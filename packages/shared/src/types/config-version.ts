/**
 * config-version.ts — HyperAgent Phase 9 shared types: versioned self-modification configs.
 *
 * Self-modification (the standing security constraint) must use versioned proposals,
 * evaluation, shadow execution, canary execution, promotion and rollback. These
 * types model an immutable, versioned config document that moves through a bounded
 * lifecycle: DRAFT → PROPOSED → SHADOW → CANARY → PROMOTED (or ROLLED_BACK at any
 * gate). A PROMOTED version supersedes the prior PROMOTED version (which ARCHIVEs).
 *
 * Every transition is content-addressed + timestamped by the caller (pure cores in
 * packages/swarm/src/hyperagent/config-lifecycle.ts decide legality; the LLM may
 * PROPOSE a config, only the lifecycle gate decides it may advance).
 */

/** The kind of HyperAgent config a version carries. */
export enum ConfigKind {
  AUTONOMY_POLICY = 'AUTONOMY_POLICY',
  REPAIR_BUDGET = 'REPAIR_BUDGET',
  LEARNING_GATE = 'LEARNING_GATE',
  GOVERNANCE_RULE = 'GOVERNANCE_RULE',
  TOOL_POLICY = 'TOOL_POLICY',
}

/** The bounded lifecycle a config version moves through. */
export enum ConfigVersionStatus {
  DRAFT = 'DRAFT',
  PROPOSED = 'PROPOSED',
  SHADOW = 'SHADOW',
  CANARY = 'CANARY',
  PROMOTED = 'PROMOTED',
  ROLLED_BACK = 'ROLLED_BACK',
  ARCHIVED = 'ARCHIVED',
}

/** The stage a version is being evaluated for promotion into. */
export enum RolloutStage {
  SHADOW = 'SHADOW',
  CANARY = 'CANARY',
  PROMOTED = 'PROMOTED',
}

/** The gate's verdict on a shadow/canary evaluation. */
export enum PromotionDecision {
  ADVANCE = 'ADVANCE',
  HOLD = 'HOLD',
  ROLLBACK = 'ROLLBACK',
}

/** Metrics compared during shadow/canary evaluation (caller-supplied, pure). */
export interface RolloutMetrics {
  /** Number of observations in this stage's sample. */
  samples: number;
  /** Success fraction in [0,1]. */
  successRate: number;
  /** Failure fraction in [0,1] (may be > 0 even when successRate high — partial). */
  failureRate: number;
  /** Mean cost per run, if tracked. */
  meanCost?: number;
  /** Observed rate of a safety-relevant event (e.g. approval-bypass attempts). */
  safetyIncidentRate?: number;
}

/** Thresholds that gate advancement from one stage to the next. */
export interface RolloutThresholds {
  /** Minimum samples before a stage may advance (statistical power floor). */
  minSamples: number;
  /** Shadow/canary success rate must be ≥ this to advance. */
  minSuccessRate: number;
  /** Shadow/canary failure rate must be ≤ this to advance. */
  maxFailureRate: number;
  /** Safety-incident rate must be ≤ this to advance (default 0 — zero tolerance). */
  maxSafetyIncidentRate: number;
  /** Must beat the baseline success rate by at least this margin to advance. */
  minLiftOverBaseline: number;
}

/** A versioned config document. Immutable once created; transitions copy + supersede. */
export interface ConfigVersion {
  id: string;
  tenantId: string;
  kind: ConfigKind;
  /** Monotonic per-(tenant,kind) version counter (1-based). */
  version: number;
  /** The config payload (typed by the caller per kind). JSONB in storage. */
  spec: unknown;
  status: ConfigVersionStatus;
  /** The version this one supersedes (null for the first version). */
  parentVersionId: string | null;
  /** The version that superseded this one (set when ARCHIVED). */
  supersededById: string | null;
  /** Canary traffic percentage (0 outside CANARY). */
  rolloutPercent: number;
  /** Caller-stamped ISO timestamps for each lifecycle event. */
  createdAt: string;
  proposedAt: string | null;
  shadowStartedAt: string | null;
  canaryStartedAt: string | null;
  promotedAt: string | null;
  rolledBackAt: string | null;
  /** Free-text reason for the latest transition (audit). */
  changeReason: string | null;
  /** Last evaluation summary attached by the gate (audit). */
  evaluationSummary: string | null;
}

/** An immutable record of one lifecycle transition (the audit trail). */
export interface ConfigRolloutEvent {
  id: string;
  configVersionId: string;
  tenantId: string;
  fromStatus: ConfigVersionStatus;
  toStatus: ConfigVersionStatus;
  stage: RolloutStage | null;
  decision: PromotionDecision | null;
  rolloutPercent: number;
  reason: string;
  occurredAt: string;
}

export const DEFAULT_ROLLOUT_THRESHOLDS: RolloutThresholds = Object.freeze({
  minSamples: 20,
  minSuccessRate: 0.9,
  maxFailureRate: 0.1,
  maxSafetyIncidentRate: 0,
  minLiftOverBaseline: 0.02,
});

/** Canonical canary rollout ladder (1% → 5% → 25% → 50% → 100%). */
export const DEFAULT_ROLLOUT_LADDER: readonly number[] = Object.freeze([1, 5, 25, 50, 100]);