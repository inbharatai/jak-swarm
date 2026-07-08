/**
 * control-centre.ts — HyperAgent Phase 13 shared view-model types.
 *
 * The Control Centre is an OPERATIONAL dashboard over real backend data only.
 * The spec mandates: "No fake graphs, placeholder percentages, sample success
 * rates or fabricated 'all systems healthy' states." These view models encode
 * that honesty structurally:
 *
 *   - Every view carries `dataAvailable: boolean`. It is `true` ONLY when at
 *     least one backing row exists for that view. It is NEVER derived from a
 *     clock, a hardcoded "healthy" default, or a sample.
 *   - Every count is a real count of real rows (0 when the table is empty).
 *   - Every list is a slice of real rows (never a fabricated sample list).
 *   - `note` carries an honest, human-readable explanation when a surface is
 *     empty because no data exists yet, OR because its backing store is not yet
 *     wired (roadmap). It NEVER claims capability that is not implemented.
 *   - `generatedAt` is caller-stamped (the API stamps it from the request
 *     clock); the pure aggregator never reads a clock itself.
 *
 * The pure aggregation core (packages/swarm/src/hyperagent/control-centre.ts)
 * builds these from Prisma-row-shaped inputs; the API route stamps `generatedAt`
 * and returns `ok(view)`; the web renders the view or an honest empty state.
 */

// ─── Common ────────────────────────────────────────────────────────────────

/** A single count + the honest flag that says whether any row backed it. */
export interface HonestCount {
  count: number;
  dataAvailable: boolean;
}

/** A named bucket from a real groupBy over rows (e.g. outcomes by verdict). */
export interface HonestBucket {
  key: string;
  count: number;
}

/** Caller-stamped ISO timestamp the API fills from the request clock. */
export type GeneratedAt = string;

// ─── Overview (/hyperagent) ────────────────────────────────────────────────

export interface HyperAgentModeSnapshot {
  hyperAgentEnabled: boolean;
  hyperAgentMode: string; // OFF | OBSERVE | ASSISTED | AUTONOMOUS_safe
  autonomyLevel: string; // L0..L5
  dataAvailable: boolean; // false when no HyperAgentConfig row exists for the tenant
}

export interface OverviewView {
  generatedAt: GeneratedAt;
  mode: HyperAgentModeSnapshot;
  /** Real outcome-verdict buckets over WorkflowOutcome rows. */
  outcomesByVerdict: HonestBucket[];
  totalOutcomes: number;
  /** Plan-history depth = max plan version across the tenant's workflows (0 = none). */
  planVersions: number;
  /** Real repair-attempt buckets over CodeRepairProposal rows by status. */
  repairsByStatus: HonestBucket[];
  /** Real learning-status buckets over LearningRecord rows. */
  learningsByStatus: HonestBucket[];
  dataAvailable: boolean;
  note: string | null;
}

// ─── Runs (/hyperagent/runs) — outcomes + diagnoses + repairs ──────────────

export interface OutcomeRow {
  workflowId: string;
  outcome: string;
  taskTotal: number;
  taskPassed: number;
  taskFailed: number;
  taskBlocked: number;
  totalCostUsd: number;
  durationMs: number;
  createdAt: string;
}

export interface DiagnosisRow {
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
  createdAt: string;
}

export interface RepairRow {
  id: string;
  kind: string;
  status: string;
  risk: string;
  safetyClass: string;
  branchName: string;
  prUrl: string | null;
  prNumber: number | null;
  description: string;
  createdAt: string;
}

export interface RunsView {
  generatedAt: GeneratedAt;
  outcomes: OutcomeRow[];
  diagnoses: DiagnosisRow[];
  repairs: RepairRow[];
  totalOutcomes: number;
  totalDiagnoses: number;
  totalRepairs: number;
  /** Repairs-attempted = every repair row not in a terminal human-only state. */
  repairsAttempted: number;
  dataAvailable: boolean;
  note: string | null;
}

// ─── Learnings (/hyperagent/learnings) ─────────────────────────────────────

export interface LearningRow {
  id: string;
  key: string;
  kind: string;
  source: string;
  status: string;
  summary: string;
  failureClass: string | null;
  confidence: number;
  mutualInformation: number | null;
  promotedAt: string | null;
  expiredAt: string | null;
  createdAt: string;
}

export interface LearningsView {
  generatedAt: GeneratedAt;
  candidates: LearningRow[];
  promoted: LearningRow[];
  deprecatedOrExpired: LearningRow[];
  /** Applied-learning impact = count of PROMOTED learnings with measured MI. */
  promotedWithMeasuredImpact: number;
  /** Honesty: MI is only present when the info-theoretic gate (innovation #2) ran. */
  impactMeasured: boolean;
  total: number;
  dataAvailable: boolean;
  note: string | null;
}

// ─── Optimizations (/hyperagent/optimizations) ─────────────────────────────

export interface OptimizationProposalRow {
  id: string;
  kind: string; // ConfigKind
  version: number;
  status: string;
  rolloutPercent: number;
  changeReason: string | null;
  evaluationSummary: string | null;
  createdAt: string;
  promotedAt: string | null;
}

export interface DiffRow {
  /** "plan" | "config" — which kind of versioned artifact this diff comes from. */
  source: 'plan' | 'config';
  workflowId: string | null;
  kind: string | null;
  version: number | null;
  changeReason: string;
  createdAt: string;
}

