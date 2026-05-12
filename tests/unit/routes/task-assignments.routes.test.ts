/**
 * Unit tests for `apps/api/src/routes/task-assignments.routes.ts`.
 *
 * The route file routes a workflow step to a HUMAN teammate. There is a
 * lot of authorization riding on each handler, so this suite focuses on:
 *
 *   - RBAC (workflow owner / REVIEWER+ to assign, only-assignee to mutate,
 *     assigner-or-REVIEWER+ to cancel)
 *   - Tenant isolation (every Prisma lookup is `where: { id, tenantId }`,
 *     and the cross-tenant probe MUST 404 not 200 — that is the load-
 *     bearing security test)
 *   - Body-shape validation (zod schemas on create / complete / decline)
 *   - Lifecycle transitions (terminal-state stickiness, idempotent re-
 *     submit, side-effect notifications fired on the right transition)
 *   - Risk-level back-compat (legacy 4-tier names accepted alongside the
 *     6-tier OpenClaw names)
 *
 * Strategy:
 *   - Build a minimal Fastify instance per test (`Fastify({ logger: false })`)
 *   - Mount the route plugin at /task-assignments
 *   - Decorate `authenticate` to read `x-test-user` JSON and stamp it onto
 *     `request.user`, so each request can pretend to be a different
 *     identity / role
 *   - Decorate `db` with an in-memory stub matching the Prisma client
 *     shape used by the route (workflow, user, taskAssignment,
 *     notification — only the methods the route calls)
 *   - Decorate `auditLog` with a vi.fn (the route doesn't call it today,
 *     but the FastifyInstance type augmentation expects it)
 *   - Drive every request through `app.inject(...)` — no real listener.
 */

// Tests workspace doesn't list fastify directly — import via apps/api's
// installed copy. Mirrors the pattern in trial.routes.test.ts +
// inbox.routes.test.ts so all route tests resolve fastify the same way.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import FastifyImport from '../../../apps/api/node_modules/fastify/fastify.js';
const Fastify = (FastifyImport as unknown as { default?: typeof FastifyImport }).default ?? FastifyImport;
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import taskAssignmentRoutes from '../../../apps/api/src/routes/task-assignments.routes.js';

// ---------------------------------------------------------------------------
// Types — keep narrow / structural so the stub doesn't drift with Prisma.
// ---------------------------------------------------------------------------

interface FakeWorkflow {
  id: string;
  tenantId: string;
  userId: string;
}

interface FakeUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  active: boolean;
}

interface FakeTaskAssignment {
  id: string;
  tenantId: string;
  workflowId: string;
  taskId: string;
  assigneeUserId: string;
  assignedByUserId: string;
  title: string;
  instructions: string | null;
  riskLevel: string;
  dueAt: Date | null;
  metadata: Record<string, unknown> | null;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'COMPLETED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
  acknowledgedAt: Date | null;
  completedAt: Date | null;
  resultJson: Record<string, unknown> | null;
  createdAt: Date;
}

