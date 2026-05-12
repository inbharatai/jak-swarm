/**
 * task-assignments.routes.ts — human-task-assignment routes.
 *
 * Workflow steps can be routed to either an AI agent (existing path) OR a
 * human teammate. When routed to a human, a TaskAssignment row is created
 * and the workflow pauses (via the existing approval-pause mechanism) until
 * the assignee posts a result.
 *
 * Endpoints:
 *   POST   /task-assignments              create an assignment (REVIEWER+ or workflow owner)
 *   GET    /task-assignments              list assignments for this tenant (filterable)
 *   GET    /task-assignments/me           assignments addressed to the calling user
 *   GET    /task-assignments/:id          single assignment
 *   POST   /task-assignments/:id/acknowledge   assignee acks (PENDING -> ACKNOWLEDGED)
 *   POST   /task-assignments/:id/complete     assignee completes (-> COMPLETED + resume workflow)
 *   POST   /task-assignments/:id/decline      assignee declines (-> DECLINED + notify assigner)
 *   POST   /task-assignments/:id/cancel       assigner withdraws (-> CANCELLED)
 *
 * RBAC:
 *   - create: REVIEWER+ OR the user owns the workflow
 *   - acknowledge/complete/decline: only the assignee
 *   - cancel: assigner OR REVIEWER+
 *   - read: any authed tenant member
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { AppError, NotFoundError, ForbiddenError, ValidationError } from '../errors.js';

const VALID_RISK_LEVELS = [
  'READ_ONLY',
  'DRAFT_ONLY',
  'SANDBOX_EDIT',
  'LOCAL_EXEC_ALLOWLIST',
  'EXTERNAL_ACTION_APPROVAL',
  'CRITICAL_MANUAL_ONLY',
  // Legacy 4-tier names — accepted for back-compat with older callers.
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

const declineBodySchema = z.object({
  reason: z.string().min(1).max(2000),
});

const listQuerySchema = z.object({
  status: z.string().optional(),
  workflowId: z.string().optional(),
  assigneeUserId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

const taskAssignmentRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = [fastify.authenticate];

  /** POST /task-assignments — create a new human-task assignment. */
  fastify.post('/', { preHandler: auth }, async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(422)
        .send(err('VALIDATION_ERROR', 'Invalid body', parsed.error.flatten()));
    }
    const data = parsed.data;
    const tenantId = request.user.tenantId;
    const userId = request.user.userId;

    try {
      // Verify workflow belongs to this tenant.
      const wf = await fastify.db.workflow.findFirst({
        where: { id: data.workflowId, tenantId },
        select: { id: true, userId: true },
      });
      if (!wf) throw new NotFoundError('Workflow', data.workflowId);

      // RBAC: workflow owner OR REVIEWER+ can assign.
      const role = request.user.role;
      const isPrivileged = role === 'REVIEWER' || role === 'TENANT_ADMIN' || role === 'SYSTEM_ADMIN' || role === 'OPERATOR';
      if (wf.userId !== userId && !isPrivileged) {
        throw new ForbiddenError('Only the workflow owner or a REVIEWER+ can assign tasks');
      }

      // Verify assignee belongs to this tenant.
      const assignee = await fastify.db.user.findFirst({
        where: { id: data.assigneeUserId, tenantId, active: true },
        select: { id: true, name: true, email: true },
      });
      if (!assignee) {
        throw new ValidationError('assigneeUserId is not a member of this tenant');
      }

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

      // Inbox notification for the assignee.
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

      return reply.status(201).send(ok(assignment));
    } catch (e) {
      if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
      throw e;
    }
  });

  /** GET /task-assignments — list (tenant-scoped, filterable). */
  fastify.get('/', { preHandler: auth }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(422)
        .send(err('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }
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

  /** GET /task-assignments/me — assignments addressed to the calling user. */
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

  /** GET /task-assignments/:id — single assignment. */
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
    if (!assignment) {
      return reply.status(404).send(err('NOT_FOUND', 'TaskAssignment not found'));
    }
    return reply.status(200).send(ok(assignment));
  });

  /** POST /task-assignments/:id/acknowledge — assignee opens the task. */
  fastify.post('/:id/acknowledge', { preHandler: auth }, async (request, reply) => {
    return mutateLifecycle(request, reply, fastify, 'ACKNOWLEDGED', null);
  });

  /** POST /task-assignments/:id/complete — assignee completes. */
  fastify.post('/:id/complete', { preHandler: auth }, async (request, reply) => {
    const parsed = completeBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .status(422)
        .send(err('VALIDATION_ERROR', 'Invalid body', parsed.error.flatten()));
    }
    return mutateLifecycle(request, reply, fastify, 'COMPLETED', {
      result: parsed.data.result ?? null,
      note: parsed.data.note ?? null,
    });
  });

  /** POST /task-assignments/:id/decline — assignee refuses. */
  fastify.post('/:id/decline', { preHandler: auth }, async (request, reply) => {
    const parsed = declineBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(422)
        .send(err('VALIDATION_ERROR', 'Invalid body', parsed.error.flatten()));
    }
    return mutateLifecycle(request, reply, fastify, 'DECLINED', {
      reason: parsed.data.reason,
    });
  });

  /** POST /task-assignments/:id/cancel — assigner withdraws. */
  fastify.post('/:id/cancel', { preHandler: auth }, async (request, reply) => {
    return mutateLifecycle(request, reply, fastify, 'CANCELLED', null, { byAssigner: true });
  });
};

