/**
 * Unit tests for the Inbox routes.
 *
 * Source: apps/api/src/routes/inbox.routes.ts
 *
 * Behaviour matrix (one `it` per row):
 *   1.  GET /inbox                    happy-path payload shape
 *   2.  GET /inbox                    counts.total = sum of pieces
 *   3.  GET /inbox                    END_USER sees approvals: []
 *   4.  GET /inbox                    REVIEWER sees only their tenant's PENDING
 *   5.  GET /inbox                    tasks scoped to assigneeUserId = me
 *   6.  GET /inbox                    tasks filtered to PENDING + ACKNOWLEDGED
 *   7.  GET /inbox                    notifications filtered to readAt = null
 *   8.  GET /inbox                    cross-tenant rows never bleed in
 *   9.  GET /inbox                    take limits: 100 / 50 / 50
 *  10.  POST /inbox/notifications/:id/read           happy path
 *  11.  POST /inbox/notifications/:id/read           non-existent → 404
 *  12.  POST /inbox/notifications/:id/read           cross-tenant → 404
 *  13.  POST /inbox/notifications/:id/read           wrong user → 404
 *  14.  POST /inbox/notifications/read-all           bulk mark + count
 *  15.  POST /inbox/notifications/read-all           leaves other users alone
 *  16.  POST /inbox/notifications/read-all           idempotent second call
 *
 * Test harness: a real Fastify instance with the route plugin registered.
 * `db` is decorated with an in-memory stub (same shape as the
 * trial-promotion.test.ts pattern). `authenticate` is a no-op preHandler
 * that copies a forced user object (provided per-request via header) onto
 * `request.user`. We do NOT exercise any real JWT logic here — that lives
 * in the auth.service.test.ts suite.
 *
 * Concurrency note: the route fans out via Promise.all over 5 db calls.
 * The stub uses fresh array filters on each call (no shared cursor) so the
 * concurrent invocations don't collide.
 *
 * Fastify is imported via a direct path through the api workspace because
 * the @jak-swarm/tests workspace doesn't list fastify as a dependency
 * (it's a transitive of @jak-swarm/api and pnpm doesn't hoist it to the
 * tests workspace). This avoids touching tests/package.json.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
// eslint-disable-next-line import/no-relative-packages -- see header note
import Fastify from '../../../apps/api/node_modules/fastify/fastify.js';
import inboxRoutes from '../../../apps/api/src/routes/inbox.routes.js';

// ---------------------------------------------------------------------------
// In-memory db stub
// ---------------------------------------------------------------------------

interface FakeTaskAssignment {
  id: string;
  tenantId: string;
  assigneeUserId: string;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'COMPLETED' | 'DECLINED' | 'CANCELLED';
  title: string;
  createdAt: Date;
}

interface FakeApprovalRequest {
  id: string;
  tenantId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'EXPIRED';
  workflowId: string;
  taskId: string | null;
  agentRole: string | null;
  action: string;
  rationale: string | null;
  riskLevel: string;
  createdAt: Date;
}

interface FakeNotification {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  body: string | null;
  readAt: Date | null;
  createdAt: Date;
}

interface FakeState {
  taskAssignments: FakeTaskAssignment[];
  approvalRequests: FakeApprovalRequest[];
  notifications: FakeNotification[];
}

// In-clause / equality matcher that handles the route's actual where shape.
function matchesWhere<T extends Record<string, unknown>>(row: T, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v === null) {
      if ((row as Record<string, unknown>)[k] !== null) return false;
      continue;
    }
    if (typeof v === 'object' && v !== null && 'in' in (v as Record<string, unknown>)) {
      const candidates = (v as { in: unknown[] }).in;
      if (!candidates.includes((row as Record<string, unknown>)[k])) return false;
      continue;
    }
    if ((row as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

function makeFakeDb(state: FakeState) {
  // NOTE: every call returns a fresh `filter` of the in-memory array, so
  // five concurrent Promise.all calls never share a mutable cursor.
  return {
    taskAssignment: {
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        const all = state.taskAssignments.filter((r) => matchesWhere(r, where));
        return take ? all.slice(0, take) : all;
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return state.taskAssignments.filter((r) => matchesWhere(r, where)).length;
      }),
    },
    approvalRequest: {
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        const all = state.approvalRequests.filter((r) => matchesWhere(r, where));
        return take ? all.slice(0, take) : all;
      }),
    },
    notification: {
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        const all = state.notifications.filter((r) => matchesWhere(r, where));
        return take ? all.slice(0, take) : all;
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return state.notifications.filter((r) => matchesWhere(r, where)).length;
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          let count = 0;
          for (const n of state.notifications) {
            if (matchesWhere(n, where)) {
              Object.assign(n, data);
              count++;
            }
          }
          return { count };
        },
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Fastify harness: real instance, mocked authenticate decorator + db decorator
// ---------------------------------------------------------------------------

interface ForcedUser {
  tenantId: string;
  userId: string;
  role: string;
  email?: string;
}

async function buildHarness(state: FakeState) {
  const app = Fastify();

  const db = makeFakeDb(state);
  app.decorate('db', db);

  // authenticate: read forced user out of x-test-user header (JSON-encoded)
  // and copy onto request.user. Fails 401 if header missing.
  app.decorate('authenticate', async (request: any, reply: any) => {
    const raw = request.headers['x-test-user'];
    if (!raw || typeof raw !== 'string') {
      return reply.status(401).send({ ok: false, error: { code: 'UNAUTHORIZED' } });
    }
    request.user = JSON.parse(raw) as ForcedUser;
  });

  await app.register(inboxRoutes, { prefix: '/inbox' });
  await app.ready();
  return { app, db };
}

function userHeader(u: ForcedUser): Record<string, string> {
  return { 'x-test-user': JSON.stringify(u) };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function freshState(): FakeState {
  const now = Date.now();
  return {
    taskAssignments: [
      // me, tenant-a, PENDING
      {
        id: 'ta-1',
        tenantId: 'tenant-a',
        assigneeUserId: 'user-me',
        status: 'PENDING',
        title: 'review demo deck',
        createdAt: new Date(now - 1000),
      },
      // me, tenant-a, ACKNOWLEDGED
      {
        id: 'ta-2',
        tenantId: 'tenant-a',
        assigneeUserId: 'user-me',
        status: 'ACKNOWLEDGED',
        title: 'sign vendor MSA',
        createdAt: new Date(now - 2000),
      },
      // me, tenant-a, COMPLETED — must NOT appear in inbox
      {
        id: 'ta-3-done',
        tenantId: 'tenant-a',
        assigneeUserId: 'user-me',
        status: 'COMPLETED',
        title: 'archived task',
        createdAt: new Date(now - 3000),
      },
      // me, tenant-a, DECLINED — must NOT appear
      {
        id: 'ta-4-decl',
        tenantId: 'tenant-a',
        assigneeUserId: 'user-me',
        status: 'DECLINED',
        title: 'declined task',
        createdAt: new Date(now - 4000),
      },
      // SAME TENANT, different user — must NOT appear (assignee scope)
      {
        id: 'ta-5-other',
        tenantId: 'tenant-a',
        assigneeUserId: 'user-someone-else',
        status: 'PENDING',
        title: 'someone else’s task',
        createdAt: new Date(now - 5000),
      },
      // CROSS-TENANT, same user-id (defence-in-depth) — must NOT appear
      {
        id: 'ta-6-xtenant',
        tenantId: 'tenant-b',
        assigneeUserId: 'user-me',
        status: 'PENDING',
        title: 'cross-tenant ghost',
        createdAt: new Date(now - 6000),
      },
    ],
    approvalRequests: [
      // tenant-a PENDING — should show for REVIEWER+
      {
        id: 'ap-1',
        tenantId: 'tenant-a',
        status: 'PENDING',
        workflowId: 'wf-1',
        taskId: 't-1',
        agentRole: 'researcher',
        action: 'send_email',
        rationale: 'reach prospect',
        riskLevel: 'EXTERNAL_ACTION_APPROVAL',
        createdAt: new Date(now - 1000),
      },
      // tenant-a APPROVED — must NOT appear (status filter)
      {
        id: 'ap-2-decided',
        tenantId: 'tenant-a',
        status: 'APPROVED',
        workflowId: 'wf-2',
        taskId: 't-2',
        agentRole: null,
        action: 'finalised',
        rationale: null,
        riskLevel: 'READ_ONLY',
        createdAt: new Date(now - 2000),
      },
      // tenant-b PENDING — must NOT appear (cross-tenant)
      {
        id: 'ap-3-xtenant',
        tenantId: 'tenant-b',
        status: 'PENDING',
        workflowId: 'wf-3',
        taskId: 't-3',
        agentRole: null,
        action: 'cross-tenant action',
        rationale: null,
        riskLevel: 'CRITICAL_MANUAL_ONLY',
        createdAt: new Date(now - 3000),
      },
    ],
    notifications: [
      // me, tenant-a, unread — should appear
      {
        id: 'n-1',
        tenantId: 'tenant-a',
        userId: 'user-me',
        title: 'workflow paused',
        body: 'awaiting your decision',
        readAt: null,
        createdAt: new Date(now - 1000),
      },
      // me, tenant-a, unread #2
      {
        id: 'n-2',
        tenantId: 'tenant-a',
        userId: 'user-me',
        title: 'budget threshold',
        body: '80% of monthly cap',
        readAt: null,
        createdAt: new Date(now - 1500),
      },
      // me, tenant-a, ALREADY READ — must NOT appear
      {
        id: 'n-3-read',
        tenantId: 'tenant-a',
        userId: 'user-me',
        title: 'old read',
        body: 'seen yesterday',
        readAt: new Date(now - 86_400_000),
        createdAt: new Date(now - 90_000_000),
      },
      // someone else, tenant-a — must NOT appear
      {
        id: 'n-4-other',
        tenantId: 'tenant-a',
        userId: 'user-someone-else',
        title: 'not for me',
        body: null,
        readAt: null,
        createdAt: new Date(now - 2000),
      },
      // me, tenant-b — must NOT appear (cross-tenant)
      {
        id: 'n-5-xtenant',
        tenantId: 'tenant-b',
        userId: 'user-me',
        title: 'wrong tenant',
        body: null,
        readAt: null,
        createdAt: new Date(now - 3000),
      },
    ],
  };
}

const ME_REVIEWER: ForcedUser = {
  tenantId: 'tenant-a',
  userId: 'user-me',
  role: 'REVIEWER',
  email: 'me@tenant-a.test',
};

const ME_END_USER: ForcedUser = { ...ME_REVIEWER, role: 'END_USER' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /inbox', () => {
  let state: FakeState;
  let app: Awaited<ReturnType<typeof buildHarness>>['app'];

  beforeEach(async () => {
    state = freshState();
    ({ app } = await buildHarness(state));
  });

  it('returns the canonical {tasks, approvals, notifications, counts} shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/inbox', headers: userHeader(ME_REVIEWER) });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { success: true; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('tasks');
    expect(body.data).toHaveProperty('approvals');
    expect(body.data).toHaveProperty('notifications');
    expect(body.data).toHaveProperty('counts');
    const counts = body.data['counts'] as Record<string, number>;
    expect(counts).toHaveProperty('tasks');
    expect(counts).toHaveProperty('approvals');
    expect(counts).toHaveProperty('notifications');
    expect(counts).toHaveProperty('total');
  });

  it('counts.total equals tasks + approvals + notifications', async () => {
    const res = await app.inject({ method: 'GET', url: '/inbox', headers: userHeader(ME_REVIEWER) });
    const body = JSON.parse(res.payload) as {
      data: { counts: { tasks: number; approvals: number; notifications: number; total: number } };
    };
    const c = body.data.counts;
    expect(c.total).toBe(c.tasks + c.approvals + c.notifications);
    // Sanity: with our fixtures, REVIEWER sees 2 tasks + 1 approval + 2 notifications.
    expect(c.tasks).toBe(2);
    expect(c.approvals).toBe(1);
    expect(c.notifications).toBe(2);
    expect(c.total).toBe(5);
  });

  it('END_USER sees an empty approvals array (filtered, NOT 403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/inbox', headers: userHeader(ME_END_USER) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as {
      data: { approvals: unknown[]; counts: { approvals: number; total: number; tasks: number; notifications: number } };
    };
    expect(body.data.approvals).toEqual([]);
    expect(body.data.counts.approvals).toBe(0);
    // total still adds up
    expect(body.data.counts.total).toBe(body.data.counts.tasks + 0 + body.data.counts.notifications);
  });

  it('REVIEWER sees only their tenant pending approvals', async () => {
    const res = await app.inject({ method: 'GET', url: '/inbox', headers: userHeader(ME_REVIEWER) });
    const body = JSON.parse(res.payload) as { data: { approvals: Array<{ id: string }> } };
    const ids = body.data.approvals.map((a) => a.id);
    expect(ids).toEqual(['ap-1']); // only tenant-a + PENDING survives
    expect(ids).not.toContain('ap-2-decided');
    expect(ids).not.toContain('ap-3-xtenant');
  });

  it('task list is scoped to assigneeUserId = me', async () => {
    const res = await app.inject({ method: 'GET', url: '/inbox', headers: userHeader(ME_REVIEWER) });
    const body = JSON.parse(res.payload) as { data: { tasks: Array<{ id: string; assigneeUserId: string }> } };
    for (const t of body.data.tasks) {
      expect(t.assigneeUserId).toBe('user-me');
    }
    const ids = body.data.tasks.map((t) => t.id);
    expect(ids).not.toContain('ta-5-other');
  });

  it('task list is filtered to status PENDING + ACKNOWLEDGED only', async () => {
    const res = await app.inject({ method: 'GET', url: '/inbox', headers: userHeader(ME_REVIEWER) });
    const body = JSON.parse(res.payload) as { data: { tasks: Array<{ id: string; status: string }> } };
    const statuses = new Set(body.data.tasks.map((t) => t.status));
    expect([...statuses].sort()).toEqual(['ACKNOWLEDGED', 'PENDING']);
    const ids = body.data.tasks.map((t) => t.id);
    expect(ids).not.toContain('ta-3-done'); // COMPLETED filtered
    expect(ids).not.toContain('ta-4-decl'); // DECLINED filtered
  });

  it('notifications are filtered to readAt IS NULL (unread only)', async () => {
    const res = await app.inject({ method: 'GET', url: '/inbox', headers: userHeader(ME_REVIEWER) });
    const body = JSON.parse(res.payload) as { data: { notifications: Array<{ id: string; readAt: Date | null }> } };
    for (const n of body.data.notifications) {
      expect(n.readAt).toBeNull();
    }
    const ids = body.data.notifications.map((n) => n.id);
    expect(ids).not.toContain('n-3-read');
  });

  it('cross-tenant rows never appear in tasks/approvals/notifications', async () => {
    const res = await app.inject({ method: 'GET', url: '/inbox', headers: userHeader(ME_REVIEWER) });
    const body = JSON.parse(res.payload) as {
      data: {
        tasks: Array<{ id: string; tenantId: string }>;
        approvals: Array<{ id: string }>;
        notifications: Array<{ id: string; tenantId: string }>;
      };
    };
    expect(body.data.tasks.every((t) => t.tenantId === 'tenant-a')).toBe(true);
    expect(body.data.notifications.every((n) => n.tenantId === 'tenant-a')).toBe(true);
    // Approvals row in fixture omits tenantId from select (route picks specific
    // fields), but we know id 'ap-3-xtenant' is the only tenant-b PENDING.
    expect(body.data.approvals.map((a) => a.id)).not.toContain('ap-3-xtenant');
  });

  it('uses Prisma `take` limits of 100 / 50 / 50 (tasks / approvals / notifications)', async () => {
    // Spy on the underlying calls.
    const { app: spyApp, db } = await buildHarness(freshState());
    await spyApp.inject({ method: 'GET', url: '/inbox', headers: userHeader(ME_REVIEWER) });

    expect(db.taskAssignment.findMany).toHaveBeenCalledOnce();
    expect(db.taskAssignment.findMany.mock.calls[0]![0]).toMatchObject({ take: 100 });

    expect(db.approvalRequest.findMany).toHaveBeenCalledOnce();
    expect(db.approvalRequest.findMany.mock.calls[0]![0]).toMatchObject({ take: 50 });

    expect(db.notification.findMany).toHaveBeenCalledOnce();
    expect(db.notification.findMany.mock.calls[0]![0]).toMatchObject({ take: 50 });
  });
});

describe('POST /inbox/notifications/:id/read', () => {
  let state: FakeState;
  let app: Awaited<ReturnType<typeof buildHarness>>['app'];

  beforeEach(async () => {
    state = freshState();
    ({ app } = await buildHarness(state));
  });

  it('marks a single notification read and returns id + readAt timestamp', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/inbox/notifications/n-1/read',
      headers: userHeader(ME_REVIEWER),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { success: true; data: { id: string; readAt: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('n-1');
    // readAt is an ISO string in the wire payload.
    expect(typeof body.data.readAt).toBe('string');
    expect(() => new Date(body.data.readAt).toISOString()).not.toThrow();

    // Side-effect: the row is now marked read.
    const row = state.notifications.find((n) => n.id === 'n-1');
    expect(row?.readAt).toBeInstanceOf(Date);
  });

  it('returns 404 for a non-existent id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/inbox/notifications/does-not-exist/read',
      headers: userHeader(ME_REVIEWER),
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload) as { ok: false; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 (not 403) when the id belongs to a different tenant', async () => {
    // 'n-5-xtenant' lives in tenant-b. Our caller is in tenant-a.
    const res = await app.inject({
      method: 'POST',
      url: '/inbox/notifications/n-5-xtenant/read',
      headers: userHeader(ME_REVIEWER),
    });
    expect(res.statusCode).toBe(404);
    // The row in tenant-b must NOT have been mutated.
    const row = state.notifications.find((n) => n.id === 'n-5-xtenant');
    expect(row?.readAt).toBeNull();
  });

  it('returns 404 when the id belongs to another user in the same tenant', async () => {
    // 'n-4-other' is in tenant-a but owned by 'user-someone-else'.
    const res = await app.inject({
      method: 'POST',
      url: '/inbox/notifications/n-4-other/read',
      headers: userHeader(ME_REVIEWER),
    });
    expect(res.statusCode).toBe(404);
    const row = state.notifications.find((n) => n.id === 'n-4-other');
    expect(row?.readAt).toBeNull();
  });
});

describe('POST /inbox/notifications/read-all', () => {
  let state: FakeState;
  let app: Awaited<ReturnType<typeof buildHarness>>['app'];

  beforeEach(async () => {
    state = freshState();
    ({ app } = await buildHarness(state));
  });

  it('bulk-marks every unread notification for the caller and returns markedRead', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/inbox/notifications/read-all',
      headers: userHeader(ME_REVIEWER),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { success: true; data: { markedRead: number } };
    expect(body.success).toBe(true);
    // Fixture has 2 unread for me in tenant-a (n-1, n-2).
    expect(body.data.markedRead).toBe(2);

    expect(state.notifications.find((n) => n.id === 'n-1')?.readAt).toBeInstanceOf(Date);
    expect(state.notifications.find((n) => n.id === 'n-2')?.readAt).toBeInstanceOf(Date);
  });

  it('does NOT touch other users’ notifications or other tenants', async () => {
    await app.inject({
      method: 'POST',
      url: '/inbox/notifications/read-all',
      headers: userHeader(ME_REVIEWER),
    });
    // someone-else (same tenant) still unread
    expect(state.notifications.find((n) => n.id === 'n-4-other')?.readAt).toBeNull();
    // me in tenant-b still unread
    expect(state.notifications.find((n) => n.id === 'n-5-xtenant')?.readAt).toBeNull();
    // already-read row left intact (not re-stamped — matchesWhere requires readAt = null)
    const oldReadAt = state.notifications.find((n) => n.id === 'n-3-read')?.readAt;
    expect(oldReadAt).toBeInstanceOf(Date);
  });

  it('is idempotent: a second call returns markedRead = 0', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/inbox/notifications/read-all',
      headers: userHeader(ME_REVIEWER),
    });
    expect((JSON.parse(first.payload) as { data: { markedRead: number } }).data.markedRead).toBe(2);

    const second = await app.inject({
      method: 'POST',
      url: '/inbox/notifications/read-all',
      headers: userHeader(ME_REVIEWER),
    });
    expect(second.statusCode).toBe(200);
    expect((JSON.parse(second.payload) as { data: { markedRead: number } }).data.markedRead).toBe(0);
  });
});