interface FakeNotification {
  id: string;
  tenantId: string;
  userId: string;
  kind: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  payload: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// In-memory DB stub.
// ---------------------------------------------------------------------------

function makeFakeDb() {
  const workflows: FakeWorkflow[] = [];
  const users: FakeUser[] = [];
  const assignments: FakeTaskAssignment[] = [];
  const notifications: FakeNotification[] = [];

  let cuid = 0;
  const id = (prefix: string) => `${prefix}-${++cuid}`;

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object' && 'in' in (v as object)) {
        const arr = (v as { in: unknown[] }).in;
        if (!arr.includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };

  const db = {
    workflow: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const row = workflows.find((w) => matches(w as unknown as Record<string, unknown>, where));
        return row ?? null;
      }),
    },
    user: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const row = users.find((u) => matches(u as unknown as Record<string, unknown>, where));
        return row ?? null;
      }),
    },
    taskAssignment: {
      create: vi.fn(async ({ data }: { data: Partial<FakeTaskAssignment> }) => {
        const row: FakeTaskAssignment = {
          id: id('ta'),
          tenantId: data.tenantId!,
          workflowId: data.workflowId!,
          taskId: data.taskId!,
          assigneeUserId: data.assigneeUserId!,
          assignedByUserId: data.assignedByUserId!,
          title: data.title!,
          instructions: data.instructions ?? null,
          riskLevel: data.riskLevel ?? 'MEDIUM',
          dueAt: data.dueAt ?? null,
          metadata: (data.metadata as Record<string, unknown>) ?? null,
          status: 'PENDING',
          acknowledgedAt: null,
          completedAt: null,
          resultJson: null,
          createdAt: new Date(),
        };
        assignments.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where, include }: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
        const row = assignments.find((a) => matches(a as unknown as Record<string, unknown>, where));
        if (!row) return null;
        if (include?.['assignee'] || include?.['assignedBy']) {
          const assignee = users.find((u) => u.id === row.assigneeUserId) ?? null;
          const assignedBy = users.find((u) => u.id === row.assignedByUserId) ?? null;
          return {
            ...row,
            assignee: assignee
              ? { id: assignee.id, name: assignee.name, email: assignee.email, jobTitle: assignee.jobTitle }
              : null,
            assignedBy: assignedBy
              ? { id: assignedBy.id, name: assignedBy.name, email: assignedBy.email }
              : null,
          };
        }
        return row;
      }),
      findMany: vi.fn(async ({ where, take, cursor, skip, orderBy }: {
        where: Record<string, unknown>;
        take?: number;
        cursor?: { id: string };
        skip?: number;
        orderBy?: unknown;
      }) => {
        let rows = assignments.filter((a) => matches(a as unknown as Record<string, unknown>, where));
        // Default sort: createdAt desc (matches the route's main-list orderBy).
        // For /me the orderBy is [{ status: 'asc' }, { createdAt: 'desc' }],
        // but the test data is small enough that order doesn't materially
        // affect the assertions.
        rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (cursor) {
          const idx = rows.findIndex((r) => r.id === cursor.id);
          if (idx >= 0) rows = rows.slice(idx + (skip ?? 0));
        }
        if (typeof take === 'number') rows = rows.slice(0, take);
        // Silence unused-var warning while leaving orderBy in the signature.
        void orderBy;
        return rows;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = assignments.findIndex((a) => a.id === where.id);
        if (idx < 0) throw new Error(`update: no row with id ${where.id}`);
        const next = { ...assignments[idx]!, ...data } as FakeTaskAssignment;
        assignments[idx] = next;
        return next;
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: { data: Partial<FakeNotification> }) => {
        const row: FakeNotification = {
          id: id('ntf'),
          tenantId: data.tenantId!,
          userId: data.userId!,
          kind: data.kind!,
          title: data.title!,
          body: data.body ?? null,
          linkPath: data.linkPath ?? null,
          payload: (data.payload as Record<string, unknown>) ?? null,
        };
        notifications.push(row);
        return row;
      }),
    },
  };

  return {
    db,
    state: { workflows, users, assignments, notifications },
  };
}

// ---------------------------------------------------------------------------
// Fastify harness — one fresh app per test.
// ---------------------------------------------------------------------------

interface TestUser {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
  name?: string;
}

async function buildApp(db: ReturnType<typeof makeFakeDb>['db']): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.decorate('db', db as unknown);
  app.decorate('auditLog', vi.fn(async () => {}));

  // Read the impersonated identity off `x-test-user` (a JSON header).
  // Production uses `@fastify/jwt`'s `request.jwtVerify()` which sets
  // `request.user`; we mimic the result without spinning up the JWT plugin.
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.headers['x-test-user'];
    if (!raw || typeof raw !== 'string') {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'no test user' } });
    }
    let parsed: TestUser;
    try {
      parsed = JSON.parse(raw) as TestUser;
    } catch {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'bad test user header' } });
    }
    (request as unknown as { user: TestUser & { sub: string; email: string; name: string } }).user = {
      ...parsed,
      sub: parsed.userId,
      email: parsed.email ?? `${parsed.userId}@test.dev`,
      name: parsed.name ?? parsed.userId,
    };
  });

  await app.register(taskAssignmentRoutes, { prefix: '/task-assignments' });
  await app.ready();
  return app;
}

function userHeader(u: TestUser): Record<string, string> {
  return { 'x-test-user': JSON.stringify(u) };
}

// ---------------------------------------------------------------------------
// Test fixtures: two tenants, multiple users, two workflows.
// ---------------------------------------------------------------------------

interface Fixture {
  app: FastifyInstance;
  state: ReturnType<typeof makeFakeDb>['state'];
  db: ReturnType<typeof makeFakeDb>['db'];
  // tenant A
  tenantA: string;
  ownerA: TestUser;       // owner of workflowA, role END_USER
  reviewerA: TestUser;    // REVIEWER role, not owner
  endUserA: TestUser;     // END_USER, no special grant
  assigneeA: TestUser;    // assignee of workflowA tasks
  workflowA: FakeWorkflow;
  // tenant B (cross-tenant attacker)
  tenantB: string;
  attackerB: TestUser;
  workflowB: FakeWorkflow;
}

