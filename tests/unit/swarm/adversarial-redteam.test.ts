/**
 * adversarial-redteam.test.ts — HyperAgent Phase 7 innovation #4 (self-red-team).
 *
 * Pins the adversary invariants:
 *   - attacks the validator CATCHES (unknown tool, cycle) are not breakthroughs;
 *   - an attack the validator lets through that is independently UNSAFE (silent
 *     risk increase) is a BREAKTHROUGH ⇒ the plan did not survive;
 *   - a custom safety oracle can flag additional mutations (e.g. duplicate ids);
 *   - with a permissive oracle, a plan with no breakthroughs survives;
 *   - not-applicable attacks (e.g. DROP_APPROVAL when nothing is gated) are skipped.
 */
import { describe, it, expect } from 'vitest';
import { AgentRole, RiskLevel, TaskStatus } from '../../../packages/shared/src/index.js';
import type { WorkflowPlan, WorkflowTask } from '../../../packages/shared/src/index.js';
import type { PlanValidationContext } from '../../../packages/swarm/src/hyperagent/plan-validator.js';
import {
  redTeamPlan,
  survivesRedTeam,
  RedTeamStrategy,
} from '../../../packages/swarm/src/hyperagent/adversarial-redteam.js';

function task(over: Partial<WorkflowTask> & { id: string }): WorkflowTask {
  return {
    name: `task-${over.id}`,
    description: 'd',
    agentRole: AgentRole.WORKER_RESEARCH,
    toolsRequired: ['web_search'],
    riskLevel: RiskLevel.LOW,
    requiresApproval: false,
    status: TaskStatus.PENDING,
    dependsOn: [],
    retryable: true,
    maxRetries: 2,
    ...over,
  } as WorkflowTask;
}

function plan(tasks: WorkflowTask[]): WorkflowPlan {
  return {
    id: 'plan-1', name: 'p', goal: 'g', industry: 'general', tasks,
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function ctx(previousPlan: WorkflowPlan): PlanValidationContext {
  return {
    knownToolNames: new Set(['web_search', 'email_send', 'alt_tool']),
    permittedTools: new Set(['web_search', 'email_send', 'alt_tool']),
    permittedAgents: new Set([AgentRole.WORKER_RESEARCH]),
    completedExternalTaskIds: new Set(),
    previousPlan,
    maxTasks: 20,
  };
}

const basePlan = () => plan([task({ id: 'a' }), task({ id: 'b', dependsOn: ['a'] })]);

describe('redTeamPlan — default oracle', () => {
  const r = redTeamPlan({ plan: basePlan(), ctx: ctx(basePlan()) });

  it('catches the unknown-tool attack (validator)', () => {
    const swap = r.attacks.find((x) => x.strategy === RedTeamStrategy.SWAP_TO_UNKNOWN_TOOL)!;
    expect(swap.applicable).toBe(true);
    expect(swap.mutatedPlanValid).toBe(false);
    expect(swap.breakthrough).toBe(false);
  });

  it('catches the introduced cycle (validator)', () => {
    const cyc = r.attacks.find((x) => x.strategy === RedTeamStrategy.INTRODUCE_CYCLE)!;
    expect(cyc.mutatedPlanValid).toBe(false);
    expect(cyc.breakthrough).toBe(false);
  });

  it('flags the silent risk increase as a BREAKTHROUGH (validator gap)', () => {
    const inflate = r.attacks.find((x) => x.strategy === RedTeamStrategy.INFLATE_RISK_TO_CRITICAL)!;
    expect(inflate.applicable).toBe(true);
    expect(inflate.mutatedPlanValid).toBe(true); // validator only checks risk DECREASES
    expect(inflate.breakthrough).toBe(true);
    expect(inflate.detail).toMatch(/silent risk increase/);
  });

  it('does NOT flag a duplicate-id mutation as a breakthrough (malformedness, not safety)', () => {
    const dup = r.attacks.find((x) => x.strategy === RedTeamStrategy.DUPLICATE_TASK_ID)!;
    expect(dup.mutatedPlanValid).toBe(true);
    expect(dup.breakthrough).toBe(false);
  });

  it('skips the drop-approval attack when nothing is gated', () => {
    const drop = r.attacks.find((x) => x.strategy === RedTeamStrategy.DROP_APPROVAL_FLAG)!;
    expect(drop.applicable).toBe(false);
  });

  it('reports the plan did NOT survive (one breakthrough)', () => {
    expect(r.breakthroughs).toBe(1);
    expect(r.survived).toBe(false);
    expect(survivesRedTeam({ plan: basePlan(), ctx: ctx(basePlan()) })).toBe(false);
  });
});

describe('redTeamPlan — custom oracle', () => {
  it('survives when an injected oracle considers every mutation safe', () => {
    const r = redTeamPlan({ plan: basePlan(), ctx: ctx(basePlan()), isUnsafe: () => null });
    expect(r.breakthroughs).toBe(0);
    expect(r.survived).toBe(true);
  });

  it('flags a duplicate-id mutation as a breakthrough when the oracle says so', () => {
    const r = redTeamPlan({
      plan: basePlan(),
      ctx: ctx(basePlan()),
      isUnsafe: (mutated) => {
        const ids = mutated.tasks.map((t) => t.id);
        return new Set(ids).size !== ids.length ? 'duplicate task id' : null;
      },
    });
    const dup = r.attacks.find((x) => x.strategy === RedTeamStrategy.DUPLICATE_TASK_ID)!;
    expect(dup.breakthrough).toBe(true);
    expect(r.survived).toBe(false);
  });

  it('honours a restricted strategy set', () => {
    const r = redTeamPlan({
      plan: basePlan(),
      ctx: ctx(basePlan()),
      strategies: [RedTeamStrategy.SWAP_TO_UNKNOWN_TOOL],
    });
    expect(r.attacks).toHaveLength(1);
    expect(r.attacks[0].strategy).toBe(RedTeamStrategy.SWAP_TO_UNKNOWN_TOOL);
  });
});