import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { Redis } from 'ioredis';
import { config } from '../config.js';

class InMemoryRedisShim {
  private store = new Map<string, string>();
  private timers = new Map<string, NodeJS.Timeout>();

  on(): this {
    return this;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.clearTimer(key);
    this.store.set(key, value);
    const timeout = setTimeout(() => {
      this.store.delete(key);
      this.timers.delete(key);
    }, seconds * 1000);
    this.timers.set(key, timeout);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        deleted++;
      }
      this.clearTimer(key);
    }
    return deleted;
  }

  async publish(): Promise<number> {
    return 0;
  }

  async quit(): Promise<'OK'> {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    return 'OK';
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  if (!config.redisUrl) {
    fastify.decorate('redis', new InMemoryRedisShim() as unknown as Redis);
    fastify.log.warn('REDIS_URL not set; using in-memory Redis shim (single-instance mode)');
    return;
  }

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
