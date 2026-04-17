import { Redis } from 'ioredis';
import pino from 'pino';
import { config } from './config.js';
import { prisma } from './db.js';
import { SwarmExecutionService } from './services/swarm-execution.service.js';
import {
  RedisLockProvider,
  InMemoryLockProvider,
  RedisWorkflowSignalBus,
  InMemoryWorkflowSignalBus,
  getDistributedCircuitBreaker,
  withLock,
} from './coordination/index.js';

async function main(): Promise<void> {
  const log = pino({
    level: config.logLevel,
    transport:
      config.nodeEnv === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  });

  await prisma.$connect();
  log.info('[Worker] Prisma client connected');

  let redis: Redis | null = null;
  let signalsRedis: Redis | null = null;
  let sseRedis: Redis | null = null;

  if (config.redisUrl) {
    try {
      redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
      signalsRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
      sseRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
      log.info('[Worker] Redis connections established');
    } catch (err) {
      log.warn({ err }, '[Worker] Redis unavailable — running without distributed coordination');
      redis = null;
    }
  } else {
    log.warn('[Worker] REDIS_URL not set — running without distributed coordination');
  }

  const locks = redis ? new RedisLockProvider(redis) : new InMemoryLockProvider();
  const signals = redis && signalsRedis
    ? new RedisWorkflowSignalBus(redis, signalsRedis)
    : new InMemoryWorkflowSignalBus();

  const swarmService = new SwarmExecutionService(prisma, log);
  swarmService.setLockProvider(locks);

  if (redis) {
    swarmService.setCircuitBreakerFactory((name, opts) =>
      getDistributedCircuitBreaker(redis!, name, opts));
  }

  if (redis && sseRedis) {
    swarmService.enableRedisRelay(redis, sseRedis);
  } else {
    log.warn('[Worker] SSE Redis relay disabled — events stay local');
  }

  // Wire credit reconciliation
  try {
    const { CreditService } = await import('./billing/credit-service.js');
    const creditService = new CreditService(prisma);
    swarmService.setCreditService(creditService as any);
    log.info('[Worker] Credit reconciliation enabled');
  } catch {
    log.warn('[Worker] CreditService not available — usage ledger will not be recorded');
  }

  // Start queue worker
  swarmService.startQueueWorker();
  log.info({ mode: 'standalone' }, '[Worker] Queue worker started');

  // Apply workflow signals from other instances
  signals.subscribe((signal) => {
    if (signal.type === 'pause') {
      swarmService.pauseWorkflow(signal.workflowId);
    } else if (signal.type === 'stop') {
      swarmService.stopWorkflow(signal.workflowId);
    }
    log.info({ signal }, '[Worker] Received workflow signal');
  });

  // Recover stale workflows on boot (coordinated)
  setImmediate(async () => {
    const recovered = await withLock(locks, 'stale-workflow-recovery', 60_000, async () => {
      await swarmService.recoverStaleWorkflows();
      return true;
    });
    if (recovered === null) {
      log.info('[Worker] Stale workflow recovery skipped (another instance is handling it)');
    }
  });

  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ reason }, '[Worker] Graceful shutdown requested');

    await swarmService.drainQueueWorker();
    swarmService.stopQueueWorker();

    if (redis) await redis.quit().catch(() => {});
    if (signalsRedis) await signalsRedis.quit().catch(() => {});
    if (sseRedis) await sseRedis.quit().catch(() => {});

    await prisma.$disconnect();
    log.info('[Worker] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});
