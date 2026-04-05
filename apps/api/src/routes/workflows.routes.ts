import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { WorkflowService } from '../services/workflow.service.js';
import { enforceTenantIsolation } from '../middleware/tenant-isolation.js';
import { ok, err } from '../types.js';
import { AppError } from '../errors.js';
import type { WorkflowStatus } from '../types.js';

const createWorkflowBodySchema = z.object({
  goal: z.string().min(1, 'Goal is required').max(2000),
  industry: z.string().max(120).optional(),
});

const resumeWorkflowBodySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'DEFERRED']),
  comment: z.string().max(2000).optional(),
});

const workflowsRoutes: FastifyPluginAsync = async (fastify) => {
  const workflowService = new WorkflowService(fastify.db, fastify.log);
  const preHandlerBase = [fastify.authenticate, enforceTenantIsolation];

  /**
   * POST /workflows
   * Create a new workflow and kick off async swarm execution.
   * Returns 202 Accepted immediately; poll GET /workflows/:id for status.
   */
  fastify.post(
    '/',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = createWorkflowBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      const { goal, industry } = parseResult.data;
      const { tenantId, userId } = request.user;

      try {
        // 1. Persist the workflow record (PENDING)
        const workflow = await workflowService.createWorkflow(tenantId, userId, goal, industry);
        await fastify.auditLog(request, 'CREATE_WORKFLOW', 'Workflow', workflow.id, { goal });

        // 2. Fire-and-forget: run the swarm in the background
        //    setImmediate defers past the current event-loop tick so the HTTP
        //    response is sent before any swarm work begins.
        setImmediate(() => {
          void fastify.swarm.executeAsync({
            workflowId: workflow.id,
            tenantId,
            userId,
            goal,
            industry,
          });
        });

        // 3. Return 202 with the created workflow
        return reply.status(202).send(ok(workflow));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /workflows
   * Paginated list of workflows for the authenticated tenant.
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
      const status = query.status as WorkflowStatus | undefined;

      const VALID_STATUSES: WorkflowStatus[] = [
        'PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED',
      ];

      if (status && !VALID_STATUSES.includes(status)) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Invalid status '${status}'`));
      }

      try {
        const result = await workflowService.listWorkflows(request.user.tenantId, {
          page,
          limit,
          status,
        });
        return reply.status(200).send(ok(result));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /workflows/:workflowId
   * Full workflow record including traces and approvals.
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

        return reply.status(200).send(ok({ ...workflow, traces, approvals }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /workflows/:workflowId/resume
   * Resume a PAUSED workflow after a human-in-the-loop approval decision.
   * The reviewer submits their decision here; the swarm then continues.
   */
  fastify.post(
    '/:workflowId/resume',
    {
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
        // Verify workflow exists and belongs to this tenant
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

        // Kick off resume in background — returns immediately
        setImmediate(() => {
          void fastify.swarm.resumeAfterApproval({
            workflowId,
            tenantId: request.user.tenantId,
            decision,
            reviewedBy: request.user.userId,
            comment,
          });
        });

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
   * Pause a running workflow (pauses between nodes).
   */
  fastify.post(
    '/:workflowId/pause',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };
      const { tenantId } = request.user;

      const workflow = await fastify.db.workflow.findFirst({ where: { id: workflowId, tenantId } });
      if (!workflow) return reply.code(404).send(err('NOT_FOUND', 'Workflow not found'));
      if (workflow.status !== 'RUNNING' && workflow.status !== 'EXECUTING') {
        return reply.code(400).send(err('BAD_REQUEST', `Cannot pause workflow in ${workflow.status} status`));
      }

      fastify.swarm.pauseWorkflow(workflowId);
      await fastify.db.workflow.update({ where: { id: workflowId }, data: { status: 'PAUSED' } });

      return reply.send(ok({ success: true, message: 'Workflow will pause after current node completes' }));
    },
  );

  /**
   * POST /workflows/:workflowId/unpause
   * Resume a paused workflow.
   */
  fastify.post(
    '/:workflowId/unpause',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };
      const { tenantId } = request.user;

      const workflow = await fastify.db.workflow.findFirst({ where: { id: workflowId, tenantId } });
      if (!workflow) return reply.code(404).send(err('NOT_FOUND', 'Workflow not found'));
      if (workflow.status !== 'PAUSED') {
        return reply.code(400).send(err('BAD_REQUEST', `Cannot unpause workflow in ${workflow.status} status`));
      }

      fastify.swarm.unpauseWorkflow(workflowId);
      await fastify.db.workflow.update({ where: { id: workflowId }, data: { status: 'RUNNING' } });

      // Resume the workflow from where it paused
      setImmediate(() => { void fastify.swarm.resumeWorkflow(workflowId); });

      return reply.send(ok({ success: true, message: 'Workflow resumed' }));
    },
  );

  /**
   * POST /workflows/:workflowId/stop
   * Stop a running workflow immediately.
   */
  fastify.post(
    '/:workflowId/stop',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };
      const { tenantId } = request.user;

      const workflow = await fastify.db.workflow.findFirst({ where: { id: workflowId, tenantId } });
      if (!workflow) return reply.code(404).send(err('NOT_FOUND', 'Workflow not found'));

      fastify.swarm.stopWorkflow(workflowId);
      await fastify.db.workflow.update({
        where: { id: workflowId },
        data: { status: 'CANCELLED', error: 'Stopped by user', completedAt: new Date() },
      });

      return reply.send(ok({ success: true, message: 'Workflow stopped' }));
    },
  );

  /**
   * DELETE /workflows/:workflowId
   * Cancel a running or pending workflow.
   */
  fastify.delete(
    '/:workflowId',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };

      try {
        const workflow = await workflowService.cancelWorkflow(request.user.tenantId, workflowId);
        await fastify.auditLog(request, 'CANCEL_WORKFLOW', 'Workflow', workflowId);

        // Also cancel in swarm runner's in-memory state (best-effort)
        setImmediate(() => {
          void fastify.swarm.cancelWorkflow({ workflowId }).catch(() => undefined);
        });

        return reply.status(200).send(ok(workflow));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /workflows/:workflowId/traces
   * Agent traces for a workflow.
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
   * Approval requests for a workflow.
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
   * GET /workflows/:workflowId/stream
   * SSE stream for real-time workflow updates.
   * Accepts token as query param since EventSource can't send headers.
   */
  fastify.get(
    '/:workflowId/stream',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Authenticate via query param (EventSource can't set headers)
      const query = request.query as { token?: string };
      if (query.token) {
        request.headers.authorization = `Bearer ${query.token}`;
      }
      try {
        await request.jwtVerify();
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { workflowId } = request.params as { workflowId: string };
      const { tenantId } = request.user;

      // Verify workflow exists and belongs to tenant
      const workflow = await fastify.db.workflow.findFirst({
        where: { id: workflowId, tenantId },
      });
      if (!workflow) {
        return reply.code(404).send({ error: 'Workflow not found' });
      }

      // Set SSE headers using raw response
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      });

      // Send initial event
      const sendEvent = (data: unknown) => {
        try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
      };

      sendEvent({ type: 'connected', workflowId, status: workflow.status });

      // If already terminal, close immediately
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(workflow.status)) {
        sendEvent({ type: workflow.status.toLowerCase(), workflowId });
        reply.raw.end();
        return;
      }

      // Listen for events from the execution service
      const handler = (event: unknown) => sendEvent(event);
      fastify.swarm.on(`workflow:${workflowId}`, handler);

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        try { reply.raw.write(`: heartbeat\n\n`); } catch { clearInterval(heartbeat); }
      }, 15000);

      // Cleanup on close
      request.raw.on('close', () => {
        fastify.swarm.removeListener(`workflow:${workflowId}`, handler);
        clearInterval(heartbeat);
      });
    },
  );

  /**
   * GET /workflows/:workflowId/output
   * Download workflow output as markdown text.
   */
  fastify.get(
    '/:workflowId/output',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
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
    },
  );
};

export default workflowsRoutes;
