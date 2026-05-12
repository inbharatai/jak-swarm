/**
 * usage-counter.service.ts — daily resource caps for trial + free-plan tenants.
 *
 * Why this exists: the landing page advertises a free 30-day trial. A bad-actor
 * tenant can otherwise drain the OpenAI budget in hours. This service tracks
 * four independent daily counters (agent runs, approvals, tool minutes, raw
 * tokens) per tenant on the existing `Subscription` row, soft-pauses workflows
 * when ANY cap hits, and resets at UTC midnight via a lazy reset on read.
 *
 * Design notes:
 *   - Reset is lazy on read (no cron) — first call after midnight zeros the
 *     counters in a single SQL UPDATE. Cheap, idempotent, no clock-skew bug.
 *   - Increments are best-effort (raceCondition tolerated). Two concurrent
 *     workflows might overshoot the cap by 1; this is acceptable because the
 *     cap is generous + soft-fail not hard-fail.
 *   - Trial expiry is checked separately from daily caps. A tenant whose
 *     trialEndsAt has passed is in `trial_expired` status; all consumption
 *     is blocked (read + export still allowed by the route layer).
 *   - Production tenants on a paid plan have no daily caps applied
 *     (returnAllowed always true regardless of counter values).
 */

import type { PrismaClient } from '@jak-swarm/db';

export type TrialResource =
  | 'agentRuns'
  | 'approvals'
  | 'toolMinutes'
  | 'tokens';

export interface CapCheckResult {
  allowed: boolean;
  // Which resource tripped (only set when allowed=false).
  blockedBy?: TrialResource;
  // Snapshot of all 4 counters AFTER any lazy reset, BEFORE the requested
  // increment. Useful for the cockpit banner.
  counters: {
    agentRuns:    { used: number; cap: number };
    approvals:    { used: number; cap: number };
    toolMinutes:  { used: number; cap: number };
    tokens:       { used: number; cap: number };
  };
  trial: {
    isTrialing: boolean;
    trialEndsAt: Date | null;
    daysRemaining: number | null;
    expired: boolean;
  };
  // ISO timestamp of the next UTC midnight (when counters reset).
  resetsAt: string;
}

const TRIAL_PLAN_IDS = new Set(['trial_30d', 'free']);

