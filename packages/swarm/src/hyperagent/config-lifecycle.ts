/**
 * config-lifecycle.ts — HyperAgent Phase 9: bounded versioned-config lifecycle.
 *
 * Self-modification (standing security constraint) must use versioned proposals,
 * evaluation, shadow execution, canary execution, promotion and rollback. This
 * pure core is the deterministic lifecycle gate: it decides which transitions a
 * ConfigVersion may make, evaluates shadow/canary metrics against thresholds, and
 * advances/rolls back the version. The LLM may PROPOSE a config; only this gate
 * decides it may ADVANCE — and it refuses to advance without positive evidence
 * (innovation: honest evaluation seam — no metrics or insufficient samples ⇒ HOLD,
 * never a fake advance).
 *
 * Lifecycle:
 *   DRAFT → PROPOSED → SHADOW → CANARY → PROMOTED
 *                                        (any of SHADOW/CANARY/PROMOTED → ROLLED_BACK)
 *   ROLLED_BACK → ARCHIVED ; PROMOTED → ARCHIVED (when superseded)
 *
 * Pure + deterministic — no I/O, no LLM, no Date.now. The caller stamps `now`
 * (ISO-8601) and supplies the rollout metrics. Pure so every promotion decision
 * is reproducible + auditable.
 */
import {
  ConfigVersionStatus,
  PromotionDecision,
  RolloutStage,
  DEFAULT_ROLLOUT_LADDER,
  DEFAULT_ROLLOUT_THRESHOLDS,
} from '@jak-swarm/shared';
import type {
  ConfigKind,
  ConfigRolloutEvent,
  ConfigVersion,
  RolloutMetrics,
  RolloutThresholds,
} from '@jak-swarm/shared';

export class ConfigLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigLifecycleError';
  }
}

/** Allowed forward / rollback transitions (bounded state machine). */
const ALLOWED_TRANSITIONS: Readonly<Record<ConfigVersionStatus, readonly ConfigVersionStatus[]>> = Object.freeze({
  [ConfigVersionStatus.DRAFT]: [ConfigVersionStatus.PROPOSED, ConfigVersionStatus.ARCHIVED],
  [ConfigVersionStatus.PROPOSED]: [ConfigVersionStatus.SHADOW, ConfigVersionStatus.ROLLED_BACK, ConfigVersionStatus.ARCHIVED],
  [ConfigVersionStatus.SHADOW]: [ConfigVersionStatus.CANARY, ConfigVersionStatus.ROLLED_BACK],
  [ConfigVersionStatus.CANARY]: [ConfigVersionStatus.PROMOTED, ConfigVersionStatus.SHADOW, ConfigVersionStatus.ROLLED_BACK],
  [ConfigVersionStatus.PROMOTED]: [ConfigVersionStatus.ROLLED_BACK, ConfigVersionStatus.ARCHIVED],
  [ConfigVersionStatus.ROLLED_BACK]: [ConfigVersionStatus.ARCHIVED],
  [ConfigVersionStatus.ARCHIVED]: [],
});

