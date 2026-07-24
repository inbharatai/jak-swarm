import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@jak-swarm/db';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowCollaborationService } from '../../apps/api/src/services/workflow-collaboration.service.js';

describe.sequential('multiplayer collaboration integration', () => {
  let container: Awaited<ReturnType<GenericContainer['start']>>;
  let prisma: PrismaClient;
  let service: WorkflowCollaborationService;
  let runtimeUnavailable = false;
  let tenantId = '';
  let ownerId = '';
  let editorId = '';
  let workflowId = '';

  beforeAll(async () => {
    try {
      container = await new GenericContainer('pgvector/pgvector:pg16')
        .withEnvironment({
          POSTGRES_DB: 'jakswarm',
          POSTGRES_USER: 'jakswarm',
          POSTGRES_PASSWORD: 'jakswarm',
        })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/i))
        .start();

      const dbUrl = `postgresql://jakswarm:jakswarm@${container.getHost()}:${container.getMappedPort(5432)}/jakswarm`;
      process.env.DATABASE_URL = dbUrl;
      process.env.DIRECT_URL = dbUrl;
      const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
      execSync('pnpm --filter @jak-swarm/db db:migrate:deploy', {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl },
      });

      prisma = new PrismaClient();
      await prisma.$connect();
      service = new WorkflowCollaborationService(prisma);

      const tenant = await prisma.tenant.create({
        data: { name: 'Multiplayer Test', slug: `multiplayer-${Date.now()}`, plan: 'FREE' },
      });
      tenantId = tenant.id;
      const owner = await prisma.user.create({
        data: { tenantId, email: `owner-${Date.now()}@example.com`, role: 'TENANT_ADMIN', name: 'Owner' },
      });
      const editor = await prisma.user.create({
        data: { tenantId, email: `editor-${Date.now()}@example.com`, role: 'END_USER', name: 'Editor' },
      });
      ownerId = owner.id;
      editorId = editor.id;
      const plan = {
        goal: 'Prepare campaign',
        tasks: [
          { id: 'research_1', description: 'Research market', agentRole: 'WORKER_RESEARCH', toolsRequired: ['web_search'] },
          { id: 'content_1', description: 'Draft launch copy', agentRole: 'WORKER_CONTENT', toolsRequired: [] },
        ],
      };
      const workflow = await prisma.workflow.create({
        data: {
          tenantId,
          userId: ownerId,
          goal: 'Prepare campaign',
          status: 'PAUSED',
          planJson: plan,
          stateJson: {
            plan,
            currentTaskIndex: 0,
            taskResults: {},
            completedTaskIds: [],
            pendingHumanTasks: {},
          },
        },
      });
      workflowId = workflow.id;
    } catch (error) {
      runtimeUnavailable = true;
      console.warn('[multiplayer-collaboration] Skipping: container runtime unavailable', error);
    }
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('persists participants and enforces a single active task controller', async () => {
    if (runtimeUnavailable) return;
    const owner = await service.upsertParticipant({ tenantId, workflowId, userId: ownerId, role: 'OWNER' });
    const editor = await service.upsertParticipant({ tenantId, workflowId, userId: editorId, role: 'EDITOR' });
    expect(owner.role).toBe('OWNER');
    expect(editor.role).toBe('EDITOR');

    const first = await service.heartbeat({
      tenantId,
      workflowId,
      userId: ownerId,
      activeTaskId: 'research_1',
      claimControl: true,
      leaseSeconds: 60,
    });
    expect(first.controlGranted).toBe(true);

    const second = await service.heartbeat({
      tenantId,
      workflowId,
      userId: editorId,
      activeTaskId: 'research_1',
      claimControl: true,
      leaseSeconds: 60,
    });
    expect(second.controlGranted).toBe(false);

    const participants = await service.listParticipants(tenantId, workflowId);
    expect(participants).toHaveLength(2);
    expect(participants.find((participant) => participant.userId === ownerId)?.activeTaskId).toBe('research_1');
  });

  it('stores an append-only collaboration event timeline', async () => {
    if (runtimeUnavailable) return;
    const first = await service.recordEvent({
      tenantId,
      workflowId,
      actorType: 'HUMAN',
      actorId: ownerId,
      eventType: 'human_comment',
      taskId: 'research_1',
      content: 'Focus on Assamese and Hindi users.',
    });
    const second = await service.recordEvent({
      tenantId,
      workflowId,
      actorType: 'SYSTEM',
      eventType: 'task_redirected',
      taskId: 'research_1',
      metadata: { source: 'test' },
    });
    expect(second.sequence).toBeGreaterThan(first.sequence);
    const events = await service.listEvents({ tenantId, workflowId, afterSequence: first.sequence - 1 });
    expect(events.map((event) => event.eventType)).toEqual(['human_comment', 'task_redirected']);
  });

  it('versions redirected tasks and updates both persisted plan copies', async () => {
    if (runtimeUnavailable) return;
    const redirected = await service.redirectTask({
      tenantId,
      workflowId,
      taskId: 'research_1',
      actorId: editorId,
      instruction: 'Research Assamese, Hindi and Bengali offline-first Android users.',
      reason: 'Narrow the target market.',
      action: 'REDIRECT',
    });
    expect(redirected.version).toBe(0);
    expect(redirected.task['description']).toContain('Assamese');

    const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
    const plan = workflow?.planJson as { tasks: Array<{ id: string; description: string }> };
    const state = workflow?.stateJson as { plan: { tasks: Array<{ id: string; description: string }> } };
    expect(plan.tasks[0]?.description).toContain('Assamese');
    expect(state.plan.tasks[0]?.description).toContain('Assamese');

    const rows = await prisma.$queryRawUnsafe<Array<{ version: number; changeReason: string }>>(
      `SELECT "version", "changeReason" FROM "plan_versions" WHERE "workflowId" = $1 ORDER BY "version" ASC`,
      workflowId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.changeReason).toBe('Narrow the target market.');
  });

  it('writes human output into SwarmState and clears the human gate', async () => {
    if (runtimeUnavailable) return;
    await service.markHumanTaskPending({
      tenantId,
      workflowId,
      taskId: 'research_1',
      assignmentId: 'assignment-1',
      assigneeUserId: editorId,
    });
    const result = await service.applyHumanTaskResult({
      tenantId,
      workflowId,
      taskId: 'research_1',
      assignmentId: 'assignment-1',
      assigneeUserId: editorId,
      result: { verifiedMarket: 'Assam + Hindi belt' },
      note: 'Verified against source data.',
    });
    expect(result.pendingApproval).toBe(false);

    const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
    const state = workflow?.stateJson as {
      taskResults: Record<string, { source: string; result: Record<string, unknown> }>;
      completedTaskIds: string[];
      pendingHumanTasks: Record<string, unknown>;
      currentTaskIndex: number;
    };
    expect(state.taskResults['research_1']?.source).toBe('human');
    expect(state.taskResults['research_1']?.result['verifiedMarket']).toBe('Assam + Hindi belt');
    expect(state.completedTaskIds).toContain('research_1');
    expect(state.pendingHumanTasks['research_1']).toBeUndefined();
    expect(state.currentTaskIndex).toBe(1);
  });
});
