import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Prisma, PrismaClient } from '@jak-swarm/db';

export type ParticipantRole = 'OWNER' | 'EDITOR' | 'REVIEWER' | 'VIEWER';
export type SessionActorType = 'HUMAN' | 'AGENT' | 'SYSTEM';

export interface WorkflowParticipantView {
  id: string;
  tenantId: string;
  workflowId: string;
  userId: string;
  role: ParticipantRole;
  joinedAt: Date;
  lastSeenAt: Date;
  activeTaskId: string | null;
  controlLeaseUntil: Date | null;
  name: string | null;
  email: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  online: boolean;
}

export interface WorkflowSessionEventView {
  id: string;
  tenantId: string;
  workflowId: string;
  actorType: SessionActorType;
  actorId: string | null;
  eventType: string;
  taskId: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
  sequence: number;
  createdAt: Date;
}

interface ParticipantRow extends Omit<WorkflowParticipantView, 'online'> {}
interface EventRow extends Omit<WorkflowSessionEventView, 'sequence'> {
  sequence: bigint | number | string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export class WorkflowCollaborationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly log?: FastifyBaseLogger,
  ) {}

  async getWorkflowForTenant(tenantId: string, workflowId: string) {
    return this.db.workflow.findFirst({
      where: { id: workflowId, tenantId },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        status: true,
        planJson: true,
        stateJson: true,
      },
    });
  }

  async resolveJoinRole(input: {
    tenantId: string;
    workflowId: string;
    userId: string;
    userRole: string;
  }): Promise<ParticipantRole> {
    const workflow = await this.getWorkflowForTenant(input.tenantId, input.workflowId);
    if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
    if (workflow.userId === input.userId) return 'OWNER';
    if (input.userRole === 'REVIEWER') return 'REVIEWER';
    if (input.userRole === 'TENANT_ADMIN' || input.userRole === 'SYSTEM_ADMIN' || input.userRole === 'OPERATOR') {
      return 'EDITOR';
    }
    return 'VIEWER';
  }

  async upsertParticipant(input: {
    tenantId: string;
    workflowId: string;
    userId: string;
    role: ParticipantRole;
  }): Promise<WorkflowParticipantView> {
    const id = randomUUID();
    const rows = await this.db.$queryRawUnsafe<ParticipantRow[]>(
      `
      INSERT INTO "workflow_participants"
        ("id", "tenantId", "workflowId", "userId", "role", "joinedAt", "lastSeenAt", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW(), NOW())
      ON CONFLICT ("workflowId", "userId") DO UPDATE SET
        "role" = CASE
          WHEN "workflow_participants"."role" = 'OWNER' THEN 'OWNER'
          ELSE EXCLUDED."role"
        END,
        "lastSeenAt" = NOW(),
        "updatedAt" = NOW()
      RETURNING
        "id", "tenantId", "workflowId", "userId", "role", "joinedAt", "lastSeenAt",
        "activeTaskId", "controlLeaseUntil",
        (SELECT "name" FROM "users" WHERE "users"."id" = "workflow_participants"."userId") AS "name",
        (SELECT "email" FROM "users" WHERE "users"."id" = "workflow_participants"."userId") AS "email",
        (SELECT "jobTitle" FROM "users" WHERE "users"."id" = "workflow_participants"."userId") AS "jobTitle",
        (SELECT "avatarUrl" FROM "users" WHERE "users"."id" = "workflow_participants"."userId") AS "avatarUrl"
      `,
      id,
      input.tenantId,
      input.workflowId,
      input.userId,
      input.role,
    );
    const row = rows[0];
    if (!row) throw new Error('PARTICIPANT_UPSERT_FAILED');
    return { ...row, online: true };
  }

  async listParticipants(tenantId: string, workflowId: string): Promise<WorkflowParticipantView[]> {
    const rows = await this.db.$queryRawUnsafe<ParticipantRow[]>(
      `
      SELECT
        p."id", p."tenantId", p."workflowId", p."userId", p."role", p."joinedAt", p."lastSeenAt",
        p."activeTaskId", p."controlLeaseUntil",
        u."name", u."email", u."jobTitle", u."avatarUrl"
      FROM "workflow_participants" p
      JOIN "users" u ON u."id" = p."userId" AND u."tenantId" = p."tenantId"
      WHERE p."tenantId" = $1 AND p."workflowId" = $2
      ORDER BY
        CASE p."role" WHEN 'OWNER' THEN 0 WHEN 'REVIEWER' THEN 1 WHEN 'EDITOR' THEN 2 ELSE 3 END,
        p."lastSeenAt" DESC
      `,
      tenantId,
      workflowId,
    );
    const onlineCutoff = Date.now() - 45_000;
    return rows.map((row) => ({
      ...row,
      online: new Date(row.lastSeenAt).getTime() >= onlineCutoff,
    }));
  }

  async heartbeat(input: {
    tenantId: string;
    workflowId: string;
    userId: string;
    activeTaskId?: string | null;
    claimControl?: boolean;
    leaseSeconds?: number;
  }): Promise<{ participant: WorkflowParticipantView; controlGranted: boolean }> {
    const leaseSeconds = Math.max(15, Math.min(120, input.leaseSeconds ?? 45));
    const activeTaskId = input.activeTaskId ?? null;

    if (input.claimControl && activeTaskId) {
      const rows = await this.db.$queryRawUnsafe<ParticipantRow[]>(
        `
        UPDATE "workflow_participants" p
        SET
          "lastSeenAt" = NOW(),
          "activeTaskId" = $4,
          "controlLeaseUntil" = NOW() + ($5::text || ' seconds')::interval,
          "updatedAt" = NOW()
        WHERE p."tenantId" = $1
          AND p."workflowId" = $2
          AND p."userId" = $3
          AND NOT EXISTS (
            SELECT 1
            FROM "workflow_participants" other
            WHERE other."tenantId" = $1
              AND other."workflowId" = $2
              AND other."userId" <> $3
              AND other."activeTaskId" = $4
              AND other."controlLeaseUntil" > NOW()
          )
        RETURNING
          p."id", p."tenantId", p."workflowId", p."userId", p."role", p."joinedAt", p."lastSeenAt",
          p."activeTaskId", p."controlLeaseUntil",
          (SELECT "name" FROM "users" WHERE "users"."id" = p."userId") AS "name",
          (SELECT "email" FROM "users" WHERE "users"."id" = p."userId") AS "email",
          (SELECT "jobTitle" FROM "users" WHERE "users"."id" = p."userId") AS "jobTitle",
          (SELECT "avatarUrl" FROM "users" WHERE "users"."id" = p."userId") AS "avatarUrl"
        `,
        input.tenantId,
        input.workflowId,
        input.userId,
        activeTaskId,
        leaseSeconds,
      );
      const participant = rows[0];
      if (participant) return { participant: { ...participant, online: true }, controlGranted: true };
    }

    const rows = await this.db.$queryRawUnsafe<ParticipantRow[]>(
      `
      UPDATE "workflow_participants" p
      SET
        "lastSeenAt" = NOW(),
        "activeTaskId" = $4,
        "controlLeaseUntil" = CASE WHEN $4::text IS NULL THEN NULL ELSE p."controlLeaseUntil" END,
        "updatedAt" = NOW()
      WHERE p."tenantId" = $1 AND p."workflowId" = $2 AND p."userId" = $3
      RETURNING
        p."id", p."tenantId", p."workflowId", p."userId", p."role", p."joinedAt", p."lastSeenAt",
        p."activeTaskId", p."controlLeaseUntil",
        (SELECT "name" FROM "users" WHERE "users"."id" = p."userId") AS "name",
        (SELECT "email" FROM "users" WHERE "users"."id" = p."userId") AS "email",
        (SELECT "jobTitle" FROM "users" WHERE "users"."id" = p."userId") AS "jobTitle",
        (SELECT "avatarUrl" FROM "users" WHERE "users"."id" = p."userId") AS "avatarUrl"
      `,
      input.tenantId,
      input.workflowId,
      input.userId,
      activeTaskId,
    );
    const participant = rows[0];
    if (!participant) throw new Error('PARTICIPANT_NOT_FOUND');
    return { participant: { ...participant, online: true }, controlGranted: false };
  }

  async leave(tenantId: string, workflowId: string, userId: string): Promise<boolean> {
    const deleted = await this.db.$executeRawUnsafe(
      `DELETE FROM "workflow_participants" WHERE "tenantId" = $1 AND "workflowId" = $2 AND "userId" = $3 AND "role" <> 'OWNER'`,
      tenantId,
      workflowId,
      userId,
    );
    return deleted > 0;
  }

  async recordEvent(input: {
    tenantId: string;
    workflowId: string;
    actorType: SessionActorType;
    actorId?: string | null;
    eventType: string;
    taskId?: string | null;
    content?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<WorkflowSessionEventView> {
    const id = randomUUID();
    const rows = await this.db.$queryRawUnsafe<EventRow[]>(
      `
      INSERT INTO "workflow_session_events"
        ("id", "tenantId", "workflowId", "actorType", "actorId", "eventType", "taskId", "content", "metadata", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
      RETURNING "id", "tenantId", "workflowId", "actorType", "actorId", "eventType", "taskId", "content", "metadata", "sequence", "createdAt"
      `,
      id,
      input.tenantId,
      input.workflowId,
      input.actorType,
      input.actorId ?? null,
      input.eventType,
      input.taskId ?? null,
      input.content ?? null,
      JSON.stringify(input.metadata ?? null),
    );
    const row = rows[0];
    if (!row) throw new Error('SESSION_EVENT_INSERT_FAILED');
    return { ...row, sequence: Number(row.sequence) };
  }

  async recordEventBestEffort(input: Parameters<WorkflowCollaborationService['recordEvent']>[0]): Promise<WorkflowSessionEventView | null> {
    try {
      return await this.recordEvent(input);
    } catch (error) {
      this.log?.warn(
        { workflowId: input.workflowId, eventType: input.eventType, error: error instanceof Error ? error.message : String(error) },
        '[multiplayer] session event persistence failed (non-fatal)',
      );
      return null;
    }
  }

  async listEvents(input: {
    tenantId: string;
    workflowId: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<WorkflowSessionEventView[]> {
    const limit = Math.max(1, Math.min(500, input.limit ?? 100));
    const rows = await this.db.$queryRawUnsafe<EventRow[]>(
      `
      SELECT "id", "tenantId", "workflowId", "actorType", "actorId", "eventType", "taskId", "content", "metadata", "sequence", "createdAt"
      FROM "workflow_session_events"
      WHERE "tenantId" = $1 AND "workflowId" = $2 AND "sequence" > $3
      ORDER BY "sequence" ASC
      LIMIT $4
      `,
      input.tenantId,
      input.workflowId,
      input.afterSequence ?? 0,
      limit,
    );
    return rows.map((row) => ({ ...row, sequence: Number(row.sequence) }));
  }

  async redirectTask(input: {
    tenantId: string;
    workflowId: string;
    taskId: string;
    actorId: string;
    instruction?: string;
    agentRole?: string;
    expectedOutput?: string;
    action?: 'REDIRECT' | 'PAUSE_BRANCH' | 'CANCEL_BRANCH';
    reason: string;
  }): Promise<{ plan: Record<string, unknown>; version: number; task: Record<string, unknown> }> {
    return this.db.$transaction(async (tx) => {
      const workflow = await tx.workflow.findFirst({
        where: { id: input.workflowId, tenantId: input.tenantId },
        select: { id: true, planJson: true, stateJson: true },
      });
      if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');

      const plan = jsonObject(workflow.planJson);
      const tasks = Array.isArray(plan['tasks']) ? [...plan['tasks']] : [];
      const index = tasks.findIndex((task) => isRecord(task) && String(task['id']) === input.taskId);
      if (index < 0) throw new Error('TASK_NOT_FOUND');

      const previousTask = jsonObject(tasks[index] as Prisma.JsonValue);
      const nextTask: Record<string, unknown> = {
        ...previousTask,
        redirectedBy: input.actorId,
        redirectedAt: new Date().toISOString(),
        redirectReason: input.reason,
      };
      if (input.instruction) {
        nextTask['description'] = input.instruction;
        nextTask['instructions'] = input.instruction;
      }
      if (input.agentRole) nextTask['agentRole'] = input.agentRole;
      if (input.expectedOutput) nextTask['expectedOutput'] = input.expectedOutput;
      if (input.action === 'PAUSE_BRANCH') nextTask['collaborationState'] = 'PAUSED_BY_HUMAN';
      if (input.action === 'CANCEL_BRANCH') nextTask['collaborationState'] = 'CANCELLED_BY_HUMAN';
      tasks[index] = nextTask;
      const nextPlan = { ...plan, tasks };

      const state = jsonObject(workflow.stateJson);
      const nextState = { ...state, plan: nextPlan };
      await tx.workflow.update({
        where: { id: input.workflowId },
        data: {
          planJson: asInputJson(nextPlan),
          stateJson: asInputJson(nextState),
        },
      });

      const versions = await tx.$queryRawUnsafe<Array<{ version: number }>>(
        `SELECT COALESCE(MAX("version"), -1)::int AS "version" FROM "plan_versions" WHERE "workflowId" = $1`,
        input.workflowId,
      );
      const previousVersion = versions[0]?.version ?? -1;
      const version = previousVersion + 1;
      await tx.$executeRawUnsafe(
        `
        INSERT INTO "plan_versions"
          ("id", "tenantId", "workflowId", "version", "planId", "plan", "parentVersionId", "changeReason", "repairType", "changedTaskIds", "invalidatedTaskIds", "createdAt")
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11::jsonb, NOW())
        `,
        randomUUID(),
        input.tenantId,
        input.workflowId,
        version,
        `${input.workflowId}-plan`,
        JSON.stringify(nextPlan),
        previousVersion >= 0 ? previousVersion : null,
        input.reason,
        input.action === 'CANCEL_BRANCH' ? 'REMOVE_TASK' : 'MODIFY_TASK',
        JSON.stringify([input.taskId]),
        JSON.stringify(input.action === 'CANCEL_BRANCH' ? [input.taskId] : []),
      );

      return { plan: nextPlan, version, task: nextTask };
    });
  }

  async markHumanTaskPending(input: {
    tenantId: string;
    workflowId: string;
    taskId: string;
    assignmentId: string;
    assigneeUserId: string;
  }): Promise<void> {
    const workflow = await this.db.workflow.findFirst({
      where: { id: input.workflowId, tenantId: input.tenantId },
      select: { stateJson: true },
    });
    if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');
    const state = jsonObject(workflow.stateJson);
    const existing = isRecord(state['pendingHumanTasks']) ? state['pendingHumanTasks'] : {};
    const pendingHumanTasks = {
      ...existing,
      [input.taskId]: {
        assignmentId: input.assignmentId,
        assigneeUserId: input.assigneeUserId,
        assignedAt: new Date().toISOString(),
      },
    };
    await this.db.workflow.update({
      where: { id: input.workflowId },
      data: { stateJson: asInputJson({ ...state, pendingHumanTasks }), status: 'PAUSED' },
    });
  }

  async applyHumanTaskResult(input: {
    tenantId: string;
    workflowId: string;
    taskId: string;
    assignmentId: string;
    assigneeUserId: string;
    result: Record<string, unknown> | null;
    note: string | null;
  }): Promise<{ pendingApproval: boolean }> {
    const workflow = await this.db.workflow.findFirst({
      where: { id: input.workflowId, tenantId: input.tenantId },
      select: { stateJson: true, planJson: true },
    });
    if (!workflow) throw new Error('WORKFLOW_NOT_FOUND');

    const state = jsonObject(workflow.stateJson);
    const taskResults = isRecord(state['taskResults']) ? { ...state['taskResults'] } : {};
    taskResults[input.taskId] = {
      source: 'human',
      assignmentId: input.assignmentId,
      assigneeUserId: input.assigneeUserId,
      result: input.result,
      note: input.note,
      completedAt: new Date().toISOString(),
    };

    const completed = new Set(
      Array.isArray(state['completedTaskIds'])
        ? state['completedTaskIds'].filter((value): value is string => typeof value === 'string')
        : [],
    );
    completed.add(input.taskId);

    const pendingHumanTasks = isRecord(state['pendingHumanTasks']) ? { ...state['pendingHumanTasks'] } : {};
    delete pendingHumanTasks[input.taskId];

    let currentTaskIndex = typeof state['currentTaskIndex'] === 'number' ? state['currentTaskIndex'] : 0;
    const plan = jsonObject(workflow.planJson);
    const tasks = Array.isArray(plan['tasks']) ? plan['tasks'] : [];
    const taskIndex = tasks.findIndex((task) => isRecord(task) && String(task['id']) === input.taskId);
    if (taskIndex >= 0 && currentTaskIndex === taskIndex) currentTaskIndex = Math.min(taskIndex + 1, tasks.length);

    await this.db.workflow.update({
      where: { id: input.workflowId },
      data: {
        stateJson: asInputJson({
          ...state,
          taskResults,
          completedTaskIds: [...completed],
          pendingHumanTasks,
          currentTaskIndex,
          status: 'EXECUTING',
        }),
      },
    });

    const pendingApproval = await this.db.approvalRequest.findFirst({
      where: { tenantId: input.tenantId, workflowId: input.workflowId, status: 'PENDING' },
      select: { id: true },
    });
    return { pendingApproval: Boolean(pendingApproval) };
  }
}
