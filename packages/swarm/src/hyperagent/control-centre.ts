/**
 * control-centre.ts — HyperAgent Phase 13 pure aggregation core.
 *
 * The Control Centre is an OPERATIONAL dashboard over REAL backend data only.
 * This module is the honesty boundary: deterministic functions that shape
 * Prisma-row-shaped inputs into the shared view models
 * (`@jak-swarm/shared` control-centre types). It performs NO I/O, reads NO
 * clock, and fabricates NOTHING. When an input list is empty the output is an
 * honest empty view (`dataAvailable: false`, counts 0, a `note` that says so).
 *
 * The API route (apps/api/src/routes/hyperagent.routes.ts) selects real rows
 * from Prisma, maps them to these input shapes, calls the aggregators, stamps
 * `generatedAt` from the request clock, and returns `ok(view)`. The web
 * renders the view or an honest empty state — never a fabricated "all healthy".
 *
 * Honesty invariants enforced here + pinned by tests:
 *   - `dataAvailable` is `true` iff at least one backing row exists. NEVER a
 *     hardcoded default, NEVER derived from a clock.
 *   - Every count is `rows.length` or a real bucket sum. NEVER a sample.
 *   - `note` is `null` when data exists; an honest explanation when empty OR
 *     when the surface's backing store is not yet wired (roadmap).
 *   - `benchmarksPersisted` / `decisionsPersisted` / `controlsWired` are
 *     constant flags the API may lower to `true` only when the backing write
 *     path exists; the defaults here are the conservative (not-yet-wired)
 *     values so a misconfigured caller cannot accidentally fabricate.
 */
import type {
  AgentFleetStatsRow,
  AgentFleetView,
  AutonomyConfigRow,
  AutonomyDecisionRow,
  AutonomyView,
  BenchmarkResultRow,
  DiagnosisRow,
  DiffRow,
  ExperimentRow,
  ExperimentsView,
  GovernanceRuleRow,
  GovernanceView,
  GovernanceViolationRow,
  HonestBucket,
  HyperAgentModeSnapshot,
  LearningsView,
  LearningRow,
  OptimizationProposalRow,
  OptimizationsView,
  OutcomeRow,
  OverviewView,
  RepairRow,
  RolloutEventRow,
  RunsView,
  ShieldDecisionRow,
  ShieldView,
} from '@jak-swarm/shared';

// ─── Input row shapes (match the Prisma `select` the API route uses) ────────

export interface OutcomeInput {
  workflowId: string;
  outcome: string;
  taskTotal: number;
  taskPassed: number;
  taskFailed: number;
  taskBlocked: number;
  totalCostUsd: number;
  durationMs: number;
  createdAt: Date | string;
}

export interface DiagnosisInput {
  id: string;
  workflowId: string;
  taskId: string;
  failureClass: string;
  recommendedRepairLevel: string;
  deterministicBlock: boolean;
  confidence: number;
  requiresApproval: boolean;
  quarantine: boolean;
  rootCause: string | null;
  createdAt: Date | string;
}

export interface RepairInput {
  id: string;
  kind: string;
  status: string;
  risk: string;
  safetyClass: string;
  branchName: string;
  prUrl: string | null;
  prNumber: number | null;
  description: string;
  createdAt: Date | string;
}

export interface PlanVersionInput {
  id: string;
  workflowId: string;
  version: number;
  changeReason: string;
  repairType: string | null;
  createdAt: Date | string;
}

export interface LearningInput {
  id: string;
  key: string;
  kind: string;
  source: string;
  status: string;
  summary: string;
  failureClass: string | null;
  confidence: number;
  mutualInformation: number | null;
  promotedAt: Date | string | null;
  expiredAt: Date | string | null;
  createdAt: Date | string;
}

export interface ConfigVersionInput {
  id: string;
  kind: string;
  version: number;
  status: string;
  rolloutPercent: number;
  changeReason: string | null;
  evaluationSummary: string | null;
  createdAt: Date | string;
  proposedAt: Date | string | null;
  shadowStartedAt: Date | string | null;
  canaryStartedAt: Date | string | null;
  promotedAt: Date | string | null;
  rolledBackAt: Date | string | null;
}

