/**
 * swarm.plugin.ts
 *
 * Registers the SwarmExecutionService as `fastify.swarm`.
 * Routes call `fastify.swarm.executeAsync(...)` or
 * `fastify.swarm.resumeAfterApproval(...)` to drive workflow execution.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { SwarmExecutionService } from '../services/swarm-execution.service.js';
import { SchedulerService } from '../services/scheduler.service.js';
import { WorkflowService } from '../services/workflow.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    swarm: SwarmExecutionService;
  }
}

const swarmPlugin: FastifyPluginAsync = async (fastify) => {
  const swarmService = new SwarmExecutionService(fastify.db, fastify.log);
  fastify.decorate('swarm', swarmService);
  fastify.log.info('[Swarm] SwarmExecutionService registered');

  // Recover any workflows that were mid-execution when the server last stopped
  setImmediate(() => {
    swarmService.recoverStaleWorkflows().catch((err) => {
      fastify.log.error({ err }, '[Swarm] Failed to recover stale workflows on startup');
    });
  });

  // Start the workflow scheduler
  const workflowService = new WorkflowService(fastify.db, fastify.log);
  const scheduler = new SchedulerService(fastify.db, async (params) => {
    // Create a workflow record, fire execution, return the workflow ID
    const workflow = await workflowService.createWorkflow(
      params.tenantId,
      params.userId,
      params.goal,
      params.industry,
    );
    setImmediate(() => {
      void swarmService.executeAsync({
        workflowId: workflow.id,
        tenantId: params.tenantId,
        userId: params.userId,
        goal: params.goal,
        industry: params.industry,
      });
    });
    return workflow.id;
  });
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
      const { supervisorBus } = await import('@jak-swarm/swarm');
      const purgedWorkflows = supervisorBus.purgeStaleWorkflows(30 * 60 * 1000); // 30 min
      if (purgedWorkflows > 0) {
        fastify.log.warn({ purgedWorkflows }, '[Supervisor] Purged stale workflows');
      }
    } catch {
      // Supervisor module not available — skip
    }

    try {
      const { purgeIdleCircuitBreakers } = await import('@jak-swarm/swarm');
      const purgedBreakers = (purgeIdleCircuitBreakers as (maxIdleMs?: number) => number)(60 * 60 * 1000); // 1 hour
      if (purgedBreakers > 0) {
        fastify.log.info({ purgedBreakers }, '[Supervisor] Purged idle circuit breakers');
      }
    } catch {
      // Circuit breaker module not available — skip
    }
  }, 10 * 60 * 1000); // Run every 10 minutes

  // Clean up scheduler and purge interval on server close
  fastify.addHook('onClose', () => {
    scheduler.stop();
    clearInterval(purgeInterval);
  });
};

export default fp(swarmPlugin, {
  name: 'swarm-plugin',
  dependencies: ['db-plugin'],
});
