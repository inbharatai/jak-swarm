/**
 * Prisma client singleton for the API.
 *
 * Local Sprint 3 — switched to import the EXTENDED `prisma` from
 * `@jak-swarm/db`. Previously this file created its own bare
 * PrismaClient, which silently bypassed the workflow-encryption
 * extension wired in `packages/db/src/client.ts`. Result: writes
 * went straight to the DB plaintext even with JAK_FIELD_ENCRYPTION_KEY
 * set. The extended client preserves all behaviour (hot-reload
 * caching is handled inside @jak-swarm/db) and adds at-rest
 * encryption for workflow goal/error/finalOutput/planJson/stateJson.
 */
import { prisma as extendedPrisma, type PrismaClient } from '@jak-swarm/db';

export const prisma: PrismaClient = extendedPrisma;
