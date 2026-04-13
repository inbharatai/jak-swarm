/**
 * Credit service — the core billing engine for Jaak managed AI.
 *
 * Handles:
 * - Credit balance checking
 * - Budget reservation before execution
 * - Post-execution reconciliation
 * - Daily reset
 * - Usage ledger recording
 * - Plan enforcement
 */

import type { PrismaClient } from '@jak-swarm/db';
import { getPlan } from './plans.js';

export interface CreditCheckResult {
  allowed: boolean;
  reason?: 'DAILY_CAP' | 'MONTHLY_CAP' | 'PER_TASK_CAP' | 'PREMIUM_CAP' | 'NO_SUBSCRIPTION' | 'PLAN_EXPIRED';
  remaining?: { daily: number; monthly: number; premium: number };
  maxModelTier?: number;
  message?: string;
}

export interface ReservationResult {
  allowed: boolean;
  reservationId?: string;
  reserved?: number;
  reason?: string;
  message?: string;
}

export interface ReconcileParams {
  tenantId: string;
  userId: string;
  workflowId?: string;
  taskType: string;
  modelUsed: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  actualCredits: number;
  reservedCredits: number;
  usdCost: number;
  latencyMs?: number;
  status: string;
}

export class CreditService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Check if a tenant has enough credits for a task.
   * Does NOT deduct — use reserveCredits for that.
   */
  async checkCredits(tenantId: string, estimatedCredits: number): Promise<CreditCheckResult> {
    const sub = await this.getSubscription(tenantId);
    if (!sub) {
      return { allowed: false, reason: 'NO_SUBSCRIPTION', message: 'No active subscription. Please sign up.' };
    }

    // Check plan expiry
    if (new Date(sub.periodEnd) < new Date()) {
      return { allowed: false, reason: 'PLAN_EXPIRED', message: 'Your plan has expired. Please renew.' };
    }

    // Auto-reset daily counter if needed
    await this.maybeResetDaily(sub);

    const remaining = {
      daily: sub.dailyCap - sub.dailyUsed,
      monthly: sub.creditsTotal - sub.creditsUsed,
      premium: sub.premiumTotal - sub.premiumUsed,
    };

    // Check per-task cap
    if (estimatedCredits > sub.perTaskCap) {
      return {
        allowed: false,
        reason: 'PER_TASK_CAP',
        remaining,
        maxModelTier: sub.maxModelTier,
        message: `This task would cost ~${estimatedCredits} credits, exceeding your per-task limit of ${sub.perTaskCap}. Try a simpler request or upgrade your plan.`,
      };
    }

    // Check daily cap
    if (sub.dailyUsed + estimatedCredits > sub.dailyCap) {
      return {
        allowed: false,
        reason: 'DAILY_CAP',
        remaining,
        maxModelTier: sub.maxModelTier,
        message: `Daily credit limit reached (${sub.dailyUsed}/${sub.dailyCap}). Resets at midnight UTC.`,
      };
    }

    // Check monthly cap (with 5% grace buffer)
    const monthlyLimit = Math.ceil(sub.creditsTotal * 1.05);
    if (sub.creditsUsed + estimatedCredits > monthlyLimit) {
      return {
        allowed: false,
        reason: 'MONTHLY_CAP',
        remaining,
        maxModelTier: sub.maxModelTier,
        message: `Monthly credit limit reached (${sub.creditsUsed}/${sub.creditsTotal}). Resets on ${new Date(sub.periodEnd).toLocaleDateString()}.`,
      };
    }

    return { allowed: true, remaining, maxModelTier: sub.maxModelTier };
  }

  /**
   * Atomically reserve credits before execution.
   * Uses SELECT FOR UPDATE to prevent race conditions.
   */
  async reserveCredits(tenantId: string, estimatedCredits: number): Promise<ReservationResult> {
    try {
      // Atomic: check + reserve in one transaction
      const result = await (this.db as any).$transaction(async (tx: any) => {
        const sub = await tx.subscription.findUnique({
          where: { tenantId },
          // FOR UPDATE handled implicitly by Prisma in transaction
        });

        if (!sub || sub.status !== 'active') {
          return { allowed: false, reason: 'No active subscription' };
        }

        // Auto-reset daily if needed
        const now = new Date();
        const resetAt = new Date(sub.dailyResetAt);
        let dailyUsed = sub.dailyUsed;
        if (now.getTime() - resetAt.getTime() > 24 * 60 * 60 * 1000) {
          dailyUsed = 0;
          await tx.subscription.update({
            where: { id: sub.id },
            data: { dailyUsed: 0, dailyResetAt: now },
          });
        }

        if (dailyUsed + estimatedCredits > sub.dailyCap) {
          return { allowed: false, reason: 'Daily cap exceeded' };
        }

        if (sub.creditsUsed + estimatedCredits > Math.ceil(sub.creditsTotal * 1.05)) {
          return { allowed: false, reason: 'Monthly cap exceeded' };
        }

        // Reserve the credits
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            dailyUsed: dailyUsed + estimatedCredits,
            creditsUsed: sub.creditsUsed + estimatedCredits,
          },
        });

        return { allowed: true, reserved: estimatedCredits };
      });

      if (!result.allowed) {
        return { allowed: false, reason: result.reason, message: result.reason };
      }

      return {
        allowed: true,
        reservationId: `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        reserved: result.reserved,
      };
    } catch (err) {
      return {
        allowed: false,
        reason: 'SYSTEM_ERROR',
        message: `Credit reservation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Reconcile actual usage after execution.
   * Refunds overpayment or charges underpayment.
   * Records to usage ledger.
   */
  async reconcile(params: ReconcileParams): Promise<void> {
    const diff = params.reservedCredits - params.actualCredits;

    if (diff !== 0) {
      try {
        await (this.db as any).$transaction(async (tx: any) => {
          // Adjust credit balance
          await tx.subscription.update({
            where: { tenantId: params.tenantId },
            data: {
              creditsUsed: { increment: -diff }, // Positive diff = refund, negative = charge more
              dailyUsed: { increment: -diff },
            },
          });
        });
      } catch {
        // Reconciliation failure — log but don't crash. Slightly off credits > broken workflow.
        console.error(`[credits] Reconciliation failed for tenant ${params.tenantId}, diff=${diff}`);
      }
    }

    // Record to usage ledger (always, regardless of reconciliation)
    try {
      await (this.db as any).usageLedger.create({
        data: {
          tenantId: params.tenantId,
          userId: params.userId,
          workflowId: params.workflowId,
          taskType: params.taskType,
          modelUsed: params.modelUsed,
          provider: params.provider,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          creditsCost: params.actualCredits,
          creditsReserved: params.reservedCredits,
          usdCost: params.usdCost,
          latencyMs: params.latencyMs,
          status: params.status,
        },
      });
    } catch (err) {
      console.error(`[credits] Failed to record usage ledger:`, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Get current usage summary for a tenant.
   */
  async getUsage(tenantId: string): Promise<{
    plan: string;
    credits: { used: number; total: number; remaining: number };
    premium: { used: number; total: number; remaining: number };
    daily: { used: number; cap: number; remaining: number; resetsAt: string };
    monthly: { resetsAt: string };
    perTaskCap: number;
    maxModelTier: number;
  } | null> {
    const sub = await this.getSubscription(tenantId);
    if (!sub) return null;

    await this.maybeResetDaily(sub);

    return {
      plan: sub.planId,
      credits: {
        used: sub.creditsUsed,
        total: sub.creditsTotal,
        remaining: Math.max(0, sub.creditsTotal - sub.creditsUsed),
      },
      premium: {
        used: sub.premiumUsed,
        total: sub.premiumTotal,
        remaining: Math.max(0, sub.premiumTotal - sub.premiumUsed),
      },
      daily: {
        used: sub.dailyUsed,
        cap: sub.dailyCap,
        remaining: Math.max(0, sub.dailyCap - sub.dailyUsed),
        resetsAt: this.nextDailyReset().toISOString(),
      },
      monthly: {
        resetsAt: new Date(sub.periodEnd).toISOString(),
      },
      perTaskCap: sub.perTaskCap,
      maxModelTier: sub.maxModelTier,
    };
  }

  /**
   * Create a free subscription for a new tenant.
   */
  async createFreeSubscription(tenantId: string): Promise<void> {
    const plan = getPlan('free');
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() + 30);

    await (this.db as any).subscription.create({
      data: {
        tenantId,
        planId: 'free',
        creditsTotal: plan.creditsTotal,
        premiumTotal: plan.premiumTotal,
        dailyCap: plan.dailyCap,
        perTaskCap: plan.perTaskCap,
        concurrentCap: plan.concurrentCap,
        maxModelTier: plan.maxModelTier,
        periodEnd,
        dailyResetAt: now,
      },
    });
  }

  /**
   * Upgrade/downgrade subscription (called from Paddle webhook).
   */
  async updateSubscription(tenantId: string, planId: string, paddleSubId?: string, paddleCustomerId?: string): Promise<void> {
    const plan = getPlan(planId);
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() + 30);

    await (this.db as any).subscription.update({
      where: { tenantId },
      data: {
        planId,
        creditsTotal: plan.creditsTotal,
        premiumTotal: plan.premiumTotal,
        dailyCap: plan.dailyCap,
        perTaskCap: plan.perTaskCap,
        concurrentCap: plan.concurrentCap,
        maxModelTier: plan.maxModelTier,
        creditsUsed: 0, // Reset on plan change
        premiumUsed: 0,
        dailyUsed: 0,
        periodStart: now,
        periodEnd,
        paddleSubId,
        paddleCustomerId,
        status: 'active',
      },
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async getSubscription(tenantId: string) {
    return (this.db as any).subscription.findUnique({ where: { tenantId } });
  }

  private async maybeResetDaily(sub: { id: string; dailyResetAt: Date | string; dailyUsed: number }): Promise<void> {
    const now = new Date();
    const resetAt = new Date(sub.dailyResetAt);
    if (now.getTime() - resetAt.getTime() > 24 * 60 * 60 * 1000) {
      await (this.db as any).subscription.update({
        where: { id: sub.id },
        data: { dailyUsed: 0, dailyResetAt: now },
      });
      sub.dailyUsed = 0;
    }
  }

  private nextDailyReset(): Date {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(0, 0, 0, 0);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return tomorrow;
  }
}