/**
 * Shared lifecycle mutation. Enforces:
 *   - Tenant scoping
 *   - "Only the assignee" for assignee-side transitions
 *   - "Assigner OR REVIEWER+" for cancel
 *   - Idempotency: re-submitting the same target status returns the existing row
 */
async function mutateLifecycle(
  request: FastifyRequest,
  reply: FastifyReply,
  fastify: { db: import('@jak-swarm/db').PrismaClient },
  target: 'ACKNOWLEDGED' | 'COMPLETED' | 'DECLINED' | 'CANCELLED',
  resultPayload: Record<string, unknown> | null,
  opts: { byAssigner?: boolean } = {},
) {
  try {
    const { id } = request.params as { id: string };
    const tenantId = request.user.tenantId;
    const userId = request.user.userId;
    const role = request.user.role;

    const assignment = await fastify.db.taskAssignment.findFirst({
      where: { id, tenantId },
    });
    if (!assignment) throw new NotFoundError('TaskAssignment', id);

    // Authorization.
    if (opts.byAssigner) {
      const isPrivileged =
        role === 'REVIEWER' || role === 'TENANT_ADMIN' || role === 'SYSTEM_ADMIN' || role === 'OPERATOR';
      if (assignment.assignedByUserId !== userId && !isPrivileged) {
        throw new ForbiddenError('Only the assigner or a REVIEWER+ can cancel');
      }
    } else if (assignment.assigneeUserId !== userId) {
      throw new ForbiddenError('Only the assignee can mutate this task');
    }

    // Terminal-state guard.
    const TERMINAL = new Set(['COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED']);
    if (TERMINAL.has(assignment.status)) {
      // Idempotent if it's already in the requested terminal state.
      if (assignment.status === target) {
        return reply.status(200).send(ok(assignment));
      }
      throw new ValidationError(
        `Cannot transition from terminal state ${assignment.status} to ${target}`,
      );
    }

    const now = new Date();
    const update: Record<string, unknown> = { status: target };
    if (target === 'ACKNOWLEDGED') update.acknowledgedAt = now;
    if (target === 'COMPLETED') update.completedAt = now;
    if (resultPayload) update.resultJson = resultPayload;

    // B2 (audit 2026-05-08): tenant isolation invariant.
    //
    // Prisma's `update` requires a unique `where`, and TaskAssignment.id
    // is the only single-column unique. We CANNOT add `tenantId` directly
    // to the `where` here without a compound `@@unique([id, tenantId])`
    // declaration in schema.prisma. Instead, we rely on the `findFirst`
    // tenant check above (~25 lines up) — which is the existing contract.
    //
    // If a future refactor splits the read from this write (e.g. moves
    // it behind a separate transaction boundary), the invariant breaks
    // silently. The defensive belt + braces is the explicit ID-not-found
    // guard right after `assignment` is loaded — keep that intact.
    const next = await fastify.db.taskAssignment.update({
      where: { id },
      data: update,
    });

    // Notify on completion / decline / cancel.
    // B1 (audit 2026-05-08): each terminal state gets its own correctly-
    // labelled notification kind so cockpit filters don't mis-categorise.
    // CANCEL goes to the assignee (their task was cancelled by someone
    // else); COMPLETED + DECLINED go to the assigner (they're waiting on
    // the result).
    if (target === 'COMPLETED' || target === 'DECLINED' || target === 'CANCELLED') {
      const recipient =
        target === 'CANCELLED' ? assignment.assigneeUserId : assignment.assignedByUserId;
      const kind: 'task_completed' | 'task_declined' | 'task_cancelled' =
        target === 'COMPLETED' ? 'task_completed'
        : target === 'DECLINED' ? 'task_declined'
        : 'task_cancelled';
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

    return reply.status(200).send(ok(next));
  } catch (e) {
    if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
    throw e;
  }
}

export default taskAssignmentRoutes;
