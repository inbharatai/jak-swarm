import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@jak-swarm/db';
import { prisma } from '../db.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: PrismaClient;
  }
}

/**
 * Database plugin — connects Prisma to PostgreSQL.
 *
 * On Cloud Run (and similar container runtimes) the server must start
 * listening within a strict timeout. If the database is temporarily
 * unreachable (network cold-start, maintenance window, etc.), blocking on
 * `$connect()` prevents the HTTP server from binding to the port, causing
 * Cloud Run to kill the container.
 *
 * Strategy: attempt a connection with a short timeout. If it fails, log a
 * warning and let the server start anyway. Prisma reconnections are
 * automatic — queries will fail until the database is reachable, but the
 * `/healthz` liveness probe succeeds and `/ready` reports the degraded state.
 */
const DB_CONNECT_TIMEOUT_MS = 5_000;

const dbPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('db', prisma);

  // Best-effort connection — don't block startup on DB availability.
  try {
    await Promise.race([
      prisma.$connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DB connect timeout')), DB_CONNECT_TIMEOUT_MS),
      ),
    ]);
    fastify.log.info('Prisma client connected');
  } catch (err) {
    fastify.log.warn(
      { err },
      'Prisma client could not connect to database — server will start in degraded mode; /ready will report 503 until DB is reachable',
    );
  }

  fastify.addHook('onClose', async () => {
    try {
      await prisma.$disconnect();
      fastify.log.info('Prisma client disconnected');
    } catch {
      // Best-effort disconnect during shutdown
    }
  });
};

export default fp(dbPlugin, {
  name: 'db-plugin',
});
