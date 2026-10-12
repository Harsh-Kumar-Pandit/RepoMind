import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

let prisma;

export const connectDatabase = () => {
  if (!prisma) {
    prisma = new PrismaClient({
      datasourceUrl: env.databaseUrl,
    });
  }
  return prisma;
};

export const getPrismaClient = () => {
  if (!prisma) {
    return connectDatabase();
  }
  return prisma;
};

export const disconnectDatabase = async () => {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
};