export interface OptimizationsView {
  generatedAt: GeneratedAt;
  proposals: OptimizationProposalRow[];
  /** Prompt/workflow diffs from PlanVersion + ConfigVersion changeReason. */
  diffs: DiffRow[];
  /**
   * Benchmark results. HONEST: the benchmark harness (Phase 8) runs in-process
   * and is NOT persisted to a table yet, so this is an empty list with
   * `benchmarksPersisted: false` until a benchmark-results store is wired.
   */
  benchmarks: BenchmarkResultRow[];
  benchmarksPersisted: boolean;
  totalProposals: number;
  dataAvailable: boolean;
  note: string | null;
}

export interface BenchmarkResultRow {
  scenarioId: string;
  passed: boolean;
  durationMs: number;
  costUsd: number;
  runAt: string;
}

// ─── Experiments (/hyperagent/experiments) — shadow/canary/promote/rollback ─

export interface ExperimentRow {
  id: string;
  kind: string;
  version: number;
  status: string;
  rolloutPercent: number;
  changeReason: string | null;
  evaluationSummary: string | null;
  shadowStartedAt: string | null;
  canaryStartedAt: string | null;
  promotedAt: string | null;
  rolledBackAt: string | null;
}

export interface RolloutEventRow {
  id: string;
  configVersionId: string;
  fromStatus: string;
  toStatus: string;
  stage: string | null;
  decision: string | null;
  rolloutPercent: number;
  reason: string;
  occurredAt: string;
}

export interface ExperimentsView {
  generatedAt: GeneratedAt;
  experiments: ExperimentRow[];
  /** Shadow-stage configs (status = SHADOW). */
  inShadow: ExperimentRow[];
  /** Canary-stage configs (status = CANARY). */
  inCanary: ExperimentRow[];
  /** Promoted configs (status = PROMOTED). */
  promoted: ExperimentRow[];
  /** Rolled-back configs (status = ROLLED_BACK). */
  rolledBack: ExperimentRow[];
  /** The immutable rollout audit trail (most-recent first). */
  rolloutEvents: RolloutEventRow[];
  /**
   * Promote/rollback controls. HONEST: the control centre DISPLAYS the rollout
   * trail; the actual advance/rollback is performed by the config-lifecycle gate
   * (Phase 9) via a write endpoint, NOT fabricated client-side. `controlsWired`
   * is false until that write endpoint exists; the UI then links to it.
   */
  controlsWired: boolean;
  total: number;
  dataAvailable: boolean;
  note: string | null;
}

// ─── Governance (/hyperagent/governance) ───────────────────────────────────

export interface GovernanceViolationRow {
  /** Source of the violation signal — currently failure diagnoses with a
   *  security-class failure (PERMISSION_DENIED / POLICY_BLOCK / PROMPT_INJECTION). */
  source: 'failure_diagnosis';
  workflowId: string;
  taskId: string;
  failureClass: string;
  quarantine: boolean;
  deterministicBlock: boolean;
  createdAt: string;
}

export interface GovernanceRuleRow {
  id: string;
  kind: string; // ConfigKind (GOVERNANCE_RULE etc.)
  version: number;
  status: string;
  changeReason: string | null;
  createdAt: string;
}

export interface GovernanceView {
  generatedAt: GeneratedAt;
  /** Security-class failures surfaced as governance violations (real diagnoses). */
  violations: GovernanceViolationRow[];
  /** Versioned governance rules (ConfigVersion rows of kind GOVERNANCE_RULE). */
  rules: GovernanceRuleRow[];
  totalViolations: number;
  totalRules: number;
  dataAvailable: boolean;
  note: string | null;
}

// ─── Agent fleet (/hyperagent/agent-fleet) ─────────────────────────────────

export interface AgentFleetStatsRow {
  agentRole: string;
  totalRuns: number;
  failedRuns: number;
  /** Median duration in ms (nearest-rank over real traces). 0 when no traces. */
  medianDurationMs: number;
  dataAvailable: boolean;
}

export interface AgentFleetView {
  generatedAt: GeneratedAt;
  byRole: AgentFleetStatsRow[];
  totalTraces: number;
  dataAvailable: boolean;
  note: string | null;
}

// ─── Autonomy (/hyperagent/autonomy) ───────────────────────────────────────

export interface AutonomyConfigRow {
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
  updatedAt: string;
  dataAvailable: boolean;
}

export interface AutonomyDecisionRow {
  /** Outcome row id the autonomy decision was snapshotted on, if any. */
  outcomeWorkflowId: string | null;
  /** Serialized AutonomyDecision verdict (the finalAutonomy JSON). */
  verdict: string | null;
  snapshottedAt: string;
}

export interface AutonomyView {
  generatedAt: GeneratedAt;
  config: AutonomyConfigRow;
  /** Recent autonomy decisions snapshotted on WorkflowOutcome.finalAutonomy. */
  recentDecisions: AutonomyDecisionRow[];
  dataAvailable: boolean;
  note: string | null;
}

// ─── Shield (/hyperagent/shield) ───────────────────────────────────────────

export interface ShieldDecisionRow {
  /** Audit-log row id, when surfaced from the audit trail. */
  auditEventId: string;
  verdict: string; // ALLOW | BLOCK | APPROVE_REQUIRED
  subjectKind: string | null;
  tenantId: string | null;
  issuedAt: string;
}

export interface ShieldView {
  generatedAt: GeneratedAt;
  decisions: ShieldDecisionRow[];
  /** Real verdict buckets over the surfaced shield decisions. */
  byVerdict: HonestBucket[];
  total: number;
  /**
   * HONEST: the signed Shield-decision store (Phase 8 signed-decision + MCP
   * client) is wired as a pure crypto core + client, but a persisted
   * shield_decisions table is NOT yet part of the schema. Until it is, the
   * control centre surfaces shield decisions from the audit log only, and
   * `decisionsPersisted` reflects whether a dedicated store exists.
   */
  decisionsPersisted: boolean;
  dataAvailable: boolean;
  note: string | null;
}