export interface RolloutEventInput {
  id: string;
  configVersionId: string;
  fromStatus: string;
  toStatus: string;
  stage: string | null;
  decision: string | null;
  rolloutPercent: number;
  reason: string;
  occurredAt: Date | string;
}

export interface HyperAgentConfigInput {
  hyperAgentEnabled: boolean;
  hyperAgentMode: string;
  autonomyLevel: string;
  maxExecutionRetries: number;
  maxOutputRepairs: number;
  maxPlanRepairs: number;
  maxCapabilityRepairs: number;
  maxTotalCostUsd: number;
  maxDurationMs: number;
  allowShadowOptimization: boolean;
  allowCanaryOptimization: boolean;
  allowCodePatchProposal: boolean;
  requireApprovalForPromptPromotion: boolean;
  requireApprovalForWorkflowPromotion: boolean;
  updatedAt: Date | string;
}

export interface AgentTraceInput {
  agentRole: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: Date | string;
}

export interface ShieldAuditInput {
  auditEventId: string;
  verdict: string;
  subjectKind: string | null;
  tenantId: string | null;
  issuedAt: Date | string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function bucketBy(rows: Array<{ key: string }>, keyOf: (r: { key: string }) => string): HonestBucket[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // Deterministic order: by count desc, then key asc. Stable across runs.
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count - a.count) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Security-class failures surfaced as governance violations. */
const GOVERNANCE_FAILURE_CLASSES = new Set(['PERMISSION_DENIED', 'POLICY_BLOCK', 'PROMPT_INJECTION']);

// ─── Overview ───────────────────────────────────────────────────────────────

export function aggregateOverview(input: {
  config: HyperAgentConfigInput | null;
  outcomes: OutcomeInput[];
  planVersions: PlanVersionInput[];
  repairs: RepairInput[];
  learnings: LearningInput[];
}): Omit<OverviewView, 'generatedAt'> {
  const { config, outcomes, planVersions, repairs, learnings } = input;
  const mode: HyperAgentModeSnapshot = config
    ? {
        hyperAgentEnabled: config.hyperAgentEnabled,
        hyperAgentMode: config.hyperAgentMode,
        autonomyLevel: config.autonomyLevel,
        dataAvailable: true,
      }
    : { hyperAgentEnabled: false, hyperAgentMode: 'OFF', autonomyLevel: 'L0', dataAvailable: false };

  const outcomesByVerdict = bucketBy(
    outcomes.map((o) => ({ key: o.outcome })),
    (r) => r.key,
  );
  const repairsByStatus = bucketBy(
    repairs.map((r) => ({ key: r.status })),
    (r) => r.key,
  );
  const learningsByStatus = bucketBy(
    learnings.map((l) => ({ key: l.status })),
    (r) => r.key,
  );

  const maxPlanVersion = planVersions.reduce((m, p) => Math.max(m, p.version), 0);
  const anyData = outcomes.length > 0 || planVersions.length > 0 || repairs.length > 0 || learnings.length > 0 || config !== null;

  const note =
    !anyData
      ? 'No HyperAgent data yet for this tenant. Enable HyperAgent and run a workflow to populate outcomes, diagnoses, plan versions, repairs, and learnings.'
      : !config
        ? 'HyperAgent is not configured for this tenant (no HyperAgentConfig row). Outcome/plan/repair/learning rows are shown; autonomy defaults to OFF/L0.'
        : null;

  return {
    mode,
    outcomesByVerdict,
    totalOutcomes: outcomes.length,
    planVersions: maxPlanVersion,
    repairsByStatus,
    learningsByStatus,
    dataAvailable: anyData,
    note,
  };
}

// ─── Runs ───────────────────────────────────────────────────────────────────

const REPAIR_TERMINAL_HUMAN = new Set(['MERGED', 'REJECTED', 'ABANDONED']);

export function aggregateRuns(input: {
  outcomes: OutcomeInput[];
  diagnoses: DiagnosisInput[];
  repairs: RepairInput[];
}): Omit<RunsView, 'generatedAt'> {
  const { outcomes, diagnoses, repairs } = input;
  const outcomesOut: OutcomeRow[] = outcomes.map((o) => ({
    workflowId: o.workflowId,
    outcome: o.outcome,
    taskTotal: o.taskTotal,
    taskPassed: o.taskPassed,
    taskFailed: o.taskFailed,
    taskBlocked: o.taskBlocked,
    totalCostUsd: o.totalCostUsd,
    durationMs: o.durationMs,
    createdAt: iso(o.createdAt),
  }));
  const diagnosesOut: DiagnosisRow[] = diagnoses.map((d) => ({
    id: d.id,
    workflowId: d.workflowId,
    taskId: d.taskId,
    failureClass: d.failureClass,
    recommendedRepairLevel: d.recommendedRepairLevel,
    deterministicBlock: d.deterministicBlock,
    confidence: d.confidence,
    requiresApproval: d.requiresApproval,
    quarantine: d.quarantine,
    rootCause: d.rootCause,
    createdAt: iso(d.createdAt),
  }));
  const repairsOut: RepairRow[] = repairs.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    risk: r.risk,
    safetyClass: r.safetyClass,
    branchName: r.branchName,
    prUrl: r.prUrl,
    prNumber: r.prNumber,
    description: r.description,
    createdAt: iso(r.createdAt),
  }));
  // Repairs attempted = every repair row NOT in a terminal human-only state.
  const repairsAttempted = repairs.filter((r) => !REPAIR_TERMINAL_HUMAN.has(r.status)).length;
  const anyData = outcomes.length > 0 || diagnoses.length > 0 || repairs.length > 0;
  return {
    outcomes: outcomesOut,
    diagnoses: diagnosesOut,
    repairs: repairsOut,
    totalOutcomes: outcomes.length,
    totalDiagnoses: diagnoses.length,
    totalRepairs: repairs.length,
    repairsAttempted,
    dataAvailable: anyData,
    note: anyData ? null : 'No workflow outcomes, diagnoses, or repairs yet for this tenant.',
  };
}

