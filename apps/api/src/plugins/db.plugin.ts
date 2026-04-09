import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@jak-swarm/db';
import { prisma } from '../db.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: PrismaClient;
  }
}

const dbPlugin: FastifyPluginAsync = async (fastify) => {
  await prisma.$connect();
  fastify.decorate('db', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
    fastify.log.info('Prisma client disconnected');
  });

  fastify.log.info('Prisma client connected');
};

export default fp(dbPlugin, {
  name: 'db-plugin',
});
