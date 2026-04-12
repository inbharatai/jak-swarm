/**
 * Fastify plugin that wires all observability hooks:
 *
 * 1. /metrics endpoint (Prometheus)
 * 2. /healthz (liveness) and /ready (readiness) probes
 * 3. HTTP request duration instrumentation
 * 4. X-Request-ID response headers
 * 5. SupervisorBus event → metrics bridge
 * 6. Graceful shutdown draining
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { metrics, metricsRegistry } from './metrics.js';

// ─── Shutdown state ─────────────────────────────────────────────────────────

let isShuttingDown = false;
let activeWorkflowCount = 0;

export function markShuttingDown(): void {
  isShuttingDown = true;
}

export function isInShutdown(): boolean {
  return isShuttingDown;
}

export function trackWorkflowStart(): void {
  activeWorkflowCount++;
}

export function trackWorkflowEnd(): void {
  activeWorkflowCount = Math.max(0, activeWorkflowCount - 1);
}

export function getActiveWorkflowCount(): number {
  return activeWorkflowCount;
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

const observabilityPlugin: FastifyPluginAsync = async (fastify) => {
  // ── 1. Prometheus /metrics endpoint ────────────────────────────────────
  fastify.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Content-Type', metricsRegistry.contentType);
    return reply.send(await metricsRegistry.metrics());
  });

  // ── 2. Liveness probe (/healthz) ──────────────────────────────────────
  // Returns 200 if the process is alive and not stuck. Does NOT check dependencies.
  fastify.get('/healthz', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      status: 'alive',
      uptime: process.uptime(),
      shuttingDown: isShuttingDown,
      timestamp: new Date().toISOString(),
    });
  });

  // ── 3. Readiness probe (/ready) ───────────────────────────────────────
  // Returns 200 only if all dependencies are reachable AND not shutting down.
  fastify.get('/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (isShuttingDown) {
      return reply.status(503).send({
        status: 'shutting_down',
        message: 'Server is draining. Not accepting new work.',
      });
    }

    const checks: Record<string, { status: string; latencyMs: number }> = {};
    let allHealthy = true;

    // Database check
    try {
      const dbStart = Date.now();
      await (fastify as any).db.$queryRaw`SELECT 1`;
      const dbLatency = Date.now() - dbStart;
      checks['database'] = { status: 'ok', latencyMs: dbLatency };
      metrics.healthCheckDuration.observe({ dependency: 'db' }, dbLatency / 1000);
    } catch {
      checks['database'] = { status: 'failed', latencyMs: -1 };
      allHealthy = false;
    }

    // Redis check
    try {
      const redisStart = Date.now();
      await (fastify as any).redis?.ping();
      const redisLatency = Date.now() - redisStart;
      checks['redis'] = { status: 'ok', latencyMs: redisLatency };
      metrics.healthCheckDuration.observe({ dependency: 'redis' }, redisLatency / 1000);
    } catch {
      checks['redis'] = { status: 'unavailable', latencyMs: -1 };
      // Redis is optional — don't fail readiness for it
    }

    return reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'ready' : 'not_ready',
      checks,
      activeWorkflows: activeWorkflowCount,
      timestamp: new Date().toISOString(),
    });
  });

  // ── 4. HTTP request instrumentation ───────────────────────────────────
  fastify.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as any)._startTime = process.hrtime.bigint();
  });

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = (request as any)._startTime as bigint | undefined;
    if (startTime) {
      const durationNs = Number(process.hrtime.bigint() - startTime);
      const durationSec = durationNs / 1e9;

      // Normalize route (replace params with :param)
      const route = request.routeOptions?.url ?? request.url;

      metrics.httpRequestDuration.observe(
        { method: request.method, route, status_code: String(reply.statusCode) },
        durationSec,
      );
    }
  });

  // ── 5. X-Request-ID response header ───────────────────────────────────
  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('X-Request-ID', request.id);
  });

  // ── 6. Reject new workflows during shutdown ───────────────────────────
  // Workflows routes can check isInShutdown() before accepting new work.
  // This is an informational hook — the /ready probe already returns 503.

  // ── 7. Wire SupervisorBus events to metrics + Redis cross-instance relay ──
  try {
    const { supervisorBus } = await import('@jak-swarm/swarm');
    const instanceId = `jak-${process.pid}-${Date.now().toString(36)}`;
    const SUPERVISOR_CHANNEL = 'jak:supervisor:events';

    // Helper: apply event to local metrics (called for both local and remote events)
    const applyEventToMetrics = (type: string, event: Record<string, unknown>) => {
      if (type === 'workflow:started') {
        metrics.workflowsTotal.inc({ status: 'started', tenant_id: String(event['tenantId'] ?? '') });
        metrics.activeWorkflows.inc({ tenant_id: String(event['tenantId'] ?? '') });
        trackWorkflowStart();
      } else if (type === 'workflow:completed') {
        const status = String(event['status'] ?? 'completed');
        metrics.workflowsTotal.inc({ status, tenant_id: String(event['tenantId'] ?? '') });
        metrics.activeWorkflows.dec({ tenant_id: String(event['tenantId'] ?? '') });
        trackWorkflowEnd();
        if (typeof event['durationMs'] === 'number') {
          metrics.workflowDuration.observe({ status, tenant_id: String(event['tenantId'] ?? '') }, event['durationMs'] / 1000);
        }
      } else if (type === 'node:completed') {
        if (event['node'] && typeof event['durationMs'] === 'number') {
          metrics.agentExecutions.inc({ agent_role: String(event['node']), status: event['success'] ? 'success' : 'failure' });
          metrics.agentDuration.observe({ agent_role: String(event['node']) }, event['durationMs'] / 1000);
        }
      } else if (type === 'circuit:open') {
        metrics.circuitBreakerTrips.inc({ breaker_name: String(event['service'] ?? 'unknown') });
        metrics.circuitBreakerState.set({ breaker_name: String(event['service'] ?? 'unknown') }, 1);
      } else if (type === 'approval:required') {
        metrics.approvalRequests.inc({ decision: 'pending' });
      }
    };

    // Subscribe to LOCAL supervisor events → publish to Redis + apply metrics
    const eventTypes = ['workflow:started', 'workflow:completed', 'node:entered', 'node:completed', 'circuit:open', 'approval:required', 'budget:exceeded'] as const;
    for (const eventType of eventTypes) {
      supervisorBus.subscribe(eventType, (event: unknown) => {
        const e = event as Record<string, unknown>;
        applyEventToMetrics(eventType, e);

        // Publish to Redis for cross-instance propagation
        try {
          const redis = (fastify as unknown as { redis?: { publish: (ch: string, msg: string) => void } }).redis;
          if (redis) {
            redis.publish(SUPERVISOR_CHANNEL, JSON.stringify({ type: eventType, event: e, sourceInstance: instanceId }));
          }
        } catch {
          // Redis not available — local-only mode
        }
      });
    }

    // Subscribe to REMOTE supervisor events from Redis → re-emit locally for SSE consumers
    try {
      const redis = (fastify as unknown as { redis?: unknown }).redis;
      if (redis) {
        const { Redis } = await import('ioredis');
        const config = (await import('../config.js')).config;
        const subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });

        subscriber.subscribe(SUPERVISOR_CHANNEL).catch((err: unknown) => {
          fastify.log.warn({ err }, '[observability] Failed to subscribe to supervisor Redis channel');
        });

        subscriber.on('message', (_channel: unknown, message: unknown) => {
          try {
            const parsed = JSON.parse(String(message)) as { type: string; event: Record<string, unknown>; sourceInstance: string };
            // Only process events from OTHER instances (avoid double-counting local events)
            if (parsed.sourceInstance !== instanceId) {
              // Re-emit on local supervisor bus so SSE handlers receive it
              supervisorBus.emit(parsed.type, parsed.event);
              // Note: metrics NOT applied here — the emitting instance already applied them locally.
              // Remote instances only need the event for SSE forwarding.
            }
          } catch {
            // Malformed message — ignore
          }
        });

        fastify.addHook('onClose', async () => {
          await subscriber.quit().catch(() => {});
        });

        fastify.log.info('[observability] SupervisorBus Redis cross-instance relay active');
      }
    } catch {
      fastify.log.warn('[observability] Redis relay not available — supervisor events local only');
    }

    fastify.log.info('[observability] SupervisorBus metrics bridge wired');
  } catch {
    fastify.log.warn('[observability] @jak-swarm/swarm not available — supervisor metrics disabled');
  }

  // ── 8. Graceful shutdown draining ─────────────────────────────────────
  fastify.addHook('onClose', async () => {
    markShuttingDown();

    // Wait for in-flight workflows to finish (up to 30s)
    const drainStart = Date.now();
    const maxDrainMs = 30_000;

    while (activeWorkflowCount > 0 && Date.now() - drainStart < maxDrainMs) {
      fastify.log.info({ activeWorkflows: activeWorkflowCount }, '[shutdown] Draining in-flight workflows...');
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (activeWorkflowCount > 0) {
      fastify.log.warn({ activeWorkflows: activeWorkflowCount }, '[shutdown] Drain timeout — forcing shutdown with workflows still running');
    } else {
      fastify.log.info('[shutdown] All workflows drained successfully');
    }
  });

  fastify.log.info('[observability] Plugin registered: /metrics, /healthz, /ready, request instrumentation');
};

export const registerObservability = fp(observabilityPlugin, {
  name: 'observability-plugin',
});
