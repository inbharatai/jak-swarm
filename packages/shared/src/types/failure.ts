/**
 * failure.ts — unified failure taxonomy + repair-state structs for the
 * HyperAgent self-healing layer.
 *
 * Why this exists (HyperAgent spec, Phase 2): the repo had TWO inconsistent
 * retry mechanisms (verifier-node.ts `MAX_RETRIES=2` on `${task.id}_retries`
 * inside taskResults vs edges.ts `MAX_TASK_RETRIES=3` on `taskRetryCount` in
 * state — different ceilings, different storage, the 3-ceiling effectively dead
 * code) and an 11-class `ErrorClass` in repair-service.ts that conflated several
 * distinct failure modes. This file replaces both with ONE typed taxonomy
 * (20 `FailureClass`es) and ONE `TaskRepairState` shape, governed by the
 * `RepairBudget` from hyperagent.ts.
 *
 * RepairLevel maps to the spec's R1–R5:
 *   R1 execution retry · R2 output correction · R3 plan repair
 *   R4 configuration repair (shadow/canary first) · R5 code repair (draft PR)
 */

// ─── Failure taxonomy (20 classes) ──────────────────────────────────────────
export enum FailureClass {
  TRANSIENT_PROVIDER = 'TRANSIENT_PROVIDER',
  RATE_LIMIT = 'RATE_LIMIT',
  TOOL_UNAVAILABLE = 'TOOL_UNAVAILABLE',
  TOOL_BAD_INPUT = 'TOOL_BAD_INPUT',
  MISSING_CONTEXT = 'MISSING_CONTEXT',
  MISSING_CREDENTIAL = 'MISSING_CREDENTIAL',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  PROMPT_INJECTION = 'PROMPT_INJECTION',
  POLICY_BLOCK = 'POLICY_BLOCK',
  OUTPUT_SCHEMA = 'OUTPUT_SCHEMA',
  HALLUCINATION = 'HALLUCINATION',
  GROUNDING_FAILURE = 'GROUNDING_FAILURE',
  PLAN_DEPENDENCY = 'PLAN_DEPENDENCY',
  WRONG_AGENT = 'WRONG_AGENT',
  WRONG_TOOL = 'WRONG_TOOL',
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
  TIMEOUT = 'TIMEOUT',
  CAPABILITY_GAP = 'CAPABILITY_GAP',
  EXTERNAL_STATE_CHANGED = 'EXTERNAL_STATE_CHANGED',
  UNKNOWN = 'UNKNOWN',
}

/** Repair levels R1–R5 (spec §1). */
export enum RepairLevel {
  R1_EXECUTION_RETRY = 'R1_EXECUTION_RETRY',
  R2_OUTPUT_CORRECTION = 'R2_OUTPUT_CORRECTION',
  R3_PLAN_REPAIR = 'R3_PLAN_REPAIR',
  R4_CONFIG_REPAIR = 'R4_CONFIG_REPAIR',
  R5_CODE_REPAIR = 'R5_CODE_REPAIR',
}

/**
 * Structured failure envelope — every agent/tool failure MUST produce one of
 * these. Do not diagnose from arbitrary log strings alone (spec §6 Step 1).
 */
export interface ExecutionFailure {
  workflowId: string;
  taskId: string;
  agentRole: string;
  toolName?: string;
  errorClass: FailureClass;
  message: string;
  /** Whether a same-input retry could plausibly succeed (R1 territory). */
  retryable: boolean;
  /** Whether the failure may have left an external side effect (never auto-retry if true + ambiguous). */
  externalSideEffectPossible: boolean;
  /** Stable hash of the task input — for dedup/replay correlation. */
  inputHash: string;
  /** Plan version the failure occurred under — for selective invalidation (Phase 4). */
  stateVersion: number;
  occurredAt: string; // ISO timestamp — callers stamp it (no Date.now in hot paths that must be deterministic).
}

/**
 * Per-task unified repair accounting — replaces the split retry counters.
 * ONE source of truth for execution / output / plan / capability attempts.
 */
export interface TaskRepairState {
  taskId: string;
  executionAttempts: number;
  outputRepairAttempts: number;
  planRepairAttempts: number;
  capabilityRepairAttempts: number;
  lastFailureClass?: FailureClass;
  lastDiagnosisId?: string;
  exhausted: boolean;
}

/** Result of diagnosing a failure (deterministic classifier first, LLM only for ambiguous cases — Phase 4). */
export interface FailureDiagnosis {
  id: string;
  tenantId: string;
  workflowId: string;
  taskId: string;
  failureClass: FailureClass;
  rootCause: string;
  evidence: Record<string, unknown>;
  confidence: number; // 0..1
  recommendedRepairLevel: RepairLevel;
  recommendedChanges: Record<string, unknown>;
  createdAt: string; // ISO
}

/** Kinds of plan repair the Replanner may propose (Phase 4 consumes this). */
export type RepairType =
  | 'MODIFY_TASK'
  | 'REPLACE_AGENT'
  | 'REPLACE_TOOL'
  | 'ADD_PREREQUISITE'
  | 'SPLIT_TASK'
  | 'REORDER_TASKS'
  | 'REDUCE_SCOPE'
  | 'REQUEST_INPUT'
  | 'ESCALATE';

/** A proposed repair (the Replanner emits these; Phase 4 validates + applies). */
export interface RepairProposal {
  id: string;
  diagnosisId: string;
  repairType: RepairType;
  repairLevel: RepairLevel;
  reason: string;
  expectedImprovement: number; // 0..1
  additionalRisk: import('./workflow.js').RiskLevel;
  requiresApproval: boolean;
  changedTaskIds: string[];
  invalidatedTaskIds: string[];
  createdAt: string; // ISO
}