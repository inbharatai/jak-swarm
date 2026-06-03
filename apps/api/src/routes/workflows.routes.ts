import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { WorkflowService } from '../services/workflow.service.js';
import { enforceTenantIsolation } from '../middleware/tenant-isolation.js';
import { ok, err } from '../types.js';
import { AppError } from '../errors.js';
import type { WorkflowStatus } from '../types.js';
import { createWorkflowOrchestration } from '../services/workflow-creation.service.js';
import workflowControlRoutes from './workflows/workflow-control.routes.js';
import workflowQueryRoutes from './workflows/workflow-query.routes.js';
import workflowStreamRoutes from './workflows/workflow-stream.routes.js';
import conversationRoutes from './workflows/conversation.routes.js';

export const createWorkflowBodySchema = z.object({
  goal: z.string().min(1, 'Goal is required').max(2000),
  industry: z.string().max(120).optional(),
  roleModes: z.array(z.string().min(1).max(64)).max(10).optional(),
  maxCostUsd: z.number().positive().max(1000).optional(),
  conversationId: z.string().min(1).max(255).optional(),
});

export const resumeWorkflowBodySchema = z.object({
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

      const { goal, industry, roleModes, maxCostUsd, conversationId } = parseResult.data;
      const { tenantId, userId } = request.user;

      try {
        // Sprint 2.1 / Item J — Follow-up command short-circuit.
        if (goal.length < 200) {
          const ACTIVE_STATUSES = ['PENDING', 'RUNNING', 'EXECUTING', 'PAUSED'] as const;
          const activeWorkflow = await (fastify.db.workflow.findFirst as unknown as (a: unknown) => Promise<{ id: string; status: string; goal: string } | null>)({
            where: { tenantId, userId, status: { in: ACTIVE_STATUSES as unknown as WorkflowStatus[] } },
            orderBy: { startedAt: 'desc' },
            select: { id: true, status: true, goal: true },
          });
          if (activeWorkflow) {
            const pendingApproval = await (fastify.db.approvalRequest.findFirst as unknown as (a: unknown) => Promise<{ id: string; status: string } | null>)({
              where: { workflowId: activeWorkflow.id, status: 'PENDING' },
              orderBy: { createdAt: 'desc' },
              select: { id: true, status: true },
            });
            const { parseFollowup, describeFollowup } = await import('../services/conversation/followup-parser.js');
            const cmd = parseFollowup(goal, { hasPendingApproval: Boolean(pendingApproval) });
            if (cmd) {
              fastify.log.info(
                {
                  requestId: request.id,
                  tenantId,
                  userId,
                  workflowId: activeWorkflow.id,
                  command: cmd.kind,
                  kind: 'followup_executed',
                },
                '[workflows.create] follow-up command matched active workflow',
              );
              const description = describeFollowup(cmd);
              const baseResult = {
                kind: 'followup_executed' as const,
                command: cmd,
                description,
                workflowId: activeWorkflow.id,
              };
              try {
                switch (cmd.kind) {
                  case 'approve':
                  case 'reject': {
                    if (!pendingApproval) {
                      return reply.status(409).send(err('NO_PENDING_APPROVAL', `Workflow ${activeWorkflow.id} has no pending approval to ${cmd.kind}.`));
                    }
                    const decision = cmd.kind === 'approve' ? 'APPROVED' : 'REJECTED';
                    await workflowService.resolveApproval(tenantId, pendingApproval.id, decision, userId);
                    await fastify.auditLog(request, `APPROVAL_${decision}_VIA_FOLLOWUP`, 'ApprovalRequest', pendingApproval.id, { decision, source: 'chat_followup' });
                    const enqueued = await fastify.swarm.enqueueControl({
                      action: 'resume',
                      workflowId: activeWorkflow.id,
                      tenantId,
                      userId,
                      decision,
                      reviewedBy: userId,
                      comment: 'Resolved from chat follow-up command',
                      approvalId: pendingApproval.id,
                    });
                    if (!enqueued) {
                      return reply.status(503).send(err('RESUME_ENQUEUE_FAILED', 'Approval was recorded, but workflow resume could not be queued. Try resume again or contact support.'));
                    }
                    return reply.status(200).send(ok({ ...baseResult, approvalId: pendingApproval.id, decision }));
                  }
                  case 'pause': {
                    fastify.swarm.pauseWorkflow(activeWorkflow.id);
                    return reply.status(200).send(ok(baseResult));
                  }
                  case 'resume': {
                    if (pendingApproval) {
                      return reply.status(409).send(err(
                        'APPROVAL_REQUIRED',
                        `Workflow ${activeWorkflow.id} is awaiting approval. Use "approve" or "reject"; generic resume cannot bypass approval.`,
                      ));
                    }
                    fastify.swarm.unpauseWorkflow(activeWorkflow.id);
                    return reply.status(200).send(ok(baseResult));
                  }
                  case 'cancel': {
                    fastify.swarm.stopWorkflow(activeWorkflow.id);
                    return reply.status(200).send(ok(baseResult));
                  }
                  case 'show_graph': {
                    const wf = await (fastify.db.workflow.findFirst as unknown as (a: unknown) => Promise<{ id: string; planJson: unknown; status: string } | null>)({
                      where: { id: activeWorkflow.id, tenantId },
                      select: { id: true, planJson: true, status: true },
                    });
                    return reply.status(200).send(ok({ ...baseResult, plan: wf?.planJson ?? null, status: wf?.status }));
                  }
                  case 'show_status': {
                    return reply.status(200).send(ok({
                      ...baseResult,
                      activeWorkflow,
                      ...(cmd.agentRole ? { agentRole: cmd.agentRole } : {}),
                      hint: cmd.agentRole
                        ? `Live activity for ${cmd.agentRole} streams on the cockpit SSE channel workflow:${activeWorkflow.id}.`
                        : `Live activity streams on the cockpit SSE channel workflow:${activeWorkflow.id}.`,
                    }));
                  }
                  case 'show_failed': {
                    const failedTraces = await fastify.db.agentTrace.findMany({
                      where: { workflowId: activeWorkflow.id, error: { not: null } },
                      select: { id: true, agentRole: true, error: true, stepIndex: true },
                      orderBy: { stepIndex: 'asc' },
                      take: 50,
                    });
                    return reply.status(200).send(ok({ ...baseResult, failedTraces }));
                  }
                  case 'show_cost': {
                    const wf = await (fastify.db.workflow.findFirst as unknown as (a: unknown) => Promise<{ totalCostUsd: number; maxCostUsd: number | null } | null>)({
                      where: { id: activeWorkflow.id, tenantId },
                      select: { totalCostUsd: true, maxCostUsd: true },
                    });
                    return reply.status(200).send(ok({ ...baseResult, totalCostUsd: wf?.totalCostUsd ?? 0, maxCostUsd: wf?.maxCostUsd ?? null }));
                  }
                  case 'download_report': {
                    return reply.status(200).send(ok({ ...baseResult, downloadUrl: `/workflows/${activeWorkflow.id}/output` }));
                  }
                  case 'finalize_workpaper': {
                    return reply.status(200).send(ok({
                      ...baseResult,
                      hint: 'To finalize a workpaper, open the audit run detail page and use the per-workpaper Approve button. The chat shortcut cannot infer which workpaper to finalize.',
                    }));
                  }
                  case 'why_waiting': {
                    if (!pendingApproval) {
                      return reply.status(200).send(ok({ ...baseResult, reason: 'no_pending_approval', hint: `Workflow ${activeWorkflow.id} is in status '${activeWorkflow.status}' and has no pending approval.` }));
                    }
                    const fullApproval = await fastify.db.approvalRequest.findFirst({
                      where: { id: pendingApproval.id, tenantId },
                    });
                    return reply.status(200).send(ok({ ...baseResult, pendingApproval: fullApproval }));
                  }
                  case 'continue': {
                    return reply.status(200).send(ok({
                      ...baseResult,
                      hint: 'Workflows continue automatically. If this run is paused, use "resume". If it is awaiting approval, use "approve" or "reject".',
                    }));
                  }
                }
              } catch (followupErr) {
                fastify.log.warn({ workflowId: activeWorkflow.id, err: followupErr instanceof Error ? followupErr.message : String(followupErr) }, '[followup] dispatch failed');
                return reply.status(500).send(err('FOLLOWUP_FAILED', followupErr instanceof Error ? followupErr.message : 'Follow-up command failed'));
              }
            }
          }
        }

        // Orchestration: credits, conversation, creation, enqueue
        const result = await createWorkflowOrchestration(fastify, request, workflowService, {
          goal,
          industry,
          roleModes,
          maxCostUsd,
          conversationId,
        });

        return reply.status(result.statusCode).send(result.body);
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  await fastify.register(workflowControlRoutes);
  await fastify.register(workflowQueryRoutes);
  await fastify.register(workflowStreamRoutes);
  await fastify.register(conversationRoutes);
};

export default workflowsRoutes;
