import { createServer } from 'node:http';
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
import { metricsRegistry, metrics } from './observability/metrics.js';

/**
 * Validate worker-specific env vars. Fail fast with a clear, actionable
 * message rather than limping along with mystery NPE-like errors at first
 * queue poll. `DATABASE_URL` is already checked by config.ts; we add the
 * worker-specific layer here.
 */
function validateWorkerEnv(log: pino.Logger): void {
  const problems: string[] = [];
  if (!config.databaseUrl) {
    problems.push('DATABASE_URL is required (worker cannot run without Postgres)');
  }
  if (!config.redisUrl && config.nodeEnv === 'production') {
    problems.push(
      'REDIS_URL strongly recommended in production (without it: no cross-instance signals, no SSE relay, no distributed locks — workers become single-tenant effective)',
    );
  }
  if (config.nodeEnv === 'production' && !process.env['WORKFLOW_WORKER_INSTANCE_ID']) {
    log.warn(
      '[Worker] WORKFLOW_WORKER_INSTANCE_ID not set; falling back to hostname or UUID. Pod name / hostname is strongly recommended so reclaim logs correlate with dead workers.',
    );
  }
  if (problems.length > 0) {
    for (const p of problems) log.error(`[Worker] Env validation: ${p}`);
    if (config.nodeEnv === 'production') {
      log.fatal('[Worker] Refusing to start in production with missing required env');
      process.exit(1);
    }
  }
}

async function main(): Promise<void> {
  const log = pino({
    level: config.logLevel,
    transport:
      config.nodeEnv === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  });

  validateWorkerEnv(log);

  const instanceId =
    process.env['WORKFLOW_WORKER_INSTANCE_ID'] ??
    process.env['HOSTNAME'] ??
    `worker-${process.pid}`;
  const metricsPort = Number(process.env['WORKER_METRICS_PORT'] ?? '9464');
  const concurrency = Number(process.env['WORKFLOW_QUEUE_CONCURRENCY'] ?? '2');
  const leaseTtlMs = Number(process.env['WORKFLOW_QUEUE_LEASE_TTL_MS'] ?? '60000');

  log.info(
    {
      mode: 'standalone',
      instanceId,
      metricsPort,
      concurrency,
      leaseTtlMs,
      nodeEnv: config.nodeEnv,
      redisConfigured: Boolean(config.redisUrl),
    },
    '[Worker] Starting',
  );

  await prisma.$connect();
  log.info('[Worker] Prisma client connected');
  try {
    metrics.postgresConnectivityStatus.set(1);
  } catch { /* swallow */ }

  let redis: Redis | null = null;
  let signalsRedis: Redis | null = null;
  let sseRedis: Redis | null = null;
  let shuttingDown = false;

  if (config.redisUrl) {
    try {
      redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
      signalsRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
      sseRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
      log.info('[Worker] Redis connections established');
      try {
        metrics.redisConnectivityStatus.set(1);
      } catch { /* swallow */ }
    } catch (err) {
      log.warn({ err }, '[Worker] Redis unavailable — running without distributed coordination');
      redis = null;
      try {
        metrics.redisConnectivityStatus.set(0);
      } catch { /* swallow */ }
    }
  } else {
    log.warn('[Worker] REDIS_URL not set — running without distributed coordination');
    try {
      metrics.redisConnectivityStatus.set(0);
    } catch { /* swallow */ }
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

  // Apply workflow signals from other instances.
  // Unpause uses a distributed lock so only one instance resumes the workflow.
  signals.subscribe((signal) => {
    try {
      metrics.workflowSignalTotal.inc({ signal_type: signal.type });
    } catch { /* swallow */ }
    if (signal.type === 'pause') {
      swarmService.pauseWorkflow(signal.workflowId);
    } else if (signal.type === 'stop') {
      swarmService.stopWorkflow(signal.workflowId);
    } else if (signal.type === 'unpause') {
      swarmService.unpauseWorkflow(signal.workflowId); // idempotent
      void (async () => {
        const acquired = await withLock(locks, `resume:${signal.workflowId}`, 60_000, async () => {
          await swarmService.resumeWorkflow(signal.workflowId);
          return true;
        });
        if (acquired === null) {
          log.info(
            { workflowId: signal.workflowId },
            '[Worker] Unpause handled by another instance',
          );
        }
      })();
    }
    log.info({ signal }, '[Worker] Received workflow signal');
  });

  // ─── /metrics + /healthz HTTP server ──────────────────────────────────
  // The worker exposes its own metrics endpoint separate from the API so
  // Prometheus can scrape every worker instance directly. Also exposes
  // /healthz for container orchestrators that poll it.
  const metricsServer = createServer((req, res) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && url.startsWith('/metrics')) {
      metricsRegistry
        .metrics()
        .then((body) => {
          res.writeHead(200, { 'Content-Type': metricsRegistry.contentType });
          res.end(body);
        })
        .catch((err: unknown) => {
          log.error({ err }, '[Worker] Metrics scrape failed');
          res.writeHead(500);
          res.end('metrics-error');
        });
      return;
    }
    if (req.method === 'GET' && url.startsWith('/healthz')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: shuttingDown ? 'draining' : 'ok', instanceId }));
      return;
    }
    if (req.method === 'GET' && url.startsWith('/ready')) {
      // Readiness: connected to Postgres AND (if configured) to Redis.
      const ready = Boolean(redis) || !config.redisUrl; // Redis optional in dev
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ready,
          instanceId,
          redisConfigured: Boolean(config.redisUrl),
          draining: shuttingDown,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end('not-found');
  });
  metricsServer.listen(metricsPort, '0.0.0.0', () => {
    log.info({ metricsPort }, '[Worker] Metrics server listening');
  });
  metricsServer.on('error', (err) => {
    log.error({ err }, '[Worker] Metrics server error');
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

  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ reason }, '[Worker] Graceful shutdown requested');

    await swarmService.drainQueueWorker();
    swarmService.stopQueueWorker();

    // Close metrics server so k8s removes this pod from load balancer targets
    await new Promise<void>((resolve) => metricsServer.close(() => resolve()));

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
