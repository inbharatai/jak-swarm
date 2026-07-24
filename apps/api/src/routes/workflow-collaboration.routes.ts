import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import {
  WorkflowCollaborationService,
  type ParticipantRole,
  type WorkflowSessionEventView,
} from '../services/workflow-collaboration.service.js';

const workflowParamsSchema = z.object({ workflowId: z.string().min(1) });
const taskParamsSchema = z.object({ workflowId: z.string().min(1), taskId: z.string().min(1) });
const heartbeatSchema = z.object({
  activeTaskId: z.string().min(1).nullable().optional(),
  claimControl: z.boolean().optional(),
  leaseSeconds: z.number().int().min(15).max(120).optional(),
});
const eventsQuerySchema = z.object({
  afterSequence: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
const commentSchema = z.object({
  content: z.string().trim().min(1).max(8000),
  taskId: z.string().min(1).nullable().optional(),
  mentions: z.array(z.string().min(1)).max(50).optional(),
});
const redirectSchema = z.object({
  instruction: z.string().trim().min(1).max(8000).optional(),
  agentRole: z.string().trim().min(1).max(100).optional(),
  expectedOutput: z.string().trim().min(1).max(4000).optional(),
  action: z.enum(['REDIRECT', 'PAUSE_BRANCH', 'CANCEL_BRANCH']).default('REDIRECT'),
  reason: z.string().trim().min(1).max(2000),
});

function emitSessionEvent(fastify: Parameters<FastifyPluginAsync>[0], event: WorkflowSessionEventView): void {
  fastify.swarm.emit(`workflow:${event.workflowId}`, {
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

function elevatedRole(role: string): boolean {
  return role === 'REVIEWER' || role === 'OPERATOR' || role === 'TENANT_ADMIN' || role === 'SYSTEM_ADMIN';
}

async function requireWorkflow(
  service: WorkflowCollaborationService,
  request: FastifyRequest,
  workflowId: string,
) {
  const workflow = await service.getWorkflowForTenant(request.user.tenantId, workflowId);
  if (!workflow) return null;
  return workflow;
}

async function participantRole(
  fastify: Parameters<FastifyPluginAsync>[0],
  tenantId: string,
  workflowId: string,
  userId: string,
): Promise<ParticipantRole | null> {
  try {
    const rows = await fastify.db.$queryRawUnsafe<Array<{ role: ParticipantRole }>>(
      `SELECT "role" FROM "workflow_participants" WHERE "tenantId" = $1 AND "workflowId" = $2 AND "userId" = $3 LIMIT 1`,
      tenantId,
      workflowId,
      userId,
    );
    return rows[0]?.role ?? null;
  } catch {
    return null;
  }
}

const workflowCollaborationRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new WorkflowCollaborationService(fastify.db, fastify.log);
  const auth = [fastify.authenticate];

  fastify.get('/:workflowId/participants', { preHandler: auth }, async (request, reply) => {
    const parsed = workflowParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid workflow id'));
    const workflow = await requireWorkflow(service, request, parsed.data.workflowId);
    if (!workflow) return reply.status(404).send(err('NOT_FOUND', 'Workflow not found'));
    try {
      return reply.send(ok({ participants: await service.listParticipants(request.user.tenantId, workflow.id) }));
    } catch (error) {
      request.log.error({ error }, 'Failed to list workflow participants');
      return reply.status(503).send(err('COLLABORATION_STORAGE_UNAVAILABLE', 'Collaboration migration is not available'));
    }
  });

  fastify.post('/:workflowId/participants/join', { preHandler: auth }, async (request, reply) => {
    const parsed = workflowParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid workflow id'));
    const workflow = await requireWorkflow(service, request, parsed.data.workflowId);
    if (!workflow) return reply.status(404).send(err('NOT_FOUND', 'Workflow not found'));
    try {
      const role = await service.resolveJoinRole({
        tenantId: request.user.tenantId,
        workflowId: workflow.id,
        userId: request.user.userId,
        userRole: request.user.role,
      });
      const participant = await service.upsertParticipant({
        tenantId: request.user.tenantId,
        workflowId: workflow.id,
        userId: request.user.userId,
        role,
      });
      const event = await service.recordEvent({
        tenantId: request.user.tenantId,
        workflowId: workflow.id,
        actorType: 'HUMAN',
        actorId: request.user.userId,
        eventType: 'participant_joined',
        metadata: { role },
      });
      emitSessionEvent(fastify, event);
      return reply.status(201).send(ok({ participant, event }));
    } catch (error) {
      request.log.error({ error }, 'Failed to join workflow session');
      return reply.status(503).send(err('COLLABORATION_STORAGE_UNAVAILABLE', 'Collaboration migration is not available'));
    }
  });

  fastify.post('/:workflowId/participants/heartbeat', { preHandler: auth }, async (request, reply) => {
    const params = workflowParamsSchema.safeParse(request.params);
    const body = heartbeatSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid heartbeat request'));
    const workflow = await requireWorkflow(service, request, params.data.workflowId);
    if (!workflow) return reply.status(404).send(err('NOT_FOUND', 'Workflow not found'));
    try {
      let role = await participantRole(fastify, request.user.tenantId, workflow.id, request.user.userId);
      if (!role) {
        role = await service.resolveJoinRole({
          tenantId: request.user.tenantId,
          workflowId: workflow.id,
          userId: request.user.userId,
          userRole: request.user.role,
        });
        await service.upsertParticipant({
          tenantId: request.user.tenantId,
          workflowId: workflow.id,
          userId: request.user.userId,
          role,
        });
      }
      const result = await service.heartbeat({
        tenantId: request.user.tenantId,
        workflowId: workflow.id,
        userId: request.user.userId,
        ...body.data,
      });
      if (body.data.claimControl && !result.controlGranted) {
        return reply.status(409).send(err('TASK_CONTROL_HELD', 'Another teammate currently controls this task'));
      }
      return reply.send(ok(result));
    } catch (error) {
      request.log.error({ error }, 'Workflow heartbeat failed');
      return reply.status(503).send(err('COLLABORATION_STORAGE_UNAVAILABLE', 'Collaboration migration is not available'));
    }
  });

  fastify.delete('/:workflowId/participants/me', { preHandler: auth }, async (request, reply) => {
    const parsed = workflowParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid workflow id'));
    const workflow = await requireWorkflow(service, request, parsed.data.workflowId);
    if (!workflow) return reply.status(404).send(err('NOT_FOUND', 'Workflow not found'));
    try {
      const left = await service.leave(request.user.tenantId, workflow.id, request.user.userId);
      if (left) {
        const event = await service.recordEvent({
          tenantId: request.user.tenantId,
          workflowId: workflow.id,
          actorType: 'HUMAN',
          actorId: request.user.userId,
          eventType: 'participant_left',
        });
        emitSessionEvent(fastify, event);
      }
      return reply.send(ok({ left }));
    } catch (error) {
      request.log.error({ error }, 'Failed to leave workflow session');
      return reply.status(503).send(err('COLLABORATION_STORAGE_UNAVAILABLE', 'Collaboration migration is not available'));
    }
  });

  fastify.get('/:workflowId/session-events', { preHandler: auth }, async (request, reply) => {
    const params = workflowParamsSchema.safeParse(request.params);
    const query = eventsQuerySchema.safeParse(request.query ?? {});
    if (!params.success || !query.success) return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid event query'));
    const workflow = await requireWorkflow(service, request, params.data.workflowId);
    if (!workflow) return reply.status(404).send(err('NOT_FOUND', 'Workflow not found'));
    try {
      const events = await service.listEvents({
        tenantId: request.user.tenantId,
        workflowId: workflow.id,
        ...query.data,
      });
      return reply.send(ok({ events, nextSequence: events.at(-1)?.sequence ?? query.data.afterSequence ?? 0 }));
    } catch (error) {
      request.log.error({ error }, 'Failed to list workflow session events');
      return reply.status(503).send(err('COLLABORATION_STORAGE_UNAVAILABLE', 'Collaboration migration is not available'));
    }
  });

  fastify.post('/:workflowId/comments', { preHandler: auth }, async (request, reply) => {
    const params = workflowParamsSchema.safeParse(request.params);
    const body = commentSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid comment'));
    const workflow = await requireWorkflow(service, request, params.data.workflowId);
    if (!workflow) return reply.status(404).send(err('NOT_FOUND', 'Workflow not found'));
    try {
      const event = await service.recordEvent({
        tenantId: request.user.tenantId,
        workflowId: workflow.id,
        actorType: 'HUMAN',
        actorId: request.user.userId,
        eventType: 'human_comment',
        taskId: body.data.taskId ?? null,
        content: body.data.content,
        metadata: { mentions: body.data.mentions ?? [] },
      });
      emitSessionEvent(fastify, event);

      if (body.data.mentions?.length) {
        const mentionedUsers = await fastify.db.user.findMany({
          where: { tenantId: request.user.tenantId, id: { in: body.data.mentions }, active: true },
          select: { id: true },
        });
        await fastify.db.notification.createMany({
          data: mentionedUsers
            .filter((user) => user.id !== request.user.userId)
            .map((user) => ({
              tenantId: request.user.tenantId,
              userId: user.id,
              kind: 'workflow_mention',
              title: 'You were mentioned in a workflow session',
              body: body.data.content.slice(0, 280),
              linkPath: `/workflows/${workflow.id}/session`,
              payload: { workflowId: workflow.id, taskId: body.data.taskId ?? null, eventId: event.id },
            })),
          skipDuplicates: true,
        }).catch(() => undefined);
      }
      return reply.status(201).send(ok(event));
    } catch (error) {
      request.log.error({ error }, 'Failed to add workflow comment');
      return reply.status(503).send(err('COLLABORATION_STORAGE_UNAVAILABLE', 'Collaboration migration is not available'));
    }
  });

  fastify.post('/:workflowId/tasks/:taskId/redirect', { preHandler: auth }, async (request, reply) => {
    const params = taskParamsSchema.safeParse(request.params);
    const body = redirectSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid redirect request'));
    const workflow = await requireWorkflow(service, request, params.data.workflowId);
    if (!workflow) return reply.status(404).send(err('NOT_FOUND', 'Workflow not found'));

    const role = await participantRole(fastify, request.user.tenantId, workflow.id, request.user.userId);
    const canEdit = workflow.userId === request.user.userId || elevatedRole(request.user.role) || role === 'OWNER' || role === 'EDITOR' || role === 'REVIEWER';
    if (!canEdit) return reply.status(403).send(err('FORBIDDEN', 'Viewer participants cannot redirect work'));
    if (workflow.status !== 'PAUSED') {
      return reply.status(409).send(err(
        'WORKFLOW_MUST_BE_PAUSED',
        'Pause the workflow before redirecting a task so the saved plan and live runtime cannot diverge',
        { status: workflow.status },
      ));
    }

    try {
      const redirected = await service.redirectTask({
        tenantId: request.user.tenantId,
        workflowId: workflow.id,
        taskId: params.data.taskId,
        actorId: request.user.userId,
        ...body.data,
      });
      const event = await service.recordEvent({
        tenantId: request.user.tenantId,
        workflowId: workflow.id,
        actorType: 'HUMAN',
        actorId: request.user.userId,
        eventType: body.data.action === 'CANCEL_BRANCH' ? 'task_branch_cancelled' : body.data.action === 'PAUSE_BRANCH' ? 'task_branch_paused' : 'task_redirected',
        taskId: params.data.taskId,
        content: body.data.reason,
        metadata: {
          version: redirected.version,
          instruction: body.data.instruction,
          agentRole: body.data.agentRole,
          expectedOutput: body.data.expectedOutput,
        },
      });
      emitSessionEvent(fastify, event);
      return reply.send(ok({ ...redirected, event, resumeEndpoint: `/workflows/${workflow.id}/unpause` }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'TASK_NOT_FOUND') return reply.status(404).send(err('NOT_FOUND', 'Task not found in workflow plan'));
      request.log.error({ error }, 'Failed to redirect workflow task');
      return reply.status(500).send(err('TASK_REDIRECT_FAILED', 'Task redirect failed'));
    }
  });

  fastify.get('/:workflowId/replay', { preHandler: auth }, async (request, reply) => {
    const params = workflowParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid workflow id'));
    const workflow = await requireWorkflow(service, request, params.data.workflowId);
    if (!workflow) return reply.status(404).send(err('NOT_FOUND', 'Workflow not found'));
    try {
      const [participants, sessionEvents, traces, approvals, humanTasks, artifacts, auditEvents] = await Promise.all([
        service.listParticipants(request.user.tenantId, workflow.id),
        service.listEvents({ tenantId: request.user.tenantId, workflowId: workflow.id, limit: 500 }),
        fastify.db.agentTrace.findMany({ where: { tenantId: request.user.tenantId, workflowId: workflow.id }, orderBy: { stepIndex: 'asc' } }),
        fastify.db.approvalRequest.findMany({ where: { tenantId: request.user.tenantId, workflowId: workflow.id }, orderBy: { createdAt: 'asc' } }),
        fastify.db.taskAssignment.findMany({ where: { tenantId: request.user.tenantId, workflowId: workflow.id }, orderBy: { createdAt: 'asc' } }),
        fastify.db.workflowArtifact.findMany({ where: { tenantId: request.user.tenantId, workflowId: workflow.id, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
        fastify.db.auditLog.findMany({ where: { tenantId: request.user.tenantId, resourceId: workflow.id }, orderBy: { createdAt: 'asc' }, take: 1000 }),
      ]);
      return reply.send(ok({
        workflow,
        participants,
        sessionEvents,
        traces,
        approvals,
        humanTasks,
        artifacts,
        auditEvents,
      }));
    } catch (error) {
      request.log.error({ error }, 'Failed to build workflow replay');
      return reply.status(500).send(err('REPLAY_BUILD_FAILED', 'Could not build workflow replay'));
    }
  });
};

export default workflowCollaborationRoutes;
