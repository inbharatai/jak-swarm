/**
 * control-centre.test.ts — HyperAgent Phase 13 pure aggregation core.
 *
 * Pins the honesty invariants the spec mandates ("No fake graphs, placeholder
 * percentages, sample success rates or fabricated 'all systems healthy'
 * states"):
 *   - empty input ⇒ dataAvailable=false, counts 0, honest note (never "healthy");
 *   - real input ⇒ real counts + real buckets (never sampled/fabricated);
 *   - `dataAvailable` is `true` iff a backing row exists (never clock/default);
 *   - roadmap flags (`benchmarksPersisted`, `decisionsPersisted`, `controlsWired`)
 *     default conservative and only surface data when the caller raises them.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateOverview,
  aggregateRuns,
  aggregateLearnings,
  aggregateOptimizations,
  aggregateExperiments,
  aggregateGovernance,
  aggregateAgentFleet,
  aggregateAutonomy,
  aggregateShield,
} from '../../../packages/swarm/src/hyperagent/control-centre.js';
import type {
  OutcomeInput,
  DiagnosisInput,
  RepairInput,
  PlanVersionInput,
  LearningInput,
  ConfigVersionInput,
  RolloutEventInput,
  HyperAgentConfigInput,
  AgentTraceInput,
  ShieldAuditInput,
} from '../../../packages/swarm/src/hyperagent/control-centre.js';

const T = '2026-07-08T12:00:00.000Z';
const date = (s: string) => new Date(s);

const cfg = (over: Partial<HyperAgentConfigInput> = {}): HyperAgentConfigInput => ({
  hyperAgentEnabled: true,
  hyperAgentMode: 'ASSISTED',
  autonomyLevel: 'L2',
  maxExecutionRetries: 2,
  maxOutputRepairs: 2,
  maxPlanRepairs: 1,
  maxCapabilityRepairs: 1,
  maxTotalCostUsd: 5,
  maxDurationMs: 60000,
  allowShadowOptimization: true,
  allowCanaryOptimization: true,
  allowCodePatchProposal: false,
  requireApprovalForPromptPromotion: true,
  requireApprovalForWorkflowPromotion: true,
  updatedAt: date(T),
  ...over,
});

const outcome = (over: Partial<OutcomeInput> = {}): OutcomeInput => ({
  workflowId: 'w1',
  outcome: 'OUTCOME_SUCCESS',
  taskTotal: 3,
  taskPassed: 3,
  taskFailed: 0,
  taskBlocked: 0,
  totalCostUsd: 0.12,
  durationMs: 5000,
  createdAt: date(T),
  ...over,
});

const diagnosis = (over: Partial<DiagnosisInput> = {}): DiagnosisInput => ({
  id: 'd1',
  workflowId: 'w1',
  taskId: 't1',
  failureClass: 'TOOL_TIMEOUT',
  recommendedRepairLevel: 'R2',
  deterministicBlock: false,
  confidence: 1.0,
  requiresApproval: false,
  quarantine: false,
  rootCause: null,
  createdAt: date(T),
  ...over,
});

const repair = (over: Partial<RepairInput> = {}): RepairInput => ({
  id: 'r1',
  kind: 'BUG_FIX',
  status: 'PR_DRAFT',
  risk: 'LOW',
  safetyClass: 'NEEDS_REVIEW',
  branchName: 'hyperagent/r5-bug_fix-r1',
  prUrl: null,
  prNumber: null,
  description: 'fix null deref',
  createdAt: date(T),
  ...over,
});

const planVersion = (over: Partial<PlanVersionInput> = {}): PlanVersionInput => ({
  id: 'p1',
  workflowId: 'w1',
  version: 1,
  changeReason: 'replaced failed worker',
  repairType: 'REPLACE_AGENT',
  createdAt: date(T),
  ...over,
});

const learning = (over: Partial<LearningInput> = {}): LearningInput => ({
  id: 'l1',
  key: 'cfg:grounding:WORKER_RESEARCH:web_search',
  kind: 'POLICY',
  source: 'OUTCOME',
  status: 'CANDIDATE',
  summary: 'prefer web_search for fresh data',
  failureClass: null,
  confidence: 0.4,
  mutualInformation: null,
  promotedAt: null,
  expiredAt: null,
  createdAt: date(T),
  ...over,
});

const configVersion = (over: Partial<ConfigVersionInput> = {}): ConfigVersionInput => ({
  id: 'c1',
  kind: 'TOOL_POLICY',
  version: 1,
  status: 'SHADOW',
  rolloutPercent: 0,
  changeReason: 'tighten web_search rate',
  evaluationSummary: null,
  createdAt: date(T),
  proposedAt: date(T),
  shadowStartedAt: date(T),
  canaryStartedAt: null,
  promotedAt: null,
  rolledBackAt: null,
  ...over,
});

// ─── Overview ───────────────────────────────────────────────────────────────

describe('aggregateOverview — honesty', () => {
  it('empty input → dataAvailable=false, zero counts, honest note (never "healthy")', () => {
    const v = aggregateOverview({ config: null, outcomes: [], planVersions: [], repairs: [], learnings: [] });
    expect(v.dataAvailable).toBe(false);
    expect(v.mode.dataAvailable).toBe(false);
    expect(v.mode.hyperAgentMode).toBe('OFF');
    expect(v.totalOutcomes).toBe(0);
    expect(v.planVersions).toBe(0);
    expect(v.outcomesByVerdict).toEqual([]);
    expect(v.repairsByStatus).toEqual([]);
    expect(v.learningsByStatus).toEqual([]);
    expect(v.note).toMatch(/No HyperAgent data yet/);
    expect(v.note).not.toMatch(/healthy|all systems/i);
  });

  it('config present but no rows → dataAvailable=true, honest "not configured" note when config null', () => {
    const v = aggregateOverview({ config: cfg(), outcomes: [], planVersions: [], repairs: [], learnings: [] });
    expect(v.dataAvailable).toBe(true);
    expect(v.mode.dataAvailable).toBe(true);
    expect(v.mode.hyperAgentMode).toBe('ASSISTED');
    expect(v.note).toBeNull();
  });

  it('rows without config → dataAvailable=true, "not configured" note', () => {
    const v = aggregateOverview({ config: null, outcomes: [outcome()], planVersions: [], repairs: [], learnings: [] });
    expect(v.dataAvailable).toBe(true);
    expect(v.mode.dataAvailable).toBe(false);
    expect(v.note).toMatch(/not configured/);
  });

  it('real buckets — counts are real, sorted by count desc then key asc', () => {
    const v = aggregateOverview({
      config: cfg(),
      outcomes: [
        outcome({ outcome: 'OUTCOME_SUCCESS' }),
        outcome({ outcome: 'OUTCOME_SUCCESS', workflowId: 'w2' }),
        outcome({ outcome: 'OUTCOME_FAILED', workflowId: 'w3' }),
      ],
      planVersions: [planVersion({ version: 2 }), planVersion({ version: 5, id: 'p2' })],
      repairs: [repair({ status: 'PR_DRAFT' }), repair({ status: 'MERGED', id: 'r2' })],
      learnings: [],
    });
    expect(v.totalOutcomes).toBe(3);
    expect(v.outcomesByVerdict).toEqual([
      { key: 'OUTCOME_SUCCESS', count: 2 },
      { key: 'OUTCOME_FAILED', count: 1 },
    ]);
    expect(v.planVersions).toBe(5); // max version
    expect(v.repairsByStatus).toEqual([
      { key: 'MERGED', count: 1 },
      { key: 'PR_DRAFT', count: 1 },
    ]); // tie → key asc
  });
});

// ─── Runs ───────────────────────────────────────────────────────────────────

describe('aggregateRuns — honesty', () => {
  it('empty → dataAvailable=false, zeros, honest note', () => {
    const v = aggregateRuns({ outcomes: [], diagnoses: [], repairs: [] });
    expect(v.dataAvailable).toBe(false);
    expect(v.totalOutcomes).toBe(0);
    expect(v.repairsAttempted).toBe(0);
    expect(v.note).toMatch(/No workflow outcomes/);
  });

  it('repairsAttempted excludes terminal human-only states', () => {
    const v = aggregateRuns({
      outcomes: [],
      diagnoses: [],
      repairs: [
        repair({ status: 'DRAFT' }),
        repair({ status: 'BRANCH_CREATED', id: 'r2' }),
        repair({ status: 'PR_DRAFT', id: 'r3' }),
        repair({ status: 'MERGED', id: 'r4' }),
        repair({ status: 'REJECTED', id: 'r5' }),
        repair({ status: 'ABANDONED', id: 'r6' }),
      ],
    });
    expect(v.totalRepairs).toBe(6);
    expect(v.repairsAttempted).toBe(3); // DRAFT + BRANCH_CREATED + PR_DRAFT
  });

  it('maps rows faithfully with ISO timestamps', () => {
    const v = aggregateRuns({ outcomes: [outcome()], diagnoses: [diagnosis()], repairs: [repair()] });
    expect(v.outcomes[0]?.workflowId).toBe('w1');
    expect(v.diagnoses[0]?.failureClass).toBe('TOOL_TIMEOUT');
    expect(v.repairs[0]?.branchName).toMatch(/^hyperagent\/r5-/);
    expect(v.outcomes[0]?.createdAt).toBe(T);
  });
});

// ─── Learnings ──────────────────────────────────────────────────────────────

describe('aggregateLearnings — honesty', () => {
  it('empty → dataAvailable=false, impactMeasured=false', () => {
    const v = aggregateLearnings({ learnings: [] });
    expect(v.dataAvailable).toBe(false);
    expect(v.impactMeasured).toBe(false);
    expect(v.promotedWithMeasuredImpact).toBe(0);
    expect(v.note).toMatch(/No learning records/);
  });

  it('partitions by status; impact measured only when a promoted learning has MI', () => {
    const v = aggregateLearnings({
      learnings: [
        learning({ status: 'CANDIDATE' }),
        learning({ status: 'PROMOTED', id: 'l2', mutualInformation: 0.31, promotedAt: date(T) }),
        learning({ status: 'PROMOTED', id: 'l3', mutualInformation: null }),
        learning({ status: 'EXPIRED', id: 'l4', expiredAt: date(T) }),
      ],
    });
    expect(v.candidates).toHaveLength(1);
    expect(v.promoted).toHaveLength(2);
    expect(v.deprecatedOrExpired).toHaveLength(1);
    expect(v.promotedWithMeasuredImpact).toBe(1);
    expect(v.impactMeasured).toBe(true);
  });

  it('impactMeasured stays false when promoted learnings lack MI', () => {
    const v = aggregateLearnings({ learnings: [learning({ status: 'PROMOTED', mutualInformation: null, promotedAt: date(T) })] });
    expect(v.impactMeasured).toBe(false);
    expect(v.promotedWithMeasuredImpact).toBe(0);
  });
});

// ─── Optimizations ──────────────────────────────────────────────────────────

describe('aggregateOptimizations — honesty', () => {
  it('empty + benchmarksPersisted=false → empty benchmarks, honest roadmap note', () => {
    const v = aggregateOptimizations({ configVersions: [], planVersions: [], benchmarks: [], benchmarksPersisted: false });
    expect(v.dataAvailable).toBe(false);
    expect(v.benchmarksPersisted).toBe(false);
    expect(v.benchmarks).toEqual([]);
    expect(v.note).toMatch(/Benchmark results are not yet persisted/);
  });

  it('does NOT fabricate benchmarks when benchmarksPersisted=false even if rows passed', () => {
    const v = aggregateOptimizations({
      configVersions: [],
      planVersions: [],
      benchmarks: [{ scenarioId: 'x', passed: true, durationMs: 1, costUsd: 0, runAt: T }],
      benchmarksPersisted: false,
    });
    expect(v.benchmarks).toEqual([]); // conservative — caller lied, we don't surface
    expect(v.dataAvailable).toBe(false);
  });

  it('surfaces benchmarks only when benchmarksPersisted=true', () => {
    const v = aggregateOptimizations({
      configVersions: [],
      planVersions: [],
      benchmarks: [{ scenarioId: 'x', passed: true, durationMs: 1, costUsd: 0, runAt: T }],
      benchmarksPersisted: true,
    });
    expect(v.benchmarks).toHaveLength(1);
    expect(v.dataAvailable).toBe(true);
  });

  it('diffs merge plan + config changeReasons, newest first', () => {
    const v = aggregateOptimizations({
      configVersions: [configVersion({ changeReason: 'cfg change', createdAt: date('2026-07-08T10:00:00.000Z') })],
      planVersions: [planVersion({ changeReason: 'plan change', createdAt: date('2026-07-08T12:00:00.000Z') })],
      benchmarks: [],
      benchmarksPersisted: false,
    });
    expect(v.diffs).toHaveLength(2);
    expect(v.diffs[0]?.source).toBe('plan'); // newer
    expect(v.diffs[1]?.source).toBe('config');
  });
});

// ─── Experiments ────────────────────────────────────────────────────────────

describe('aggregateExperiments — honesty', () => {
  it('empty → dataAvailable=false, honest note', () => {
    const v = aggregateExperiments({ configVersions: [], rolloutEvents: [], controlsWired: false });
    expect(v.dataAvailable).toBe(false);
    expect(v.controlsWired).toBe(false);
    expect(v.inShadow).toEqual([]);
    expect(v.note).toMatch(/No versioned experiments/);
  });

  it('partitions by lifecycle stage + sorts rollout events newest first', () => {
    const v = aggregateExperiments({
      configVersions: [
        configVersion({ id: 'c1', status: 'SHADOW' }),
        configVersion({ id: 'c2', status: 'CANARY', rolloutPercent: 5 }),
        configVersion({ id: 'c3', status: 'PROMOTED', rolloutPercent: 100, promotedAt: date(T) }),
        configVersion({ id: 'c4', status: 'ROLLED_BACK', rolledBackAt: date(T) }),
      ],
      rolloutEvents: [
        { id: 'e1', configVersionId: 'c1', fromStatus: 'PROPOSED', toStatus: 'SHADOW', stage: 'SHADOW', decision: 'ADVANCE', rolloutPercent: 0, reason: 'start shadow', occurredAt: date('2026-07-08T10:00:00.000Z') },
        { id: 'e2', configVersionId: 'c1', fromStatus: 'SHADOW', toStatus: 'CANARY', stage: 'CANARY', decision: 'ADVANCE', rolloutPercent: 5, reason: 'ramp', occurredAt: date('2026-07-08T12:00:00.000Z') },
      ],
      controlsWired: true,
    });
    expect(v.inShadow).toHaveLength(1);
    expect(v.inCanary).toHaveLength(1);
    expect(v.promoted).toHaveLength(1);
    expect(v.rolledBack).toHaveLength(1);
    expect(v.rolloutEvents[0]?.id).toBe('e2'); // newest first
    expect(v.controlsWired).toBe(true);
  });
});

// ─── Governance ─────────────────────────────────────────────────────────────

describe('aggregateGovernance — honesty', () => {
  it('empty → dataAvailable=false, honest note', () => {
    const v = aggregateGovernance({ diagnoses: [], configVersions: [] });
    expect(v.dataAvailable).toBe(false);
    expect(v.totalViolations).toBe(0);
    expect(v.note).toMatch(/No governance violations/);
  });

  it('surfaces ONLY security-class failures as violations + GOVERNANCE_RULE configs as rules', () => {
    const v = aggregateGovernance({
      diagnoses: [
        diagnosis({ failureClass: 'PERMISSION_DENIED', id: 'd1' }),
        diagnosis({ failureClass: 'TOOL_TIMEOUT', id: 'd2' }),
        diagnosis({ failureClass: 'PROMPT_INJECTION', id: 'd3', quarantine: true }),
      ],
      configVersions: [
        configVersion({ kind: 'GOVERNANCE_RULE', id: 'c1' }),
        configVersion({ kind: 'TOOL_POLICY', id: 'c2' }),
      ],
    });
    expect(v.violations).toHaveLength(2); // PERMISSION_DENIED + PROMPT_INJECTION
    expect(v.violations[0]?.failureClass).toBe('PERMISSION_DENIED');
    expect(v.violations[1]?.quarantine).toBe(true);
    expect(v.rules).toHaveLength(1);
    expect(v.totalViolations).toBe(2);
    expect(v.totalRules).toBe(1);
  });
});

// ─── Agent fleet ────────────────────────────────────────────────────────────

describe('aggregateAgentFleet — honesty', () => {
  it('empty → dataAvailable=false, honest note', () => {
    const v = aggregateAgentFleet({ traces: [] });
    expect(v.dataAvailable).toBe(false);
    expect(v.totalTraces).toBe(0);
    expect(v.byRole).toEqual([]);
    expect(v.note).toMatch(/No agent traces/);
  });

  it('aggregates real per-role counts + median duration, sorts by total desc', () => {
    const traces: AgentTraceInput[] = [
      { agentRole: 'WORKER_RESEARCH', durationMs: 100, error: null, createdAt: date(T) },
      { agentRole: 'WORKER_RESEARCH', durationMs: 300, error: 'boom', createdAt: date(T) },
      { agentRole: 'WORKER_RESEARCH', durationMs: 200, error: null, createdAt: date(T) },
      { agentRole: 'WORKER_EMAIL', durationMs: 50, error: null, createdAt: date(T) },
      { agentRole: null, durationMs: null, error: null, createdAt: date(T) },
    ];
    const v = aggregateAgentFleet({ traces });
    expect(v.totalTraces).toBe(5);
    expect(v.byRole[0]?.agentRole).toBe('WORKER_RESEARCH');
    expect(v.byRole[0]?.totalRuns).toBe(3);
    expect(v.byRole[0]?.failedRuns).toBe(1);
    expect(v.byRole[0]?.medianDurationMs).toBe(200); // median of [100,200,300]
    // total=1 tie between WORKER_EMAIL and UNKNOWN → key asc: UNKNOWN first.
    expect(v.byRole[1]?.agentRole).toBe('UNKNOWN');
    expect(v.byRole[2]?.agentRole).toBe('WORKER_EMAIL');
  });
});

// ─── Autonomy ───────────────────────────────────────────────────────────────

describe('aggregateAutonomy — honesty', () => {
  it('no config + no outcomes → dataAvailable=false, OFF/L0 defaults, honest note', () => {
    const v = aggregateAutonomy({ config: null, outcomes: [] });
    expect(v.dataAvailable).toBe(false);
    expect(v.config.dataAvailable).toBe(false);
    expect(v.config.hyperAgentMode).toBe('OFF');
    expect(v.config.autonomyLevel).toBe('L0');
    expect(v.config.requireApprovalForPromptPromotion).toBe(true); // fail-closed default
    expect(v.note).toMatch(/No autonomy configuration/);
  });

  it('config present → faithful snapshot + dataAvailable=true', () => {
    const v = aggregateAutonomy({ config: cfg({ autonomyLevel: 'L4', allowCodePatchProposal: true }), outcomes: [] });
    expect(v.config.dataAvailable).toBe(true);
    expect(v.config.autonomyLevel).toBe('L4');
    expect(v.config.allowCodePatchProposal).toBe(true);
    expect(v.config.updatedAt).toBe(T);
  });
});

// ─── Shield ─────────────────────────────────────────────────────────────────

describe('aggregateShield — honesty', () => {
  it('empty + decisionsPersisted=false → honest roadmap note about the missing store', () => {
    const v = aggregateShield({ decisions: [], decisionsPersisted: false });
    expect(v.dataAvailable).toBe(false);
    expect(v.decisionsPersisted).toBe(false);
    expect(v.total).toBe(0);
    expect(v.note).toMatch(/persisted shield_decisions table is roadmap/);
  });

  it('empty + decisionsPersisted=true → honest "no decisions yet" note', () => {
    const v = aggregateShield({ decisions: [], decisionsPersisted: true });
    expect(v.dataAvailable).toBe(false);
    expect(v.note).toMatch(/No Shield decisions recorded/);
    expect(v.note).not.toMatch(/roadmap/);
  });

  it('real decisions → real verdict buckets', () => {
    const decisions: ShieldAuditInput[] = [
      { auditEventId: 'a1', verdict: 'ALLOW', subjectKind: 'tool', tenantId: 't1', issuedAt: date(T) },
      { auditEventId: 'a2', verdict: 'ALLOW', subjectKind: 'tool', tenantId: 't1', issuedAt: date(T) },
      { auditEventId: 'a3', verdict: 'BLOCK', subjectKind: 'tool', tenantId: 't1', issuedAt: date(T) },
    ];
    const v = aggregateShield({ decisions, decisionsPersisted: true });
    expect(v.total).toBe(3);
    expect(v.byVerdict).toEqual([
      { key: 'ALLOW', count: 2 },
      { key: 'BLOCK', count: 1 },
    ]);
    expect(v.decisions[0]?.verdict).toBe('ALLOW');
    expect(v.note).toBeNull();
  });
});