async function makeFixture(): Promise<Fixture> {
  const { db, state } = makeFakeDb();
  const app = await buildApp(db);

  const tenantA = 'tnt-A';
  const tenantB = 'tnt-B';

  const ownerA: TestUser = { userId: 'usr-owner-A', tenantId: tenantA, role: 'END_USER' };
  const reviewerA: TestUser = { userId: 'usr-reviewer-A', tenantId: tenantA, role: 'REVIEWER' };
  const endUserA: TestUser = { userId: 'usr-enduser-A', tenantId: tenantA, role: 'END_USER' };
  const assigneeA: TestUser = { userId: 'usr-assignee-A', tenantId: tenantA, role: 'END_USER' };
  const attackerB: TestUser = { userId: 'usr-attacker-B', tenantId: tenantB, role: 'TENANT_ADMIN' };

  // Seed users so the assignee/createdBy lookups can resolve.
  state.users.push(
    { id: ownerA.userId, tenantId: tenantA, name: 'Owner A', email: 'owner-a@test', jobTitle: null, active: true },
    { id: reviewerA.userId, tenantId: tenantA, name: 'Rev A', email: 'rev-a@test', jobTitle: null, active: true },
    { id: endUserA.userId, tenantId: tenantA, name: 'EU A', email: 'eu-a@test', jobTitle: null, active: true },
    { id: assigneeA.userId, tenantId: tenantA, name: 'Asg A', email: 'asg-a@test', jobTitle: 'Engineer', active: true },
    { id: attackerB.userId, tenantId: tenantB, name: 'Atk B', email: 'atk-b@test', jobTitle: null, active: true },
  );

  const workflowA: FakeWorkflow = { id: 'wf-A', tenantId: tenantA, userId: ownerA.userId };
  const workflowB: FakeWorkflow = { id: 'wf-B', tenantId: tenantB, userId: attackerB.userId };
  state.workflows.push(workflowA, workflowB);

  return {
    app,
    state,
    db,
    tenantA,
    ownerA,
    reviewerA,
    endUserA,
    assigneeA,
    workflowA,
    tenantB,
    attackerB,
    workflowB,
  };
}

