import { getPrismaClient, disconnectDatabase } from '../src/config/database.js';

async function main() {
  const prisma = getPrismaClient();
  const tables = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `;
  console.log('Existing tables in public schema:', tables);
  await disconnectDatabase();
}

main().catch(console.error);
