/**
 * learning.ts — HyperAgent Phase 5 self-learning types.
 *
 * The spec (§13 Phase 5) requires a Learning Extractor that reads
 * WorkflowOutcome + FailureDiagnosis rows, extracts typed learnings, persists
 * them, and gates promotion on evidence — never on "the LLM said this is
 * better". Three AI-scientist innovations live here as pure data + the
 * accounting structs their pure cores (in packages/swarm/src/hyperagent)
 * operate on:
 *
 *   #2  Information-theoretic gating — a learning is promoted only when the
 *       mutual information I(learning; outcome=success) exceeds a threshold,
 *       measured over a 2×2 contingency table of observed runs. Replaces
 *       "LLM says better" with a measured correlation.
 *   #5  Bayesian evidence accrual — contradictory observations fork into
 *       competing hypotheses tracked until one posterior collapses the other
 *       (no silent merge of contradicting evidence).
 *   #10 Hazard-model temporal drift — a learning carries a predictive posterior
 *       that decays as time passes without fresh validating evidence; it
 *       auto-expires when the predictive drops below a floor (no stale rule
 *       governs forever).
 *
 * Pure data. The logic lives in the pure cores; callers stamp `createdAt` /
 * `now` (no Date.now in the hot paths).
 */

import type { FailureClass } from './failure.js';
import type { OutcomeVerdict, TaskVerdict } from './outcome.js';

/** Where a learning came from. */
export enum LearningSource {
  OUTCOME = 'OUTCOME',
  FAILURE_DIAGNOSIS = 'FAILURE_DIAGNOSIS',
  COUNTERFACTUAL = 'COUNTERFACTUAL',
  HUMAN_FEEDBACK = 'HUMAN_FEEDBACK',
}

/** Kind of knowledge a learning encodes. */
export enum LearningKind {
  KNOWLEDGE = 'KNOWLEDGE', // a fact / pattern observed about the world
  POLICY = 'POLICY', // a repair / routing preference
  WORKFLOW = 'WORKFLOW', // a plan-shape that worked or didn't
}

/** Lifecycle of a learning candidate. */
export enum LearningStatus {
  CANDIDATE = 'CANDIDATE', // extracted but not yet promoted
  PROMOTED = 'PROMOTED', // passed the info-theoretic gate + has predictive value
  DEPRECATED = 'DEPRECATED', // superseded by a stronger learning
  EXPIRED = 'EXPIRED', // hazard-model predictive decayed below floor
  REJECTED = 'REJECTED', // failed the info-theoretic gate
}

/**
 * Innovation #2 — the 2×2 contingency table that gates promotion.
 *   a = learning present  & run succeeded
 *   b = learning present  & run failed
 *   c = learning absent   & run succeeded
 *   d = learning absent   & run failed
 * N = a + b + c + d. Mutual information I(learning; success) is computed from
 * this table by learning-gate.ts.
 */
export interface ContingencyTable {
  a: number;
  b: number;
  c: number;
  d: number;
}

/**
 * Innovation #5 — one competing hypothesis in a Bayesian evidence-accrual
 * cluster. Hypotheses are forked when an observation contradicts the leading
 * hypothesis; they survive until one posterior collapses the others.
 */
export interface Hypothesis {
  id: string;
  /** Human-readable claim, e.g. "agent WORKER_RESEARCH is the right pick for grounding tasks". */
  claim: string;
  /** Prior weight (unnormalised); the posterior is normalised across siblings. */
  prior: number;
  /** Running unnormalised posterior after applying observed likelihoods. */
  posterior: number;
  /** Count of observations accrued into this hypothesis. */
  observations: number;
  /** ISO timestamp of the last update — for audit / drift. */
  lastUpdatedAt: string;
}

/**
 * A cluster of competing hypotheses for one learning question. The accrual
 * core forks / updates / collapses these; only the surviving hypothesis is
 * promoted into a LearningRecord.
 */
export interface EvidenceCluster {
  id: string;
  tenantId: string;
  /** The question this cluster is trying to answer. */
  question: string;
  hypotheses: Hypothesis[];
  /** True once one posterior has collapsed the others (a winner emerged). */
  resolved: boolean;
  winnerId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Innovation #10 — the hazard model attached to a promoted learning. The
 * predictive posterior (Beta(α, β)) is the probability the learning still
 * yields a successful outcome; it decays toward a prior as time passes
 * without fresh validating evidence, and the learning expires once it drops
 * below `predictiveFloor`.
 */
export interface HazardModel {
  /** Beta prior successes (α). */
  alpha: number;
  /** Beta prior failures (β). */
  beta: number;
  /** Half-life of belief decay (ms). Predictive decays toward the prior over this window. */
  decayHalfLifeMs: number;
  /** Predictive below this ⇒ the learning expires. */
  predictiveFloor: number;
  /** ISO timestamp of the last validating observation. */
  lastValidatedAt: string;
  /** Hard expiry (ISO) regardless of decay — a safety ceiling on a learning's life. */
  expiresAt: string;
}

/**
 * A learning — candidate or promoted. The Phase 5 extractor produces
 * candidates; the gate + accrual + hazard cores decide promotion / expiry.
 * Persisted as `learning_records` (migration 114).
 */
export interface LearningRecord {
  id: string;
  tenantId: string;
  /** Stable lookup key (e.g. "grounding:WORKER_RESEARCH:web_search"). */
  key: string;
  kind: LearningKind;
  source: LearningSource;
  /** The learned content (structured value — repair preference, pattern, plan-shape). */
  value: Record<string, unknown>;
  /** Human-readable summary for audit + cockpit. */
  summary: string;
  status: LearningStatus;
  /** Correlation tags — the task type / agent / tool / failure class this learning concerns. */
  tags: string[];
  /** Failure class this learning is about, when sourced from a diagnosis. */
  failureClass?: FailureClass;
  /** Outcome verdict this learning generalises from. */
  outcomeVerdict?: OutcomeVerdict;
  /** Task verdict this learning generalises from. */
  taskVerdict?: TaskVerdict;
  /** Innovation #2 — the contingency table that gated promotion. */
  contingency?: ContingencyTable;
  /** Innovation #2 — the mutual-information value measured at promotion. */
  mutualInformation?: number;
  /** Innovation #10 — the hazard model governing this learning's expiry. */
  hazard?: HazardModel;
  /** Evidence cluster that produced this learning (innovation #5). */
  evidenceClusterId?: string;
  /** 0..1 confidence (promoted: posterior predictive; candidate: prior). */
  confidence: number;
  createdAt: string;
  promotedAt?: string;
  expiredAt?: string;
}

/** A candidate the extractor emits; the gate consumes it. */
export interface LearningCandidate {
  key: string;
  kind: LearningKind;
  source: LearningSource;
  value: Record<string, unknown>;
  summary: string;
  tags: string[];
  failureClass?: FailureClass;
  outcomeVerdict?: OutcomeVerdict;
  taskVerdict?: TaskVerdict;
  /** Initial contingency table (often a single observation — grown over time). */
  contingency: ContingencyTable;
  confidence: number;
}

/** The promotion decision the gate emits for one candidate. */
export interface LearningPromotion {
  candidate: LearningCandidate;
  promoted: boolean;
  mutualInformation: number;
  reason: string;
}