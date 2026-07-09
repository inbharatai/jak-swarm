/**
 * repair-budget-auction.ts — Innovation #6 (HyperAgent Phase 4).
 *
 * When several tasks are failing concurrently, the HyperAgent has a FINITE
 * repair budget (cost, duration, and per-level attempt caps). Rather than
 * repair in arrival order or repair everything until budget collapses, we
 * hold an auction: each candidate repair bids its expected value
 *
 *     E[value] = P(success | repair) · value − cost
 *
 * and the auction picks the highest-bidding repairs that still fit within
 * the remaining budget and per-level caps. This is a deterministic greedy
 * knapsack — not globally optimal, but bounded, auditable, and free of any
 * LLM "I think this one matters more" judgement. The numbers come from the
 * diagnostician's counterfactual replay (Innovation #1) + the replanner's
 * repair-type estimate.
 *
 * Pure + deterministic — no I/O, no Date.now, fully unit-testable.
 */

import type { RepairLevel, RepairType } from '@jak-swarm/shared';

/** One repair the auction may bid on. */
export interface RepairCandidate {
  taskId: string;
  repairType: RepairType;
  repairLevel: RepairLevel;
  /** Estimated probability the repair succeeds (0..1). */
  probabilityOfSuccess: number;
  /** Value of the task succeeding (priority weight, >= 0). */
  value: number;
  /** Estimated cost of attempting the repair (USD, >= 0). */
  costUsd: number;
  /** Estimated duration of the repair (ms, >= 0). */
  durationMs: number;
  /** True when a human must approve before the repair runs (never auto-awarded). */
  requiresApproval: boolean;
}

export interface AuctionBudget {
  costUsd: number;
  durationMs: number;
  maxPlanRepairs: number;
  maxExecutionRetries: number;
  maxOutputRepairs: number;
  maxCapabilityRepairs: number;
}

export interface AuctionRejected {
  candidate: RepairCandidate;
  reason: string;
}

export interface AuctionResult {
  /** Winners, sorted by expected value descending. */
  winners: RepairCandidate[];
  rejected: AuctionRejected[];
  totalExpectedValue: number;
  totalCostUsd: number;
  totalDurationMs: number;
}

/**
 * Expected value of a candidate: P(success)·value − cost.
 * Approval-required candidates are still scored (so humans can see the ranking)
 * but are never auto-awarded by `auctionRepairs`.
 */
export function expectedValue(c: RepairCandidate): number {
  const p = clamp01(c.probabilityOfSuccess);
  return p * Math.max(0, c.value) - Math.max(0, c.costUsd);
}

const clamp01 = (n: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;

/**
 * Hold the auction. Greedy by expected value, subject to:
 *   - remaining cost + duration budget;
 *   - per-repair-level attempt caps;
 *   - approval-required candidates are never auto-awarded (they go to rejected
 *     with reason "requires approval" so the cockpit can surface them).
 *
 * Ties in expected value break by lower cost, then by taskId for determinism.
 */
export function auctionRepairs(
  candidates: ReadonlyArray<RepairCandidate>,
  budget: AuctionBudget,
): AuctionResult {
  const ranked = [...candidates].sort((a, b) => {
    const evDiff = expectedValue(b) - expectedValue(a);
    if (Math.abs(evDiff) > 1e-9) return evDiff;
    if (a.costUsd !== b.costUsd) return a.costUsd - b.costUsd;
    return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
  });

  const winners: RepairCandidate[] = [];
  const rejected: AuctionRejected[] = [];
  let remainingCost = Math.max(0, budget.costUsd);
  let remainingDuration = Math.max(0, budget.durationMs);
  // R4 (config repair) and R5 (code repair) SHARE one capability budget —
  // `budget.maxCapabilityRepairs` — matching failure-classifier.ts which
  // tracks a single capabilityRepairAttempts counter for both. Previously the
  // auction kept separate R4 and R5 counters, each capped at
  // maxCapabilityRepairs, so it could award maxCapabilityRepairs R4 repairs
  // AND maxCapabilityRepairs R5 repairs = 2× the intended capability budget.
  // Collapse them into one shared 'CAPABILITY' bucket.
  const bucketFor = (level: string): string =>
    level === 'R4_CONFIG_REPAIR' || level === 'R5_CODE_REPAIR' ? 'CAPABILITY' : level;
  const levelUsed: Record<string, number> = {
    R1_EXECUTION_RETRY: 0,
    R2_OUTPUT_CORRECTION: 0,
    R3_PLAN_REPAIR: 0,
    CAPABILITY: 0,
  };
  const levelCap: Record<string, number> = {
    R1_EXECUTION_RETRY: budget.maxExecutionRetries,
    R2_OUTPUT_CORRECTION: budget.maxOutputRepairs,
    R3_PLAN_REPAIR: budget.maxPlanRepairs,
    CAPABILITY: budget.maxCapabilityRepairs,
  };

  for (const c of ranked) {
    if (c.requiresApproval) {
      rejected.push({ candidate: c, reason: 'requires human approval — never auto-awarded' });
      continue;
    }
    if (expectedValue(c) <= 0) {
      rejected.push({ candidate: c, reason: 'non-positive expected value' });
      continue;
    }
    const bucket = bucketFor(c.repairLevel);
    const cap = levelCap[bucket] ?? 0;
    if ((levelUsed[bucket] ?? 0) >= cap) {
      rejected.push({
        candidate: c,
        reason:
          bucket === 'CAPABILITY'
            ? `capability repair cap reached (R4+R5 shared: ${cap})`
            : `repair-level cap reached (${c.repairLevel}: ${cap})`,
      });
      continue;
    }
    if (c.costUsd > remainingCost) {
      rejected.push({ candidate: c, reason: `cost $${c.costUsd} exceeds remaining $${remainingCost.toFixed(4)}` });
      continue;
    }
    if (c.durationMs > remainingDuration) {
      rejected.push({ candidate: c, reason: `duration ${c.durationMs}ms exceeds remaining ${remainingDuration}ms` });
      continue;
    }
    winners.push(c);
    remainingCost -= c.costUsd;
    remainingDuration -= c.durationMs;
    levelUsed[bucket] = (levelUsed[bucket] ?? 0) + 1;
  }

  const totalCostUsd = winners.reduce((s, c) => s + Math.max(0, c.costUsd), 0);
  const totalDurationMs = winners.reduce((s, c) => s + Math.max(0, c.durationMs), 0);
  const totalExpectedValue = winners.reduce((s, c) => s + expectedValue(c), 0);

  return {
    winners,
    rejected,
    totalExpectedValue,
    totalCostUsd,
    totalDurationMs,
  };
}