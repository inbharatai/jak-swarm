import { describe, it, expect } from 'vitest';
import {
  AutonomyCapability,
  AutonomyLevel,
  HyperAgentMode,
} from '../../../packages/shared/src/types/hyperagent.js';
import {
  evaluateAutonomy,
  evaluateForConfig,
  validateRepairBudget,
  AutonomyPolicyService,
  autonomyPolicyService,
} from '../../../packages/security/src/governance/autonomy-policy.js';

describe('AutonomyPolicy — level capability matrix', () => {
  it('L0 permits only OBSERVE_REPORT', () => {
    const allowed = (Object.keys(AutonomyCapability) as AutonomyCapability[]).filter(
      (c) => evaluateAutonomy(AutonomyLevel.L0, c).allowed,
    );
    expect(allowed).toEqual([AutonomyCapability.OBSERVE_REPORT]);
  });

  it('L1 adds PROPOSE_REPAIRS + PROPOSE_LEARNINGS', () => {
    expect(evaluateAutonomy(AutonomyLevel.L1, AutonomyCapability.PROPOSE_REPAIRS).allowed).toBe(true);
    expect(evaluateAutonomy(AutonomyLevel.L1, AutonomyCapability.PROPOSE_LEARNINGS).allowed).toBe(true);
    // L1 must NOT yet retry/correct/replan.
    expect(evaluateAutonomy(AutonomyLevel.L1, AutonomyCapability.RETRY_SAFE_READONLY).allowed).toBe(false);
    expect(evaluateAutonomy(AutonomyLevel.L1, AutonomyCapability.CORRECT_OUTPUT).allowed).toBe(false);
    expect(evaluateAutonomy(AutonomyLevel.L1, AutonomyCapability.REPLAN_WITHIN_APPROVED).allowed).toBe(false);
  });

  it('L2 adds RETRY_SAFE_READONLY + CORRECT_OUTPUT', () => {
    expect(evaluateAutonomy(AutonomyLevel.L2, AutonomyCapability.RETRY_SAFE_READONLY).allowed).toBe(true);
    expect(evaluateAutonomy(AutonomyLevel.L2, AutonomyCapability.CORRECT_OUTPUT).allowed).toBe(true);
    expect(evaluateAutonomy(AutonomyLevel.L2, AutonomyCapability.REPLAN_WITHIN_APPROVED).allowed).toBe(false);
  });

  it('L3 adds REPLAN_WITHIN_APPROVED + PROPOSE_CONFIG_CHANGE', () => {
    expect(evaluateAutonomy(AutonomyLevel.L3, AutonomyCapability.REPLAN_WITHIN_APPROVED).allowed).toBe(true);
    expect(evaluateAutonomy(AutonomyLevel.L3, AutonomyCapability.PROPOSE_CONFIG_CHANGE).allowed).toBe(true);
    expect(evaluateAutonomy(AutonomyLevel.L3, AutonomyCapability.SHADOW_EXPERIMENT).allowed).toBe(false);
  });

  it('L4 adds SHADOW + CANARY + PROMOTE_CONFIG', () => {
    expect(evaluateAutonomy(AutonomyLevel.L4, AutonomyCapability.SHADOW_EXPERIMENT).allowed).toBe(true);
    expect(evaluateAutonomy(AutonomyLevel.L4, AutonomyCapability.CANARY_EXPERIMENT).allowed).toBe(true);
    expect(evaluateAutonomy(AutonomyLevel.L4, AutonomyCapability.PROMOTE_CONFIG).allowed).toBe(true);
    expect(evaluateAutonomy(AutonomyLevel.L4, AutonomyCapability.CODE_PATCH_BRANCH).allowed).toBe(false);
  });

  it('L5 adds CODE_PATCH_BRANCH (the highest safe capability)', () => {
    expect(evaluateAutonomy(AutonomyLevel.L5, AutonomyCapability.CODE_PATCH_BRANCH).allowed).toBe(true);
  });

  it('capabilities only add as level increases — no level loses a safe capability it gained', () => {
    // L5 must still permit everything L0-L4 permitted.
    for (const c of [
      AutonomyCapability.OBSERVE_REPORT,
      AutonomyCapability.PROPOSE_REPAIRS,
      AutonomyCapability.RETRY_SAFE_READONLY,
      AutonomyCapability.CORRECT_OUTPUT,
      AutonomyCapability.REPLAN_WITHIN_APPROVED,
      AutonomyCapability.SHADOW_EXPERIMENT,
      AutonomyCapability.CODE_PATCH_BRANCH,
    ] as AutonomyCapability[]) {
      expect(evaluateAutonomy(AutonomyLevel.L5, c).allowed, `${c} should be allowed at L5`).toBe(true);
    }
  });
});

