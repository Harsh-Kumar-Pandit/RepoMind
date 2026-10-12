import { getPrismaClient, disconnectDatabase } from '../src/config/database.js';

async function verifyStep1() {
  const prisma = getPrismaClient();

  console.log('Connecting to database (handling Neon wake-up)...');
  let connected = false;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1;`;
      connected = true;
      console.log(`Connected to database on attempt ${attempt}.`);
      break;
    } catch (e) {
      console.log(`Connection attempt ${attempt} failed. Retrying in 2s (Neon cold start)...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!connected) {
    throw new Error('Could not connect to database after 10 attempts.');
  }

  console.log('--- Step 1 Verification ---');

  // 1. Check migration tracking record
  const migrations = await prisma.$queryRaw`
    SELECT id, name, applied_at FROM "_repomind_migrations" ORDER BY id;
  `;
  console.log('Migration tracking records:', migrations);
  if (!migrations.some(m => m.name === '0001_phase2_rag_schema')) {
    throw new Error('Migration 0001_phase2_rag_schema not found in _repomind_migrations!');
  }

  // 2. Check public tables
  const tables = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `;
  const tableNames = tables.map(t => t.table_name);
  console.log('Tables present:', tableNames);
  const requiredTables = ['Repository', 'RepoSnapshot', 'FileRecord', 'CodeChunk', 'SnapshotChunk', '_repomind_migrations'];
  for (const req of requiredTables) {
    if (!tableNames.includes(req)) {
      throw new Error(`Required table ${req} is missing!`);
    }
  }

  // 3. Check vector column in CodeChunk
  const vectorCol = await prisma.$queryRaw`
    SELECT column_name, data_type, udt_name 
    FROM information_schema.columns 
    WHERE table_name = 'CodeChunk' AND column_name = 'embedding';
  `;
  console.log('Vector column:', vectorCol);
  if (vectorCol.length === 0 || vectorCol[0].udt_name !== 'vector') {
    throw new Error('Vector column on CodeChunk is missing or not of type vector!');
  }

  // 4. Check foreign keys
  const fkeys = await prisma.$queryRaw`
    SELECT
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name 
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public';
  `;
  console.log('Foreign key relationships verified:', fkeys.length);

  // 5. Check unique constraints
  const uniqueConstraints = await prisma.$queryRaw`
    SELECT tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints AS tc
    WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public';
  `;
  console.log('Unique constraints verified:', uniqueConstraints.map(u => `${u.table_name}.${u.constraint_name}`));

  console.log('--- Step 1 Verification Passed Successfully ---');
  await disconnectDatabase();
}

verifyStep1().catch(async (e) => {
  console.error('Verification failed:', e);
  await disconnectDatabase();
  process.exit(1);
});
