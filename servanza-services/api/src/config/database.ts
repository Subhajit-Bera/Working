import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

// Handle hot-reload in dev
const globalForPrisma = globalThis as unknown as { prismaApi?: PrismaClient };

export const prisma =
  globalForPrisma.prismaApi ??
  new PrismaClient({
    log: ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaApi = prisma;
}

export async function connectDatabase() {
  try {
    await prisma.$connect();
    logger.info('[API] Database connected successfully');
  } catch (error) {
    logger.error('[API] Database connection error:', error);
  }
}
