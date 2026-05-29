import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { WorkflowService } from '../../services/workflow.service.js';
import { enforceTenantIsolation } from '../../middleware/tenant-isolation.js';
import { ok, err } from '../../types.js';
import { AppError } from '../../errors.js';
import { resumeWorkflowBodySchema } from '../workflows.routes.js';

const controlBodySchema = z.object({}).strict();

const workflowControlRoutes: FastifyPluginAsync = async (fastify) => {
  const workflowService = new WorkflowService(fastify.db, fastify.log);
  const preHandlerBase = [fastify.authenticate, enforceTenantIsolation];

  /**
   * POST /workflows/:workflowId/resume
   * Resume a PAUSED workflow after a human-in-the-loop approval decision.
   */
  fastify.post(
    '/:workflowId/resume',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const { workflowId } = req.params as { workflowId: string };
            return `resume:${req.user?.userId ?? req.ip}:${workflowId}`;
          },
        },
      },
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN'),
        enforceTenantIsolation,
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };
      const parseResult = resumeWorkflowBodySchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      const { decision, comment } = parseResult.data;

      try {
        const workflow = await workflowService.getWorkflow(request.user.tenantId, workflowId);

        if (workflow.status !== 'PAUSED') {
          return reply
            .status(409)
            .send(
              err(
                'WORKFLOW_NOT_PAUSED',
                `Workflow is not awaiting approval (status: ${workflow.status})`,
              ),
            );
        }

        await fastify.auditLog(
          request,
          `WORKFLOW_RESUME_${decision}`,
          'Workflow',
          workflowId,
          { decision, comment },
        );

        const enqueued = await fastify.swarm.enqueueControl({
          action: 'resume',
          workflowId,
          tenantId: request.user.tenantId,
          userId: request.user.userId,
          decision,
          reviewedBy: request.user.userId,
          comment,
        });
        if (!enqueued) {
          return reply.status(503).send(err('RESUME_ENQUEUE_FAILED', 'Workflow resume could not be queued. Try again or contact support.'));
        }

        return reply.status(202).send(
          ok({
            workflowId,
            decision,
            message: decision === 'APPROVED'
              ? 'Workflow resuming — poll GET /workflows/:id for status'
              : decision === 'REJECTED'
              ? 'Workflow has been rejected and will be cancelled'
              : 'Approval deferred — workflow remains paused',
          }),
        );
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /workflows/:workflowId/pause
   */
  fastify.post(
    '/:workflowId/pause',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const bodyParsed = controlBodySchema.safeParse(request.body ?? {});
        if (!bodyParsed.success) {
          return reply.code(422).send(err('VALIDATION_ERROR', 'Invalid request body', bodyParsed.error.flatten()));
        }
        const { workflowId } = request.params as { workflowId: string };
        const { tenantId } = request.user;

        const workflow = await fastify.db.workflow.findFirst({ where: { id: workflowId, tenantId } });
        if (!workflow) return reply.code(404).send(err('NOT_FOUND', 'Workflow not found'));
        if (workflow.status !== 'RUNNING' && workflow.status !== 'EXECUTING') {
          return reply.code(400).send(err('BAD_REQUEST', `Cannot pause workflow in ${workflow.status} status`));
        }

        fastify.swarm.pauseWorkflow(workflowId);
        await fastify.coordination.signals.publish({
          type: 'pause',
          workflowId,
          issuedBy: request.user.userId,
          timestamp: new Date().toISOString(),
        });
        await fastify.db.workflow.update({ where: { id: workflowId }, data: { status: 'PAUSED' } });

        fastify.swarm.emit(`workflow:${workflowId}`, { type: 'paused', workflowId, timestamp: new Date().toISOString() });

        return reply.send(ok({ success: true, message: 'Workflow will pause after current node completes' }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        request.log.error({ err: e }, 'Failed to pause workflow');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /workflows/:workflowId/unpause
   */
  fastify.post(
    '/:workflowId/unpause',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const bodyParsed = controlBodySchema.safeParse(request.body ?? {});
        if (!bodyParsed.success) {
          return reply.code(422).send(err('VALIDATION_ERROR', 'Invalid request body', bodyParsed.error.flatten()));
        }
        const { workflowId } = request.params as { workflowId: string };
        const { tenantId } = request.user;

        const workflow = await fastify.db.workflow.findFirst({ where: { id: workflowId, tenantId } });
        if (!workflow) return reply.code(404).send(err('NOT_FOUND', 'Workflow not found'));
        if (workflow.status !== 'PAUSED') {
          return reply.code(400).send(err('BAD_REQUEST', `Cannot unpause workflow in ${workflow.status} status`));
        }

        const pendingApproval = await fastify.db.approvalRequest.findFirst({
          where: { workflowId, tenantId, status: 'PENDING' },
          select: { id: true },
        });
        if (pendingApproval) {
          return reply.code(409).send(err(
            'APPROVAL_REQUIRED',
            'This workflow is paused for a pending approval. Use /approvals/:approvalId/decide or /workflows/:workflowId/resume with a reviewer role.',
            { approvalId: pendingApproval.id },
          ));
        }

        fastify.swarm.unpauseWorkflow(workflowId);
        await fastify.coordination.signals.publish({
          type: 'unpause',
          workflowId,
          issuedBy: request.user.userId,
          timestamp: new Date().toISOString(),
        });
        await fastify.db.workflow.update({ where: { id: workflowId }, data: { status: 'RUNNING' } });

        return reply.send(ok({ success: true, message: 'Workflow resumed' }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        request.log.error({ err: e }, 'Failed to unpause workflow');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /workflows/:workflowId/stop
   */
  fastify.post(
    '/:workflowId/stop',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const bodyParsed = controlBodySchema.safeParse(request.body ?? {});
        if (!bodyParsed.success) {
          return reply.code(422).send(err('VALIDATION_ERROR', 'Invalid request body', bodyParsed.error.flatten()));
        }
        const { workflowId } = request.params as { workflowId: string };
        const { tenantId } = request.user;

        const workflow = await fastify.db.workflow.findFirst({ where: { id: workflowId, tenantId } });
        if (!workflow) return reply.code(404).send(err('NOT_FOUND', 'Workflow not found'));

        fastify.swarm.stopWorkflow(workflowId);
        await fastify.coordination.signals.publish({
          type: 'stop',
          workflowId,
          issuedBy: request.user.userId,
          timestamp: new Date().toISOString(),
        });
        await fastify.db.workflow.update({
          where: { id: workflowId },
          data: { status: 'CANCELLED', error: 'Stopped by user', completedAt: new Date() },
        });

        return reply.send(ok({ success: true, message: 'Workflow stopped' }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        request.log.error({ err: e }, 'Failed to stop workflow');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * DELETE /workflows/:workflowId
   */
  fastify.delete(
    '/:workflowId',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };

      try {
        const workflow = await workflowService.cancelWorkflow(request.user.tenantId, workflowId);
        await fastify.auditLog(request, 'CANCEL_WORKFLOW', 'Workflow', workflowId);

        await fastify.coordination.signals.publish({
          type: 'stop',
          workflowId,
          issuedBy: request.user.userId,
          timestamp: new Date().toISOString(),
        });

        return reply.status(200).send(ok(workflow));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default workflowControlRoutes;