// Convenience: create one assignment row directly in state, bypassing the
// route. Used by GET / lifecycle tests so we're not coupling them to POST /.
function seedAssignment(
  state: Fixture['state'],
  overrides: Partial<FakeTaskAssignment> & {
    tenantId: string;
    workflowId: string;
    assigneeUserId: string;
    assignedByUserId: string;
  },
): FakeTaskAssignment {
  const row: FakeTaskAssignment = {
    id: overrides.id ?? `ta-seed-${state.assignments.length + 1}`,
    tenantId: overrides.tenantId,
    workflowId: overrides.workflowId,
    taskId: overrides.taskId ?? 'task-1',
    assigneeUserId: overrides.assigneeUserId,
    assignedByUserId: overrides.assignedByUserId,
    title: overrides.title ?? 'Seeded task',
    instructions: overrides.instructions ?? null,
    riskLevel: overrides.riskLevel ?? 'MEDIUM',
    dueAt: overrides.dueAt ?? null,
    metadata: overrides.metadata ?? null,
    status: overrides.status ?? 'PENDING',
    acknowledgedAt: overrides.acknowledgedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    resultJson: overrides.resultJson ?? null,
    createdAt: overrides.createdAt ?? new Date(Date.now() - state.assignments.length * 1000),
  };
  state.assignments.push(row);
  return row;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let fx: Fixture;

beforeEach(async () => {
  fx = await makeFixture();
});

afterEach(async () => {
  await fx.app.close();
});

// =============================================================================
// POST /task-assignments
// =============================================================================

describe('POST /task-assignments', () => {
  it('happy path: workflow owner creates an assignment + Notification', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/task-assignments',
      headers: userHeader(fx.ownerA),
      payload: {
        workflowId: fx.workflowA.id,
        taskId: 'task-1',
        assigneeUserId: fx.assigneeA.userId,
        title: 'Review the contract',
        instructions: 'Look at the indemnity clause',
        riskLevel: 'EXTERNAL_ACTION_APPROVAL',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { success: boolean; data: FakeTaskAssignment };
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe(fx.tenantA);
    expect(body.data.assigneeUserId).toBe(fx.assigneeA.userId);
    expect(body.data.assignedByUserId).toBe(fx.ownerA.userId);
    expect(body.data.title).toBe('Review the contract');
    expect(body.data.riskLevel).toBe('EXTERNAL_ACTION_APPROVAL');

    expect(fx.state.assignments).toHaveLength(1);
    // One inbox notification fired to the assignee.
    expect(fx.state.notifications).toHaveLength(1);
    const ntf = fx.state.notifications[0]!;
    expect(ntf.userId).toBe(fx.assigneeA.userId);
    expect(ntf.kind).toBe('task_assigned');
    expect(ntf.linkPath).toBe(`/inbox/${body.data.id}`);
    expect(ntf.tenantId).toBe(fx.tenantA);
  });

  it('RBAC: an end-user who is NOT the workflow owner gets 403', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/task-assignments',
      headers: userHeader(fx.endUserA),
      payload: {
        workflowId: fx.workflowA.id,
        taskId: 'task-1',
        assigneeUserId: fx.assigneeA.userId,
        title: 'Should be blocked',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(fx.state.assignments).toHaveLength(0);
    expect(fx.state.notifications).toHaveLength(0);
  });

  it('REVIEWER+ override: a REVIEWER who is NOT the workflow owner CAN assign', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/task-assignments',
      headers: userHeader(fx.reviewerA),
      payload: {
        workflowId: fx.workflowA.id,
        taskId: 'task-1',
        assigneeUserId: fx.assigneeA.userId,
        title: 'Reviewer-initiated',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { success: true; data: FakeTaskAssignment };
    expect(body.data.assignedByUserId).toBe(fx.reviewerA.userId);
  });

  it('workflow not in tenant: 404, no row created', async () => {
    // Owner of tenant-A tries to assign on a tenant-B workflow.
    const res = await fx.app.inject({
      method: 'POST',
      url: '/task-assignments',
      headers: userHeader(fx.ownerA),
      payload: {
        workflowId: fx.workflowB.id,
        taskId: 'task-1',
        assigneeUserId: fx.assigneeA.userId,
        title: 'Cross-tenant probe',
      },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { success: false; error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(fx.state.assignments).toHaveLength(0);
  });

  it('assignee not in tenant: 422 ValidationError, no row created', async () => {
    // assigneeUserId is a tenant-B user.
    const res = await fx.app.inject({
      method: 'POST',
      url: '/task-assignments',
      headers: userHeader(fx.ownerA),
      payload: {
        workflowId: fx.workflowA.id,
        taskId: 'task-1',
        assigneeUserId: fx.attackerB.userId,
        title: 'Cross-tenant assignee',
      },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { success: false; error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/not a member of this tenant/);
    expect(fx.state.assignments).toHaveLength(0);
  });

  it('assignee inactive: 422 ValidationError (active:true filter applies)', async () => {
    fx.state.users.push({
      id: 'usr-inactive',
      tenantId: fx.tenantA,
      name: 'Inactive',
      email: 'inactive@test',
      jobTitle: null,
      active: false,
    });

    const res = await fx.app.inject({
      method: 'POST',
      url: '/task-assignments',
      headers: userHeader(fx.ownerA),
      payload: {
        workflowId: fx.workflowA.id,
        taskId: 'task-1',
        assigneeUserId: 'usr-inactive',
        title: 'Inactive assignee',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(fx.state.assignments).toHaveLength(0);
  });

  it('invalid body: 422 with field-level errors', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/task-assignments',
      headers: userHeader(fx.ownerA),
      payload: {
        // Missing workflowId, taskId, assigneeUserId; title empty.
        title: '',
      },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { success: false; error: { code: string; details: { fieldErrors: Record<string, string[]> } } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toBeDefined();
    expect(body.error.details.fieldErrors).toBeDefined();
    expect(Object.keys(body.error.details.fieldErrors).length).toBeGreaterThan(0);
    // Confirm at least the obvious required fields are flagged.
    expect(body.error.details.fieldErrors).toHaveProperty('workflowId');
    expect(body.error.details.fieldErrors).toHaveProperty('assigneeUserId');
  });

  it('riskLevel back-compat: legacy 4-tier "HIGH" is accepted', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/task-assignments',
      headers: userHeader(fx.ownerA),
      payload: {
        workflowId: fx.workflowA.id,
        taskId: 'task-1',
        assigneeUserId: fx.assigneeA.userId,
        title: 'Legacy risk level',
        riskLevel: 'HIGH',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { success: true; data: FakeTaskAssignment };
    expect(body.data.riskLevel).toBe('HIGH');
  });

  it('riskLevel back-compat: 6-tier "EXTERNAL_ACTION_APPROVAL" is also accepted', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/task-assignments',
      headers: userHeader(fx.ownerA),
      payload: {
        workflowId: fx.workflowA.id,
        taskId: 'task-1',
        assigneeUserId: fx.assigneeA.userId,
        title: '6-tier risk',
        riskLevel: 'EXTERNAL_ACTION_APPROVAL',
      },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { data: FakeTaskAssignment }).data.riskLevel).toBe('EXTERNAL_ACTION_APPROVAL');
  });

  it('riskLevel default is MEDIUM when omitted', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/task-assignments',
      headers: userHeader(fx.ownerA),
      payload: {
        workflowId: fx.workflowA.id,
        taskId: 'task-1',
        assigneeUserId: fx.assigneeA.userId,
        title: 'Default risk',
      },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { data: FakeTaskAssignment }).data.riskLevel).toBe('MEDIUM');
  });

  it('riskLevel rejects unknown values', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/task-assignments',
      headers: userHeader(fx.ownerA),
      payload: {
        workflowId: fx.workflowA.id,
        taskId: 'task-1',
        assigneeUserId: fx.assigneeA.userId,
        title: 'Bogus risk',
        riskLevel: 'GIGA_NUKE',
      },
    });
    expect(res.statusCode).toBe(422);
  });
});

