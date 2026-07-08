/**
 * spec.ts — HyperAgent Phase 6 approved-spec closed-loop types.
 *
 * The spec (§13 Phase 6) requires an APPROVED AgentExecutableSpec to drive a
 * closed loop: materialise its `agentTaskPlan` into a runnable WorkflowPlan,
 * execute it, harvest run evidence, and MEASURE that evidence against the spec's
 * `acceptanceCriteria` — deterministically, never faking a satisfied criterion.
 *
 * This file is the typed shape of the AgentExecutableSpec that the Prisma model
 * `agent_executable_specs` (Json columns) stores opaquely. Phase 6 makes the
 * acceptance criteria STRUCTURED so a deterministic checker can bind them to
 * runtime evidence (the outcome-evaluator's honest `wired=false` seam flips
 * true here). Criteria that cannot be bound (CUSTOM) stay `wired=false` and
 * surface an explicit UNVERIFIABLE verdict instead of being silently passed.
 *
 * Pure data — the logic lives in packages/swarm/src/hyperagent.
 */
import type { AgentRole } from './agent.js';
import type { RiskLevel } from './workflow.js';
import type { FailureClass } from './failure.js';
import type { TaskOutcome } from './outcome.js';

/** Lifecycle of an AgentExecutableSpec (mirrors the Prisma `status` column). */
export type SpecStatus = 'draft' | 'approved' | 'rejected';

/**
 * Kind of acceptance criterion. The deterministic checker binds each kind to a
 * concrete runtime evidence source; CUSTOM criteria have no deterministic
 * binding and surface as UNVERIFIABLE rather than silently satisfied.
 */
export enum AcceptanceCriterionKind {
  /** A named task reached TASK_PASSED. */
  TASK_COMPLETED = 'TASK_COMPLETED',
  /** A named task was verifier-passed (verified === true AND TASK_PASSED). */
  TASK_VERIFIED = 'TASK_VERIFIED',
  /** A named evidence artifact was produced / referenced by the run. */
  ARTIFACT_PRESENT = 'ARTIFACT_PRESENT',
  /** A named numeric metric satisfied a threshold comparison. */
  METRIC_THRESHOLD = 'METRIC_THRESHOLD',
  /** No task failed with the given failure class. */
  NO_FAILURE_CLASS = 'NO_FAILURE_CLASS',
  /** Human-judgement criterion — no deterministic binding (stays unwired). */
  CUSTOM = 'CUSTOM',
}

/** Comparison operator for a METRIC_THRESHOLD criterion. */
export type MetricOperator = 'gte' | 'lte' | 'gt' | 'lt' | 'eq';

/** A named metric threshold the run's harvested metrics are checked against. */
export interface MetricThreshold {
  name: string;
  operator: MetricOperator;
  threshold: number;
}

/** One structured acceptance criterion the closed loop measures. */
export interface AcceptanceCriterion {
  id: string;
  description: string;
  kind: AcceptanceCriterionKind;
  /** Task id for TASK_COMPLETED / TASK_VERIFIED. */
  taskId?: string;
  /** Artifact id for ARTIFACT_PRESENT. */
  artifactId?: string;
  /** Metric threshold for METRIC_THRESHOLD. */
  metric?: MetricThreshold;
  /** Failure class for NO_FAILURE_CLASS. */
  failureClass?: FailureClass;
}

/** Minimal task descriptor inside a spec's agentTaskPlan. */
export interface SpecTaskDescriptor {
  id: string;
  name: string;
  description: string;
  agentRole: AgentRole;
  toolsRequired: string[];
  riskLevel?: RiskLevel;
  dependsOn?: string[];
  requiresApproval?: boolean;
  retryable?: boolean;
  maxRetries?: number;
}

/** The spec's executable plan — materialised into a WorkflowPlan by the executor. */
export interface SpecTaskPlan {
  tasks: SpecTaskDescriptor[];
}

/**
 * The typed AgentExecutableSpec. The Prisma model stores `acceptanceCriteria`,
 * `testPlan`, `agentTaskPlan`, `approvalGates`, `evidenceArtifactIds`, and
 * `evidenceEntityIds` as Json; this interface is the typed view the HyperAgent
 * layer operates on. Callers are responsible for validating the Json shape on
 * load (a malformed spec must never reach the executor — see spec-executor.ts).
 */
export interface AgentExecutableSpec {
  id: string;
  tenantId: string;
  title: string;
  problemStatement: string;
  objective: string;
  contextSummary: string;
  proposedApproach: string;
  acceptanceCriteria: AcceptanceCriterion[];
  testPlan: unknown;
  agentTaskPlan: SpecTaskPlan;
  approvalGates: unknown;
  evidenceArtifactIds: string[];
  evidenceEntityIds: string[];
  status: SpecStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

/**
 * The runtime evidence the acceptance checker binds criteria against. Harvested
 * from a finished run: the outcome evaluator's task triage, the artifact ids
 * the run produced/referenced, and named numeric metrics (cost, latency, counts).
 */
export interface RunEvidence {
  taskOutcomes: TaskOutcome[];
  artifacts: string[];
  metrics: Record<string, number>;
}

/** Verdict the acceptance checker reaches over a set of criterion results. */
export enum AcceptanceVerdict {
  /** ≥1 wired criterion AND every wired criterion satisfied. */
  MET = 'MET',
  /** Some wired criterion was NOT satisfied. */
  UNMET = 'UNMET',
  /** Zero wired criteria — every criterion is CUSTOM (no deterministic binding). */
  UNVERIFIABLE = 'UNVERIFIABLE',
}