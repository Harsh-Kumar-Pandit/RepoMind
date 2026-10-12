import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnv, parseCorsOrigins } from '../src/config/env.js';
import { validateMigrationName, splitSqlStatements } from '../scripts/run-migration.js';

test('Step 3A — Configuration & CORS Validation', async (t) => {
  await t.test('parseCorsOrigins splits comma-separated URLs and trims whitespace', () => {
    assert.deepEqual(parseCorsOrigins('http://localhost:5173, http://127.0.0.1:5173 '), [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
    assert.deepEqual(parseCorsOrigins(''), []);
    assert.deepEqual(parseCorsOrigins(null), []);
  });

  await t.test('validateEnv accepts explicit origin allowlists', () => {
    const validConfig = {
      databaseUrl: 'postgresql://user:pass@localhost:5432/db',
      corsOrigin: 'http://localhost:5173,http://localhost:3000',
    };
    assert.doesNotThrow(() => validateEnv(validConfig));
  });

  await t.test('validateEnv rejects wildcard origin "*"', () => {
    const wildcardConfig = {
      databaseUrl: 'postgresql://user:pass@localhost:5432/db',
      corsOrigin: '*',
    };
    assert.throws(
      () => validateEnv(wildcardConfig),
      /CORS_ORIGIN cannot be "\*"/i
    );
  });

  await t.test('validateEnv rejects wildcard inside multiple origins', () => {
    const mixedConfig = {
      databaseUrl: 'postgresql://user:pass@localhost:5432/db',
      corsOrigin: 'http://localhost:5173,*',
    };
    assert.throws(
      () => validateEnv(mixedConfig),
      /CORS_ORIGIN cannot be "\*"/i
    );
  });

  await t.test('validateEnv rejects empty or missing CORS_ORIGIN', () => {
    const emptyConfig = {
      databaseUrl: 'postgresql://user:pass@localhost:5432/db',
      corsOrigin: '',
    };
    assert.throws(
      () => validateEnv(emptyConfig),
      /CORS_ORIGIN environment variable is required/i
    );
  });

  await t.test('validateEnv rejects missing DATABASE_URL', () => {
    const noDbConfig = {
      databaseUrl: '',
      corsOrigin: 'http://localhost:5173',
    };
    assert.throws(
      () => validateEnv(noDbConfig),
      /DATABASE_URL environment variable is required/i
    );
  });
});

test('Step 3A — Migration Runner Name & SQL Parsing Validation', async (t) => {
  await t.test('validateMigrationName accepts valid alphanumeric and hyphenated names', () => {
    assert.equal(validateMigrationName('0001_phase2_rag_schema'), '0001_phase2_rag_schema');
    assert.equal(validateMigrationName('0002_phase3_auth_workspace'), '0002_phase3_auth_workspace');
    assert.equal(validateMigrationName('init-migration'), 'init-migration');
  });

  await t.test('validateMigrationName rejects traversal or malicious characters', () => {
    assert.throws(() => validateMigrationName('../evil'), /Invalid migration name/i);
    assert.throws(() => validateMigrationName('0001; DROP TABLE users;'), /Invalid migration name/i);
    assert.throws(() => validateMigrationName(''), /Migration name must be a non-empty string/i);
    assert.throws(() => validateMigrationName(null), /Migration name must be a non-empty string/i);
  });

  await t.test('splitSqlStatements correctly handles multi-statement SQL with dollar-quoted blocks', () => {
    const sql = `
      -- Comment line
      CREATE EXTENSION IF NOT EXISTS vector;

      DO $$ BEGIN
        CREATE TYPE "IndexingStatus" AS ENUM ('PENDING', 'COMPLETED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;

      CREATE TABLE "TestTable" ( "id" TEXT NOT NULL PRIMARY KEY );
    `;

    const stmts = splitSqlStatements(sql);
    assert.equal(stmts.length, 3);
    assert.match(stmts[0], /CREATE EXTENSION/);
    assert.match(stmts[1], /DO \$\$ BEGIN/);
    assert.match(stmts[2], /CREATE TABLE "TestTable"/);
  });
});

test('Step 3A — Migration Runner Atomic Transaction & Rollback Behavior', async (t) => {
  const { executeMigrationInTransaction, runMigration } = await import('../scripts/run-migration.js');

  await t.test('executes all statements and tracking insert inside one transaction', async () => {
    const executedStatements = [];
    const mockTx = {
      $executeRawUnsafe: async (sql) => {
        executedStatements.push(sql);
      },
      $executeRaw: async (queryParts, ...values) => {
        executedStatements.push({ queryParts, values });
      },
    };

    const mockClient = {
      $transaction: async (callback, options) => {
        assert.ok(options.timeout >= 60000, 'Transaction timeout should be at least 60s');
        return await callback(mockTx);
      },
    };

    const statements = [
      'CREATE TABLE "Alpha" ("id" TEXT PRIMARY KEY);',
      'CREATE TABLE "Beta" ("id" TEXT PRIMARY KEY);',
    ];

    const result = await executeMigrationInTransaction(mockClient, '0002_phase3_auth_workspace', statements);

    assert.equal(result.applied, true);
    assert.equal(result.statementsCount, 2);
    assert.equal(executedStatements.length, 3); // 2 DDL statements + 1 tracking insert
    assert.equal(executedStatements[0], statements[0]);
    assert.equal(executedStatements[1], statements[1]);
    // The 3rd execution is the tracking insert
    assert.ok(executedStatements[2].values.includes('0002_phase3_auth_workspace'));
  });

  await t.test('aborts transaction and throws if any statement fails mid-run', async () => {
    let rolledBack = false;
    const executedStatements = [];

    const mockTx = {
      $executeRawUnsafe: async (sql) => {
        executedStatements.push(sql);
        if (sql.includes('FAIL_HERE')) {
          throw new Error('Simulated syntax error in statement');
        }
      },
      $executeRaw: async () => {
        executedStatements.push('TRACKING_INSERT');
      },
    };

    const mockClient = {
      $transaction: async (callback) => {
        try {
          return await callback(mockTx);
        } catch (err) {
          rolledBack = true;
          throw err;
        }
      },
    };

    const statements = [
      'CREATE TABLE "Alpha" ("id" TEXT PRIMARY KEY);',
      'FAIL_HERE;',
      'CREATE TABLE "Beta" ("id" TEXT PRIMARY KEY);',
    ];

    await assert.rejects(
      async () => {
        await executeMigrationInTransaction(mockClient, '0002_phase3_auth_workspace', statements);
      },
      /Simulated syntax error/
    );

    assert.equal(rolledBack, true);
    // Statement 3 should never be executed
    assert.equal(executedStatements.length, 2);
    // Tracking insert should never be executed
    assert.ok(!executedStatements.includes('TRACKING_INSERT'));
  });

  await t.test('skips execution if migration is already present in _repomind_migrations', async () => {
    let transactionStarted = false;
    const mockClient = {
      $connect: async () => {},
      $queryRaw: async (queryParts, ...values) => {
        const queryStr = String(queryParts);
        if (queryStr.includes('SELECT 1')) return [{ 1: 1 }];
        if (queryStr.includes('_repomind_migrations')) {
          // Simulate that migration already exists
          return [{ name: '0001_phase2_rag_schema', applied_at: new Date() }];
        }
        return [];
      },
      $executeRawUnsafe: async () => {},
      $transaction: async () => {
        transactionStarted = true;
      },
      $disconnect: async () => {},
    };

    const res = await runMigration('0001_phase2_rag_schema', mockClient);

    assert.equal(res.skipped, true);
    assert.equal(res.applied, false);
    assert.equal(transactionStarted, false);
  });
});