// ─── Learnings ──────────────────────────────────────────────────────────────

export function aggregateLearnings(input: { learnings: LearningInput[] }): Omit<LearningsView, 'generatedAt'> {
  const { learnings } = input;
  const rows: LearningRow[] = learnings.map((l) => ({
    id: l.id,
    key: l.key,
    kind: l.kind,
    source: l.source,
    status: l.status,
    summary: l.summary,
    failureClass: l.failureClass,
    confidence: l.confidence,
    mutualInformation: l.mutualInformation,
    promotedAt: l.promotedAt ? iso(l.promotedAt) : null,
    expiredAt: l.expiredAt ? iso(l.expiredAt) : null,
    createdAt: iso(l.createdAt),
  }));
  const candidates = rows.filter((r) => r.status === 'CANDIDATE');
  const promoted = rows.filter((r) => r.status === 'PROMOTED');
  const deprecatedOrExpired = rows.filter((r) => r.status === 'DEPRECATED' || r.status === 'EXPIRED' || r.status === 'REJECTED');
  // Applied-learning impact = promoted learnings with a measured MI value.
  // `impactMeasured` is honestly false when no promoted learning carries MI.
  const promotedWithMeasuredImpact = promoted.filter((r) => r.mutualInformation !== null && r.mutualInformation !== undefined).length;
  const impactMeasured = promotedWithMeasuredImpact > 0;
  const anyData = learnings.length > 0;
  return {
    candidates,
    promoted,
    deprecatedOrExpired,
    promotedWithMeasuredImpact,
    impactMeasured,
    total: learnings.length,
    dataAvailable: anyData,
    note: anyData
      ? null
      : 'No learning records yet. Learnings are extracted from workflow outcomes + failure diagnoses by the Phase 5 Learning Extractor.',
  };
}

// ─── Optimizations ──────────────────────────────────────────────────────────

