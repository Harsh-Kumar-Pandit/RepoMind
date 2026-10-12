import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;

  const lines = sql.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') && !current.trim()) {
      continue; // Skip comments between statements
    }

    const dollarCount = (line.match(/\$\$/g) || []).length;
    if (dollarCount % 2 === 1) {
      inDollarQuote = !inDollarQuote;
    }

    current += line + '\n';

    if (!inDollarQuote && trimmed.endsWith(';')) {
      const stmt = current.trim();
      if (stmt) {
        statements.push(stmt);
      }
      current = '';
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

export function validateMigrationName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Migration name must be a non-empty string.');
  }
  const trimmed = name.trim();
  // Valid migration directory format: alphanumeric, underscore, hyphen
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error(
      `Invalid migration name '${trimmed}'. Migration name can only contain letters, numbers, underscores, and hyphens.`
    );
  }
  return trimmed;
}

/**
 * Executes a migration's statements and records its entry in `_repomind_migrations`
 * within a single atomic PostgreSQL transaction.
 *
 * If any statement fails, the entire transaction rolls back and no tracking record
 * is inserted.
 *
 * @param {object} client - A transaction-capable client implementing $transaction
 * @param {string} migrationName - Name of the migration
 * @param {string[]} statements - Array of SQL statements to execute
 * @returns {Promise<{ applied: boolean, statementsCount: number }>}
 */
export async function executeMigrationInTransaction(client, migrationName, statements) {
  return await client.$transaction(
    async (tx) => {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        await tx.$executeRawUnsafe(stmt);
      }

      // Record migration inside the same transaction
      await tx.$executeRaw`
        INSERT INTO "_repomind_migrations" ("name") VALUES (${migrationName});
      `;

      return { applied: true, statementsCount: statements.length };
    },
    {
      maxWait: 30000, // 30s max wait to acquire transaction slot
      timeout: 120000, // 2m max duration for executing all migration statements
    }
  );
}

/**
 * Creates a dedicated PrismaClient for migrations.
 * Prefers DIRECT_URL when configured (direct PostgreSQL connection without pooling),
 * falling back to DATABASE_URL.
 */
export function createMigrationClient(customUrl) {
  const datasourceUrl = customUrl || env.directUrl || env.databaseUrl;
  return new PrismaClient({
    datasources: {
      db: {
        url: datasourceUrl,
      },
    },
  });
}

export async function runMigration(specifiedName, customClient) {
  // Accept argument or CLI parameter, defaulting to '0001_phase2_rag_schema'
  const targetName = specifiedName || process.argv[2] || '0001_phase2_rag_schema';
  const migrationName = validateMigrationName(targetName);

  const migrationDir = path.join(__dirname, '../prisma/migrations', migrationName);
  const migrationPath = path.join(migrationDir, 'migration.sql');

  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Migration SQL file not found at: ${migrationPath}`);
  }

  const prisma = customClient || createMigrationClient();
  const isDedicatedClient = !customClient;

  try {
    console.log(`Connecting to database for migration '${migrationName}'...`);
    let connected = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1;`;
        connected = true;
        console.log(`Connected successfully on attempt ${attempt}.`);
        break;
      } catch (e) {
        console.log(`Connection attempt ${attempt} failed. Retrying in 3s (Neon compute cold start)...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    if (!connected) {
      throw new Error('Could not connect to database after 10 attempts.');
    }

    console.log(`Checking migration tracking table for '${migrationName}'...`);

    // Ensure migration tracking table exists
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "_repomind_migrations" (
        "id" SERIAL PRIMARY KEY,
        "name" TEXT UNIQUE NOT NULL,
        "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Check if migration has already been applied
    const existing = await prisma.$queryRaw`
      SELECT name, applied_at FROM "_repomind_migrations" WHERE name = ${migrationName};
    `;

    if (existing.length > 0) {
      console.log(`Migration '${migrationName}' was already applied at ${existing[0].applied_at}. Skipping.`);
      return { applied: false, skipped: true, name: migrationName };
    }

    console.log(`Reading SQL from: ${migrationPath}`);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const statements = splitSqlStatements(sql);

    console.log(
      `Executing ${statements.length} migration statements + tracking insert in ONE atomic transaction...`
    );

    const result = await executeMigrationInTransaction(prisma, migrationName, statements);

    console.log(
      `Migration '${migrationName}' successfully applied and recorded in transaction (${result.statementsCount} statements).`
    );

    // Validation query
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    console.log('Public tables present in database:', tables.map((t) => t.table_name));

    return { applied: true, skipped: false, name: migrationName };
  } finally {
    if (isDedicatedClient) {
      await prisma.$disconnect().catch(() => {});
    }
  }
}

// Execute directly if run from CLI
const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectExecution) {
  runMigration().catch(async (err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
