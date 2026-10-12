import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env.js';

const prisma = new PrismaClient({
  datasourceUrl: env.databaseUrl,
});

async function main() {
  console.log('Connecting to database...');
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
  
  console.log('Enabling pgvector extension...');
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector;`);
  
  console.log('Creating test_items table with vector column...');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS test_items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      embedding vector(3)
    );
  `);
  
  console.log('Clearing old test items...');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE test_items;`);

  console.log('Inserting test vectors...');
  await prisma.$executeRaw`
    INSERT INTO test_items (name, embedding) VALUES 
    ('item1', '[1.0, 0.0, 0.0]'::vector),
    ('item2', '[0.0, 1.0, 0.0]'::vector),
    ('item3', '[0.0, 0.0, 1.0]'::vector);
  `;
  
  console.log('Running vector similarity query...');
  const searchVector = '[1.0, 0.1, 0.0]';
  const results = await prisma.$queryRaw`
    SELECT name, embedding::text, 1 - (embedding <=> ${searchVector}::vector) as similarity
    FROM test_items
    ORDER BY embedding <=> ${searchVector}::vector
    LIMIT 1;
  `;
  
  console.log('Query results:', results);

  if (results.length > 0 && results[0].name === 'item1') {
    console.log('pgvector similarity search succeeded!');
  } else {
    console.error('Unexpected results:', results);
    throw new Error('Vector similarity search failed or returned unexpected results.');
  }
  
  console.log('Cleaning up test table...');
  await prisma.$executeRawUnsafe(`DROP TABLE test_items;`);
  
  console.log('Test completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