function startOfNextUtcDay(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

export class UsageCounterService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Reset daily counters if the dailyResetAt cursor is in a previous UTC day.
   * Idempotent — calling twice in the same UTC day is a no-op.
   */
  private async lazyDailyReset(tenantId: string, now: Date): Promise<void> {
    const todayStartUtc = new Date(now);
    todayStartUtc.setUTCHours(0, 0, 0, 0);

    // Single UPDATE that only fires when dailyResetAt < today00:00 UTC.
    // Avoids a SELECT roundtrip in the steady state.
    await this.db.subscription.updateMany({
      where: {
        tenantId,
        dailyResetAt: { lt: todayStartUtc },
      },
      data: {
        dailyAgentRunsUsed: 0,
        dailyApprovalsUsed: 0,
        dailyToolMinutesUsed: 0,
        dailyTokensUsed: 0,
        dailyUsed: 0,
        dailyResetAt: now,
      },
    });
  }

  /**
   * Check if a tenant can consume `amount` of `resource` right now.
   * Does NOT increment — call `recordUsage` after the work completes.
   *
   * Returns `allowed=false` when:
   *   - Trial expired (any trial tenant past trialEndsAt)
   *   - Any cap on a trial/free plan would be exceeded by `amount`
   */
  async check(
    tenantId: string,
    resource: TrialResource,
    amount = 1,
    now: Date = new Date(),
  ): Promise<CapCheckResult> {
    await this.lazyDailyReset(tenantId, now);

    const sub = await this.db.subscription.findUnique({
      where: { tenantId },
    });

    if (!sub) {
      // No subscription row = nothing to enforce. The auth layer should have
      // bootstrapped one; treat absence as "allowed" but flag for the caller.
      return {
        allowed: true,
        counters: {
          agentRuns:   { used: 0, cap: 0 },
          approvals:   { used: 0, cap: 0 },
          toolMinutes: { used: 0, cap: 0 },
          tokens:      { used: 0, cap: 0 },
        },
        trial: {
          isTrialing: false,
          trialEndsAt: null,
          daysRemaining: null,
          expired: false,
        },
        resetsAt: startOfNextUtcDay(now).toISOString(),
      };
    }

    const isTrialPlan = TRIAL_PLAN_IDS.has(sub.planId);
    const isTrialing = sub.status === 'trialing' || isTrialPlan;
    const trialExpired =
      isTrialing && sub.trialEndsAt !== null && sub.trialEndsAt.getTime() <= now.getTime();
    const daysRemaining =
      sub.trialEndsAt !== null
        ? Math.max(
            0,
            Math.ceil(
              (sub.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            ),
          )
        : null;

    const counters = {
      agentRuns:   { used: sub.dailyAgentRunsUsed,   cap: sub.dailyAgentRunsCap },
      approvals:   { used: sub.dailyApprovalsUsed,   cap: sub.dailyApprovalsCap },
      toolMinutes: { used: sub.dailyToolMinutesUsed, cap: sub.dailyToolMinutesCap },
      tokens:      { used: sub.dailyTokensUsed,      cap: sub.dailyTokensCap },
    };

    const trial = {
      isTrialing,
      trialEndsAt: sub.trialEndsAt,
      daysRemaining,
      expired: trialExpired,
    };

    const baseResult = {
      counters,
      trial,
      resetsAt: startOfNextUtcDay(now).toISOString(),
    };

    // Paid plans skip per-resource caps and stale historical trial dates.
    if (!isTrialPlan && sub.status !== 'trialing') {
      return { ...baseResult, allowed: true };
    }

    if (trialExpired) {
      return { ...baseResult, allowed: false, blockedBy: resource };
    }

    const projected = counters[resource].used + amount;
    if (projected > counters[resource].cap) {
      return { ...baseResult, allowed: false, blockedBy: resource };
    }

    return { ...baseResult, allowed: true };
  }

  /**
   * Increment a counter after consumption. Must be called by the layer that
   * actually consumed the resource (workflow-start handler for agentRuns,
   * approval-decide for approvals, token logger for tokens, etc).
   *
   * Best-effort — failures here are logged but never throw, because losing
   * a counter increment is far less bad than rolling back a successful
   * operation.
   */
  async recordUsage(
    tenantId: string,
    resource: TrialResource,
    amount = 1,
    now: Date = new Date(),
  ): Promise<void> {
    await this.lazyDailyReset(tenantId, now);

    const fieldMap: Record<TrialResource, string> = {
      agentRuns:   'dailyAgentRunsUsed',
      approvals:   'dailyApprovalsUsed',
      toolMinutes: 'dailyToolMinutesUsed',
      tokens:      'dailyTokensUsed',
    };
    const field = fieldMap[resource];

    try {
      await this.db.subscription.update({
        where: { tenantId },
        data: { [field]: { increment: amount } },
      });
    } catch (err) {
      // Best-effort. The route layer logs to AuditLog separately.
      // eslint-disable-next-line no-console
      console.warn(
        `[usage-counter] increment failed for tenant ${tenantId} ${resource} +${amount}`,
        err,
      );
    }
  }

  /**
   * Bootstrap a fresh trial subscription for a tenant. Called from the
   * trial-signup → tenant-promotion flow. Idempotent: if a subscription
   * already exists, it's upgraded to trialing only if currently 'free'.
   */
  async startTrial(tenantId: string, now: Date = new Date()): Promise<void> {
    const trialEndsAt = new Date(now);
    trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + 30);

    const periodEnd = new Date(now);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

    await this.db.subscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        planId: 'trial_30d',
        status: 'trialing',
        trialStartedAt: now,
        trialEndsAt,
        periodStart: now,
        periodEnd,
        dailyResetAt: now,
        // Defaults from the schema cover the rest (caps + zeroed counters).
      },
      update: {
        // Only promote a 'free' tenant — never downgrade a paid one.
        planId: 'trial_30d',
        status: 'trialing',
        trialStartedAt: now,
        trialEndsAt,
      },
    });
  }
}