// =============================================================================
// GET /task-assignments — list
// =============================================================================

describe('GET /task-assignments', () => {
  it('lists assignments scoped to tenantId only', async () => {
    seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
    });
    seedAssignment(fx.state, {
      tenantId: fx.tenantB,
      workflowId: fx.workflowB.id,
      assigneeUserId: fx.attackerB.userId,
      assignedByUserId: fx.attackerB.userId,
    });

    const res = await fx.app.inject({
      method: 'GET',
      url: '/task-assignments',
      headers: userHeader(fx.ownerA),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: true; data: { items: FakeTaskAssignment[]; nextCursor: string | null } };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]!.tenantId).toBe(fx.tenantA);
    expect(body.data.nextCursor).toBeNull();
  });

  it('respects status filter', async () => {
    seedAssignment(fx.state, {
      id: 'ta-pending',
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });
    seedAssignment(fx.state, {
      id: 'ta-completed',
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'COMPLETED',
    });

    const res = await fx.app.inject({
      method: 'GET',
      url: '/task-assignments?status=COMPLETED',
      headers: userHeader(fx.ownerA),
    });
    const body = res.json() as { data: { items: FakeTaskAssignment[] } };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]!.id).toBe('ta-completed');
  });

  it('respects workflowId filter', async () => {
    // Add a second tenant-A workflow row for the filter to bite on.
    const wfA2: FakeWorkflow = { id: 'wf-A2', tenantId: fx.tenantA, userId: fx.ownerA.userId };
    fx.state.workflows.push(wfA2);

    seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
    });
    seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: wfA2.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
    });

    const res = await fx.app.inject({
      method: 'GET',
      url: `/task-assignments?workflowId=${wfA2.id}`,
      headers: userHeader(fx.ownerA),
    });
    const body = res.json() as { data: { items: FakeTaskAssignment[] } };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]!.workflowId).toBe(wfA2.id);
  });

  it('respects assigneeUserId filter', async () => {
    seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
    });
    seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.endUserA.userId,
      assignedByUserId: fx.ownerA.userId,
    });

    const res = await fx.app.inject({
      method: 'GET',
      url: `/task-assignments?assigneeUserId=${fx.endUserA.userId}`,
      headers: userHeader(fx.ownerA),
    });
    const body = res.json() as { data: { items: FakeTaskAssignment[] } };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]!.assigneeUserId).toBe(fx.endUserA.userId);
  });

  it('rejects invalid query (limit > 200) with 422', async () => {
    const res = await fx.app.inject({
      method: 'GET',
      url: '/task-assignments?limit=999',
      headers: userHeader(fx.ownerA),
    });
    expect(res.statusCode).toBe(422);
  });
});

// =============================================================================
// GET /task-assignments/me
// =============================================================================

