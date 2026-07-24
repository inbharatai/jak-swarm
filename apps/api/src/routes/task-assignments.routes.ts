/**
 * task-assignments.routes.ts — human-task-assignment routes.
 *
 * Workflow steps can be routed to either an AI agent (existing path) OR a
 * human teammate. When routed to a human, a TaskAssignment row is created,
 * the workflow is paused, and completion is written into the saved SwarmState
 * before a distributed unpause signal resumes dependent agent work.
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { AppError, NotFoundError, ForbiddenError, ValidationError } from '../errors.js';
import { WorkflowCollaborationService } from '../services/workflow-collaboration.service.js';

const VALID_RISK_LEVELS = [
  'READ_ONLY',
  'DRAFT_ONLY',
  'SANDBOX_EDIT',
  'LOCAL_EXEC_ALLOWLIST',
  'EXTERNAL_ACTION_APPROVAL',
  'CRITICAL_MANUAL_ONLY',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;

const createBodySchema = z.object({
  workflowId: z.string().min(1),
  taskId: z.string().min(1),
  assigneeUserId: z.string().min(1),
  title: z.string().min(1).max(200),
  instructions: z.string().max(8000).optional(),
  riskLevel: z.enum(VALID_RISK_LEVELS).optional(),
  dueAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const completeBodySchema = z.object({
  result: z.record(z.unknown()).optional(),
  note: z.string().max(2000).optional(),
});

const declineBodySchema = z.object({ reason: z.string().min(1).max(2000) });
const listQuerySchema = z.object({
  status: z.string().optional(),
  workflowId: z.string().optional(),
  assigneeUserId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

type OptionalSwarm = {
  pauseWorkflow?: (workflowId: string) => void;
  unpauseWorkflow?: (workflowId: string) => void;
  emit?: (eventName: string, event: unknown) => boolean;
};
type OptionalCoordination = {
  signals?: { publish?: (signal: { type: 'pause' | 'unpause'; workflowId: string; issuedBy: string; timestamp: string }) => Promise<unknown> };
};

function optionalSwarm(fastify: FastifyInstance): OptionalSwarm | undefined {
  return (fastify as unknown as { swarm?: OptionalSwarm }).swarm;
}

function optionalCoordination(fastify: FastifyInstance): OptionalCoordination | undefined {
  return (fastify as unknown as { coordination?: OptionalCoordination }).coordination;
}

function hasDurableWorkflowStub(fastify: FastifyInstance): boolean {
  const workflow = (fastify.db as unknown as { workflow?: { update?: unknown } }).workflow;
  return typeof workflow?.update === 'function';
}

function canApplyHumanResult(fastify: FastifyInstance): boolean {
  const db = fastify.db as unknown as {
    workflow?: { update?: unknown };
    approvalRequest?: { findFirst?: unknown };
  };
  return typeof db.workflow?.update === 'function' && typeof db.approvalRequest?.findFirst === 'function';
}

function emitCollaborationEvent(
  fastify: FastifyInstance,
  event: Awaited<ReturnType<WorkflowCollaborationService['recordEventBestEffort']>>,
): void {
  if (!event) return;
  optionalSwarm(fastify)?.emit?.(`workflow:${event.workflowId}`, {
    type: event.eventType,
    kind: 'collaboration',
    workflowId: event.workflowId,
    taskId: event.taskId,
    actorType: event.actorType,
    actorId: event.actorId,
    content: event.content,
    metadata: event.metadata,
    sequence: event.sequence,
    timestamp: new Date(event.createdAt).toISOString(),
  });
}

async function publishPauseSignal(
  fastify: FastifyInstance,
  type: 'pause' | 'unpause',
  workflowId: string,
  userId: string,
): Promise<boolean> {
  const publish = optionalCoordination(fastify)?.signals?.publish;
  if (!publish) return false;
  await publish({ type, workflowId, issuedBy: userId, timestamp: new Date().toISOString() });
  return true;
}

async function requestWorkflowResume(
  fastify: FastifyInstance,
  input: { workflowId: string; userId: string; pendingApproval: boolean },
): Promise<boolean> {
  if (input.pendingApproval) return false;
  const swarm = optionalSwarm(fastify);
  if (!swarm?.unpauseWorkflow) return false;
  swarm.unpauseWorkflow(input.workflowId);
  return publishPauseSignal(fastify, 'unpause', input.workflowId, input.userId);
}

const taskAssignmentRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = [fastify.authenticate];
  const collaboration = new WorkflowCollaborationService(fastify.db, fastify.log);

  fastify.post('/', { preHandler: auth }, async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid body', parsed.error.flatten()));
    }
    const data = parsed.data;
    const tenantId = request.user.tenantId;
    const userId = request.user.userId;

    try {
      const wf = await fastify.db.workflow.findFirst({
        where: { id: data.workflowId, tenantId },
        select: { id: true, userId: true, status: true },
      });
      if (!wf) throw new NotFoundError('Workflow', data.workflowId);
      if (typeof wf.status === 'string' && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(wf.status)) {
        throw new ValidationError(`Cannot assign a human task to workflow in ${wf.status} status`);
      }

      const role = request.user.role;
      const isPrivileged = role === 'REVIEWER' || role === 'TENANT_ADMIN' || role === 'SYSTEM_ADMIN' || role === 'OPERATOR';
      if (wf.userId !== userId && !isPrivileged) {
        throw new ForbiddenError('Only the workflow owner or a REVIEWER+ can assign tasks');
      }

      const assignee = await fastify.db.user.findFirst({
        where: { id: data.assigneeUserId, tenantId, active: true },
        select: { id: true, name: true, email: true },
      });
      if (!assignee) throw new ValidationError('assigneeUserId is not a member of this tenant');

      const assignment = await fastify.db.taskAssignment.create({
        data: {
          tenantId,
          workflowId: data.workflowId,
          taskId: data.taskId,
          assigneeUserId: data.assigneeUserId,
          assignedByUserId: userId,
          title: data.title,
          instructions: data.instructions ?? null,
          riskLevel: data.riskLevel ?? 'MEDIUM',
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          metadata: (data.metadata as import('@jak-swarm/db').Prisma.InputJsonValue | undefined) ?? undefined,
        },
      });

      let workflowPaused = false;
      if (hasDurableWorkflowStub(fastify)) {
        await collaboration.markHumanTaskPending({
          tenantId,
          workflowId: data.workflowId,
          taskId: data.taskId,
          assignmentId: assignment.id,
          assigneeUserId: data.assigneeUserId,
        });
        optionalSwarm(fastify)?.pauseWorkflow?.(data.workflowId);
        workflowPaused = await publishPauseSignal(fastify, 'pause', data.workflowId, userId);
      }

      const sessionEvent = await collaboration.recordEventBestEffort({
        tenantId,
        workflowId: data.workflowId,
        actorType: 'HUMAN',
        actorId: userId,
        eventType: 'human_task_assigned',
        taskId: data.taskId,
        content: data.instructions ?? data.title,
        metadata: {
          assignmentId: assignment.id,
          assigneeUserId: data.assigneeUserId,
          title: data.title,
          riskLevel: data.riskLevel ?? 'MEDIUM',
          dueAt: data.dueAt ?? null,
        },
      });
      emitCollaborationEvent(fastify, sessionEvent);

      await fastify.db.notification.create({
        data: {
          tenantId,
          userId: data.assigneeUserId,
          kind: 'task_assigned',
          title: `New task: ${data.title}`,
          body: data.instructions?.slice(0, 280) ?? null,
          linkPath: `/inbox/${assignment.id}`,
          payload: { taskAssignmentId: assignment.id, workflowId: data.workflowId },
        },
      });

      return reply.status(201).send(ok({ ...assignment, workflowPaused, sessionEvent }));
    } catch (e) {
      if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
      throw e;
    }
  });

  fastify.get('/', { preHandler: auth }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    const q = parsed.data;
    const tenantId = request.user.tenantId;
    const where: Record<string, unknown> = { tenantId };
    if (q.status) where.status = q.status;
    if (q.workflowId) where.workflowId = q.workflowId;
    if (q.assigneeUserId) where.assigneeUserId = q.assigneeUserId;

    const items = await fastify.db.taskAssignment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > q.limit;
    const page = hasMore ? items.slice(0, q.limit) : items;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;
    return reply.status(200).send(ok({ items: page, nextCursor }));
  });

  fastify.get('/me', { preHandler: auth }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const userId = request.user.userId;
    const status = (request.query as { status?: string })?.status;
    const items = await fastify.db.taskAssignment.findMany({
      where: {
        tenantId,
        assigneeUserId: userId,
        ...(status ? { status } : { status: { in: ['PENDING', 'ACKNOWLEDGED'] } }),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return reply.status(200).send(ok({ items, count: items.length }));
  });

  fastify.get('/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.user.tenantId;
    const assignment = await fastify.db.taskAssignment.findFirst({
      where: { id, tenantId },
      include: {
        assignee: { select: { id: true, name: true, email: true, jobTitle: true } },
        assignedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!assignment) return reply.status(404).send(err('NOT_FOUND', 'TaskAssignment not found'));
    return reply.status(200).send(ok(assignment));
  });

  fastify.post('/:id/acknowledge', { preHandler: auth }, async (request, reply) =>
    mutateLifecycle(request, reply, fastify, 'ACKNOWLEDGED', null));

  fastify.post('/:id/complete', { preHandler: auth }, async (request, reply) => {
    const parsed = completeBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid body', parsed.error.flatten()));
    return mutateLifecycle(request, reply, fastify, 'COMPLETED', {
      result: parsed.data.result ?? null,
      note: parsed.data.note ?? null,
    });
  });

  fastify.post('/:id/decline', { preHandler: auth }, async (request, reply) => {
    const parsed = declineBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid body', parsed.error.flatten()));
    return mutateLifecycle(request, reply, fastify, 'DECLINED', { reason: parsed.data.reason });
  });

  fastify.post('/:id/cancel', { preHandler: auth }, async (request, reply) =>
    mutateLifecycle(request, reply, fastify, 'CANCELLED', null, { byAssigner: true }));
};

async function mutateLifecycle(
  request: FastifyRequest,
  reply: FastifyReply,
  fastify: FastifyInstance,
  target: 'ACKNOWLEDGED' | 'COMPLETED' | 'DECLINED' | 'CANCELLED',
  resultPayload: Record<string, unknown> | null,
  opts: { byAssigner?: boolean } = {},
) {
  try {
    const { id } = request.params as { id: string };
    const tenantId = request.user.tenantId;
    const userId = request.user.userId;
    const role = request.user.role;
    const collaboration = new WorkflowCollaborationService(fastify.db, fastify.log);

    const assignment = await fastify.db.taskAssignment.findFirst({ where: { id, tenantId } });
    if (!assignment) throw new NotFoundError('TaskAssignment', id);

    if (opts.byAssigner) {
      const isPrivileged = role === 'REVIEWER' || role === 'TENANT_ADMIN' || role === 'SYSTEM_ADMIN' || role === 'OPERATOR';
      if (assignment.assignedByUserId !== userId && !isPrivileged) {
        throw new ForbiddenError('Only the assigner or a REVIEWER+ can cancel');
      }
    } else if (assignment.assigneeUserId !== userId) {
      throw new ForbiddenError('Only the assignee can mutate this task');
    }

    const TERMINAL = new Set(['COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED']);
    if (TERMINAL.has(assignment.status)) {
      if (assignment.status === target) {
        let workflowResumeRequested = false;
        if (target === 'COMPLETED' && canApplyHumanResult(fastify)) {
          const stored = assignment.resultJson && typeof assignment.resultJson === 'object' && !Array.isArray(assignment.resultJson)
            ? assignment.resultJson as Record<string, unknown>
            : {};
          const applied = await collaboration.applyHumanTaskResult({
            tenantId,
            workflowId: assignment.workflowId,
            taskId: assignment.taskId,
            assignmentId: assignment.id,
            assigneeUserId: assignment.assigneeUserId,
            result: stored['result'] && typeof stored['result'] === 'object' && !Array.isArray(stored['result'])
              ? stored['result'] as Record<string, unknown>
              : null,
            note: typeof stored['note'] === 'string' ? stored['note'] : null,
          });
          workflowResumeRequested = await requestWorkflowResume(fastify, {
            workflowId: assignment.workflowId,
            userId,
            pendingApproval: applied.pendingApproval,
          });
        }
        return reply.status(200).send(ok({ ...assignment, workflowResumeRequested, idempotent: true }));
      }
      throw new ValidationError(`Cannot transition from terminal state ${assignment.status} to ${target}`);
    }

    const now = new Date();
    const update: Record<string, unknown> = { status: target };
    if (target === 'ACKNOWLEDGED') update.acknowledgedAt = now;
    if (target === 'COMPLETED') update.completedAt = now;
    if (resultPayload) update.resultJson = resultPayload;
    const next = await fastify.db.taskAssignment.update({ where: { id }, data: update });

    let workflowResumeRequested = false;
    let pendingApproval = false;
    if (target === 'COMPLETED' && canApplyHumanResult(fastify)) {
      const applied = await collaboration.applyHumanTaskResult({
        tenantId,
        workflowId: assignment.workflowId,
        taskId: assignment.taskId,
        assignmentId: assignment.id,
        assigneeUserId: assignment.assigneeUserId,
        result: resultPayload?.['result'] && typeof resultPayload['result'] === 'object' && !Array.isArray(resultPayload['result'])
          ? resultPayload['result'] as Record<string, unknown>
          : null,
        note: typeof resultPayload?.['note'] === 'string' ? resultPayload['note'] as string : null,
      });
      pendingApproval = applied.pendingApproval;
      workflowResumeRequested = await requestWorkflowResume(fastify, {
        workflowId: assignment.workflowId,
        userId,
        pendingApproval,
      });
    }

    const eventType = target === 'ACKNOWLEDGED'
      ? 'human_task_acknowledged'
      : target === 'COMPLETED'
        ? 'human_task_completed'
        : target === 'DECLINED'
          ? 'human_task_declined'
          : 'human_task_cancelled';
    const sessionEvent = await collaboration.recordEventBestEffort({
      tenantId,
      workflowId: assignment.workflowId,
      actorType: 'HUMAN',
      actorId: userId,
      eventType,
      taskId: assignment.taskId,
      content: target === 'DECLINED'
        ? String(resultPayload?.['reason'] ?? '')
        : typeof resultPayload?.['note'] === 'string'
          ? resultPayload['note'] as string
          : null,
      metadata: {
        assignmentId: assignment.id,
        assigneeUserId: assignment.assigneeUserId,
        result: resultPayload?.['result'] ?? null,
        workflowResumeRequested,
        pendingApproval,
      },
    });
    emitCollaborationEvent(fastify, sessionEvent);

    if (target === 'COMPLETED' || target === 'DECLINED' || target === 'CANCELLED') {
      const recipient = target === 'CANCELLED' ? assignment.assigneeUserId : assignment.assignedByUserId;
      const kind: 'task_completed' | 'task_declined' | 'task_cancelled' =
        target === 'COMPLETED' ? 'task_completed' : target === 'DECLINED' ? 'task_declined' : 'task_cancelled';
      const verb = target === 'COMPLETED' ? 'completed' : target.toLowerCase();
      await fastify.db.notification.create({
        data: {
          tenantId,
          userId: recipient,
          kind,
          title: `Task ${verb}: ${assignment.title}`,
          body: target === 'DECLINED' ? (resultPayload?.reason as string | undefined) ?? null : null,
          linkPath: `/inbox/${assignment.id}`,
          payload: { taskAssignmentId: assignment.id, workflowId: assignment.workflowId },
        },
      });
    }

    return reply.status(200).send(ok({ ...next, workflowResumeRequested, pendingApproval, sessionEvent }));
  } catch (e) {
    if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
    throw e;
  }
}

export default taskAssignmentRoutes;
