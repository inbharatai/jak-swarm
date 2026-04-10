import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { ok, err } from '../types.js';
import { AppError, NotFoundError } from '../errors.js';
import { toolRegistry } from '@jak-swarm/tools';
import type { ToolCategory, ToolRiskClass } from '@jak-swarm/shared';

const toolsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /tools
   * List all registered tools with metadata from the real ToolRegistry.
   * Supports optional ?category= and ?riskClass= query filters.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { category, riskClass } = request.query as {
        category?: ToolCategory;
        riskClass?: ToolRiskClass;
      };
      const filter =
        category || riskClass
          ? { category: category || undefined, riskClass: riskClass || undefined }
          : undefined;
      const tools = toolRegistry.list(filter);
      return reply.status(200).send(ok(tools));
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
};

export default toolsRoutes;
