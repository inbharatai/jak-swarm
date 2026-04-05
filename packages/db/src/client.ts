import { PrismaClient } from '@prisma/client';
import { createLogger } from '@jak-swarm/shared';

const logger = createLogger('db');

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

if (process.env['NODE_ENV'] !== 'production') {
  prisma.$on('query' as never, (e: unknown) => {
    const event = e as { query: string; duration: number };
    logger.debug({ query: event.query, duration: event.duration }, 'DB query');
  });
}

prisma.$on('error' as never, (e: unknown) => {
  const event = e as { message: string };
  logger.error({ message: event.message }, 'DB error');
});

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient };
