import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreditService } from '../../../apps/api/src/billing/credit-service.js';
import { getPlan } from '../../../apps/api/src/billing/plans.js';
import type { PrismaClient } from '@jak-swarm/db';

/**
 * Behavioral tests for `CreditService` against a hand-rolled in-memory Prisma
 * fake that mirrors the shape the service expects: `subscription.findUnique /
 * update / create`, `usageLedger.create`, and `$transaction(async tx => …)`
 * where `tx` shares the same in-memory state. Supports Prisma's
 * `{ increment: n }` update operator (used by `reconcile`).
 *
 * Real Prisma integration (SELECT FOR UPDATE, constraint behavior) is covered
 * by the postgres-integration suite — this file is a fast harness that runs
 * without a database and locks the billing math + cap-rejection contracts.
 */

type SubRow = {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
  creditsTotal: number;
  creditsUsed: number;
  premiumTotal: number;
  premiumUsed: number;
  dailyUsed: number;
  dailyCap: number;
  perTaskCap: number;
  concurrentCap: number;
  maxModelTier: number;
  periodStart: Date;
  periodEnd: Date;
  dailyResetAt: Date;
  paddleSubId: string | null;
  paddleCustomerId: string | null;
};

type LedgerRow = Record<string, unknown>;

function applyUpdateData(row: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in (v as Record<string, unknown>)) {
      const inc = (v as { increment: number }).increment;
      row[k] = (typeof row[k] === 'number' ? row[k] : 0) + inc;
    } else {
      row[k] = v;
    }
  }
}

function makeStubPrisma() {
  const subs = new Map<string, SubRow>();
  const ledgers: LedgerRow[] = [];
  let nextId = 1;

  // Both the top-level client and the transaction `tx` share this surface.
  const surface = {
    subscription: {
      findUnique: vi.fn(async (args: { where: { tenantId?: string; id?: string } }) => {
        const where = args.where as Record<string, string>;
        if (where.tenantId) return subs.get(where.tenantId) ?? null;
        if (where.id) {
          for (const s of subs.values()) if (s.id === where.id) return s;
        }
        return null;
      }),
      update: vi.fn(async (args: { where: { tenantId?: string; id?: string }; data: Record<string, unknown> }) => {
        const where = args.where as Record<string, string>;
        let row: SubRow | undefined;
        if (where.tenantId) row = subs.get(where.tenantId);
        else if (where.id) for (const s of subs.values()) if (s.id === where.id) row = s;
        if (!row) throw new Error(`subscription not found for ${JSON.stringify(where)}`);
        applyUpdateData(row as unknown as Record<string, unknown>, args.data);
        return row;
      }),
      create: vi.fn(async (args: { data: Partial<SubRow> }) => {
        const row: SubRow = {
          id: `sub-${nextId++}`,
          tenantId: args.data.tenantId ?? 't-1',
          planId: args.data.planId ?? 'free',
          status: 'active',
          creditsTotal: args.data.creditsTotal ?? 200,
          creditsUsed: args.data.creditsUsed ?? 0,
          premiumTotal: args.data.premiumTotal ?? 0,
          premiumUsed: args.data.premiumUsed ?? 0,
          dailyUsed: args.data.dailyUsed ?? 0,
          dailyCap: args.data.dailyCap ?? 30,
          perTaskCap: args.data.perTaskCap ?? 10,
          concurrentCap: args.data.concurrentCap ?? 1,
          maxModelTier: args.data.maxModelTier ?? 1,
          periodStart: args.data.periodStart ?? new Date(),
          periodEnd: args.data.periodEnd ?? new Date(Date.now() + 30 * 86_400_000),
          dailyResetAt: args.data.dailyResetAt ?? new Date(),
          paddleSubId: args.data.paddleSubId ?? null,
          paddleCustomerId: args.data.paddleCustomerId ?? null,
        };
        subs.set(row.tenantId, row);
        return row;
      }),
    },
    usageLedger: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        ledgers.push(args.data);
        return args.data;
      }),
    },
  };

  const client = {
    ...surface,
    $transaction: vi.fn(async (fn: (tx: typeof surface) => Promise<unknown>) => fn(surface)),
  } as unknown as PrismaClient;

  return { client, subs, ledgers };
}

const TENANT = 't-1';

