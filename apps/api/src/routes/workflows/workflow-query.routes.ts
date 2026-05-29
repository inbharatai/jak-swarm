import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { WorkflowService } from '../../services/workflow.service.js';
import { config } from '../../config.js';
import { enforceTenantIsolation } from '../../middleware/tenant-isolation.js';
import { ok, err } from '../../types.js';
import { AppError } from '../../errors.js';
import type { WorkflowStatus } from '../../types.js';
import { buildWorkflowResponse } from '../../services/workflow-recovery.service.js';

const workflowQueryRoutes: FastifyPluginAsync = async (fastify) => {
  const workflowService = new WorkflowService(fastify.db, fastify.log);
  const preHandlerBase = [fastify.authenticate, enforceTenantIsolation];

  /**
   * GET /workflows
   */
  fastify.get(
    '/',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        page?: string;
        limit?: string;
        status?: string;
      };
      const page = Math.max(1, parseInt(query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
      const statuses = query.status
        ?.split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean) as WorkflowStatus[] | undefined;

      const VALID_STATUSES: WorkflowStatus[] = [
        'PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED',
      ];

      const invalidStatus = statuses?.find((value) => !VALID_STATUSES.includes(value));
      if (invalidStatus) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Invalid status '${invalidStatus}'`));
      }

      try {
        const result = await workflowService.listWorkflows(request.user.tenantId, {
          page,
          limit,
          status: statuses?.length === 1 ? statuses[0] : statuses,
        });
        return reply.status(200).send(ok(result));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /workflows/queue/stats
   */
  fastify.get(
    '/queue/stats',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
        enforceTenantIsolation,
      ],
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const stats = await fastify.swarm.getQueueStats();
        return reply.status(200).send(ok(stats));
      } catch (err) {
        _request.log.error({ err }, 'Failed to get queue stats');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /workflows/queue/health
   */
  fastify.get(
    '/queue/health',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
        enforceTenantIsolation,
      ],
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const health = fastify.swarm.getWorkerHealth();
        return reply.status(200).send(ok({
          ...health,
          mode: config.workflowWorkerMode,
        }));
      } catch (err) {
        _request.log.error({ err }, 'Failed to get queue health');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /workflows/:workflowId
   */
  fastify.get(
    '/:workflowId',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };

      try {
        const [workflow, traces, approvals] = await Promise.all([
          workflowService.getWorkflow(request.user.tenantId, workflowId),
          workflowService.getWorkflowTraces(request.user.tenantId, workflowId),
          workflowService.getWorkflowApprovals(request.user.tenantId, workflowId),
        ]);

        const responseBody = buildWorkflowResponse(workflow, traces, approvals);

        return reply.status(200).send(ok(responseBody));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /workflows/:workflowId/traces
   */
  fastify.get(
    '/:workflowId/traces',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };

      try {
        const traces = await workflowService.getWorkflowTraces(request.user.tenantId, workflowId);
        return reply.status(200).send(ok(traces));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /workflows/:workflowId/approvals
   */
  fastify.get(
    '/:workflowId/approvals',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };

      try {
        const approvals = await workflowService.getWorkflowApprovals(
          request.user.tenantId,
          workflowId,
        );
        return reply.status(200).send(ok(approvals));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /workflows/:workflowId/output
   */
  fastify.get(
    '/:workflowId/output',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { workflowId } = request.params as { workflowId: string };
        const { tenantId } = request.user;

        const workflow = await (fastify.db.workflow.findFirst as any)({
          where: { id: workflowId, tenantId },
          select: { finalOutput: true, goal: true, status: true },
        });

        if (!workflow) {
          return reply.code(404).send({ error: 'Workflow not found' });
        }

        if (!workflow.finalOutput) {
          return reply.code(404).send({ error: 'No output available yet. Workflow may still be running.' });
        }

        reply.header('Content-Type', 'text/markdown; charset=utf-8');
        return reply.send(`# ${workflow.goal ?? 'Workflow Output'}\n\n${workflow.finalOutput}`);
      } catch (err) {
        request.log.error({ err }, 'Failed to get workflow output');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};

export default workflowQueryRoutes;
