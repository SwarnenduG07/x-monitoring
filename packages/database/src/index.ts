import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});


export type DbContext = {
  prisma: PrismaClient;
};


export function createDbContext(): DbContext {
  return { prisma };
}


export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}


export async function dbHealthCheck(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
} 