function seedActiveSub(overrides: Partial<SubRow> = {}, prisma: ReturnType<typeof makeStubPrisma>) {
  const plan = getPlan('free');
  const now = new Date();
  const sub: SubRow = {
    id: 'sub-1',
    tenantId: TENANT,
    planId: 'free',
    status: 'active',
    creditsTotal: plan.creditsTotal,
    creditsUsed: 0,
    premiumTotal: plan.premiumTotal,
    premiumUsed: 0,
    dailyUsed: 0,
    dailyCap: plan.dailyCap,
    perTaskCap: plan.perTaskCap,
    concurrentCap: plan.concurrentCap,
    maxModelTier: plan.maxModelTier,
    periodStart: now,
    periodEnd: new Date(now.getTime() + 30 * 86_400_000),
    dailyResetAt: now,
    paddleSubId: null,
    paddleCustomerId: null,
    ...overrides,
  };
  prisma.subs.set(TENANT, sub);
  return sub;
}

describe('CreditService', () => {
  let prisma: ReturnType<typeof makeStubPrisma>;
  let svc: CreditService;

  beforeEach(() => {
    prisma = makeStubPrisma();
    svc = new CreditService(prisma.client);
  });

  describe('checkCredits', () => {
    it('denies with NO_SUBSCRIPTION when the tenant has no subscription', async () => {
      const out = await svc.checkCredits('nope', 5);
      expect(out.allowed).toBe(false);
      expect(out.reason).toBe('NO_SUBSCRIPTION');
    });

    it('denies with PLAN_EXPIRED when periodEnd is in the past', async () => {
      seedActiveSub({ periodEnd: new Date(Date.now() - 86_400_000) }, prisma);
      const out = await svc.checkCredits(TENANT, 5);
      expect(out.allowed).toBe(false);
      expect(out.reason).toBe('PLAN_EXPIRED');
    });

    it('denies with PER_TASK_CAP when the estimate exceeds perTaskCap', async () => {
      seedActiveSub({ perTaskCap: 10 }, prisma);
      const out = await svc.checkCredits(TENANT, 11);
      expect(out.allowed).toBe(false);
      expect(out.reason).toBe('PER_TASK_CAP');
      expect(out.maxModelTier).toBe(1);
    });

    it('denies with DAILY_CAP when dailyUsed + estimate exceeds dailyCap', async () => {
      seedActiveSub({ dailyUsed: 28, dailyCap: 30 }, prisma);
      const out = await svc.checkCredits(TENANT, 5);
      expect(out.allowed).toBe(false);
      expect(out.reason).toBe('DAILY_CAP');
    });

    it('denies with MONTHLY_CAP when creditsUsed + estimate exceeds 105% of total', async () => {
      seedActiveSub({ creditsUsed: 200, creditsTotal: 200, dailyCap: 1000, perTaskCap: 1000 }, prisma);
      // 105% of 200 = 210; 200 + 11 > 210 → denied
      const out = await svc.checkCredits(TENANT, 11);
      expect(out.allowed).toBe(false);
      expect(out.reason).toBe('MONTHLY_CAP');
    });

    it('allows and reports remaining when the estimate fits all caps', async () => {
      seedActiveSub({ dailyCap: 30, creditsTotal: 200, perTaskCap: 10 }, prisma);
      const out = await svc.checkCredits(TENANT, 5);
      expect(out.allowed).toBe(true);
      expect(out.remaining).toEqual({ daily: 30, monthly: 200, premium: 0 });
      expect(out.maxModelTier).toBe(1);
    });

    it('auto-resets the daily counter when the last reset was >24h ago', async () => {
      const sub = seedActiveSub({ dailyUsed: 25, dailyCap: 30 }, prisma);
      sub.dailyResetAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const out = await svc.checkCredits(TENANT, 5);
      expect(out.allowed).toBe(true);
      // After reset, daily remaining = 30 (reset wiped dailyUsed), 5 fits.
      expect(out.remaining?.daily).toBe(30);
      expect(prisma.subs.get(TENANT)?.dailyUsed).toBe(0);
    });
  });

  describe('reserveCredits', () => {
    it('reserves credits and returns a reservationId', async () => {
      seedActiveSub({ dailyCap: 30, creditsTotal: 200, perTaskCap: 100 }, prisma);
      const out = await svc.reserveCredits(TENANT, 5);
      expect(out.allowed).toBe(true);
      expect(out.reservationId).toMatch(/^res_/);
      expect(out.reserved).toBe(5);
      expect(prisma.subs.get(TENANT)?.dailyUsed).toBe(5);
      expect(prisma.subs.get(TENANT)?.creditsUsed).toBe(5);
    });

    it('denies when there is no active subscription', async () => {
      const out = await svc.reserveCredits('nope', 5);
      expect(out.allowed).toBe(false);
      expect(out.reason).toBe('No active subscription');
    });

    it('denies when the subscription status is not active', async () => {
      seedActiveSub({ status: 'cancelled' }, prisma);
      const out = await svc.reserveCredits(TENANT, 5);
      expect(out.allowed).toBe(false);
      expect(out.reason).toBe('No active subscription');
    });

    it('denies with the daily-cap reason when daily budget is exhausted', async () => {
      seedActiveSub({ dailyUsed: 28, dailyCap: 30 }, prisma);
      const out = await svc.reserveCredits(TENANT, 5);
      expect(out.allowed).toBe(false);
      expect(out.reason).toBe('Daily cap exceeded');
      expect(prisma.subs.get(TENANT)?.dailyUsed).toBe(28); // unchanged
    });

    it('denies with the monthly-cap reason when monthly budget is exhausted', async () => {
      seedActiveSub({ creditsUsed: 200, creditsTotal: 200, dailyCap: 1000 }, prisma);
      const out = await svc.reserveCredits(TENANT, 11);
      expect(out.allowed).toBe(false);
      expect(out.reason).toBe('Monthly cap exceeded');
    });

    it('auto-resets the daily counter inside the transaction when >24h elapsed', async () => {
      const sub = seedActiveSub({ dailyUsed: 25, dailyCap: 30 }, prisma);
      sub.dailyResetAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const oldResetAt = sub.dailyResetAt;
      const out = await svc.reserveCredits(TENANT, 5);
      expect(out.allowed).toBe(true);
      // Reset to 0, then reserved 5.
      expect(prisma.subs.get(TENANT)?.dailyUsed).toBe(5);
      expect(prisma.subs.get(TENANT)?.dailyResetAt).not.toEqual(oldResetAt);
    });

    it('returns SYSTEM_ERROR when the transaction throws', async () => {
      seedActiveSub({}, prisma);
      vi.spyOn(prisma.client as unknown as { $transaction: unknown }, '$transaction').mockImplementationOnce(async () => {
        throw new Error('connection lost');
      });
      const out = await svc.reserveCredits(TENANT, 5);
      expect(out.allowed).toBe(false);
      expect(out.reason).toBe('SYSTEM_ERROR');
      expect(out.message).toContain('connection lost');
    });
  });

  describe('reconcile', () => {
    it('refunds the difference when reserved > actual (overpayment)', async () => {
      const sub = seedActiveSub({ creditsUsed: 20, dailyUsed: 20 }, prisma);
      await svc.reconcile({
        tenantId: TENANT, userId: 'u-1', taskType: 'chat', modelUsed: 'gpt-4o-mini', provider: 'openai',
        inputTokens: 100, outputTokens: 50, actualCredits: 5, reservedCredits: 20, usdCost: 0.05, status: 'COMPLETED',
      });
      // diff = 20 - 5 = 15 refund → creditsUsed 20-15=5, dailyUsed 20-15=5
      expect(sub.creditsUsed).toBe(5);
      expect(sub.dailyUsed).toBe(5);
      expect(prisma.ledgers).toHaveLength(1);
      expect(prisma.ledgers[0]?.['creditsCost']).toBe(5);
      expect(prisma.ledgers[0]?.['creditsReserved']).toBe(20);
    });

    it('charges the difference when actual > reserved (underpayment)', async () => {
      const sub = seedActiveSub({ creditsUsed: 5, dailyUsed: 5 }, prisma);
      await svc.reconcile({
        tenantId: TENANT, userId: 'u-1', taskType: 'chat', modelUsed: 'gpt-4o-mini', provider: 'openai',
        inputTokens: 100, outputTokens: 50, actualCredits: 20, reservedCredits: 5, usdCost: 0.2, status: 'COMPLETED',
      });
      // diff = 5 - 20 = -15 → increment -(-15)=+15 → creditsUsed 5+15=20
      expect(sub.creditsUsed).toBe(20);
      expect(sub.dailyUsed).toBe(20);
    });

    it('skips the balance adjustment but still records the ledger when diff === 0', async () => {
      const sub = seedActiveSub({ creditsUsed: 10, dailyUsed: 10 }, prisma);
      const updateSpy = prisma.client.subscription.update;
      await svc.reconcile({
        tenantId: TENANT, userId: 'u-1', taskType: 'chat', modelUsed: 'gpt-4o-mini', provider: 'openai',
        inputTokens: 100, outputTokens: 50, actualCredits: 10, reservedCredits: 10, usdCost: 0.1, status: 'COMPLETED',
      });
      // No balance update was issued (diff === 0).
      expect(updateSpy).not.toHaveBeenCalled();
      expect(sub.creditsUsed).toBe(10);
      // Ledger still recorded.
      expect(prisma.ledgers).toHaveLength(1);
    });

    it('records the ledger even when the balance-adjust transaction throws', async () => {
      seedActiveSub({ creditsUsed: 20, dailyUsed: 20 }, prisma);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // First subscription.update (inside reconcile's $transaction) throws.
      const updateSpy = vi.spyOn(prisma.client.subscription, 'update').mockRejectedValueOnce(new Error('tx aborted'));
      await svc.reconcile({
        tenantId: TENANT, userId: 'u-1', taskType: 'chat', modelUsed: 'gpt-4o-mini', provider: 'openai',
        inputTokens: 100, outputTokens: 50, actualCredits: 5, reservedCredits: 20, usdCost: 0.05, status: 'COMPLETED',
      });
      expect(errSpy).toHaveBeenCalled();
      expect(prisma.ledgers).toHaveLength(1); // ledger still written
      updateSpy.mockRestore();
      errSpy.mockRestore();
    });
  });

  describe('getUsage', () => {
    it('returns null when there is no subscription', async () => {
      expect(await svc.getUsage('nope')).toBeNull();
    });

    it('returns a correct usage summary for an active subscription', async () => {
      seedActiveSub({ creditsUsed: 50, creditsTotal: 200, premiumUsed: 0, premiumTotal: 0, dailyUsed: 10, dailyCap: 30, perTaskCap: 10, maxModelTier: 1, planId: 'free' }, prisma);
      const out = await svc.getUsage(TENANT);
      expect(out).not.toBeNull();
      expect(out!.plan).toBe('free');
      expect(out!.credits).toEqual({ used: 50, total: 200, remaining: 150 });
      expect(out!.daily).toEqual({ used: 10, cap: 30, remaining: 20, resetsAt: expect.any(String) });
      expect(out!.premium.remaining).toBe(0);
      expect(out!.perTaskCap).toBe(10);
      expect(out!.maxModelTier).toBe(1);
    });

    it('clamps remaining at 0 when over the cap', async () => {
      seedActiveSub({ creditsUsed: 250, creditsTotal: 200 }, prisma);
      const out = await svc.getUsage(TENANT);
      expect(out!.credits.remaining).toBe(0);
    });
  });

  describe('createFreeSubscription', () => {
    it('creates a subscription seeded from the free plan', async () => {
      await svc.createFreeSubscription('new-tenant');
      const sub = prisma.subs.get('new-tenant');
      expect(sub).toBeDefined();
      const plan = getPlan('free');
      expect(sub!.planId).toBe('free');
      expect(sub!.creditsTotal).toBe(plan.creditsTotal);
      expect(sub!.dailyCap).toBe(plan.dailyCap);
      expect(sub!.perTaskCap).toBe(plan.perTaskCap);
      expect(sub!.maxModelTier).toBe(plan.maxModelTier);
      expect(sub!.periodEnd.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    });
  });

  describe('updateSubscription', () => {
    it('upgrades to the pro plan and resets the used counters', async () => {
      const sub = seedActiveSub({ planId: 'free', creditsUsed: 100, dailyUsed: 20, premiumUsed: 0 }, prisma);
      await svc.updateSubscription(TENANT, 'pro', 'paddle-sub-1', 'paddle-cust-1');
      const plan = getPlan('pro');
      expect(sub.planId).toBe('pro');
      expect(sub.creditsTotal).toBe(plan.creditsTotal);
      expect(sub.premiumTotal).toBe(plan.premiumTotal);
      expect(sub.maxModelTier).toBe(plan.maxModelTier);
      expect(sub.creditsUsed).toBe(0);
      expect(sub.dailyUsed).toBe(0);
      expect(sub.premiumUsed).toBe(0);
      expect(sub.paddleSubId).toBe('paddle-sub-1');
      expect(sub.paddleCustomerId).toBe('paddle-cust-1');
      expect(sub.status).toBe('active');
    });
  });
});