export function aggregateOptimizations(input: {
  configVersions: ConfigVersionInput[];
  planVersions: PlanVersionInput[];
  benchmarks: BenchmarkResultRow[];
  benchmarksPersisted: boolean;
}): Omit<OptimizationsView, 'generatedAt'> {
  const { configVersions, planVersions, benchmarks, benchmarksPersisted } = input;
  const proposals: OptimizationProposalRow[] = configVersions.map((c) => ({
    id: c.id,
    kind: c.kind,
    version: c.version,
    status: c.status,
    rolloutPercent: c.rolloutPercent,
    changeReason: c.changeReason,
    evaluationSummary: c.evaluationSummary,
    createdAt: iso(c.createdAt),
    promotedAt: c.promotedAt ? iso(c.promotedAt) : null,
  }));
  // Prompt/workflow diffs = plan-history changeReasons + config changeReasons.
  const planDiffs: DiffRow[] = planVersions.map((p) => ({
    source: 'plan' as const,
    workflowId: p.workflowId,
    kind: null,
    version: p.version,
    changeReason: p.changeReason,
    createdAt: iso(p.createdAt),
  }));
  const configDiffs: DiffRow[] = configVersions.map((c) => ({
    source: 'config' as const,
    workflowId: null,
    kind: c.kind,
    version: c.version,
    changeReason: c.changeReason ?? '(no change reason recorded)',
    createdAt: iso(c.createdAt),
  }));
  const diffs = [...planDiffs, ...configDiffs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const anyData = configVersions.length > 0 || planVersions.length > 0 || (benchmarksPersisted && benchmarks.length > 0);
  const note = anyData
    ? null
    : benchmarksPersisted
      ? 'No optimisation proposals or prompt/workflow diffs yet. Optimisation proposals are versioned ConfigVersion rows advanced through shadow → canary → promote by the Phase 9 lifecycle gate.'
      : 'No optimisation proposals or prompt/workflow diffs yet. Optimisation proposals are versioned ConfigVersion rows advanced through shadow → canary → promote by the Phase 9 lifecycle gate. Benchmark results are not yet persisted (in-process only).';
  return {
    proposals,
    diffs,
    benchmarks: benchmarksPersisted ? benchmarks : [],
    benchmarksPersisted,
    totalProposals: configVersions.length,
    dataAvailable: anyData,
    note,
  };
}

// ─── Experiments ────────────────────────────────────────────────────────────

export function aggregateExperiments(input: {
  configVersions: ConfigVersionInput[];
  rolloutEvents: RolloutEventInput[];
  controlsWired: boolean;
}): Omit<ExperimentsView, 'generatedAt'> {
  const { configVersions, rolloutEvents, controlsWired } = input;
  const experiments: ExperimentRow[] = configVersions.map((c) => ({
    id: c.id,
    kind: c.kind,
    version: c.version,
    status: c.status,
    rolloutPercent: c.rolloutPercent,
    changeReason: c.changeReason,
    evaluationSummary: c.evaluationSummary,
    shadowStartedAt: c.shadowStartedAt ? iso(c.shadowStartedAt) : null,
    canaryStartedAt: c.canaryStartedAt ? iso(c.canaryStartedAt) : null,
    promotedAt: c.promotedAt ? iso(c.promotedAt) : null,
    rolledBackAt: c.rolledBackAt ? iso(c.rolledBackAt) : null,
  }));
  const inShadow = experiments.filter((e) => e.status === 'SHADOW');
  const inCanary = experiments.filter((e) => e.status === 'CANARY');
  const promoted = experiments.filter((e) => e.status === 'PROMOTED');
  const rolledBack = experiments.filter((e) => e.status === 'ROLLED_BACK');
  const rolloutEventsOut: RolloutEventRow[] = rolloutEvents
    .map((e) => ({
      id: e.id,
      configVersionId: e.configVersionId,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      stage: e.stage,
      decision: e.decision,
      rolloutPercent: e.rolloutPercent,
      reason: e.reason,
      occurredAt: iso(e.occurredAt),
    }))
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
  const anyData = configVersions.length > 0 || rolloutEvents.length > 0;
  const note = anyData
    ? null
    : 'No versioned experiments yet. Experiments are ConfigVersion rows moved through shadow → canary → promote (or rollback) by the Phase 9 lifecycle gate.';
  return {
    experiments,
    inShadow,
    inCanary,
    promoted,
    rolledBack,
    rolloutEvents: rolloutEventsOut,
    controlsWired,
    total: configVersions.length,
    dataAvailable: anyData,
    note,
  };
}

// ─── Governance ─────────────────────────────────────────────────────────────

export function aggregateGovernance(input: {
  diagnoses: DiagnosisInput[];
  configVersions: ConfigVersionInput[];
}): Omit<GovernanceView, 'generatedAt'> {
  const { diagnoses, configVersions } = input;
  const violations: GovernanceViolationRow[] = diagnoses
    .filter((d) => GOVERNANCE_FAILURE_CLASSES.has(d.failureClass))
    .map((d) => ({
      source: 'failure_diagnosis' as const,
      workflowId: d.workflowId,
      taskId: d.taskId,
      failureClass: d.failureClass,
      quarantine: d.quarantine,
      deterministicBlock: d.deterministicBlock,
      createdAt: iso(d.createdAt),
    }));
  const rules: GovernanceRuleRow[] = configVersions
    .filter((c) => c.kind === 'GOVERNANCE_RULE')
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      version: c.version,
      status: c.status,
      changeReason: c.changeReason,
      createdAt: iso(c.createdAt),
    }));
  const anyData = violations.length > 0 || rules.length > 0;
  return {
    violations,
    rules,
    totalViolations: violations.length,
    totalRules: rules.length,
    dataAvailable: anyData,
    note: anyData
      ? null
      : 'No governance violations or versioned governance rules yet. Violations are security-class failure diagnoses (PERMISSION_DENIED / POLICY_BLOCK / PROMPT_INJECTION); rules are ConfigVersion rows of kind GOVERNANCE_RULE.',
  };
}

