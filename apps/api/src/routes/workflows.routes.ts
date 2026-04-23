import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { WorkflowService } from '../services/workflow.service.js';
import { config } from '../config.js';
import { enforceTenantIsolation } from '../middleware/tenant-isolation.js';
import { ok, err } from '../types.js';
import { AppError } from '../errors.js';
import type { WorkflowStatus } from '../types.js';
import { CreditService } from '../billing/credit-service.js';
import { detectTaskType, estimateCredits } from '../billing/model-router.js';

const createWorkflowBodySchema = z.object({
  goal: z.string().min(1, 'Goal is required').max(2000),
  industry: z.string().max(120).optional(),
  roleModes: z.array(z.string().min(1).max(64)).max(10).optional(),
  maxCostUsd: z.number().positive().max(1000).optional(),
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

      const { goal, industry, roleModes, maxCostUsd } = parseResult.data;
      const { tenantId, userId } = request.user;

      try {
        // ── Credit check: estimate cost and verify user has budget ───────
        const creditService = new CreditService(fastify.db);

        const taskType = detectTaskType(goal);
        const usage = await creditService.getUsage(tenantId);
        const maxTier = usage?.maxModelTier ?? 1;
        const estimate = estimateCredits(goal, taskType, maxTier);

        const creditCheck = await creditService.checkCredits(tenantId, estimate.estimatedCredits);
        if (!creditCheck.allowed) {
          return reply.status(429).send(err('CREDIT_LIMIT', creditCheck.message ?? 'Credit limit reached', {
            reason: creditCheck.reason,
            remaining: creditCheck.remaining,
            estimatedCost: estimate.estimatedCredits,
          }));
        }

        // Reserve credits before execution
        const reservation = await creditService.reserveCredits(tenantId, estimate.estimatedCredits);
        if (!reservation.allowed) {
          return reply.status(429).send(err('CREDIT_RESERVE_FAILED', reservation.message ?? 'Could not reserve credits'));
        }

        // 1. Persist the workflow record (PENDING)
        const workflow = await workflowService.createWorkflow(tenantId, userId, goal, industry);

        // Persist queue execution intent so restart recovery can re-enqueue with
        // the same user-selected parameters even before the first state update.
        await (fastify.db.workflow.update as any)({
          where: { id: workflow.id },
          data: {
            maxCostUsd: maxCostUsd ?? null,
            stateJson: {
              roleModes: roleModes ?? [],
              requestedAt: new Date().toISOString(),
              requestedBy: userId,
            },
          },
        });

        await fastify.auditLog(request, 'CREATE_WORKFLOW', 'Workflow', workflow.id, {
          goal, maxCostUsd, estimatedCredits: estimate.estimatedCredits, taskType,
        });

        // 2. Enqueue execution for queue-backed background processing
        const idempotencyKey = typeof request.headers['idempotency-key'] === 'string'
          ? request.headers['idempotency-key']
          : undefined;

        // Coarse subscription tier for gating paid external services (Serper / Tavily).
        // maxModelTier 1 = FREE plan → 'free' (DDG only); >= 2 = paid plan → 'paid'.
        const subscriptionTier: 'free' | 'paid' = maxTier >= 2 ? 'paid' : 'free';

        fastify.swarm.enqueueExecution({
          workflowId: workflow.id,
          tenantId,
          userId,
          goal,
          industry,
          roleModes,
          maxCostUsd,
          idempotencyKey,
          subscriptionTier,
        });

        // 3. Return 202 with the created workflow + cost estimate
        return reply.status(202).send(ok({
          ...workflow,
          estimatedCredits: estimate.estimatedCredits,
          creditsReserved: reservation.reserved,
          taskType,
          model: estimate.model,
        }));
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
   * Operational queue depth and running worker count.
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
      const stats = await fastify.swarm.getQueueStats();
      return reply.status(200).send(ok(stats));
    },
  );

  /**
   * GET /workflows/queue/health
   * Dedicated worker health diagnostics (counters, uptime, running jobs).
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
      const health = fastify.swarm.getWorkerHealth();
      return reply.status(200).send(ok({
        ...health,
        mode: config.workflowWorkerMode,
      }));
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

        // Recovery: if the worker's stale @jak-swarm/swarm dist failed to
        // route a Commander directAnswer to __end__ (resulting in finalOutput
        // = "Agents completed their work but did not produce a user-facing
        // response..." even though Commander did answer), surface the
        // directAnswer from the trace and present the workflow as completed.
        // Safe to run on every request — it's a no-op when finalOutput is
        // already substantive or when no Commander directAnswer exists.
        const responseBody: Record<string, unknown> = { ...workflow, traces, approvals };
        const stub = /Agents completed their work but did not produce/i;
        const fo = responseBody['finalOutput'];
        if (typeof fo !== 'string' || fo.trim().length === 0 || stub.test(fo)) {
          const cmd = traces.find((t) => t.agentRole === 'COMMANDER');
          const cmdOut = (cmd?.output ?? null) as { directAnswer?: unknown } | null;
          const da = typeof cmdOut?.directAnswer === 'string' ? cmdOut.directAnswer.trim() : '';
          if (da.length > 0) {
            responseBody['finalOutput'] = da;
            responseBody['status'] = 'COMPLETED';
            responseBody['error'] = null;
            responseBody['recoveredFromCommanderTrace'] = true;
          }
        }

        return reply.status(200).send(ok(responseBody));
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

        // Enqueue the resume as a durable control job. The queue worker picks it up
        // and calls swarmService.resumeAfterApproval() with the same parameters, but
        // now it survives an API crash between the 202 and the actual resume.
        fastify.swarm.enqueueControl({
          action: 'resume',
          workflowId,
          tenantId: request.user.tenantId,
          userId: request.user.userId,
          decision,
          reviewedBy: request.user.userId,
          comment,
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

      // Broadcast pause signal to ALL instances (the one running the workflow will act on it)
      fastify.swarm.pauseWorkflow(workflowId); // Local instance
      await fastify.coordination.signals.publish({
        type: 'pause',
        workflowId,
        issuedBy: request.user.userId,
        timestamp: new Date().toISOString(),
      });
      await fastify.db.workflow.update({ where: { id: workflowId }, data: { status: 'PAUSED' } });

      // Notify SSE listeners that workflow is paused
      fastify.swarm.emit(`workflow:${workflowId}`, { type: 'paused', workflowId, timestamp: new Date().toISOString() });

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

      // Broadcast unpause signal — whichever instance holds the paused workflow will resume it
      // under a distributed lock (see subscriber in plugins/swarm.plugin.ts and worker-entry.ts).
      fastify.swarm.unpauseWorkflow(workflowId); // Local instance (idempotent)
      await fastify.coordination.signals.publish({
        type: 'unpause',
        workflowId,
        issuedBy: request.user.userId,
        timestamp: new Date().toISOString(),
      });
      await fastify.db.workflow.update({ where: { id: workflowId }, data: { status: 'RUNNING' } });

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

      // Broadcast stop signal to ALL instances
      fastify.swarm.stopWorkflow(workflowId); // Local instance
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

        // Cross-instance stop signal — whichever instance owns the runner will cancel.
        // Matches the pause/stop routes which already use the signal bus, and replaces
        // the previous setImmediate(swarm.cancelWorkflow) which only reached the local
        // instance.
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
   * Accepts Bearer auth headers and supports token query fallback for legacy EventSource clients.
   */
  fastify.get(
    '/:workflowId/stream',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Support legacy EventSource token query param if no Authorization header is present.
      const query = request.query as { token?: string };
      if (!request.headers.authorization && query.token) {
        request.headers.authorization = `Bearer ${query.token}`;
      }
      try {
        await fastify.authenticate(request, reply);
      } catch {
        return reply.code(401).send(err('UNAUTHORIZED', 'Unauthorized'));
      }

      const { workflowId } = request.params as { workflowId: string };
      const { tenantId } = request.user;

      // Verify workflow exists and belongs to tenant
      const workflow = await fastify.db.workflow.findFirst({
        where: { id: workflowId, tenantId },
      });
      if (!workflow) {
        return reply.code(404).send(err('NOT_FOUND', 'Workflow not found'));
      }

      // SSE stream — hijack the response so Fastify doesn't try to auto-close it
      reply.hijack();
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