describe('GET /task-assignments/me', () => {
  it('returns only my assignments', async () => {
    seedAssignment(fx.state, {
      id: 'ta-mine',
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
    });
    seedAssignment(fx.state, {
      id: 'ta-not-mine',
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.endUserA.userId,
      assignedByUserId: fx.ownerA.userId,
    });

    const res = await fx.app.inject({
      method: 'GET',
      url: '/task-assignments/me',
      headers: userHeader(fx.assigneeA),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { items: FakeTaskAssignment[]; count: number } };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]!.id).toBe('ta-mine');
    expect(body.data.count).toBe(1);
  });

  it('defaults to PENDING + ACKNOWLEDGED when no status param', async () => {
    seedAssignment(fx.state, {
      id: 'ta-pending',
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });
    seedAssignment(fx.state, {
      id: 'ta-ack',
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'ACKNOWLEDGED',
    });
    seedAssignment(fx.state, {
      id: 'ta-completed',
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'COMPLETED',
    });
    seedAssignment(fx.state, {
      id: 'ta-declined',
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'DECLINED',
    });

    const res = await fx.app.inject({
      method: 'GET',
      url: '/task-assignments/me',
      headers: userHeader(fx.assigneeA),
    });
    const body = res.json() as { data: { items: FakeTaskAssignment[] } };
    const ids = body.data.items.map((i) => i.id).sort();
    expect(ids).toEqual(['ta-ack', 'ta-pending']);
  });

  it('explicit ?status=COMPLETED narrows further', async () => {
    seedAssignment(fx.state, {
      id: 'ta-pending',
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });
    seedAssignment(fx.state, {
      id: 'ta-completed',
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'COMPLETED',
    });

    const res = await fx.app.inject({
      method: 'GET',
      url: '/task-assignments/me?status=COMPLETED',
      headers: userHeader(fx.assigneeA),
    });
    const body = res.json() as { data: { items: FakeTaskAssignment[] } };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]!.id).toBe('ta-completed');
  });
});

// =============================================================================
// GET /task-assignments/:id
// =============================================================================

describe('GET /task-assignments/:id', () => {
  it('returns the single row + assignee + assignedBy details', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
    });

    const res = await fx.app.inject({
      method: 'GET',
      url: `/task-assignments/${row.id}`,
      headers: userHeader(fx.ownerA),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: FakeTaskAssignment & {
        assignee: { id: string; name: string; email: string; jobTitle: string | null };
        assignedBy: { id: string; name: string; email: string };
      };
    };
    expect(body.data.id).toBe(row.id);
    expect(body.data.assignee).toBeDefined();
    expect(body.data.assignee.id).toBe(fx.assigneeA.userId);
    expect(body.data.assignee.jobTitle).toBe('Engineer');
    expect(body.data.assignedBy).toBeDefined();
    expect(body.data.assignedBy.id).toBe(fx.ownerA.userId);
  });

  it('SECURITY: cross-tenant id returns 404 (NOT 200)', async () => {
    const tenantBRow = seedAssignment(fx.state, {
      tenantId: fx.tenantB,
      workflowId: fx.workflowB.id,
      assigneeUserId: fx.attackerB.userId,
      assignedByUserId: fx.attackerB.userId,
    });

    // tenant-A user tries to read tenant-B row.
    const res = await fx.app.inject({
      method: 'GET',
      url: `/task-assignments/${tenantBRow.id}`,
      headers: userHeader(fx.ownerA),
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { success: false; error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for unknown id', async () => {
    const res = await fx.app.inject({
      method: 'GET',
      url: '/task-assignments/does-not-exist',
      headers: userHeader(fx.ownerA),
    });
    expect(res.statusCode).toBe(404);
  });
});

// =============================================================================
// POST /:id/acknowledge
// =============================================================================

describe('POST /task-assignments/:id/acknowledge', () => {
  it('only the assignee can acknowledge', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });

    // Assigner trying to ack on assignee's behalf is forbidden.
    const owner = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/acknowledge`,
      headers: userHeader(fx.ownerA),
    });
    expect(owner.statusCode).toBe(403);

    // Even REVIEWER+ can't ack (only the assignee, per the source).
    const reviewer = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/acknowledge`,
      headers: userHeader(fx.reviewerA),
    });
    expect(reviewer.statusCode).toBe(403);

    // Assignee can.
    const assignee = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/acknowledge`,
      headers: userHeader(fx.assigneeA),
    });
    expect(assignee.statusCode).toBe(200);
    const body = assignee.json() as { data: FakeTaskAssignment };
    expect(body.data.status).toBe('ACKNOWLEDGED');
    expect(body.data.acknowledgedAt).not.toBeNull();
  });

  it('cross-tenant id returns 404', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantB,
      workflowId: fx.workflowB.id,
      assigneeUserId: fx.attackerB.userId,
      assignedByUserId: fx.attackerB.userId,
    });
    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/acknowledge`,
      headers: userHeader(fx.ownerA),
    });
    expect(res.statusCode).toBe(404);
  });
});

