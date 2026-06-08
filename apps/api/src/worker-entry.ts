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
import { ensureModelMap } from '@jak-swarm/agents';

if (process.env['NODE_ENV'] !== 'production') {
  process.setMaxListeners(Math.max(process.getMaxListeners(), 100));
}

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
    // Honor the REQUIRE_REDIS_IN_PROD escape hatch (same flag the API
    // checks at apps/api/src/config.ts). Setting it to 'false' permits
    // booting in degraded single-instance mode — no cross-instance
    // signals, no SSE relay, no distributed locks. Useful for a new
    // deploy while Upstash hasn't been wired yet.
    const requireRedis =
      (process.env['REQUIRE_REDIS_IN_PROD'] ?? 'true').toLowerCase() !== 'false';
    if (requireRedis) {
      problems.push(
        'REDIS_URL required in production (set REQUIRE_REDIS_IN_PROD=false to run in degraded single-instance mode without cross-instance signals / SSE relay / distributed locks)',
      );
    } else {
      log.warn(
        '[Worker] REDIS_URL not set and REQUIRE_REDIS_IN_PROD=false — running in degraded single-instance mode (no cross-instance signals / SSE relay / distributed locks)',
      );
    }
  }
  if (config.nodeEnv === 'production' && !process.env['WORKFLOW_WORKER_INSTANCE_ID']) {
    log.warn(
      '[Worker] WORKFLOW_WORKER_INSTANCE_ID not set; falling back to hostname or UUID. Pod name / hostname is strongly recommended so reclaim logs correlate with dead workers.',
    );
  }
  if (problems.length > 0) {
    for (const p of problems) log.error(`[Worker] Env validation: ${p}`);
    // On Cloud Run the container MUST start listening within a strict
    // timeout. Exiting prevents the port from binding, causing a crash
    // loop. Log errors instead and let /healthz keep the container alive.
    // /ready reports the degraded state so load balancers stop routing.
    if (config.nodeEnv === 'production') {
      log.fatal('[Worker] Missing required env vars — starting in degraded mode; /ready will report 503');
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
  const openaiKeyPresent = Boolean(process.env['OPENAI_API_KEY']);
  const gitCommit =
    process.env['RAILWAY_GIT_COMMIT_SHA'] ??
    process.env['RENDER_GIT_COMMIT'] ??
    process.env['GIT_COMMIT'] ??
    'unknown';
  const gitBranch =
    process.env['RAILWAY_GIT_BRANCH'] ??
    process.env['RENDER_GIT_BRANCH'] ??
    'unknown';

  log.info(
    {
      mode: 'standalone',
      instanceId,
      metricsPort,
      concurrency,
      leaseTtlMs,
      nodeEnv: config.nodeEnv,
      openaiKeyPresent,
      redisConfigured: Boolean(config.redisUrl),
      gitCommit,
      gitBranch,
    },
    '[Worker] Starting',
  );
  log.info(
    {
      nodeEnv: config.nodeEnv,
      openaiKeyPresent,
      redisConfigured: Boolean(config.redisUrl),
    },
    '[Worker] Environment loaded',
  );

  // Best-effort DB connection — don't block startup. On Cloud Run the
  // container must start listening within a strict timeout. If the DB is
  // temporarily unreachable, Prisma reconnects automatically and /healthz
  // keeps the container alive while /ready reports 503.
  try {
    await prisma.$connect();
    log.info('[Worker] Prisma client connected');
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[Worker] Prisma client could not connect — worker starting in degraded mode; /ready will report 503 until DB is reachable',
    );
  }
  try {
    metrics.postgresConnectivityStatus.set(1);
  } catch { /* swallow */ }

  // Warm the OpenAI ModelResolver cache at worker boot. If /v1/models is
  // unavailable, the resolver keeps GPT-5.5/5.4 configured defaults and
  // fails loudly at call time instead of falling back to older models.
  void ensureModelMap().catch((err) => {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[Worker] ensureModelMap() at boot failed; resolver will keep GPT-5.5/5.4 configured defaults',
    );
  });

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
  log.info('[Worker] Waiting for jobs');

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
      const expected = process.env['METRICS_TOKEN']?.trim();
      if (!expected && config.nodeEnv === 'production') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'metrics endpoint is not exposed without METRICS_TOKEN' }));
        return;
      }
      if (expected) {
        const provided = (() => {
          const header = req.headers.authorization;
          if (typeof header === 'string' && header.startsWith('Bearer ')) {
            return header.slice(7);
          }
          const query = new URL(req.url ?? '/', 'http://worker.local').searchParams;
          return query.get('token') ?? undefined;
        })();
        if (provided !== expected) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'metrics endpoint requires bearer token' }));
          return;
        }
      }
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
    if (req.method === 'GET' && url.startsWith('/version')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        gitCommit: process.env['RENDER_GIT_COMMIT'] ?? process.env['GIT_COMMIT'] ?? 'unknown',
        gitBranch: process.env['RENDER_GIT_BRANCH'] ?? 'unknown',
        buildId: process.env['RENDER_INSTANCE_ID'] ?? 'unknown',
        uptimeSeconds: Math.round(process.uptime()),
        instanceId,
      }));
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
