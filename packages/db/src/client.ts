import { PrismaClient } from '@prisma/client';
import { createLogger } from '@jak-swarm/shared';
import { workflowEncryptionExtension } from './extensions/workflow-encryption.js';

const logger = createLogger('db');

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

// Base client + log listeners. Listeners MUST attach before the
// extension wraps the client (extended clients don't expose $on).
const baseClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

if (process.env['NODE_ENV'] !== 'production') {
  baseClient.$on('query' as never, (e: unknown) => {
    const event = e as { query: string; duration: number };
    logger.debug({ query: event.query, duration: event.duration }, 'DB query');
  });
}

baseClient.$on('error' as never, (e: unknown) => {
  const event = e as { message: string };
  logger.error({ message: event.message }, 'DB error');
});

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = baseClient;
}

// Local Sprint 3 — at-rest field encryption for workflows.{goal,error,
// finalOutput,planJson,stateJson}. No-op when JAK_FIELD_ENCRYPTION_KEY
// is unset (default in dev). See packages/db/src/extensions/workflow-encryption.ts
// and docs/workflow-pii-storage-policy.md.
//
// The cast is necessary because $extends returns a more restrictive
// type that Typescript can't widen back to PrismaClient. The extension
// only adds query interceptors — it never removes operations — so the
// runtime surface is identical.
export const prisma = baseClient.$extends(workflowEncryptionExtension) as unknown as PrismaClient;

export type { PrismaClient };