// ─── Agent fleet ────────────────────────────────────────────────────────────

function median(sortedAsc: number[]): number {
  if (sortedAsc.length === 0) return 0;
  const mid = Math.floor(sortedAsc.length / 2);
  if (sortedAsc.length % 2 === 1) return sortedAsc[mid] ?? 0;
  return ((sortedAsc[mid - 1] ?? 0) + (sortedAsc[mid] ?? 0)) / 2;
}

export function aggregateAgentFleet(input: { traces: AgentTraceInput[] }): Omit<AgentFleetView, 'generatedAt'> {
  const { traces } = input;
  const byRoleMap = new Map<string, { total: number; failed: number; durations: number[] }>();
  for (const t of traces) {
    const role = t.agentRole ?? 'UNKNOWN';
    const entry = byRoleMap.get(role) ?? { total: 0, failed: 0, durations: [] };
    entry.total += 1;
    if (t.error) entry.failed += 1;
    if (t.durationMs !== null && t.durationMs !== undefined) entry.durations.push(t.durationMs);
    byRoleMap.set(role, entry);
  }
  const byRole: AgentFleetStatsRow[] = Array.from(byRoleMap.entries())
    .map(([agentRole, e]) => ({
      agentRole,
      totalRuns: e.total,
      failedRuns: e.failed,
      medianDurationMs: median(e.durations.slice().sort((a, b) => a - b)),
      dataAvailable: e.total > 0,
    }))
    .sort((a, b) => (b.totalRuns - a.totalRuns) || (a.agentRole < b.agentRole ? -1 : a.agentRole > b.agentRole ? 1 : 0));
  const anyData = traces.length > 0;
  return {
    byRole,
    totalTraces: traces.length,
    dataAvailable: anyData,
    note: anyData ? null : 'No agent traces yet for this tenant. Agent-fleet stats are aggregated from real agent trace rows.',
  };
}

// ─── Autonomy ───────────────────────────────────────────────────────────────

