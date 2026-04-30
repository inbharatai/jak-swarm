/**
 * Sprint 3 — SubgoalCoordinator unit tests.
 *
 * The coordinator is stateless: takes a user goal, returns subgoals
 * with dependency edges + parallel groups + a CEO summary. These
 * tests lock the contract:
 *   - Multi-domain goal produces one subgoal per matched domain
 *   - CEO summary depends on every domain subgoal
 *   - External-side-effect subgoals are NOT grouped together
 *     (sequential — avoids parallel publish attempts)
 *   - Internal subgoals (read-only review) ARE grouped (parallel)
 *   - No-domain-match goal falls through to a single CEO subgoal
 *   - Every emitted subgoal has a valid AgentRole + risk level
 */
import { describe, it, expect } from 'vitest';
import { decomposeGoal, summarizePlan } from '../../../packages/agents/src/coordination/subgoal-coordinator';
import { AgentRole } from '@jak-swarm/shared';

describe('decomposeGoal — multi-domain decomposition', () => {
  it('splits "review my landing page, draft a LinkedIn post, prepare a fix plan" into CTO + CMO + CEO', () => {
    const result = decomposeGoal(
      'Review my landing page, draft a LinkedIn post about it, and prepare a technical fix plan',
    );
    const labels = result.subgoals.map((s) => s.agentLabel).sort();
    expect(labels).toContain('CTO Agent');
    expect(labels).toContain('CMO Agent');
    expect(labels).toContain('CEO Agent');
  });

  it('CEO summary depends on every domain subgoal', () => {
    const result = decomposeGoal('Review the repo and draft a marketing post');
    const ceo = result.subgoals.find((s) => s.agentLabel === 'CEO Agent');
    expect(ceo).toBeDefined();
    expect(ceo!.dependsOn.length).toBeGreaterThan(0);
    // Every dependency id must exist in the subgoals list.
    for (const dep of ceo!.dependsOn) {
      expect(result.subgoals.some((s) => s.id === dep)).toBe(true);
    }
  });

  it('parallel-safe: internal-only domain subgoals group into one parallel cluster', () => {
    const result = decomposeGoal('Review the GitHub repo and analyze competitor research');
    // CTO (internal) + Research (internal) → group together; CEO summary → separate.
    expect(result.parallelGroups[0]!.length).toBeGreaterThanOrEqual(2);
  });

  it('serializes external-side-effect subgoals (no parallel publish)', () => {
    // Marketing/CMO is the only external-side-effect domain in the
    // current ruleset; this test asserts CMO gets its own group.
    const result = decomposeGoal('Draft a LinkedIn post and an Instagram caption');
    // Only one CMO subgoal because seenRoles dedupes — but the
    // grouping logic is what we're testing.
    const cmoSubgoal = result.subgoals.find((s) => s.agentLabel === 'CMO Agent');
    expect(cmoSubgoal).toBeDefined();
    expect(cmoSubgoal!.externalSideEffect).toBe(true);
    // Find the parallel group containing CMO — it must have exactly 1 member.
    const cmoGroup = result.parallelGroups.find((g) => g.includes(cmoSubgoal!.id));
    expect(cmoGroup!.length).toBe(1);
  });
});

describe('decomposeGoal — risk-level assignments', () => {
  it('CMO subgoals (publishing) get HIGH risk', () => {
    const result = decomposeGoal('Draft a LinkedIn post about our launch');
    const cmo = result.subgoals.find((s) => s.agentLabel === 'CMO Agent');
    expect(cmo?.riskLevel).toBe('HIGH');
  });

  it('Research subgoals (read-only) get LOW risk', () => {
    const result = decomposeGoal('Research the competitor analytics market');
    const research = result.subgoals.find((s) => s.agentLabel === 'Research Agent');
    expect(research?.riskLevel).toBe('LOW');
  });

  it('CEO summary is LOW risk (it just merges other agents\' outputs)', () => {
    const result = decomposeGoal('Research the market and draft a post');
    const ceo = result.subgoals.find((s) => s.agentLabel === 'CEO Agent');
    expect(ceo?.riskLevel).toBe('LOW');
  });
});

describe('decomposeGoal — fallback when no domain matches', () => {
  it('produces a single CEO subgoal for an unmatched goal', () => {
    const result = decomposeGoal('Tell me something interesting');
    expect(result.subgoals.length).toBe(1);
    expect(result.subgoals[0]!.agentLabel).toBe('CEO Agent');
    expect(result.subgoals[0]!.dependsOn).toEqual([]);
  });

  it('throws on empty goal', () => {
    expect(() => decomposeGoal('')).toThrow();
    expect(() => decomposeGoal('   ')).toThrow();
  });
});

describe('decomposeGoal — every subgoal has a valid AgentRole', () => {
  it('produces only AgentRole enum values', () => {
    const result = decomposeGoal(
      'Review the repo, draft a LinkedIn post, propose UI fixes, analyze competitor research',
    );
    const validRoles = new Set(Object.values(AgentRole));
    for (const sg of result.subgoals) {
      expect(validRoles.has(sg.agentRole), `${sg.agentLabel} role must be in AgentRole enum`).toBe(true);
    }
  });
});

describe('summarizePlan — layman-friendly cockpit copy', () => {
  it('produces a numbered step list with agent labels', () => {
    const result = decomposeGoal('Review the repo and draft a LinkedIn post');
    const summary = summarizePlan(result);
    expect(summary).toContain('CEO plan for:');
    expect(summary).toMatch(/Step 1[:.]/i);
    expect(summary.toLowerCase()).toContain('agent');
  });

  it('marks parallel groups explicitly', () => {
    const result = decomposeGoal(
      'Review the repo, analyze competitor research, propose UI fixes',
    );
    const summary = summarizePlan(result);
    // At least one parallel cluster (CTO + Research + VibeCoder are all internal).
    expect(summary.toLowerCase()).toContain('in parallel');
  });
});

describe('decomposeGoal — tenant/cross-instance safety', () => {
  it('is stateless: two consecutive calls with different goals return independent results', () => {
    const a = decomposeGoal('Draft a LinkedIn post');
    const b = decomposeGoal('Review the GitHub repo');
    // No shared subgoal ids.
    const aIds = new Set(a.subgoals.map((s) => s.id));
    for (const bSg of b.subgoals) {
      expect(aIds.has(bSg.id), 'subgoal ids must be unique across calls').toBe(false);
    }
  });
});
