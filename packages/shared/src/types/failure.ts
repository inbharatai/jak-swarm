/**
 * failure.ts — unified failure taxonomy + repair-state structs for the
 * HyperAgent self-healing layer.
 *
 * Why this exists (HyperAgent spec, Phase 2): the repo previously had TWO
 * inconsistent retry mechanisms (verifier-node.ts `MAX_RETRIES=2` on
 * `${task.id}_retries` inside taskResults vs edges.ts `MAX_TASK_RETRIES=3` on
 * `taskRetryCount` — different ceilings, different storage, the 3-ceiling
 * effectively dead code). The live same-input R1/R2 loop has since been
 * unified on `taskRetryCount` + a single shared `MAX_TASK_RETRIES` ceiling
 * (see edges.ts / verifier-node.ts); this file additionally provides ONE typed
 * taxonomy (20 `FailureClass`es) and ONE `TaskRepairState` shape, governed by
 * the `RepairBudget` from hyperagent.ts.
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

/**
 * R2 CORRECT_OUTPUT typed correction (HyperAgent Phase 5).
 *
 * Emitted by the verifier when a task fails verification with `needsRetry` AND
 * the failure classifies as a malformed-output class (`OUTPUT_SCHEMA` /
 * `TOOL_BAD_INPUT`). The `afterVerifier` edge consults the autonomy policy
 * (`AutonomyCapability.CORRECT_OUTPUT`, min level L2) and, when permitted +
 * within the `outputRepairAttempts` budget, routes back to the worker with
 * this correction threaded into the next pass's prompt — instead of a blind
 * same-input retry. This is a DISTINCT counter
 * (`taskRepairState[taskId].outputRepairAttempts`) from the legacy
 * `taskRetryCount` same-input loop; both honor the shared `MAX_TASK_RETRIES`
 * ceiling. Default workflows (HyperAgent OFF / L0–L1) never emit/consume it.
 */
export interface OutputCorrection {
  taskId: string;
  /** Classified failure class that triggered the correction (OUTPUT_SCHEMA | TOOL_BAD_INPUT). */
  failureClass: FailureClass;
  /** The verifier's issue list for the failed pass. */
  issues: string[];
  /** Optional schema/shape hint the output should satisfy (derived from issues when present). */
  expectedSchema?: string;
  /** Agent-facing instruction appended to the next worker pass's task description. */
  correctionPrompt: string;
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

// ─── Classifier signal + result (Phase 2/4) ──────────────────────────────────
// These are pure data types. The classification LOGIC lives in
// packages/swarm/src/recovery/failure-classifier.ts; the types live here so
// the agents package (FailureDiagnosticianAgent) can type its LLM-diagnose
// input without importing from swarm (which would be a circular dependency:
// swarm → agents → swarm).

/** Input to the deterministic classifier — whatever signals the runtime has. */
export interface FailureSignal {
  message: string;
  toolName?: string;
  /** HTTP status or provider error code, if any. */
  statusCode?: number;
  /**
   * Legacy ErrorClass string from repair-service.ts, if already classified.
   * Typed loosely as `string` here to avoid a circular shared→swarm type
   * import; the classifier's `mapLegacyErrorClass` switch maps any unknown
   * string to UNKNOWN via its default branch.
   */
  legacyClass?: string;
  /** Hint from the caller: did the tool declare external side effects? */
  toolHadExternalSideEffect?: boolean;
  /** True if the failure happened before any tool actually executed. */
  failedBeforeExecution?: boolean;
}

/** Result of the deterministic classifier (Phase 2). */
export interface ClassificationResult {
  errorClass: FailureClass;
  retryable: boolean;
  externalSideEffectPossible: boolean;
  recommendedRepairLevel: RepairLevel;
  /** True when the repair path requires a human approval (never bypassed). */
  requiresApproval: boolean;
  /** True when the input should be quarantined (prompt injection, etc.). */
  quarantine: boolean;
  reason: string;
}