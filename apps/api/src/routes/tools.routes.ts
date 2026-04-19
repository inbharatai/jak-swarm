import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { ok, err } from '../types.js';
import { AppError, NotFoundError } from '../errors.js';
import { toolRegistry } from '@jak-swarm/tools';
import { ToolRiskClass, type ToolCategory, type ToolMaturity } from '@jak-swarm/shared';
import { listRoleManifest, getRoleManifestSummary, type RoleMaturity } from '@jak-swarm/agents';
import { randomUUID } from 'node:crypto';

const toolsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /tools
   * List all registered tools with metadata from the real ToolRegistry.
   * Supports optional ?category=, ?riskClass=, and ?maturity= query filters.
   *
   * Metadata now includes honest maturity classification (maturity,
   * requiredEnvVars, liveTested, sideEffectLevel) so admin UIs can render
   * "real / config-dependent / heuristic / llm-passthrough / experimental"
   * badges instead of treating every tool as equally production-grade.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { category, riskClass, maturity } = request.query as {
        category?: ToolCategory;
        riskClass?: ToolRiskClass;
        maturity?: ToolMaturity;
      };
      const filter =
        category || riskClass
          ? { category: category || undefined, riskClass: riskClass || undefined }
          : undefined;
      let tools = toolRegistry.list(filter);
      if (maturity) {
        tools = tools.filter((t) => (t.maturity ?? 'unclassified') === maturity);
      }
      return reply.status(200).send(ok(tools));
    },
  );

  /**
   * GET /tools/manifest
   * Aggregate counts by maturity and category + the names of unclassified tools.
   *
   * Consumed by the docs truth-check script (scripts/check-docs-truth.ts) and the
   * admin observability surfaces. This is the source-of-truth for any "production
   * tools" claim in README / landing-page copy.
   */
  fastify.get(
    '/manifest',
    { preHandler: [fastify.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send(ok(toolRegistry.getManifest()));
    },
  );

  /**
   * GET /tools/roles
   * Per-agent-role maturity classification — parallel to /tools/manifest but
   * covers the AgentRole axis. Admin UI renders depth badges from this.
   * Returns entries ordered hero → experimental. Optional ?maturity= filter.
   */
  fastify.get(
    '/roles',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { maturity } = request.query as { maturity?: RoleMaturity };
      let list = listRoleManifest();
      if (maturity) list = list.filter((r) => r.maturity === maturity);
      return reply.status(200).send(
        ok({
          summary: getRoleManifestSummary(),
          roles: list,
        }),
      );
    },
  );

  /**
   * GET /tools/:toolName
   * Get full detail for a single tool, including its risk class and schemas.
   */
  fastify.get(
    '/:toolName',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { toolName } = request.params as { toolName: string };

      try {
        const registered = toolRegistry.get(toolName);
        if (!registered) throw new NotFoundError('Tool', toolName);
        return reply.status(200).send(ok(registered.metadata));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
  /**
   * POST /tools/:toolName/execute
   * Execute a tool directly by name with provided input.
   * Useful for testing tools from the UI without running a full workflow.
   */
  fastify.post(
    '/:toolName/execute',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { toolName } = request.params as { toolName: string };
      const user = (request as unknown as { user: { tenantId: string; userId: string } }).user;

      const registered = toolRegistry.get(toolName);
      if (!registered) {
        return reply.status(404).send(err('NOT_FOUND', `Tool '${toolName}' not found`));
      }

      // Direct execution bypasses workflow-level guardrails and approval nodes,
      // so restrict this endpoint to lower-risk tools.
      if (registered.metadata.riskClass !== ToolRiskClass.READ_ONLY) {
        return reply.status(403).send(err(
          'FORBIDDEN',
          `Direct execution is disabled for ${registered.metadata.riskClass} tools. Run via workflow for guarded execution.`,
        ));
      }

      const context = {
        tenantId: user.tenantId,
        userId: user.userId,
        workflowId: 'direct',
        runId: randomUUID(),
      };

      try {
        const result = await toolRegistry.execute(toolName, request.body, context);
        return reply.status(200).send(ok(result));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default toolsRoutes;
