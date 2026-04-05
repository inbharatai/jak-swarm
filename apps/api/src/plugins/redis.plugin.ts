import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { Redis } from 'ioredis';
import { config } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on('error', (err: Error) => {
    fastify.log.error({ err }, 'Redis connection error');
  });

  client.on('connect', () => {
    fastify.log.info('Redis connected');
  });

  client.on('ready', () => {
    fastify.log.info('Redis ready');
  });

  client.on('reconnecting', () => {
    fastify.log.warn('Redis reconnecting...');
  });

  fastify.decorate('redis', client);

  fastify.addHook('onClose', async () => {
    await client.quit();
    fastify.log.info('Redis client closed');
  });
};

export default fp(redisPlugin, {
  name: 'redis-plugin',
});
