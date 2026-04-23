
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

// Shared Prisma in development
const globalForPrisma = globalThis as unknown as {
  prismaWorker: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prismaWorker ??
  new PrismaClient({
    log: ['error', 'warn'],
  });

// Avoid creating multiple clients in dev
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaWorker = prisma;
}

export function connectDatabase() {
  return prisma.$connect()
    .then(() => logger.info('Database connected (Worker)'))
    .catch((err) => logger.error('Database connection error:', err));
}