// =============================================================================
// POST /:id/complete
// =============================================================================

describe('POST /task-assignments/:id/complete', () => {
  it('happy path: assignee completes; completedAt + resultJson set; assigner notified', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'ACKNOWLEDGED',
    });

    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/complete`,
      headers: userHeader(fx.assigneeA),
      payload: {
        result: { ok: true, link: 'https://example.com/doc' },
        note: 'Filed in the tracker.',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: FakeTaskAssignment };
    expect(body.data.status).toBe('COMPLETED');
    expect(body.data.completedAt).not.toBeNull();
    expect(body.data.resultJson).toEqual({
      result: { ok: true, link: 'https://example.com/doc' },
      note: 'Filed in the tracker.',
    });

    // task_completed Notification fired to the assigner.
    const notif = fx.state.notifications.find((n) => n.kind === 'task_completed');
    expect(notif).toBeDefined();
    expect(notif!.userId).toBe(fx.ownerA.userId);
    expect(notif!.linkPath).toBe(`/inbox/${row.id}`);
  });

  it('happy path with no body is allowed', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });

    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/complete`,
      headers: userHeader(fx.assigneeA),
      // no payload
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: FakeTaskAssignment };
    expect(body.data.status).toBe('COMPLETED');
  });

  it('non-assignee gets 403', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });

    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/complete`,
      headers: userHeader(fx.ownerA),
      payload: { result: { hijack: true } },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects oversized note (> 2000 chars)', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });

    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/complete`,
      headers: userHeader(fx.assigneeA),
      payload: { note: 'x'.repeat(2001) },
    });
    expect(res.statusCode).toBe(422);
  });
});

// =============================================================================
// POST /:id/decline
// =============================================================================

describe('POST /task-assignments/:id/decline', () => {
  it('requires a non-empty reason — empty string → 422', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });

    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/decline`,
      headers: userHeader(fx.assigneeA),
      payload: { reason: '' },
    });
    expect(res.statusCode).toBe(422);

    // No state change.
    expect(fx.state.assignments[0]!.status).toBe('PENDING');
  });

  it('requires the body to include reason at all', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });

    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/decline`,
      headers: userHeader(fx.assigneeA),
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it('happy path: status becomes DECLINED and assigner is notified with the reason', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });

    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/decline`,
      headers: userHeader(fx.assigneeA),
      payload: { reason: 'Out on PTO' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: FakeTaskAssignment };
    expect(body.data.status).toBe('DECLINED');

    const notif = fx.state.notifications.find((n) => n.title.startsWith('Task declined'));
    expect(notif).toBeDefined();
    expect(notif!.body).toBe('Out on PTO');
    expect(notif!.userId).toBe(fx.ownerA.userId);
  });

  it('non-assignee gets 403', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });
    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/decline`,
      headers: userHeader(fx.ownerA),
      payload: { reason: 'Not allowed' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// =============================================================================
// POST /:id/cancel
// =============================================================================

describe('POST /task-assignments/:id/cancel', () => {
  it('the assigner can cancel', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });
    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/cancel`,
      headers: userHeader(fx.ownerA),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: FakeTaskAssignment };
    expect(body.data.status).toBe('CANCELLED');
  });

  it('a REVIEWER who is NOT the assigner can cancel', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });
    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/cancel`,
      headers: userHeader(fx.reviewerA),
    });
    expect(res.statusCode).toBe(200);
  });

  it('a random end-user (not assigner, not REVIEWER+) is forbidden', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });
    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/cancel`,
      headers: userHeader(fx.endUserA),
    });
    expect(res.statusCode).toBe(403);
    expect(fx.state.assignments[0]!.status).toBe('PENDING');
  });

  it('on cancel, the notification recipient is the ASSIGNEE (per source)', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'PENDING',
    });
    await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/cancel`,
      headers: userHeader(fx.ownerA),
    });
    const notif = fx.state.notifications.find((n) => n.title.startsWith('Task cancelled'));
    expect(notif).toBeDefined();
    expect(notif!.userId).toBe(fx.assigneeA.userId);
  });
});

