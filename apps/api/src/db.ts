/**
 * Prisma client singleton for the API.
 *
 * Imports from @jak-swarm/db which re-exports @prisma/client.
 * In development the client is cached on globalThis to prevent connection
 * pool exhaustion from hot-reloads.
 */
import { PrismaClient } from '@jak-swarm/db';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}
