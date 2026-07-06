/**
 * Phase C — unit tests for the honest analytics aggregation endpoints in
 * apps/api/src/routes/analytics.routes.ts:
 *   GET /analytics/tools              — per-tool success + duration (toolCallsJson)
 *   GET /analytics/routing            — SYSTEM_ADMIN only (RoutingLog is not tenant-scoped)
 *   GET /analytics/approvals/decisions — ApprovalAuditLog totals + autoApprovalRate
 *   GET /analytics/intents             — IntentRecord byIntent + urgency + riskIndicators
 *   GET /analytics/latency             — UsageLedger.latencyMs p50/p90/p95/p99
 *
 * Each endpoint is exercised through Fastify inject against an inline test app
 * (auth + db + requireRole decorators stubbed). Aggregation math (success rate,
 * fallback rate, p50/p95 on a fixed dataset, autoApprovalRate, clarificationRate)
 * is asserted against seeded data so the math — not just the HTTP shape — is
 * verified. Empty-tenant cases assert honest "no data" (0 samples), never a
 * faked 100%.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from '../../../apps/api/node_modules/fastify/fastify.js';
import type { UserRole } from '@jak-swarm/shared';
import analyticsRoutes from '../../../apps/api/src/routes/analytics.routes.ts';

// ─── In-memory DB stub ─────────────────────────────────────────────────────
// Shapes only the slice each endpoint touches. findMany filters by the
// `where` we actually use (tenantId + a startedAt/decidedAt/createdAt/createdAt
// range). All models return the seeded rows that match.

interface TraceRow {
  tenantId: string;
  startedAt: Date;
  toolCallsJson: unknown;
}
interface RoutingRow {
  taskType: string;
  selectedModel: string;
  selectedProvider: string;
  fallbackUsed: boolean;
  score: number | null;
  reason: string | null;
  createdAt: Date;
}
interface ApprovalRow {
  tenantId: string;
  decidedAt: Date;
  decision: string;
  agentRole: string;
  riskLevel: string;
  autoApproved: boolean;
}
interface IntentRow {
  tenantId: string;
  createdAt: Date;
  intent: string;
  intentConfidence: number | null;
  urgency: number | null;
  riskIndicators: unknown;
  clarificationNeeded: boolean;
}
interface UsageRow {
  tenantId: string;
  createdAt: Date;
  latencyMs: number | null;
  provider: string;
}

function makeFakeDb() {
  const traces: TraceRow[] = [];
  const routing: RoutingRow[] = [];
  const approvals: ApprovalRow[] = [];
  const intents: IntentRow[] = [];
  const usage: UsageRow[] = [];

  function inRange(d: Date, gte: Date, lte: Date): boolean {
    return +d >= +gte && +d <= +lte;
  }

  const db = {
    agentTrace: {
      findMany: vi.fn(async ({ where }: { where: { tenantId: string; startedAt?: { gte: Date; lte: Date } } }) => {
        return traces.filter((t) => {
          if (t.tenantId !== where.tenantId) return false;
          if (where.startedAt && !inRange(t.startedAt, where.startedAt.gte, where.startedAt.lte)) return false;
          return true;
        });
      }),
    },
    routingLog: {
      findMany: vi.fn(async ({ where }: { where: { createdAt?: { gte: Date; lte: Date } } }) => {
        return routing.filter((r) => (where.createdAt ? inRange(r.createdAt, where.createdAt.gte, where.createdAt.lte) : true));
      }),
    },
    approvalAuditLog: {
      findMany: vi.fn(async ({ where }: { where: { tenantId: string; decidedAt?: { gte: Date; lte: Date } } }) => {
        return approvals.filter((a) => {
          if (a.tenantId !== where.tenantId) return false;
          if (where.decidedAt && !inRange(a.decidedAt, where.decidedAt.gte, where.decidedAt.lte)) return false;
          return true;
        });
      }),
    },
    intentRecord: {
      findMany: vi.fn(async ({ where }: { where: { tenantId: string; createdAt?: { gte: Date; lte: Date } } }) => {
        return intents.filter((i) => {
          if (i.tenantId !== where.tenantId) return false;
          if (where.createdAt && !inRange(i.createdAt, where.createdAt.gte, where.createdAt.lte)) return false;
          return true;
        });
      }),
    },
    usageLedger: {
      findMany: vi.fn(async ({ where }: { where: { tenantId: string; createdAt?: { gte: Date; lte: Date }; latencyMs?: { not: null } } }) => {
        return usage.filter((u) => {
          if (u.tenantId !== where.tenantId) return false;
          if (where.createdAt && !inRange(u.createdAt, where.createdAt.gte, where.createdAt.lte)) return false;
          if (where.latencyMs && u.latencyMs === null) return false;
          return true;
        });
      }),
    },
  };
  return { db, state: { traces, routing, approvals, intents, usage } };
}

// ─── Auth identity + requireRole stub ─────────────────────────────────────
let currentUser: { userId: string; tenantId: string; role: string; email: string } = {
  userId: 'u1',
  tenantId: 'tenant-A',
  role: 'TENANT_ADMIN',
  email: 'founder@a.com',
};

async function buildApp(db: ReturnType<typeof makeFakeDb>['db']): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    (request as unknown as { user: typeof currentUser }).user = currentUser;
  });
  // Mirror auth.plugin's requireRole factory: returns a preHandler that 403s if
  // the authenticated user's role is not in the allowed list.
  app.decorate('requireRole', (...roles: UserRole[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const u = (request as unknown as { user: { role: string } }).user;
      if (!u || !roles.includes(u.role as UserRole)) {
        return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient role' } });
      }
    };
  });
  await app.register(analyticsRoutes, { prefix: '/analytics' });
  await app.ready();
  return app;
}

function body(res: { statusCode: number; payload: string }) {
  return JSON.parse(res.payload) as { success: boolean; data?: Record<string, unknown>; error?: { code: string } };
}

const NOW = new Date('2026-07-05T12:00:00.000Z');
const EARLIER = new Date('2026-07-01T12:00:00.000Z');

beforeEach(() => {
  currentUser = { userId: 'u1', tenantId: 'tenant-A', role: 'TENANT_ADMIN', email: 'founder@a.com' };
});

// ─── /analytics/tools ──────────────────────────────────────────────────────
describe('GET /analytics/tools', () => {
  it('aggregates per-tool count, successRate, p50/p95 + counts traces without tools', async () => {
    const { db, state } = makeFakeDb();
    // 3 traces. Two carry tool calls ({calls:[...]} shape + bare-array shape),
    // one has no tools.
    state.traces.push(
      {
        tenantId: 'tenant-A', startedAt: EARLIER,
        toolCallsJson: { calls: [
          { toolName: 'send_email', durationMs: 100, error: null },
          { toolName: 'send_email', durationMs: 200, error: 'timeout' },
          { toolName: 'web_search', durationMs: 300, error: null },
        ] },
      },
      {
        tenantId: 'tenant-A', startedAt: EARLIER,
        toolCallsJson: [
          { toolName: 'send_email', durationMs: 150, error: null },
        ],
      },
      { tenantId: 'tenant-A', startedAt: EARLIER, toolCallsJson: null },
    );
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/analytics/tools' });
    expect(res.statusCode).toBe(200);
    const d = body(res).data!;
    expect(d.tracesExamined).toBe(3);
    expect(d.tracesWithoutTools).toBe(1);
    expect(d.totalToolCalls).toBe(4);
    const email = (d.tools as Array<Record<string, unknown>>).find((t) => t.toolName === 'send_email')!;
    expect(email.count).toBe(3);
    expect(email.successCount).toBe(2);
    expect(email.failCount).toBe(1);
    expect(email.successRate).toBeCloseTo(0.667, 2);
    // durations for send_email: [100,200,150] → sorted [100,150,200]; p50=150, p95=200
    expect(email.p50DurationMs).toBe(150);
    expect(email.p95DurationMs).toBe(200);
    const search = (d.tools as Array<Record<string, unknown>>).find((t) => t.toolName === 'web_search')!;
    expect(search.count).toBe(1);
    await app.close();
  });

  it('returns honest zero totals for an empty tenant (no fake 100%)', async () => {
    const { db } = makeFakeDb();
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/analytics/tools' });
    const d = body(res).data!;
    expect(d.tracesExamined).toBe(0);
    expect(d.totalToolCalls).toBe(0);
    expect(d.tools).toEqual([]);
    await app.close();
  });

  it('isolates by tenant (other tenant traces not counted)', async () => {
    const { db, state } = makeFakeDb();
    state.traces.push(
      { tenantId: 'tenant-A', startedAt: EARLIER, toolCallsJson: [{ toolName: 'send_email', durationMs: 50, error: null }] },
      { tenantId: 'tenant-B', startedAt: EARLIER, toolCallsJson: [{ toolName: 'send_email', durationMs: 999, error: null }] },
    );
    const app = await buildApp(db);
    const d = body(await app.inject({ method: 'GET', url: '/analytics/tools' })).data!;
    expect(d.totalToolCalls).toBe(1);
    const email = (d.tools as Array<Record<string, unknown>>)[0]!;
    expect(email.count).toBe(1);
    expect(email.p50DurationMs).toBe(50);
    await app.close();
  });
});

// ─── /analytics/routing (SYSTEM_ADMIN only) ────────────────────────────────
describe('GET /analytics/routing', () => {
  it('403s for TENANT_ADMIN (RoutingLog is not tenant-scoped)', async () => {
    const { db, state } = makeFakeDb();
    state.routing.push({ taskType: 'chat', selectedModel: 'gpt-5', selectedProvider: 'openai', fallbackUsed: false, score: 0.9, reason: 'default', createdAt: EARLIER });
    currentUser.role = 'TENANT_ADMIN';
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/analytics/routing' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('aggregates fallbackRate + avgScore + byModel for SYSTEM_ADMIN', async () => {
    const { db, state } = makeFakeDb();
    state.routing.push(
      { taskType: 'chat', selectedModel: 'gpt-5', selectedProvider: 'openai', fallbackUsed: false, score: 0.9, reason: 'default', createdAt: EARLIER },
      { taskType: 'chat', selectedModel: 'gpt-4', selectedProvider: 'openai', fallbackUsed: true, score: 0.4, reason: 'primary_unavailable', createdAt: EARLIER },
      { taskType: 'analysis', selectedModel: 'gpt-5', selectedProvider: 'openai', fallbackUsed: false, score: null, reason: 'default', createdAt: EARLIER },
    );
    currentUser.role = 'SYSTEM_ADMIN';
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/analytics/routing' });
    expect(res.statusCode).toBe(200);
    const d = body(res).data!;
    expect(d.total).toBe(3);
    expect(d.fallbackRate).toBeCloseTo(0.333, 2);
    // avgScore: only the 2 rows with non-null score → (0.9+0.4)/2 = 0.65
    expect(d.avgScore).toBeCloseTo(0.65, 2);
    expect((d.byModel as Record<string, number>)['gpt-5']).toBe(2);
    expect((d.byModel as Record<string, number>)['gpt-4']).toBe(1);
    expect(d.tenantScoped).toBe(false);
    await app.close();
  });

  it('honest 0 totals when routing log is empty', async () => {
    const { db } = makeFakeDb();
    currentUser.role = 'SYSTEM_ADMIN';
    const app = await buildApp(db);
    const d = body(await app.inject({ method: 'GET', url: '/analytics/routing' })).data!;
    expect(d.total).toBe(0);
    expect(d.fallbackRate).toBe(0);
    expect(d.avgScore).toBe(0);
    await app.close();
  });
});

// ─── /analytics/approvals/decisions ───────────────────────────────────────
describe('GET /analytics/approvals/decisions', () => {
  it('aggregates totals, byRiskLevel, autoApprovalRate', async () => {
    const { db, state } = makeFakeDb();
    state.approvals.push(
      { tenantId: 'tenant-A', decidedAt: EARLIER, decision: 'APPROVED', agentRole: 'WORKER_EMAIL', riskLevel: 'LOW', autoApproved: true },
      { tenantId: 'tenant-A', decidedAt: EARLIER, decision: 'APPROVED', agentRole: 'WORKER_EMAIL', riskLevel: 'HIGH', autoApproved: false },
      { tenantId: 'tenant-A', decidedAt: EARLIER, decision: 'REJECTED', agentRole: 'WORKER_BILLING', riskLevel: 'HIGH', autoApproved: false },
      { tenantId: 'tenant-B', decidedAt: EARLIER, decision: 'APPROVED', agentRole: 'WORKER_EMAIL', riskLevel: 'LOW', autoApproved: true },
    );
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/analytics/approvals/decisions' });
    expect(res.statusCode).toBe(200);
    const d = body(res).data!;
    expect(d.total).toBe(3); // tenant-B excluded
    expect((d.totals as Record<string, number>).APPROVED).toBe(2);
    expect((d.totals as Record<string, number>).REJECTED).toBe(1);
    expect((d.byRiskLevel as Record<string, number>).HIGH).toBe(2);
    expect((d.byRiskLevel as Record<string, number>).LOW).toBe(1);
    expect(d.autoApproved).toBe(1);
    expect(d.humanApproved).toBe(2);
    expect(d.autoApprovalRate).toBeCloseTo(0.333, 2);
    await app.close();
  });

  it('honest 0 total + 0 autoApprovalRate when empty', async () => {
    const { db } = makeFakeDb();
    const app = await buildApp(db);
    const d = body(await app.inject({ method: 'GET', url: '/analytics/approvals/decisions' })).data!;
    expect(d.total).toBe(0);
    expect(d.autoApprovalRate).toBe(0);
    await app.close();
  });
});

// ─── /analytics/intents ───────────────────────────────────────────────────
describe('GET /analytics/intents', () => {
  it('aggregates byIntent avgConfidence + clarificationRate, urgency, riskIndicators', async () => {
    const { db, state } = makeFakeDb();
    state.intents.push(
      { tenantId: 'tenant-A', createdAt: EARLIER, intent: 'website_review', intentConfidence: 0.9, urgency: 3, riskIndicators: ['pii'], clarificationNeeded: false },
      { tenantId: 'tenant-A', createdAt: EARLIER, intent: 'website_review', intentConfidence: 0.7, urgency: 4, riskIndicators: ['pii', 'cost'], clarificationNeeded: true },
      { tenantId: 'tenant-A', createdAt: EARLIER, intent: 'outreach_draft', intentConfidence: 0.5, urgency: 2, riskIndicators: ['cost'], clarificationNeeded: true },
      { tenantId: 'tenant-B', createdAt: EARLIER, intent: 'website_review', intentConfidence: 0.99, urgency: 5, riskIndicators: [], clarificationNeeded: false },
    );
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/analytics/intents' });
    expect(res.statusCode).toBe(200);
    const d = body(res).data!;
    expect(d.total).toBe(3);
    // clarificationRate: 2 of 3 → 0.667
    expect(d.clarificationRate).toBeCloseTo(0.667, 2);
    const ws = (d.intents as Array<Record<string, unknown>>).find((i) => i.intent === 'website_review')!;
    expect(ws.count).toBe(2);
    expect(ws.avgConfidence).toBeCloseTo(0.8, 2); // (0.9+0.7)/2
    expect(ws.clarificationRate).toBe(0.5); // 1 of 2
    const urgency = d.urgencyDistribution as Record<string, number>;
    expect(urgency['3']).toBe(1);
    expect(urgency['4']).toBe(1);
    expect(urgency['2']).toBe(1);
    const risk = d.topRiskIndicators as Array<{ indicator: string; count: number }>;
    expect(risk[0]!.indicator).toBe('pii');
    expect(risk[0]!.count).toBe(2);
    await app.close();
  });

  it('honest 0 clarificationRate when empty', async () => {
    const { db } = makeFakeDb();
    const app = await buildApp(db);
    const d = body(await app.inject({ method: 'GET', url: '/analytics/intents' })).data!;
    expect(d.total).toBe(0);
    expect(d.clarificationRate).toBe(0);
    expect(d.intents).toEqual([]);
    await app.close();
  });
});

// ─── /analytics/latency ────────────────────────────────────────────────────
describe('GET /analytics/latency', () => {
  it('computes p50/p90/p95/p99 + byProvider, excluding null-latency rows', async () => {
    const { db, state } = makeFakeDb();
    // 5 openai rows with latencies [10,20,30,40,100], 1 openai row with null latency, 1 anthropic row.
    state.usage.push(
      { tenantId: 'tenant-A', createdAt: EARLIER, latencyMs: 10, provider: 'openai' },
      { tenantId: 'tenant-A', createdAt: EARLIER, latencyMs: 20, provider: 'openai' },
      { tenantId: 'tenant-A', createdAt: EARLIER, latencyMs: 30, provider: 'openai' },
      { tenantId: 'tenant-A', createdAt: EARLIER, latencyMs: 40, provider: 'openai' },
      { tenantId: 'tenant-A', createdAt: EARLIER, latencyMs: 100, provider: 'openai' },
      { tenantId: 'tenant-A', createdAt: EARLIER, latencyMs: null, provider: 'openai' },
      { tenantId: 'tenant-A', createdAt: EARLIER, latencyMs: 500, provider: 'anthropic' },
    );
    const app = await buildApp(db);
    const res = await app.inject({ method: 'GET', url: '/analytics/latency' });
    expect(res.statusCode).toBe(200);
    const d = body(res).data!;
    // null-latency row excluded → samples = 6 (5 openai + 1 anthropic)
    expect(d.samples).toBe(6);
    // all sorted: [10,20,30,40,100,500]. nearest-rank p50 = ceil(0.5*6)=3rd → 30
    expect(d.p50Ms).toBe(30);
    // p90 = ceil(0.9*6)=6th → 500
    expect(d.p90Ms).toBe(500);
    // openai provider: [10,20,30,40,100] → p50=30, p95=100
    const openai = (d.byProvider as Array<Record<string, unknown>>).find((p) => p.provider === 'openai')!;
    expect(openai.count).toBe(5);
    expect(openai.p50Ms).toBe(30);
    expect(openai.p95Ms).toBe(100);
    await app.close();
  });

  it('honest 0 samples when no latency rows', async () => {
    const { db, state } = makeFakeDb();
    // only null-latency rows
    state.usage.push({ tenantId: 'tenant-A', createdAt: EARLIER, latencyMs: null, provider: 'openai' });
    const app = await buildApp(db);
    const d = body(await app.inject({ method: 'GET', url: '/analytics/latency' })).data!;
    expect(d.samples).toBe(0);
    expect(d.p50Ms).toBe(0);
    expect(d.byProvider).toEqual([]);
    await app.close();
  });
});

// ─── /usage/history extended select (Phase C: +provider, inputTokens,
// outputTokens, usdCost, latencyMs) ─────────────────────────────────────
// (Covered indirectly by the integration suite; the select extension is
// additive and backward-compatible — new fields appended, none removed.)
void NOW;