describe('AutonomyPolicy — NEVER-autonomous capabilities (human-only at every level)', () => {
  const neverAutonomous: AutonomyCapability[] = [
    AutonomyCapability.MERGE_PR,
    AutonomyCapability.DEPLOY_PRODUCTION,
    AutonomyCapability.CHANGE_SECRETS,
    AutonomyCapability.APPROVE_PAYMENTS,
    AutonomyCapability.DELETE_PRODUCTION_DATA,
    AutonomyCapability.PUBLISH_EXTERNALLY,
    AutonomyCapability.EXPAND_PERMISSIONS,
    AutonomyCapability.MODIFY_GOVERNANCE,
  ];

  it.each(neverAutonomous)('blocks %s even at L5 and requires approval', (cap) => {
    const d = evaluateAutonomy(AutonomyLevel.L5, cap);
    expect(d.allowed).toBe(false);
    expect(d.requiresApproval).toBe(true);
  });

  it.each(neverAutonomous)('blocks %s at L0 too', (cap) => {
    expect(evaluateAutonomy(AutonomyLevel.L0, cap).allowed).toBe(false);
  });
});

describe('AutonomyPolicy — mode OFF', () => {
  it('inerts every capability except OBSERVE_REPORT', () => {
    for (const c of [
      AutonomyCapability.RETRY_SAFE_READONLY,
      AutonomyCapability.REPLAN_WITHIN_APPROVED,
      AutonomyCapability.CODE_PATCH_BRANCH,
    ] as AutonomyCapability[]) {
      const d = evaluateAutonomy(AutonomyLevel.L5, c, HyperAgentMode.OFF);
      expect(d.allowed, `${c} should be inert when mode=OFF`).toBe(false);
    }
    // Observation still allowed so the cockpit can render state.
    expect(evaluateAutonomy(AutonomyLevel.L0, AutonomyCapability.OBSERVE_REPORT, HyperAgentMode.OFF).allowed).toBe(true);
  });
});

describe('AutonomyPolicy — fail closed on unknown capability', () => {
  it('blocks + requires approval for a capability not in the matrix', () => {
    const d = evaluateAutonomy(AutonomyLevel.L5, 'NUKE_PRODUCTION' as AutonomyCapability);
    expect(d.allowed).toBe(false);
    expect(d.requiresApproval).toBe(true);
  });
});

describe('AutonomyPolicy — evaluateForConfig honours hyperAgentEnabled=false', () => {
  it('treats disabled config as OFF', () => {
    const d = evaluateForConfig(
      { hyperAgentEnabled: false, hyperAgentMode: HyperAgentMode.AUTONOMOUS_SAFE, autonomyLevel: AutonomyLevel.L5 },
      AutonomyCapability.REPLAN_WITHIN_APPROVED,
    );
    expect(d.allowed).toBe(false);
  });

  it('permits at-or-above min level when enabled', () => {
    const d = evaluateForConfig(
      { hyperAgentEnabled: true, hyperAgentMode: HyperAgentMode.ASSISTED, autonomyLevel: AutonomyLevel.L3 },
      AutonomyCapability.REPLAN_WITHIN_APPROVED,
    );
    expect(d.allowed).toBe(true);
  });
});

describe('AutonomyPolicy — RepairBudget validation', () => {
  const good = {
    maxExecutionRetries: 2,
    maxOutputRepairs: 2,
    maxPlanRepairs: 1,
    maxCapabilityRepairs: 1,
    maxTotalCostUsd: 5,
    maxDurationMs: 60000,
  };
  it('accepts a valid budget', () => {
    expect(validateRepairBudget(good)).toEqual([]);
  });
  it('rejects negative retries', () => {
    expect(validateRepairBudget({ ...good, maxExecutionRetries: -1 })).toContain(
      'maxExecutionRetries must be >= 0',
    );
  });
  it('rejects NaN cost', () => {
    expect(validateRepairBudget({ ...good, maxTotalCostUsd: Number.NaN }).length).toBeGreaterThan(0);
  });
});

describe('AutonomyPolicyService — injectable wrapper', () => {
  it('delegates to the pure evaluator', () => {
    const svc = new AutonomyPolicyService();
    expect(svc.evaluate(AutonomyLevel.L3, AutonomyCapability.REPLAN_WITHIN_APPROVED).allowed).toBe(true);
    expect(svc.evaluate(AutonomyLevel.L2, AutonomyCapability.REPLAN_WITHIN_APPROVED).allowed).toBe(false);
  });
  it('singleton is usable', () => {
    expect(autonomyPolicyService.evaluate(AutonomyLevel.L0, AutonomyCapability.OBSERVE_REPORT).allowed).toBe(true);
  });
});