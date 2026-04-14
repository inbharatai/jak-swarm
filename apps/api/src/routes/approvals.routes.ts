import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { WorkflowService } from '../services/workflow.service.js';
import { ok, err } from '../types.js';
import { AppError, NotFoundError } from '../errors.js';
import type { ApprovalStatus } from '../types.js';

const decideBodySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'DEFERRED']),
  comment: z.string().max(2000).optional(),
});

const approvalsRoutes: FastifyPluginAsync = async (fastify) => {
  const workflowService = new WorkflowService(fastify.db, fastify.log);

  // REVIEWER, TENANT_ADMIN, and SYSTEM_ADMIN may manage approvals
  const preHandlerBase = [
    fastify.authenticate,
    fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN'),
  ];

  /**
   * GET /approvals
   * List pending (or filtered) approval requests for the authenticated tenant.
   */
  fastify.get(
    '/',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        status?: string;
        page?: string;
        limit?: string;
      };

      const VALID_STATUSES: ApprovalStatus[] = [
        'PENDING', 'APPROVED', 'REJECTED', 'DEFERRED', 'EXPIRED',
      ];

      const status = (query.status ?? 'PENDING').toUpperCase() as ApprovalStatus;
      if (!VALID_STATUSES.includes(status)) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Invalid status '${status}'`));
      }

      const page = Math.max(1, parseInt(query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
      const skip = (page - 1) * limit;
      const tenantId = request.user.tenantId;

      try {
        const [total, approvals] = await Promise.all([
          fastify.db.approvalRequest.count({ where: { tenantId, status } }),
          fastify.db.approvalRequest.findMany({
            where: { tenantId, status },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
        ]);

        return reply
          .status(200)
          .send(ok({ items: approvals, total, page, limit, hasMore: skip + approvals.length < total }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /approvals/:approvalId
   * Get a single approval request by id.
   */
  fastify.get(
    '/:approvalId',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { approvalId } = request.params as { approvalId: string };
      const tenantId = request.user.tenantId;

      try {
        const whereClause = request.user.role === 'SYSTEM_ADMIN'
          ? { id: approvalId }
          : { id: approvalId, tenantId };

        const approval = await fastify.db.approvalRequest.findFirst({
          where: whereClause,
        });

        if (!approval) throw new NotFoundError('ApprovalRequest', approvalId);

        return reply.status(200).send(ok(approval));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /approvals/:approvalId/decide
   * Submit a decision (APPROVED | REJECTED | DEFERRED) for an approval request.
   */
  fastify.post(
    '/:approvalId/decide',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { approvalId } = request.params as { approvalId: string };
      const parseResult = decideBodySchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      const { decision, comment } = parseResult.data;

      try {
        const approval = await workflowService.resolveApproval(
          request.user.tenantId,
          approvalId,
          decision,
          request.user.userId,
          comment,
        );

        await fastify.auditLog(request, `APPROVAL_${decision}`, 'ApprovalRequest', approvalId, {
          decision,
          comment,
        });

        // Trigger swarm resume in the background so the reviewer gets an
        // immediate response regardless of how long the workflow takes to run.
        setImmediate(() => {
          void fastify.swarm.resumeAfterApproval({
            workflowId: approval.workflowId,
            tenantId: request.user.tenantId,
            decision,
            reviewedBy: request.user.userId,
            comment,
          });
        });

        return reply.status(200).send(ok(approval));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /approvals/:approvalId/defer
   * Convenience shortcut to defer an approval request.
   */
  fastify.post(
    '/:approvalId/defer',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { approvalId } = request.params as { approvalId: string };
      const body = request.body as { comment?: string } | null;

      try {
        const approval = await workflowService.resolveApproval(
          request.user.tenantId,
          approvalId,
          'DEFERRED',
          request.user.userId,
          body?.comment,
        );

        await fastify.auditLog(request, 'APPROVAL_DEFERRED', 'ApprovalRequest', approvalId);
        return reply.status(200).send(ok(approval));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default approvalsRoutes;
