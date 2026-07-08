/**
 * plan-repair.ts — HyperAgent Phase 4 types for genuine plan repair.
 *
 * The spec (§6 Step 4 + §13 Phase 4) requires a Replanner that changes the
 * plan rather than re-sending the same task to the same worker. Every revised
 * plan must pass schema / DAG / dependency / tool / agent / ability-pack /
 * autonomy / cost / risk / approval / idempotency validation, must never
 * repeat completed external actions, and must be versioned with full history.
 *
 * These types are pure data. The symbolic validation logic lives in
 * `packages/swarm/src/hyperagent/plan-validator.ts` (Innovation #3: the
 * Replanner is a constrained symbolic search — an LLM may propose, but a
 * deterministic layer validates and picks, so no cyclic / invalid / unsafe
 * plan can ever be applied).
 */

import type { RiskLevel } from './workflow.js';
import type { AgentRole } from './agent.js';
import type { WorkflowPlan, WorkflowTask } from './workflow.js';
import type { FailureDiagnosis, RepairType } from './failure.js';
import type { AutonomyDecision } from './hyperagent.js';
import type { CounterfactualReplayHint } from './outcome.js';

/**
 * Result of a replan — the spec's `ReplanResult` (§6 Step 4). The Replanner
 * returns one of these; the graph applies `updatedPlan` only if `valid` is
 * true and the autonomy decision permits it.
 */
export interface ReplanResult {
  repairType: RepairType;
  /** The revised plan. Undefined when the replanner escalated / rejected. */
  updatedPlan?: WorkflowPlan;
  /** Tasks whose definition changed (must be re-executed). */
  changedTaskIds: string[];
  /** Tasks whose outputs are no longer valid (downstream of a changed task). */
  invalidatedTaskIds: string[];
  /** Completed tasks whose outputs + signed approvals + receipts are preserved. */
  retainedCompletedTaskIds: string[];
  reason: string;
  /** 0..1 — the replanner's estimate of how much the repair improves success. */
  expectedImprovement: number;
  additionalRisk: RiskLevel;
  requiresApproval: boolean;
  /** True when the symbolic validator (plan-validator.ts) accepted the plan. */
  valid: boolean;
  /** Validation violations when `valid` is false. */
  validationIssues: PlanValidationIssue[];
  /** The autonomy decision governing whether this replan may auto-apply. */
  autonomy?: AutonomyDecision;
  /** Whether the replanner gave up and escalated to a human. */
  escalated: boolean;
}

/**
 * One validation violation from the symbolic plan validator.
 * Codes mirror the spec's "Every revised plan must pass" list.
 */
export interface PlanValidationIssue {
  code:
    | 'CYCLE'
    | 'DANGLING_DEPENDENCY'
    | 'UNKNOWN_TOOL'
    | 'UNKNOWN_AGENT'
    | 'TOOL_NOT_PERMITTED'
    | 'AGENT_NOT_PERMITTED'
    | 'COST_OVER_BUDGET'
    | 'RISK_SILENTLY_DECREASED'
    | 'DESTRUCTIVE_AUTO_APPROVED'
    | 'COMPLETED_EXTERNAL_REPEATED'
    | 'IDEMPOTENCY_KEY_STRIPPED'
    | 'TASK_COUNT_OVER_LIMIT'
    | 'EMPTY_PLAN'
    | 'INVALID_TASK';
  message: string;
  taskId?: string;
}

/** Outcome of validating a revised plan. */
export interface PlanValidationResult {
  valid: boolean;
  issues: PlanValidationIssue[];
}

/**
 * A versioned snapshot of a plan. The spec mandates: "Version every plan and
 * store the complete plan history." `version` is monotonic per workflow;
 * `parentVersionId` chains the history; `diff` records what the replanner changed.
 */
export interface PlanVersion {
  version: number;
  planId: string;
  plan: WorkflowPlan;
  /** Previous version this one was derived from (undefined for the initial plan). */
  parentVersionId?: number;
  /** Why this version was created (e.g. "R3 replan: WRONG_AGENT on task t_3"). */
  changeReason: string;
  /** Failure diagnosis that triggered this version, if any. */
  triggeringDiagnosisId?: string;
  /** Repair type that produced this version. */
  repairType?: RepairType;
  changedTaskIds: string[];
  invalidatedTaskIds: string[];
  createdAt: string; // ISO — callers stamp it
}

