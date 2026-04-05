import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { ok, err } from '../types.js';
import { AppError, NotFoundError, ForbiddenError } from '../errors.js';

const tracesRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /traces
   * List recent agent traces for the tenant with optional filters.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        workflowId?: string;
        agentRole?: string;
        page?: string;
        limit?: string;
      };

      const page = Math.max(1, parseInt(query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
      const skip = (page - 1) * limit;
      const tenantId = request.user.tenantId;

      try {
        const where = {
          tenantId,
          ...(query.workflowId ? { workflowId: query.workflowId } : {}),
          ...(query.agentRole ? { agentRole: query.agentRole } : {}),
        };

        const [total, traces] = await Promise.all([
          fastify.db.agentTrace.count({ where }),
          fastify.db.agentTrace.findMany({
            where,
            orderBy: { startedAt: 'desc' },
            skip,
            take: limit,
            select: {
              id: true,
              traceId: true,
              runId: true,
              workflowId: true,
              tenantId: true,
              agentRole: true,
              stepIndex: true,
              startedAt: true,
              completedAt: true,
              durationMs: true,
              error: true,
            },
          }),
        ]);

        return reply
          .status(200)
          .send(ok({ items: traces, total, page, limit, hasMore: skip + traces.length < total }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /traces/:traceId
   * Get a full trace by id.
   */
  fastify.get(
    '/:traceId',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { traceId } = request.params as { traceId: string };

      try {
        const trace = await fastify.db.agentTrace.findUnique({
          where: { id: traceId },
        });

        if (!trace) throw new NotFoundError('AgentTrace', traceId);

        if (trace.tenantId !== request.user.tenantId && request.user.role !== 'SYSTEM_ADMIN') {
          throw new ForbiddenError('Access to trace in another tenant is not allowed');
        }

        return reply.status(200).send(ok(trace));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /traces/:traceId/replay
   * Get replay-friendly trace data with timing information.
   */
  fastify.get(
    '/:traceId/replay',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { traceId } = request.params as { traceId: string };

      try {
        const trace = await fastify.db.agentTrace.findUnique({
          where: { id: traceId },
        });

        if (!trace) throw new NotFoundError('AgentTrace', traceId);

        if (trace.tenantId !== request.user.tenantId && request.user.role !== 'SYSTEM_ADMIN') {
          throw new ForbiddenError('Access to trace in another tenant is not allowed');
        }

        return reply.status(200).send(
          ok({
            traceId: trace.id,
            workflowId: trace.workflowId,
            agentRole: trace.agentRole,
            startedAt: trace.startedAt,
            completedAt: trace.completedAt,
            durationMs: trace.durationMs,
            inputJson: trace.inputJson,
            outputJson: trace.outputJson,
            toolCallsJson: trace.toolCallsJson,
            handoffsJson: trace.handoffsJson,
            error: trace.error,
          }),
        );
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default tracesRoutes;
