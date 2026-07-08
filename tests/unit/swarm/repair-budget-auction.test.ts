/**
 * repair-budget-auction.test.ts — Innovation #6 (HyperAgent Phase 4).
 *
 * The auction is a deterministic greedy knapsack over finite repair budgets.
 * These tests pin: EV scoring, greedy ordering, per-level caps, cost/duration
 * budget enforcement, and the invariant that approval-required candidates are
 * NEVER auto-awarded.
 */
import { describe, it, expect } from 'vitest';
import { RepairLevel } from '../../../packages/shared/src/index.js';
import type { RepairType } from '../../../packages/shared/src/index.js';
import {
  auctionRepairs,
  expectedValue,
  type RepairCandidate,
  type AuctionBudget,
} from '../../../packages/swarm/src/hyperagent/repair-budget-auction.js';

function cand(over: Partial<RepairCandidate> & { taskId: string }): RepairCandidate {
  return {
    repairType: 'REPLACE_TOOL' as RepairType,
    repairLevel: RepairLevel.R3_PLAN_REPAIR,
    probabilityOfSuccess: 0.7,
    value: 10,
    costUsd: 1,
    durationMs: 100,
    requiresApproval: false,
    ...over,
  };
}

function budget(over: Partial<AuctionBudget> = {}): AuctionBudget {
  return {
    costUsd: 100,
    durationMs: 100_000,
    maxPlanRepairs: 3,
    maxExecutionRetries: 3,
    maxOutputRepairs: 3,
    maxCapabilityRepairs: 3,
    ...over,
  };
}

describe('repair-budget-auction — expected value', () => {
  it('EV = P(success)·value − cost', () => {
    expect(expectedValue(cand({ probabilityOfSuccess: 0.5, value: 10, costUsd: 2 }))).toBeCloseTo(3, 5);
  });

  it('clamps probability to [0,1] and treats negative value/cost as 0', () => {
    expect(expectedValue(cand({ probabilityOfSuccess: 5, value: 10, costUsd: -3 }))).toBeCloseTo(10, 5);
    expect(expectedValue(cand({ probabilityOfSuccess: 0.5, value: -10, costUsd: 1 }))).toBeCloseTo(-1, 5);
  });
});

describe('repair-budget-auction — greedy ordering', () => {
  it('awards the highest-EV candidates first', () => {
    const lo = cand({ taskId: 'lo', probabilityOfSuccess: 0.2, value: 10, costUsd: 1 });
    const hi = cand({ taskId: 'hi', probabilityOfSuccess: 0.9, value: 10, costUsd: 1 });
    const r = auctionRepairs([lo, hi], budget());
    expect(r.winners[0].taskId).toBe('hi');
    expect(r.winners[1].taskId).toBe('lo');
  });

  it('breaks EV ties by lower cost, then by taskId', () => {
    const a = cand({ taskId: 'b', probabilityOfSuccess: 0.5, value: 10, costUsd: 3 });
    const b = cand({ taskId: 'a', probabilityOfSuccess: 0.5, value: 10, costUsd: 3 });
    const c = cand({ taskId: 'c', probabilityOfSuccess: 0.5, value: 10, costUsd: 1 });
    const r = auctionRepairs([a, b, c], budget());
    expect(r.winners.map((w) => w.taskId)).toEqual(['c', 'a', 'b']);
  });
});

describe('repair-budget-auction — budget enforcement', () => {
  it('rejects candidates that exceed the remaining cost budget', () => {
    const r = auctionRepairs(
      [cand({ taskId: 'a', costUsd: 60, value: 100 }), cand({ taskId: 'b', costUsd: 60, value: 100 })],
      budget({ costUsd: 100 }),
    );
    expect(r.winners.map((w) => w.taskId)).toEqual(['a']);
    expect(r.rejected.find((x) => x.candidate.taskId === 'b')?.reason).toMatch(/cost/);
  });

  it('rejects candidates that exceed the remaining duration budget', () => {
    const r = auctionRepairs(
      [cand({ taskId: 'a', durationMs: 60_000 }), cand({ taskId: 'b', durationMs: 60_000 })],
      budget({ durationMs: 100_000 }),
    );
    expect(r.winners.map((w) => w.taskId)).toEqual(['a']);
    expect(r.rejected.find((x) => x.candidate.taskId === 'b')?.reason).toMatch(/duration/);
  });

  it('rejects candidates with non-positive expected value', () => {
    const r = auctionRepairs([cand({ taskId: 'a', probabilityOfSuccess: 0.1, value: 1, costUsd: 5 })], budget());
    expect(r.winners).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/expected value/);
  });
});

describe('repair-budget-auction — per-level caps', () => {
  it('enforces the per-repair-level attempt cap', () => {
    const r = auctionRepairs(
      [
        cand({ taskId: 'a', repairLevel: RepairLevel.R3_PLAN_REPAIR }),
        cand({ taskId: 'b', repairLevel: RepairLevel.R3_PLAN_REPAIR }),
        cand({ taskId: 'c', repairLevel: RepairLevel.R3_PLAN_REPAIR }),
      ],
      budget({ maxPlanRepairs: 1 }),
    );
    expect(r.winners.map((w) => w.taskId)).toEqual(['a']);
    expect(r.rejected.filter((x) => x.reason.match(/cap/))).toHaveLength(2);
  });
});

describe('repair-budget-auction — approval invariant', () => {
  it('NEVER auto-awards an approval-required candidate, regardless of EV', () => {
    const r = auctionRepairs([cand({ taskId: 'a', requiresApproval: true, probabilityOfSuccess: 1, value: 1000, costUsd: 0 })], budget());
    expect(r.winners).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/approval/);
  });

  it('reports totals only over winners', () => {
    const a = cand({ taskId: 'a', costUsd: 4, durationMs: 500, value: 10 }); // EV = 7 - 4 = 3
    const b = cand({ taskId: 'b', costUsd: 8, durationMs: 200, value: 20 }); // EV = 14 - 8 = 6
    const r = auctionRepairs([a, b], budget({ costUsd: 100, durationMs: 1000 }));
    expect(r.winners.map((w) => w.taskId)).toEqual(['b', 'a']); // higher EV first
    expect(r.totalCostUsd).toBe(12);
    expect(r.totalDurationMs).toBe(700);
    expect(r.totalExpectedValue).toBeCloseTo(expectedValue(a) + expectedValue(b), 5);
  });
});