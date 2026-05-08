/**
 * Unit tests for UsageCounterService — pure-logic checks against an in-memory
 * Prisma mock. Verifies the cap behavior we sell on the landing page:
 *   1. trialing tenant under cap → allowed
 *   2. trialing tenant at cap    → blocked, blockedBy set correctly
 *   3. trialing tenant past trialEndsAt → blocked with trial.expired=true
 *   4. paid plan tenant over the same cap → allowed (caps don't apply)
 *   5. lazy daily reset zeroes counters when dailyResetAt < today UTC
 *   6. recordUsage increments the right column
 *
 * No DB dependency — vitest spawns the harness with placeholder env via
 * tests/vitest.setup.ts; these tests do not need network or a live Postgres.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UsageCounterService } from '../../../apps/api/src/services/trial/usage-counter.service.js';

interface FakeSubscription {
  tenantId: string;
  planId: string;
  status: string;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  dailyAgentRunsUsed: number;
  dailyAgentRunsCap: number;
  dailyApprovalsUsed: number;
  dailyApprovalsCap: number;
  dailyToolMinutesUsed: number;
  dailyToolMinutesCap: number;
  dailyTokensUsed: number;
  dailyTokensCap: number;
  dailyUsed: number;
  dailyResetAt: Date;
}

function makeFakeDb(initial: FakeSubscription | null) {
  let row: FakeSubscription | null = initial ? { ...initial } : null;
  const subscription = {
    findUnique: vi.fn(async ({ where }: { where: { tenantId: string } }) => {
      if (!row || row.tenantId !== where.tenantId) return null;
      return row;
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (!row) throw new Error('no row');
      // Handle Prisma `{ increment: n }` shape.
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'object' && value !== null && 'increment' in value) {
          (row as Record<string, unknown>)[key] =
            ((row as Record<string, number>)[key] ?? 0) + (value as { increment: number }).increment;
        } else {
          (row as Record<string, unknown>)[key] = value;
        }
      }
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { tenantId: string; dailyResetAt: { lt: Date } }; data: Record<string, unknown> }) => {
      if (!row || row.tenantId !== where.tenantId) return { count: 0 };
      if (row.dailyResetAt.getTime() >= where.dailyResetAt.lt.getTime()) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    }),
    upsert: vi.fn(async () => row),
  };
  return { subscription, _row: () => row };
}

const baseRow = (): FakeSubscription => ({
  tenantId: 't1',
  planId: 'trial_30d',
  status: 'trialing',
  trialStartedAt: new Date('2026-05-01T00:00:00Z'),
  trialEndsAt: new Date('2026-05-31T00:00:00Z'),
  dailyAgentRunsUsed: 0,
  dailyAgentRunsCap: 20,
  dailyApprovalsUsed: 0,
  dailyApprovalsCap: 5,
  dailyToolMinutesUsed: 0,
  dailyToolMinutesCap: 120,
  dailyTokensUsed: 0,
  dailyTokensCap: 200_000,
  dailyUsed: 0,
  dailyResetAt: new Date('2026-05-08T03:00:00Z'),
});

describe('UsageCounterService.check', () => {
  const NOW = new Date('2026-05-08T12:00:00Z');

  it('allows a trialing tenant under cap', async () => {
    const db = makeFakeDb(baseRow());
    const svc = new UsageCounterService(db as any);
    const result = await svc.check('t1', 'agentRuns', 1, NOW);
    expect(result.allowed).toBe(true);
    expect(result.trial.isTrialing).toBe(true);
    expect(result.trial.expired).toBe(false);
    expect(result.counters.agentRuns.cap).toBe(20);
  });

  it('blocks a trialing tenant whose cap would be exceeded', async () => {
    const row = baseRow();
    row.dailyAgentRunsUsed = 20;
    const db = makeFakeDb(row);
    const svc = new UsageCounterService(db as any);
    const result = await svc.check('t1', 'agentRuns', 1, NOW);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('agentRuns');
  });

  it('blocks each resource independently', async () => {
    const row = baseRow();
    row.dailyApprovalsUsed = 5;
    const db = makeFakeDb(row);
    const svc = new UsageCounterService(db as any);
    const a = await svc.check('t1', 'approvals', 1, NOW);
    expect(a.allowed).toBe(false);
    expect(a.blockedBy).toBe('approvals');
    const r = await svc.check('t1', 'agentRuns', 1, NOW);
    expect(r.allowed).toBe(true);
  });

  it('blocks a trialing tenant past trialEndsAt with trial.expired=true', async () => {
    const row = baseRow();
    row.trialEndsAt = new Date('2026-05-07T00:00:00Z');
    const db = makeFakeDb(row);
    const svc = new UsageCounterService(db as any);
    const result = await svc.check('t1', 'agentRuns', 1, NOW);
    expect(result.allowed).toBe(false);
    expect(result.trial.expired).toBe(true);
  });

  it('always allows a paid (non-trial) plan even past cap', async () => {
    const row = baseRow();
    row.planId = 'pro';
    row.status = 'active';
    row.dailyAgentRunsUsed = 100;
    const db = makeFakeDb(row);
    const svc = new UsageCounterService(db as any);
    const result = await svc.check('t1', 'agentRuns', 50, NOW);
    expect(result.allowed).toBe(true);
  });

  it('lazy-resets daily counters when dailyResetAt < today UTC midnight', async () => {
    const row = baseRow();
    // dailyResetAt is yesterday in UTC; counters should reset on first read.
    row.dailyResetAt = new Date('2026-05-07T20:00:00Z');
    row.dailyAgentRunsUsed = 19;
    const db = makeFakeDb(row);
    const svc = new UsageCounterService(db as any);
    await svc.check('t1', 'agentRuns', 1, NOW);
    expect(db._row()!.dailyAgentRunsUsed).toBe(0);
  });

  it('does NOT reset when dailyResetAt is later in the same UTC day', async () => {
    const row = baseRow();
    // 03:00 UTC on the same day — should NOT trigger reset on a 12:00 UTC read.
    row.dailyResetAt = new Date('2026-05-08T03:00:00Z');
    row.dailyAgentRunsUsed = 5;
    const db = makeFakeDb(row);
    const svc = new UsageCounterService(db as any);
    await svc.check('t1', 'agentRuns', 1, NOW);
    expect(db._row()!.dailyAgentRunsUsed).toBe(5);
  });

  it('exposes resetsAt as next UTC midnight', async () => {
    const db = makeFakeDb(baseRow());
    const svc = new UsageCounterService(db as any);
    const result = await svc.check('t1', 'agentRuns', 0, NOW);
    expect(result.resetsAt).toBe('2026-05-09T00:00:00.000Z');
  });
});

describe('UsageCounterService.recordUsage', () => {
  const NOW = new Date('2026-05-08T12:00:00Z');

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('increments the right column', async () => {
    const row = baseRow();
    row.dailyAgentRunsUsed = 3;
    const db = makeFakeDb(row);
    const svc = new UsageCounterService(db as any);
    await svc.recordUsage('t1', 'agentRuns', 4, NOW);
    expect(db._row()!.dailyAgentRunsUsed).toBe(7);
  });

  it('swallows errors so a counter-write hiccup never rolls back a workflow', async () => {
    const db = makeFakeDb(baseRow());
    db.subscription.update = vi.fn().mockRejectedValue(new Error('db down'));
    const svc = new UsageCounterService(db as any);
    // No throw expected.
    await expect(svc.recordUsage('t1', 'agentRuns', 1, NOW)).resolves.toBeUndefined();
  });
});

describe('UsageCounterService.startTrial', () => {
  const NOW = new Date('2026-05-08T12:00:00Z');

  it('creates a 30-day trial subscription', async () => {
    const db = makeFakeDb(null);
    const svc = new UsageCounterService(db as any);
    await svc.startTrial('t-new', NOW);
    expect(db.subscription.upsert).toHaveBeenCalledTimes(1);
    const args = db.subscription.upsert.mock.calls[0]![0];
    expect(args.create.planId).toBe('trial_30d');
    expect(args.create.status).toBe('trialing');
    const expectedEnds = new Date(NOW);
    expectedEnds.setUTCDate(expectedEnds.getUTCDate() + 30);
    expect(args.create.trialEndsAt.toISOString()).toBe(expectedEnds.toISOString());
  });
});