// =============================================================================
// Lifecycle terminal-state stickiness
// =============================================================================

describe('lifecycle terminal-state stickiness', () => {
  it('COMPLETED → COMPLETED is idempotent (returns existing row, 200)', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'COMPLETED',
      completedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/complete`,
      headers: userHeader(fx.assigneeA),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    // No second notification fired (idempotent path skips the notify
    // block by returning early).
    expect(fx.state.notifications.filter((n) => n.kind === 'task_completed')).toHaveLength(0);
  });

  it('COMPLETED → ACKNOWLEDGED is rejected (terminal-state guard)', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'COMPLETED',
      completedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/acknowledge`,
      headers: userHeader(fx.assigneeA),
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/terminal state COMPLETED/);
  });

  it('DECLINED → CANCELLED is rejected', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'DECLINED',
    });
    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/cancel`,
      headers: userHeader(fx.ownerA),
    });
    expect(res.statusCode).toBe(422);
  });

  it('CANCELLED → CANCELLED is idempotent', async () => {
    const row = seedAssignment(fx.state, {
      tenantId: fx.tenantA,
      workflowId: fx.workflowA.id,
      assigneeUserId: fx.assigneeA.userId,
      assignedByUserId: fx.ownerA.userId,
      status: 'CANCELLED',
    });
    const res = await fx.app.inject({
      method: 'POST',
      url: `/task-assignments/${row.id}/cancel`,
      headers: userHeader(fx.ownerA),
    });
    expect(res.statusCode).toBe(200);
  });
});

// =============================================================================
// Tenant-isolation regression (every mutation looks up via { id, tenantId })
// =============================================================================

describe('tenant isolation on every mutation', () => {
  it('acknowledge / complete / decline / cancel all use { id, tenantId } lookup', async () => {
    const tenantBRow = seedAssignment(fx.state, {
      tenantId: fx.tenantB,
      workflowId: fx.workflowB.id,
      assigneeUserId: fx.attackerB.userId,
      assignedByUserId: fx.attackerB.userId,
      status: 'PENDING',
    });

    // tenant-A user (even an admin equivalent — fx.ownerA is END_USER, but
    // the route's where-clause is `{ id, tenantId: request.user.tenantId }`,
    // so role doesn't matter; tenantId mismatch always 404s) tries every
    // mutation against the cross-tenant id.
    const verbs = ['acknowledge', 'complete', 'decline', 'cancel'] as const;
    for (const verb of verbs) {
      const payload = verb === 'decline' ? { reason: 'x' } : {};
      const res = await fx.app.inject({
        method: 'POST',
        url: `/task-assignments/${tenantBRow.id}/${verb}`,
        headers: userHeader(fx.ownerA),
        payload,
      });
      expect(res.statusCode, `${verb} should 404 cross-tenant`).toBe(404);
    }

    // The tenant-B row is untouched.
    expect(fx.state.assignments.find((a) => a.id === tenantBRow.id)!.status).toBe('PENDING');

    // Inspect the recorded `findFirst` where-clauses to confirm every
    // mutation used tenantId scoping (regression guard for if the route
    // ever drops the filter).
    const findFirstCalls = fx.db.taskAssignment.findFirst.mock.calls.map(
      (call) => (call[0] as { where: Record<string, unknown> }).where,
    );
    expect(findFirstCalls.length).toBeGreaterThanOrEqual(verbs.length);
    for (const where of findFirstCalls) {
      expect(where).toHaveProperty('tenantId');
      expect(where).toHaveProperty('id');
    }
  });
});

// =============================================================================
// Auth required
// =============================================================================

describe('authentication', () => {
  it('every endpoint requires authentication (no x-test-user → 401)', async () => {
    const calls: Array<[string, string, Record<string, unknown> | undefined]> = [
      ['POST', '/task-assignments', { workflowId: 'x' }],
      ['GET', '/task-assignments', undefined],
      ['GET', '/task-assignments/me', undefined],
      ['GET', '/task-assignments/some-id', undefined],
      ['POST', '/task-assignments/some-id/acknowledge', {}],
      ['POST', '/task-assignments/some-id/complete', {}],
      ['POST', '/task-assignments/some-id/decline', { reason: 'x' }],
      ['POST', '/task-assignments/some-id/cancel', {}],
    ];

    for (const [method, url, payload] of calls) {
      const res = await fx.app.inject({ method, url, payload });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