/**
 * Result of an Innovation #1 counterfactual replay. For a failed task, the
 * diagnostician replays three single-variable variants on a sandboxed clone
 * — hold the agent, hold the tool, hold the model — and records which
 * dimension(s) flipping changed the outcome. That isolates the fault
 * dimension instead of LLM-guessing a root cause from log strings.
 */
export interface CounterfactualReplayResult {
  taskId: string;
  /** Per-variant outcome: did flipping this dimension make the task pass? */
  variants: Array<{
    dimension: 'agent-only' | 'tool-only' | 'model-only';
    /** True when the variant flipped the outcome from fail → pass. */
    faultIsolated: boolean;
    note: string;
  }>;
  /** The dimension whose flip isolated the fault, if any. */
  isolatedDimension?: 'agent-only' | 'tool-only' | 'model-only';
  /** Whether the replay was actually executed (false when no sandboxed re-executor was injected). */
  executed: boolean;
}

/**
 * The full context the Replanner consumes (spec §13 Phase 4 input list).
 * Everything the symbolic search needs to propose + validate a repair.
 */
export interface ReplanContext {
  originalGoal: string;
  originalPlan: WorkflowPlan;
  currentPlanVersion: number;
  /** Successful task outputs keyed by taskId — preserved, never re-executed. */
  successfulTaskOutputs: Record<string, unknown>;
  /** Tasks that completed with an external side effect (receipts / emails / publishes). */
  completedExternalTaskIds: string[];
  failedTask: WorkflowTask;
  /** Verifier findings for the failed task. */
  verifierIssues: string[];
  /** Deterministic + counterfactual diagnosis. */
  diagnosis: FailureDiagnosis;
  counterfactual?: CounterfactualReplayResult;
  /** Permitted worker roles for this tenant / run. */
  permittedAgents: AgentRole[];
  /** Permitted tool names for this tenant / run (allowlist intersect registry). */
  permittedTools: string[];
  /**
   * Optional tenant-configured equivalence map: tool → equivalent alternatives,
   * most-preferred first. The replanner uses this for REPLACE_TOOL repairs
   * (TOOL_UNAVAILABLE / WRONG_TOOL). Empty/absent = no auto-substitution
   * (the replanner escalates rather than guessing an equivalent).
   */
  toolAlternates?: Readonly<Record<string, string[]>>;
  /** Remaining repair budget. */
  budgetRemaining: {
    planRepairs: number;
    executionRetries: number;
    outputRepairs: number;
    costUsd: number;
    durationMs: number;
  };
  /** Autonomy decision for REPLAN_WITHIN_APPROVED at the current level. */
  autonomy: AutonomyDecision;
  /** Relevant learnings retrieved for this task type (Phase 5 populates; empty until then). */
  relevantLearnings: ReadonlyArray<{ key: string; summary: string; confidence: number }>;
  /** Hard ceiling on tasks per plan (defensive). */
  maxTasks: number;
}

/** What the diagnosis node writes into state. */
export interface DiagnosisRecord {
  diagnosis: FailureDiagnosis;
  counterfactual?: CounterfactualReplayResult;
  hint: CounterfactualReplayHint;
}

/**
 * The HyperAgent-state slice added to SwarmState in Phase 4 (spec §4
 * HyperAgentState). Kept narrow to what Phase 4 actually populates; later
 * phases extend it. All fields default safely so existing workflows are
 * unaffected when `hyperAgentMode === OFF`.
 */
export interface HyperAgentStateSlice {
  executionMode: 'standard' | 'hyperagent' | 'shadow';
  activePlanVersion: number;
  planHistory: PlanVersion[];
  taskRepairState: Record<string, import('./failure.js').TaskRepairState>;
  failureDiagnoses: Record<string, FailureDiagnosis>;
  repairProposals: ReplanResult[];
  hyperAgentIteration: number;
  maxHyperAgentIterations: number;
  /** Diagnoses waiting to be consumed by the replanner, keyed by taskId. */
  pendingDiagnoses: Record<string, DiagnosisRecord>;
}