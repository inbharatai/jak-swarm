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

  // ── 7. Wire SupervisorBus events to metrics ───────────────────────────
  try {
    const { supervisorBus } = await import('@jak-swarm/swarm');

    supervisorBus.subscribe('workflow:started', (event) => {
      metrics.workflowsTotal.inc({ status: 'started', tenant_id: event.tenantId });
      metrics.activeWorkflows.inc({ tenant_id: event.tenantId });
      trackWorkflowStart();
    });

    supervisorBus.subscribe('workflow:completed', (event) => {
      const status = (event as any).status ?? 'completed';
      metrics.workflowsTotal.inc({ status, tenant_id: event.tenantId });
      metrics.activeWorkflows.dec({ tenant_id: event.tenantId });
      trackWorkflowEnd();

      if ((event as any).durationMs) {
        metrics.workflowDuration.observe(
          { status, tenant_id: event.tenantId },
          (event as any).durationMs / 1000,
        );
      }
    });

    supervisorBus.subscribe('node:completed', (event) => {
      const e = event as any;
      if (e.node && e.durationMs) {
        metrics.agentExecutions.inc({ agent_role: e.node, status: e.success ? 'success' : 'failure' });
        metrics.agentDuration.observe({ agent_role: e.node }, e.durationMs / 1000);
      }
    });

    supervisorBus.subscribe('circuit:open', (event) => {
      const e = event as any;
      metrics.circuitBreakerTrips.inc({ breaker_name: e.service ?? 'unknown' });
      metrics.circuitBreakerState.set({ breaker_name: e.service ?? 'unknown' }, 1); // 1 = OPEN
    });

    supervisorBus.subscribe('approval:required', () => {
      metrics.approvalRequests.inc({ decision: 'pending' });
    });

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
