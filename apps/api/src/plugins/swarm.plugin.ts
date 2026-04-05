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
  setImmediate(() => { void swarmService.recoverStaleWorkflows(); });

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

  // Auto-reconnect previously connected MCP integrations
  const db = fastify.db;
  setImmediate(async () => {
    try {
      const { mcpClientManager, MCP_PROVIDERS } = await import('@jak-swarm/tools');
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
          await mcpClientManager.connect(integration.provider, config);
        } catch (err) {
          console.error(`[mcp] Failed to reconnect ${integration.provider}:`, err);
          // Mark as needing reauth
          await db.integration.update({
            where: { id: integration.id },
            data: { status: 'NEEDS_REAUTH' },
          });
        }
      }
    } catch (err) {
      console.error('[mcp] Auto-reconnect failed:', err);
    }
  });

  // Clean up scheduler on server close
  fastify.addHook('onClose', () => { scheduler.stop(); });
};

export default fp(swarmPlugin, {
  name: 'swarm-plugin',
  dependencies: ['db-plugin'],
});