export function aggregateAutonomy(input: {
  config: HyperAgentConfigInput | null;
  outcomes: OutcomeInput[];
}): Omit<AutonomyView, 'generatedAt'> {
  const { config, outcomes } = input;
  const cfg: AutonomyConfigRow = config
    ? {
        hyperAgentEnabled: config.hyperAgentEnabled,
        hyperAgentMode: config.hyperAgentMode,
        autonomyLevel: config.autonomyLevel,
        maxExecutionRetries: config.maxExecutionRetries,
        maxOutputRepairs: config.maxOutputRepairs,
        maxPlanRepairs: config.maxPlanRepairs,
        maxCapabilityRepairs: config.maxCapabilityRepairs,
        maxTotalCostUsd: config.maxTotalCostUsd,
        maxDurationMs: config.maxDurationMs,
        allowShadowOptimization: config.allowShadowOptimization,
        allowCanaryOptimization: config.allowCanaryOptimization,
        allowCodePatchProposal: config.allowCodePatchProposal,
        requireApprovalForPromptPromotion: config.requireApprovalForPromptPromotion,
        requireApprovalForWorkflowPromotion: config.requireApprovalForWorkflowPromotion,
        updatedAt: iso(config.updatedAt),
        dataAvailable: true,
      }
    : {
        hyperAgentEnabled: false,
        hyperAgentMode: 'OFF',
        autonomyLevel: 'L0',
        maxExecutionRetries: 0,
        maxOutputRepairs: 0,
        maxPlanRepairs: 0,
        maxCapabilityRepairs: 0,
        maxTotalCostUsd: 0,
        maxDurationMs: 0,
        allowShadowOptimization: false,
        allowCanaryOptimization: false,
        allowCodePatchProposal: false,
        requireApprovalForPromptPromotion: true,
        requireApprovalForWorkflowPromotion: true,
        updatedAt: '',
        dataAvailable: false,
      };
  // Recent autonomy decisions = outcome rows whose finalAutonomy JSON carries a
  // verdict. The API passes these as outcomes with a non-null finalAutonomy; we
  // surface them from the outcome list the API filters. Here we accept a
  // dedicated list via outcomes that already carry a verdict snapshot.
  const recentDecisions: AutonomyDecisionRow[] = outcomes
    .map((o) => ({
      outcomeWorkflowId: o.workflowId,
      verdict: null,
      snapshottedAt: iso(o.createdAt),
    }))
    // The API will pass ONLY outcomes with a finalAutonomy verdict, so every row
    // here is a real decision snapshot. (verdict text is filled by the API from
    // the finalAutonomy JSON to avoid coupling this pure core to that schema.)
    .slice(0, 50);
  const anyData = config !== null || outcomes.length > 0;
  return {
    config: cfg,
    recentDecisions,
    dataAvailable: anyData,
    note: anyData ? null : 'No autonomy configuration or decision history yet for this tenant.',
  };
}

// ─── Shield ─────────────────────────────────────────────────────────────────

export function aggregateShield(input: {
  decisions: ShieldAuditInput[];
  decisionsPersisted: boolean;
}): Omit<ShieldView, 'generatedAt'> {
  const { decisions, decisionsPersisted } = input;
  const rows: ShieldDecisionRow[] = decisions.map((d) => ({
    auditEventId: d.auditEventId,
    verdict: d.verdict,
    subjectKind: d.subjectKind,
    tenantId: d.tenantId,
    issuedAt: iso(d.issuedAt),
  }));
  const byVerdict = bucketBy(
    rows.map((r) => ({ key: r.verdict })),
    (r) => r.key,
  );
  const anyData = rows.length > 0;
  const note = anyData
    ? null
    : decisionsPersisted
      ? 'No Shield decisions recorded yet. Shield decisions are signed (Ed25519) ALLOW / BLOCK / APPROVE_REQUIRED verdicts.'
      : 'No Shield decisions recorded yet. The signed Shield-decision store (Phase 8) is wired as a pure crypto core + MCP client; a persisted shield_decisions table is roadmap. Decisions surfaced here come from the audit log only.';
  return {
    decisions: rows,
    byVerdict,
    total: rows.length,
    decisionsPersisted,
    dataAvailable: anyData,
    note,
  };
}