/** True when a transition is permitted by the bounded lifecycle. Pure. */
export function canTransition(from: ConfigVersionStatus, to: ConfigVersionStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

export function assertTransition(from: ConfigVersionStatus, to: ConfigVersionStatus): void {
  if (!canTransition(from, to)) {
    throw new ConfigLifecycleError(`illegal config transition: ${from} → ${to}`);
  }
}

/** Create a fresh DRAFT version (the only way a new version enters the pipeline). */
export function createDraft(input: {
  id: string;
  tenantId: string;
  kind: ConfigKind;
  version: number;
  spec: unknown;
  parentVersionId?: string | null;
  now: string;
}): ConfigVersion {
  return {
    id: input.id,
    tenantId: input.tenantId,
    kind: input.kind,
    version: input.version,
    spec: input.spec,
    status: ConfigVersionStatus.DRAFT,
    parentVersionId: input.parentVersionId ?? null,
    supersededById: null,
    rolloutPercent: 0,
    createdAt: input.now,
    proposedAt: null,
    shadowStartedAt: null,
    canaryStartedAt: null,
    promotedAt: null,
    rolledBackAt: null,
    changeReason: null,
    evaluationSummary: null,
  };
}

/** Apply a transition, returning a NEW version (immutable update). Pure. */
function withStatus(v: ConfigVersion, to: ConfigVersionStatus, reason: string | null, extra?: Partial<ConfigVersion>): ConfigVersion {
  assertTransition(v.status, to);
  return { ...v, status: to, changeReason: reason, ...extra, supersededById: v.supersededById };
}

/** DRAFT → PROPOSED. */
export function proposeVersion(v: ConfigVersion, now: string, reason?: string): ConfigVersion {
  return withStatus(v, ConfigVersionStatus.PROPOSED, reason ?? 'proposed for evaluation', { proposedAt: now });
}

/** PROPOSED → SHADOW (begin shadow execution alongside the live config). */
export function startShadow(v: ConfigVersion, now: string, reason?: string): ConfigVersion {
  if (v.status !== ConfigVersionStatus.PROPOSED) {
    throw new ConfigLifecycleError(`shadow requires PROPOSED, got ${v.status}`);
  }
  return withStatus(v, ConfigVersionStatus.SHADOW, reason ?? 'shadow execution started', { shadowStartedAt: now });
}

/** SHADOW → CANARY (begin canary at the first ladder percentage). */
export function startCanary(v: ConfigVersion, now: string, ladder: readonly number[] = DEFAULT_ROLLOUT_LADDER, reason?: string): ConfigVersion {
  if (v.status !== ConfigVersionStatus.SHADOW) {
    throw new ConfigLifecycleError(`canary requires SHADOW, got ${v.status}`);
  }
  const first = ladder[0] ?? 1;
  return withStatus(v, ConfigVersionStatus.CANARY, reason ?? 'canary started', { canaryStartedAt: now, rolloutPercent: first });
}

/** CANARY → PROMOTED (full rollout). */
export function promoteVersion(v: ConfigVersion, now: string, reason?: string): ConfigVersion {
  if (v.status !== ConfigVersionStatus.CANARY) {
    throw new ConfigLifecycleError(`promote requires CANARY, got ${v.status}`);
  }
  return withStatus(v, ConfigVersionStatus.PROMOTED, reason ?? 'canary passed — promoted', { promotedAt: now, rolloutPercent: 100 });
}

/**
 * SHADOW | CANARY | PROMOTED → ROLLED_BACK. The version is abandoned; the prior
 * PROMOTED version (if any) remains the live config. Pure.
 */
export function rollbackVersion(v: ConfigVersion, now: string, reason: string): ConfigVersion {
  if (!canTransition(v.status, ConfigVersionStatus.ROLLED_BACK)) {
    throw new ConfigLifecycleError(`rollback not allowed from ${v.status}`);
  }
  return withStatus(v, ConfigVersionStatus.ROLLED_BACK, reason, { rolledBackAt: now, rolloutPercent: 0 });
}

/**
 * Supersede a previously-PROMOTED version with a newly-PROMOTED one. The old
 * version is ARCHIVED with `supersededById` pointing at the new one; the new one
 * records `parentVersionId`. Returns both updated versions. Pure.
 */
export function supersede(
  prevPromoted: ConfigVersion,
  newPromoted: ConfigVersion,
  now: string,
): { archived: ConfigVersion; promoted: ConfigVersion } {
  if (prevPromoted.status !== ConfigVersionStatus.PROMOTED) {
    throw new ConfigLifecycleError(`supersede requires a PROMOTED predecessor, got ${prevPromoted.status}`);
  }
  if (newPromoted.status !== ConfigVersionStatus.PROMOTED) {
    throw new ConfigLifecycleError(`supersede requires a PROMOTED successor, got ${newPromoted.status}`);
  }
  const archived: ConfigVersion = {
    ...prevPromoted,
    status: ConfigVersionStatus.ARCHIVED,
    supersededById: newPromoted.id,
    changeReason: `superseded by version ${newPromoted.version} at ${now}`,
  };
  const promoted: ConfigVersion = { ...newPromoted, parentVersionId: prevPromoted.id };
  return { archived, promoted };
}

/**
 * Next canary percentage strictly greater than `current` on the ladder, or null
 * when already at the top (⇒ promote). Pure.
 */
export function nextRolloutPercent(current: number, ladder: readonly number[] = DEFAULT_ROLLOUT_LADDER): number | null {
  const next = ladder.find((p) => p > current);
  return next ?? null;
}

export interface StageEvaluation {
  decision: PromotionDecision;
  reasons: string[];
  /** Human-readable summary for audit attachment. */
  summary: string;
}

/**
 * Evaluate a stage's metrics against thresholds + a baseline. ADVANCE only when
 * there are enough samples, success/failure rates pass, the safety-incident rate
 * is within tolerance, AND the success rate beats the baseline by the required
 * lift. A safety incident ABOVE tolerance ⇒ immediate ROLLBACK. Insufficient
 * evidence ⇒ HOLD (never a fake advance). Pure.
 */
export function evaluateStage(
  candidate: RolloutMetrics,
  baseline: RolloutMetrics,
  thresholds: RolloutThresholds = DEFAULT_ROLLOUT_THRESHOLDS,
): StageEvaluation {
  const reasons: string[] = [];
  const safetyRate = candidate.safetyIncidentRate ?? 0;
  if (safetyRate > thresholds.maxSafetyIncidentRate) {
    return {
      decision: PromotionDecision.ROLLBACK,
      reasons: [`safety-incident rate ${safetyRate} > max ${thresholds.maxSafetyIncidentRate}`],
      summary: 'rollback: safety threshold breached',
    };
  }
  if (candidate.samples < thresholds.minSamples) {
    reasons.push(`samples ${candidate.samples} < min ${thresholds.minSamples} (hold for more evidence)`);
  }
  if (candidate.successRate < thresholds.minSuccessRate) {
    reasons.push(`success rate ${candidate.successRate} < min ${thresholds.minSuccessRate}`);
  }
  if (candidate.failureRate > thresholds.maxFailureRate) {
    reasons.push(`failure rate ${candidate.failureRate} > max ${thresholds.maxFailureRate}`);
  }
  const lift = candidate.successRate - baseline.successRate;
  if (lift < thresholds.minLiftOverBaseline) {
    reasons.push(`lift ${lift.toFixed(4)} < min ${thresholds.minLiftOverBaseline} over baseline ${baseline.successRate}`);
  }
  if (reasons.length > 0) {
    return { decision: PromotionDecision.HOLD, reasons, summary: `hold: ${reasons.join('; ')}` };
  }
  return {
    decision: PromotionDecision.ADVANCE,
    reasons: ['all thresholds met'],
    summary: `advance: success ${candidate.successRate} (lift ${lift.toFixed(4)}), failure ${candidate.failureRate}, samples ${candidate.samples}`,
  };
}

/** Evaluate a SHADOW stage (alias for evaluateStage with shadow semantics). */
export function evaluateShadow(candidate: RolloutMetrics, baseline: RolloutMetrics, thresholds?: RolloutThresholds): StageEvaluation {
  return evaluateStage(candidate, baseline, thresholds);
}

/** Evaluate a CANARY stage. */
export function evaluateCanary(candidate: RolloutMetrics, baseline: RolloutMetrics, thresholds?: RolloutThresholds): StageEvaluation {
  return evaluateStage(candidate, baseline, thresholds);
}

export interface CanaryRampResult {
  decision: PromotionDecision;
  /** The new version after ramping (ADVANCE) — null on HOLD / ROLLBACK. */
  nextVersion: ConfigVersion | null;
  evaluation: StageEvaluation;
}

/**
 * Ramp a CANARY version: evaluate its metrics, and on ADVANCE either step up to
 * the next ladder percentage (still CANARY) or PROMOTE when the next step would
 * be 100%. On ROLLBACK, return the decision with nextVersion=null so the caller
 * can roll back. On HOLD, nextVersion=null (wait for more evidence). Pure.
 */
export function rampCanary(
  v: ConfigVersion,
  candidate: RolloutMetrics,
  baseline: RolloutMetrics,
  now: string,
  options?: { thresholds?: RolloutThresholds; ladder?: readonly number[]; reason?: string },
): CanaryRampResult {
  if (v.status !== ConfigVersionStatus.CANARY) {
    throw new ConfigLifecycleError(`rampCanary requires CANARY, got ${v.status}`);
  }
  const ladder = options?.ladder ?? DEFAULT_ROLLOUT_LADDER;
  const thresholds = options?.thresholds ?? DEFAULT_ROLLOUT_THRESHOLDS;
  const evaluation = evaluateCanary(candidate, baseline, thresholds);
  if (evaluation.decision === PromotionDecision.ADVANCE) {
    const next = nextRolloutPercent(v.rolloutPercent, ladder);
    if (next === null || next >= 100) {
      return {
        decision: PromotionDecision.ADVANCE,
        nextVersion: promoteVersion(v, now, options?.reason ?? evaluation.summary),
        evaluation,
      };
    }
    return {
      decision: PromotionDecision.ADVANCE,
      nextVersion: { ...v, rolloutPercent: next, changeReason: options?.reason ?? evaluation.summary, evaluationSummary: evaluation.summary },
      evaluation,
    };
  }
  return { decision: evaluation.decision, nextVersion: null, evaluation };
}

/**
 * Record an immutable audit event for a transition. Pure (caller stamps `now` +
 * supplies the id; the durable store is the Prisma ConfigRolloutEvent table).
 */
export function recordEvent(
  v: ConfigVersion,
  input: {
    id: string;
    fromStatus: ConfigVersionStatus;
    toStatus: ConfigVersionStatus;
    stage?: RolloutStage | null;
    decision?: PromotionDecision | null;
    rolloutPercent?: number;
    reason: string;
    now: string;
  },
): ConfigRolloutEvent {
  return {
    id: input.id,
    configVersionId: v.id,
    tenantId: v.tenantId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    stage: input.stage ?? null,
    decision: input.decision ?? null,
    rolloutPercent: input.rolloutPercent ?? v.rolloutPercent,
    reason: input.reason,
    occurredAt: input.now,
  };
}

/** Attach an evaluation summary to a version (for audit on HOLD/HOLD transitions). */
export function withEvaluation(v: ConfigVersion, summary: string): ConfigVersion {
  return { ...v, evaluationSummary: summary };
}