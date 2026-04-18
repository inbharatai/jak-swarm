/**
 * swarm.plugin.ts
 *
 * Registers the SwarmExecutionService as `fastify.swarm`.
 * Routes call `fastify.swarm.executeAsync(...)` or
 * `fastify.swarm.resumeAfterApproval(...)` to drive workflow execution.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { Redis } from 'ioredis';
import { SwarmExecutionService } from '../services/swarm-execution.service.js';
import { SchedulerService } from '../services/scheduler.service.js';
import { WorkflowService } from '../services/workflow.service.js';
import {
  RedisSchedulerLeader,
  InMemorySchedulerLeader,
  RedisWorkflowSignalBus,
  InMemoryWorkflowSignalBus,
  RedisLockProvider,
  InMemoryLockProvider,
  withLock,
  getDistributedCircuitBreaker,
  type SchedulerLeader,
  type WorkflowSignalBus,
  type LockProvider,
} from '../coordination/index.js';
import { config } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    swarm: SwarmExecutionService;
    coordination: {
      locks: LockProvider;
      signals: WorkflowSignalBus;
      leader: SchedulerLeader;
    };
  }
}

const swarmPlugin: FastifyPluginAsync = async (fastify) => {
  // ── Distributed Coordination Layer ──────────────────────────────────
  let locks: LockProvider;
  let signals: WorkflowSignalBus;
  let leader: SchedulerLeader;
  let subscriberRedis: Redis | null = null;

  if (config.redisUrl) {
    try {
    // Use Redis for coordination if available
    locks = new RedisLockProvider(fastify.redis);
    leader = new RedisSchedulerLeader(fastify.redis);

    // Redis pub/sub requires a SEPARATE connection (subscriber is blocking)
    subscriberRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
    signals = new RedisWorkflowSignalBus(fastify.redis, subscriberRedis);

    fastify.log.info('[Coordination] Using Redis for distributed locks, signals, and leader election');
    } catch {
      locks = new InMemoryLockProvider();
      signals = new InMemoryWorkflowSignalBus();
      leader = new InMemorySchedulerLeader();
      fastify.log.warn('[Coordination] Redis unavailable — using in-memory coordination (single-instance only)');
    }
  } else {
    locks = new InMemoryLockProvider();
    signals = new InMemoryWorkflowSignalBus();
    leader = new InMemorySchedulerLeader();
    fastify.log.warn('[Coordination] REDIS_URL not set — using in-memory coordination (single-instance only)');
  }

  fastify.decorate('coordination', {
    locks,
    signals,
    leader,
    getCircuitBreaker: (name: string, opts?: { failureThreshold?: number; resetTimeoutMs?: number }) =>
      config.redisUrl
        ? getDistributedCircuitBreaker(fastify.redis, name, opts)
        : getDistributedCircuitBreaker(undefined, name, opts),
  });

  // Start leader election
  leader.start();

  // Wire per-call LLM billing hook into BaseAgent
  try {
    const agentsModule = await import('@jak-swarm/agents');
    const BaseAgentClass = (agentsModule as Record<string, unknown>)['BaseAgent'] as Record<string, unknown> | undefined;
    const { metrics } = await import('../observability/metrics.js');

    if (BaseAgentClass) {
    (BaseAgentClass as any)['onLLMCallComplete'] = (info: { model: string; provider: string; promptTokens: number; completionTokens: number; costUsd: number; agentRole: string; tenantId?: string }) => {
      // Track in Prometheus metrics
      metrics.llmTokensTotal.inc({ model: info.model, direction: 'prompt' }, info.promptTokens);
      metrics.llmTokensTotal.inc({ model: info.model, direction: 'completion' }, info.completionTokens);
      metrics.llmCostTotal.inc({ model: info.model, tenant_id: info.tenantId ?? 'unknown' }, info.costUsd);

      fastify.log.debug({
        model: info.model,
        provider: info.provider,
        tokens: info.promptTokens + info.completionTokens,
        costUsd: info.costUsd,
        agent: info.agentRole,
      }, '[billing] LLM call tracked');
    };
    }

    fastify.log.info('[billing] Per-call LLM cost tracking hook wired');
  } catch (hookErr) {
    fastify.log.warn({ err: hookErr }, '[billing] Failed to wire LLM billing hook');
  }

  const swarmService = new SwarmExecutionService(fastify.db, fastify.log);
  swarmService.setLockProvider(locks); // Distributed lock for workflow execution
  const workerMode = config.workflowWorkerMode;
  if (workerMode === 'embedded') {
    swarmService.startQueueWorker();
    fastify.log.info('[Swarm] Queue worker started in embedded mode');
  } else {
    fastify.log.warn({ workerMode }, '[Swarm] Queue worker disabled in API process (standalone mode expected)');
  }

  // Start LLM provider health monitoring
  try {
    const { startProviderHealthChecks, stopProviderHealthChecks } = await import('../billing/provider-health.js');
    startProviderHealthChecks();
    fastify.addHook('onClose', () => { stopProviderHealthChecks(); });
    fastify.log.info('[health] LLM provider health checks started (60s interval)');
  } catch {
    fastify.log.warn('[health] Provider health checks not available');
  }

  // Wire credit service for post-execution reconciliation
  try {
    const { CreditService } = await import('../billing/credit-service.js');
    const creditService = new CreditService(fastify.db);
    swarmService.setCreditService(creditService as any);
    fastify.log.info('[billing] Credit reconciliation wired to workflow execution');
  } catch {
    fastify.log.warn('[billing] CreditService not available — usage ledger will not be recorded');
  }
  // Inject distributed circuit breaker factory for shared failure state across instances
  if (config.redisUrl) {
    try {
    swarmService.setCircuitBreakerFactory((name, opts) =>
      getDistributedCircuitBreaker(fastify.redis, name, opts));
    } catch {
      fastify.log.warn('[Swarm] Distributed circuit breaker not available — using in-process breakers');
    }
  }

  // Enable cross-instance SSE relay if Redis is available
  if (config.redisUrl && subscriberRedis) {
    // Create a second subscriber connection for SSE events (separate from signals subscriber)
    try {
      const { Redis } = await import('ioredis');
      const sseSubscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
      swarmService.enableRedisRelay(fastify.redis, sseSubscriber);

      fastify.addHook('onClose', async () => {
        await sseSubscriber.quit().catch(() => {});
      });
    } catch {
      fastify.log.warn('[Swarm] SSE Redis relay not available — SSE requires sticky sessions');
    }
  }

  fastify.decorate('swarm', swarmService);
  fastify.log.info('[Swarm] SwarmExecutionService registered (with distributed lock + SSE relay)');

  // Graceful shutdown: drain in-flight jobs before closing
  fastify.addHook('onClose', async () => {
    if (workerMode !== 'embedded') return;
    fastify.log.info('[Swarm] Graceful shutdown — draining queue worker');
    await swarmService.drainQueueWorker();
    swarmService.stopQueueWorker();
  });

  // Wire workflow signals: when another instance sends pause/unpause/stop, apply locally.
  // Unpause uses a distributed lock so only one instance actually resumes the workflow.
  signals.subscribe((signal) => {
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
          fastify.log.info(
            { workflowId: signal.workflowId },
            '[Coordination] Unpause handled by another instance',
          );
        }
      })();
    }
    fastify.log.info({ signal }, '[Coordination] Received workflow signal');
  });

  // Recover stale workflows (use lock to prevent duplicate recovery across instances)
  if (workerMode === 'embedded') {
    setImmediate(async () => {
      const recovered = await withLock(locks, 'stale-workflow-recovery', 60_000, async () => {
        await swarmService.recoverStaleWorkflows();
        return true;
      });
      if (recovered === null) {
        fastify.log.info('[Swarm] Stale workflow recovery skipped (another instance is handling it)');
      }
    });
  } else {
    fastify.log.info('[Swarm] Stale workflow recovery handled by standalone worker');
  }

  // Start the workflow scheduler with leader election
  const workflowService = new WorkflowService(fastify.db, fastify.log);
  const scheduler = new SchedulerService(
    fastify.db,
    async (params) => {
      const workflow = await workflowService.createWorkflow(
        params.tenantId,
        params.userId,
        params.goal,
        params.industry,
      );
      swarmService.enqueueExecution({
        workflowId: workflow.id,
        tenantId: params.tenantId,
        userId: params.userId,
        goal: params.goal,
        industry: params.industry,
      });
      return workflow.id;
    },
    { isLeader: () => leader.isLeader() },
  );
  scheduler.start();

  // Auto-reconnect previously connected MCP integrations (tenant-scoped)
  const db = fastify.db;
  setImmediate(async () => {
    try {
      const { getTenantMcpManager, MCP_PROVIDERS } = await import('@jak-swarm/tools');
      const integrations = await db.integration.findMany({
        where: { status: 'CONNECTED' },
        include: { credentials: true },
      });

      for (const integration of integrations) {
        const providerDef = MCP_PROVIDERS[integration.provider];
        if (!providerDef || !integration.credentials?.accessTokenEnc) continue;

        try {
          const creds = JSON.parse(integration.credentials.accessTokenEnc) as Record<string, string>;
          const config = providerDef.buildConfig(creds);
          // Use tenant-scoped MCP manager instead of global singleton
          const tenantMcp = getTenantMcpManager(integration.tenantId);
          await tenantMcp.connect(integration.provider, config);
        } catch (err) {
          fastify.log.error({ err, provider: integration.provider, tenantId: integration.tenantId }, '[mcp] Failed to reconnect provider');
          // Mark as needing reauth
          await db.integration.update({
            where: { id: integration.id },
            data: { status: 'NEEDS_REAUTH' },
          });
        }
      }
    } catch (err) {
      fastify.log.error({ err }, '[mcp] Auto-reconnect failed');
    }
  });

  // Periodic cleanup: purge stale workflows and idle circuit breakers
  const purgeInterval = setInterval(async () => {
    try {
      const swarmModule = await import('@jak-swarm/swarm') as Record<string, unknown>;
      const bus = swarmModule['supervisorBus'] as { purgeStaleWorkflows?: (ms: number) => number } | undefined;
      if (bus?.purgeStaleWorkflows) {
        const purgedWorkflows = bus.purgeStaleWorkflows(30 * 60 * 1000);
        if (purgedWorkflows > 0) {
          fastify.log.warn({ purgedWorkflows }, '[Supervisor] Purged stale workflows');
        }
      }

      const purgeFn = swarmModule['purgeIdleCircuitBreakers'] as ((ms: number) => number) | undefined;
      if (purgeFn) {
        const purgedBreakers = purgeFn(60 * 60 * 1000);
        if (purgedBreakers > 0) {
          fastify.log.info({ purgedBreakers }, '[Supervisor] Purged idle circuit breakers');
        }
      }
    } catch {
      // Swarm module not available — skip periodic cleanup
    }
  }, 10 * 60 * 1000); // Run every 10 minutes

  // Clean up scheduler, purge interval, and coordination resources on server close
  fastify.addHook('onClose', async () => {
    scheduler.stop();
    swarmService.stopQueueWorker();
    clearInterval(purgeInterval);
    await leader.stop();
    await signals.close();
    if (subscriberRedis) {
      await subscriberRedis.quit().catch(() => {});
    }
    fastify.log.info('[Coordination] Cleanup complete');
  });
};

export default fp(swarmPlugin, {
  name: 'swarm-plugin',
  dependencies: ['db-plugin', 'redis-plugin'],
});
