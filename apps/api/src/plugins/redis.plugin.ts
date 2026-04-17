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

  async set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
    // Supports: SET key value [PX ms] [NX]
    const nx = args.includes('NX');
    const pxIndex = args.indexOf('PX');
    const ttlMs = pxIndex !== -1 ? Number(args[pxIndex + 1]) : 0;

    if (nx && this.store.has(key)) {
      return null;
    }

    this.clearTimer(key);
    this.store.set(key, value);

    if (ttlMs > 0) {
      const timeout = setTimeout(() => {
        this.store.delete(key);
        this.timers.delete(key);
      }, ttlMs);
      this.timers.set(key, timeout);
    }

    return 'OK';
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

  async incr(key: string): Promise<number> {
    const current = parseInt(this.store.get(key) ?? '0', 10);
    const next = current + 1;
    this.store.set(key, String(next));
    return next;
  }

  async pexpire(key: string, ms: number): Promise<number> {
    if (!this.store.has(key)) return 0;
    this.clearTimer(key);
    const timeout = setTimeout(() => {
      this.store.delete(key);
      this.timers.delete(key);
    }, ms);
    this.timers.set(key, timeout);
    return 1;
  }

  async eval(..._args: unknown[]): Promise<unknown> {
    // Lua scripts can't run in-memory; return 0 (no-op) for lock release scripts
    return 0;
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
    if (config.nodeEnv === 'production' && config.requireRedisInProd) {
      throw new Error('REDIS_URL is required in production when REQUIRE_REDIS_IN_PROD=true');
    }
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
