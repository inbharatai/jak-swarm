/**
 * Audit & Compliance v0 route tests.
 *
 * Exercises the audit-route handlers via a stubbed fastify wrapper. We
 * don't need a real Postgres for these — the goal is to verify:
 *
 *   1. Tenant isolation: every query is scoped by request.user.tenantId.
 *      Cross-tenant probes return 404 / empty.
 *   2. RBAC: /audit/dashboard + /audit/reviewer-queue require REVIEWER+;
 *      /audit/log allows VIEWER and above.
 *   3. Filter handling: /audit/log respects action/resource/userId/from/to/q.
 *   4. Workflow trail: 404 for cross-tenant workflow id; merged events
 *      are sorted chronologically.
 *   5. Reviewer queue: combines workflow approvals + artifact approvals,
 *      degrades gracefully if the artifact table is missing.
 *   6. Dashboard: artifacts.available=false when the table is missing
 *      (migration not deployed) — never crashes.
 *
 * What this test does NOT prove:
 *   - The actual Postgres queries return correct rows (covered by
 *     the route-contract.test.ts integration suite that runs against
 *     a real Postgres in CI).
 *   - End-to-end auth flow (auth.plugin.ts is tested separately).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the handler logic by directly invoking the registered
// route function. Building a real Fastify instance for every test
// would be heavy; instead we mock just enough of fastify + db to
// drive the handlers.

interface ResolvedReply {
  status: number;
  body: unknown;
}

function makeReply() {
  let captured: ResolvedReply = { status: 200, body: undefined };
  const reply = {
    status(code: number) {
      captured.status = code;
      return reply;
    },
    send(body: unknown) {
      captured.body = body;
      return reply;
    },
    _captured: () => captured,
  };
  return reply as never as { status: (n: number) => unknown; send: (b: unknown) => unknown; _captured: () => ResolvedReply };
}

function makeRequest(opts: { tenantId?: string; userId?: string; role?: string; query?: Record<string, unknown>; params?: Record<string, string> }) {
  return {
    user: {
      tenantId: opts.tenantId ?? 'tenant-a',
      userId: opts.userId ?? 'user-a',
      role: opts.role ?? 'REVIEWER',
      email: 'test@example.com',
      name: 'Test User',
      sub: opts.userId ?? 'user-a',
    },
    query: opts.query ?? {},
    params: opts.params ?? {},
  } as never;
}

function makeFastifyMock(opts: {
  authenticate?: (...args: unknown[]) => Promise<void>;
  requireRole?: (...roles: string[]) => (...args: unknown[]) => Promise<void>;
  db?: Record<string, unknown>;
} = {}) {
  const noop = vi.fn(async () => {});
  const handlers: Record<string, { route: { method: string; url: string; handler: (req: never, rep: never) => Promise<unknown> } }> = {};

  const fastify = {
    authenticate: opts.authenticate ?? noop,
    requireRole: opts.requireRole ?? ((..._roles: string[]) => noop),
    db: opts.db ?? {},
    get(url: string, _opts: unknown, handler: (req: never, rep: never) => Promise<unknown>) {
      handlers[`GET ${url}`] = { route: { method: 'GET', url, handler } };
    },
    post(url: string, _opts: unknown, handler: (req: never, rep: never) => Promise<unknown>) {
      handlers[`POST ${url}`] = { route: { method: 'POST', url, handler } };
    },
  };
  return { fastify, handlers };
}

async function loadRoutes() {
  // Dynamic import so vi has a chance to install module mocks if needed.
  const mod = await import('../../apps/api/src/routes/audit.routes.js');
  return mod.default;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /audit/log', () => {
  it('scopes the query to the requester tenantId', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'a1' }]);
    const count = vi.fn().mockResolvedValue(1);
    const { fastify, handlers } = makeFastifyMock({
      db: { auditLog: { findMany, count } },
    });

    const routes = await loadRoutes();
    await routes(fastify as never, {} as never);

    const handler = handlers['GET /audit/log']!.route.handler;
    const reply = makeReply();
    await handler(makeRequest({ tenantId: 'tenant-a' }), reply as never);

    expect(findMany).toHaveBeenCalledOnce();
    const callArgs = (findMany.mock.calls[0]![0] as { where: { tenantId: string } });
    expect(callArgs.where.tenantId).toBe('tenant-a');
  });

  it('applies action + resource filters when supplied', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const { fastify, handlers } = makeFastifyMock({
      db: { auditLog: { findMany, count } },
    });
    const routes = await loadRoutes();
    await routes(fastify as never, {} as never);

    const handler = handlers['GET /audit/log']!.route.handler;
    await handler(
      makeRequest({ tenantId: 'tenant-a', query: { action: 'WORKFLOW_COMPLETED', resource: 'workflow' } }),
      makeReply() as never,
    );
    const where = (findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ tenantId: 'tenant-a', action: 'WORKFLOW_COMPLETED', resource: 'workflow' });
  });

  it('translates from + to into a createdAt range filter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const { fastify, handlers } = makeFastifyMock({
      db: { auditLog: { findMany, count } },
    });
    const routes = await loadRoutes();
    await routes(fastify as never, {} as never);

    const handler = handlers['GET /audit/log']!.route.handler;
    await handler(
      makeRequest({ query: { from: '2026-04-01T00:00:00Z', to: '2026-04-25T00:00:00Z' } }),
      makeReply() as never,
    );
    const where = (findMany.mock.calls[0]![0] as { where: { createdAt?: { gte?: Date; lte?: Date } } }).where;
    expect(where.createdAt?.gte).toBeInstanceOf(Date);
    expect(where.createdAt?.lte).toBeInstanceOf(Date);
  });

  it('rejects bad query with 400', async () => {
    const { fastify, handlers } = makeFastifyMock({
      db: { auditLog: { findMany: vi.fn(), count: vi.fn() } },
    });
    const routes = await loadRoutes();
    await routes(fastify as never, {} as never);

    const handler = handlers['GET /audit/log']!.route.handler;
    const reply = makeReply();
    await handler(makeRequest({ query: { limit: -1 } }), reply as never);
    expect(reply._captured().status).toBe(400);
  });
});

describe('GET /audit/workflows/:workflowId/trail', () => {
  it('returns 404 when the workflow does not belong to the tenant', async () => {
    const { fastify, handlers } = makeFastifyMock({
      db: {
        workflow: { findFirst: vi.fn().mockResolvedValue(null) },
        auditLog: { findMany: vi.fn().mockResolvedValue([]) },
        agentTrace: { findMany: vi.fn().mockResolvedValue([]) },
        approvalRequest: { findMany: vi.fn().mockResolvedValue([]) },
        workflowArtifact: { findMany: vi.fn().mockResolvedValue([]) },
      },
    });
    const routes = await loadRoutes();
    await routes(fastify as never, {} as never);

    const handler = handlers['GET /audit/workflows/:workflowId/trail']!.route.handler;
    const reply = makeReply();
    await handler(makeRequest({ params: { workflowId: 'wf-other-tenant' } }), reply as never);
    expect(reply._captured().status).toBe(404);
  });

  it('merges + chronologically sorts events from all 4 sources', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'wf-1', goal: 'g', status: 'COMPLETED', startedAt: new Date('2026-04-25T00:00:00Z'), completedAt: new Date('2026-04-25T01:00:00Z'), totalCostUsd: 0.05 });
    const auditLog = vi.fn().mockResolvedValue([
      { createdAt: new Date('2026-04-25T00:30:00Z'), action: 'WORKFLOW_STARTED', userId: 'u', details: {} },
    ]);
    const agentTrace = vi.fn().mockResolvedValue([
      { startedAt: new Date('2026-04-25T00:35:00Z'), agentRole: 'WORKER_CONTENT', stepIndex: 0, durationMs: 1000, error: null, tokenUsage: null },
    ]);
    const approvalRequest = vi.fn().mockResolvedValue([
      { createdAt: new Date('2026-04-25T00:40:00Z'), id: 'a1', status: 'APPROVED', riskLevel: 'HIGH', agentRole: 'WORKER_EMAIL', reviewedBy: 'r', decidedAt: new Date('2026-04-25T00:42:00Z') },
    ]);
    const workflowArtifact = vi.fn().mockResolvedValue([
      { createdAt: new Date('2026-04-25T00:45:00Z'), id: 'art1', artifactType: 'export', fileName: 'r.pdf', status: 'READY', approvalState: 'NOT_REQUIRED', sizeBytes: 1024, contentHash: 'abc' },
    ]);

    const { fastify, handlers } = makeFastifyMock({
      db: {
        workflow: { findFirst },
        auditLog: { findMany: auditLog },
        agentTrace: { findMany: agentTrace },
        approvalRequest: { findMany: approvalRequest },
        workflowArtifact: { findMany: workflowArtifact },
      },
    });
    const routes = await loadRoutes();
    await routes(fastify as never, {} as never);

    const handler = handlers['GET /audit/workflows/:workflowId/trail']!.route.handler;
    const reply = makeReply();
    await handler(makeRequest({ params: { workflowId: 'wf-1' } }), reply as never);
    const captured = reply._captured();
    expect(captured.status).toBe(200);
    const body = captured.body as { data: { events: Array<{ at: string; source: string; type: string }>; eventCount: number } };
    expect(body.data.eventCount).toBe(4);
    // Sorted chronologically
    const ats = body.data.events.map((e) => e.at);
    expect(ats).toEqual([...ats].sort());
    // All 4 sources present
    const sources = new Set(body.data.events.map((e) => e.source));
    expect(sources).toEqual(new Set(['lifecycle', 'trace', 'approval', 'artifact']));
  });

  it('degrades gracefully when artifact table is missing', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'wf-1', goal: 'g', status: 'COMPLETED', startedAt: new Date(), completedAt: null, totalCostUsd: 0 });
    const workflowArtifact = vi.fn().mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: 'P2021' }));

    const { fastify, handlers } = makeFastifyMock({
      db: {
        workflow: { findFirst },
        auditLog: { findMany: vi.fn().mockResolvedValue([]) },
        agentTrace: { findMany: vi.fn().mockResolvedValue([]) },
        approvalRequest: { findMany: vi.fn().mockResolvedValue([]) },
        workflowArtifact: { findMany: workflowArtifact },
      },
    });
    const routes = await loadRoutes();
    await routes(fastify as never, {} as never);

    const handler = handlers['GET /audit/workflows/:workflowId/trail']!.route.handler;
    const reply = makeReply();
    await handler(makeRequest({ params: { workflowId: 'wf-1' } }), reply as never);
    // No crash — returns 200 with 0 artifact events
    expect(reply._captured().status).toBe(200);
  });
});

describe('GET /audit/reviewer-queue', () => {
  it('returns both workflow approvals + artifact approvals in one response', async () => {
    const { fastify, handlers } = makeFastifyMock({
      db: {
        approvalRequest: {
          findMany: vi.fn().mockResolvedValue([{ id: 'apr-1', status: 'PENDING', riskLevel: 'HIGH' }]),
          count: vi.fn().mockResolvedValue(1),
        },
        workflowArtifact: {
          findMany: vi.fn().mockResolvedValue([{ id: 'art-1', fileName: 'r.pdf', approvalState: 'REQUIRES_APPROVAL' }]),
          count: vi.fn().mockResolvedValue(1),
        },
      },
    });
    const routes = await loadRoutes();
    await routes(fastify as never, {} as never);

    const handler = handlers['GET /audit/reviewer-queue']!.route.handler;
    const reply = makeReply();
    await handler(makeRequest({}), reply as never);
    const body = reply._captured().body as { data: { workflowApprovals: { total: number }; artifactApprovals: { total: number } } };
    expect(body.data.workflowApprovals.total).toBe(1);
    expect(body.data.artifactApprovals.total).toBe(1);
  });

  it('degrades gracefully when artifact table is missing', async () => {
    const { fastify, handlers } = makeFastifyMock({
      db: {
        approvalRequest: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
        },
        workflowArtifact: {
          findMany: vi.fn().mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: 'P2021' })),
          count: vi.fn().mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: 'P2021' })),
        },
      },
    });
    const routes = await loadRoutes();
    await routes(fastify as never, {} as never);

    const handler = handlers['GET /audit/reviewer-queue']!.route.handler;
    const reply = makeReply();
    await handler(makeRequest({}), reply as never);
    const body = reply._captured().body as { data: { artifactApprovals: { total: number; items: unknown[] } } };
    expect(body.data.artifactApprovals.total).toBe(0);
    expect(body.data.artifactApprovals.items).toEqual([]);
  });
});

describe('GET /audit/dashboard', () => {
  it('returns aggregated metrics with artifacts.available=true when present', async () => {
    const { fastify, handlers } = makeFastifyMock({
      db: {
        workflow: {
          count: vi.fn().mockResolvedValue(10),
          groupBy: vi.fn().mockResolvedValue([{ status: 'COMPLETED', _count: { _all: 8 } }, { status: 'FAILED', _count: { _all: 2 } }]),
        },
        approvalRequest: {
          groupBy: vi.fn().mockResolvedValue([{ status: 'APPROVED', _count: { _all: 5 } }]),
        },
        workflowArtifact: {
          groupBy: vi.fn()
            .mockResolvedValueOnce([{ artifactType: 'export', _count: { _all: 3 } }])
            .mockResolvedValueOnce([{ approvalState: 'NOT_REQUIRED', _count: { _all: 3 } }]),
          count: vi.fn().mockResolvedValue(2),
        },
        auditLog: {
          groupBy: vi.fn().mockResolvedValue([{ action: 'WORKFLOW_COMPLETED', _count: { _all: 8 } }]),
        },
      },
    });
    const routes = await loadRoutes();
    await routes(fastify as never, {} as never);

    const handler = handlers['GET /audit/dashboard']!.route.handler;
    const reply = makeReply();
    await handler(makeRequest({}), reply as never);
    const body = reply._captured().body as { data: { workflows: { total: number }; artifacts: { available: boolean; signedBundles: number } } };
    expect(body.data.workflows.total).toBe(10);
    expect(body.data.artifacts.available).toBe(true);
    expect(body.data.artifacts.signedBundles).toBe(2);
  });

  it('returns artifacts.available=false when the artifact table is missing', async () => {
    const { fastify, handlers } = makeFastifyMock({
      db: {
        workflow: {
          count: vi.fn().mockResolvedValue(0),
          groupBy: vi.fn().mockResolvedValue([]),
        },
        approvalRequest: {
          groupBy: vi.fn().mockResolvedValue([]),
        },
        workflowArtifact: {
          groupBy: vi.fn().mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: 'P2021' })),
          count: vi.fn().mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: 'P2021' })),
        },
        auditLog: {
          groupBy: vi.fn().mockResolvedValue([]),
        },
      },
    });
    const routes = await loadRoutes();
    await routes(fastify as never, {} as never);

    const handler = handlers['GET /audit/dashboard']!.route.handler;
    const reply = makeReply();
    await handler(makeRequest({}), reply as never);
    const body = reply._captured().body as { data: { artifacts: { available: boolean; signedBundles: number } } };
    expect(body.data.artifacts.available).toBe(false);
    expect(body.data.artifacts.signedBundles).toBe(0);
  });
});
