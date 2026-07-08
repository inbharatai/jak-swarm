/**
 * failure-classifier.ts — deterministic failure classifier (HyperAgent Phase 2).
 *
 * Runs BEFORE any LLM diagnostician (Phase 4). The spec mandates: "The
 * deterministic classifier should run first. The LLM should only explain
 * ambiguous root causes … never override a deterministic security block."
 *
 * This is pure + deterministic — no LLM, no I/O — so it is fully unit-testable.
 * It maps:
 *   - the legacy 11-class `ErrorClass` (repair-service.ts) → the new 20-class
 *     `FailureClass`, so the existing safe RepairService keeps working while
 *     emitting structured records;
 *   - a raw failure signal (message / status / tool name / side-effect hint) →
 *     a `FailureClass` + `retryable` + `externalSideEffectPossible` +
 *     recommended `RepairLevel` + `requiresApproval`, per the spec §6 Step 3
 *     repair policy.
 *
 * Security invariants enforced here (never overridden by an LLM later):
 *   - PERMISSION_DENIED / POLICY_BLOCK / PROMPT_INJECTION → never retryable,
 *     always requires approval / quarantine.
 *   - UNKNOWN → never retryable (escalate, never loop).
 *   - Anything with a possible external side effect → not auto-retryable.
 */

import type { ErrorClass } from './repair-service.js';
import { FailureClass, RepairLevel } from '@jak-swarm/shared';
import type { RepairBudget, TaskRepairState } from '@jak-swarm/shared';

/** Input to the classifier — whatever signals the runtime has on hand. */
export interface FailureSignal {
  message: string;
  toolName?: string;
  /** HTTP status or provider error code, if any. */
  statusCode?: number;
  /** Legacy ErrorClass from repair-service.ts, if already classified. */
  legacyClass?: ErrorClass;
  /** Hint from the caller: did the tool declare external side effects? */
  toolHadExternalSideEffect?: boolean;
  /** True if the failure happened before any tool actually executed. */
  failedBeforeExecution?: boolean;
}

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

/**
 * The spec §6 Step 3 repair policy, as a per-class table. This is the single
 * source of truth for "what repair level does this class suggest".
 */
const POLICY: Readonly<Record<FailureClass, Omit<ClassificationResult, 'errorClass' | 'reason'>>> = Object.freeze({
  [FailureClass.TRANSIENT_PROVIDER]: { retryable: true, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R1_EXECUTION_RETRY, requiresApproval: false, quarantine: false },
  [FailureClass.RATE_LIMIT]: { retryable: true, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R1_EXECUTION_RETRY, requiresApproval: false, quarantine: false },
  [FailureClass.TIMEOUT]: { retryable: true, externalSideEffectPossible: true, recommendedRepairLevel: RepairLevel.R1_EXECUTION_RETRY, requiresApproval: false, quarantine: false },
  [FailureClass.TOOL_UNAVAILABLE]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: false, quarantine: false },
  [FailureClass.TOOL_BAD_INPUT]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R2_OUTPUT_CORRECTION, requiresApproval: false, quarantine: false },
  [FailureClass.OUTPUT_SCHEMA]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R2_OUTPUT_CORRECTION, requiresApproval: false, quarantine: false },
  [FailureClass.MISSING_CONTEXT]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: false, quarantine: false },
  [FailureClass.MISSING_CREDENTIAL]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: true, quarantine: false },
  [FailureClass.PERMISSION_DENIED]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: true, quarantine: false },
  [FailureClass.POLICY_BLOCK]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: true, quarantine: false },
  [FailureClass.PROMPT_INJECTION]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: true, quarantine: true },
  [FailureClass.HALLUCINATION]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: false, quarantine: false },
  [FailureClass.GROUNDING_FAILURE]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: false, quarantine: false },
  [FailureClass.PLAN_DEPENDENCY]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: false, quarantine: false },
  [FailureClass.WRONG_AGENT]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: false, quarantine: false },
  [FailureClass.WRONG_TOOL]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: false, quarantine: false },
  [FailureClass.BUDGET_EXCEEDED]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: true, quarantine: false },
  [FailureClass.CAPABILITY_GAP]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: true, quarantine: false },
  [FailureClass.EXTERNAL_STATE_CHANGED]: { retryable: false, externalSideEffectPossible: true, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: true, quarantine: false },
  [FailureClass.UNKNOWN]: { retryable: false, externalSideEffectPossible: false, recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR, requiresApproval: true, quarantine: false },
});

/**
 * Map the legacy 11-class ErrorClass → the new 20-class FailureClass so the
 * existing safe RepairService can emit structured records without behaviour change.
 */
export function mapLegacyErrorClass(legacy: ErrorClass): FailureClass {
  switch (legacy) {
    case 'transient_api': return FailureClass.TRANSIENT_PROVIDER;
    case 'invalid_structured_output': return FailureClass.OUTPUT_SCHEMA;
    case 'missing_input': return FailureClass.MISSING_CONTEXT;
    case 'document_parse_failure': return FailureClass.TOOL_BAD_INPUT;
    case 'tool_unavailable': return FailureClass.TOOL_UNAVAILABLE;
    case 'permission_block': return FailureClass.PERMISSION_DENIED;
    case 'destructive_action': return FailureClass.POLICY_BLOCK;
    case 'graph_node_failure': return FailureClass.UNKNOWN;
    case 'approval_timeout': return FailureClass.PERMISSION_DENIED;
    case 'export_failure': return FailureClass.TOOL_BAD_INPUT;
    case 'unknown': return FailureClass.UNKNOWN;
    default: return FailureClass.UNKNOWN;
  }
}

/** Regex signals for raw-message classification when no legacy class is given. */
const SIGNALS: ReadonlyArray<{ class: FailureClass; re: RegExp }> = Object.freeze([
  { class: FailureClass.RATE_LIMIT, re: /429|rate.?limit|too many requests|quota/i },
  { class: FailureClass.TRANSIENT_PROVIDER, re: /503|502|504|service unavailable|temporarily unavailable|econnreset|econnrefused|socket hang up|network|timeout/i },
  { class: FailureClass.TIMEOUT, re: /\btimeout\b|timed out|deadline exceeded|aborted/i },
  { class: FailureClass.PERMISSION_DENIED, re: /permission|forbidden|403|unauthorized|401|not allowed|access denied/i },
  { class: FailureClass.MISSING_CREDENTIAL, re: /missing.*(api.?key|credential|token|secret)|unconfigured|no.*credentials/i },
  { class: FailureClass.PROMPT_INJECTION, re: /injection|jailbreak|ignore previous|DAN|system prompt leaked/i },
  { class: FailureClass.POLICY_BLOCK, re: /policy|blocked by|destructive|not permitted|disallowed/i },
  { class: FailureClass.TOOL_UNAVAILABLE, re: /tool.*unavailable|not found|no such tool|connector.*(down|offline)/i },
  { class: FailureClass.OUTPUT_SCHEMA, re: /schema|parse.*fail|invalid.*output|expected.*got|zod|validation/i },
  { class: FailureClass.GROUNDING_FAILURE, re: /grounding|no citations|ungrounded|hallucinat/i },
  { class: FailureClass.BUDGET_EXCEEDED, re: /budget|cost.*limit|max.*cost|spend.*limit/i },
]);

/**
 * Classify a failure signal deterministically. Pure.
 *
 * Order of precedence:
 *   1. If the caller already has a legacy ErrorClass, map it (and let the
 *      policy table refine `retryable`/`requiresApproval`/`quarantine`).
 *   2. Else match raw signals (rate-limit → timeout → transient → …).
 *   3. Else UNKNOWN.
 * Then apply two hard invariants regardless of source:
 *   - externalSideEffectPossible ⇒ retryable = false (never auto-retry a
 *     possibly-side-effected action);
 *   - PERMISSION_DENIED / POLICY_BLOCK / PROMPT_INJECTION / UNKNOWN ⇒
 *     retryable = false (security: never loop / never bypass).
 */
export function classifyFailure(signal: FailureSignal): ClassificationResult {
  let errorClass: FailureClass;

  if (signal.legacyClass) {
    errorClass = mapLegacyErrorClass(signal.legacyClass);
  } else {
    errorClass = FailureClass.UNKNOWN;
    for (const s of SIGNALS) {
      if (s.re.test(signal.message)) {
        errorClass = s.class;
        break;
      }
    }
  }

  const policy = POLICY[errorClass];

  // External-side-effect hint from the caller overrides the table conservatively.
  const externalSideEffectPossible =
    policy.externalSideEffectPossible || (signal.toolHadExternalSideEffect === true && !signal.failedBeforeExecution);

  // Hard security invariants — never overridden.
  const hardNonRetryable =
    errorClass === FailureClass.PERMISSION_DENIED ||
    errorClass === FailureClass.POLICY_BLOCK ||
    errorClass === FailureClass.PROMPT_INJECTION ||
    errorClass === FailureClass.UNKNOWN ||
    externalSideEffectPossible;

  const retryable = policy.retryable && !hardNonRetryable;

  return {
    errorClass,
    retryable,
    externalSideEffectPossible,
    recommendedRepairLevel: policy.recommendedRepairLevel,
    requiresApproval: policy.requiresApproval,
    quarantine: policy.quarantine,
    reason: `classified as ${errorClass} (retryable=${retryable}, approval=${policy.requiresApproval}, quarantine=${policy.quarantine})`,
  };
}

/**
 * Build a fresh TaskRepairState for a task. Phase 4's replanner will mutate
 * copies of this instead of the split counters.
 */
export function freshTaskRepairState(taskId: string): TaskRepairState {
  return {
    taskId,
    executionAttempts: 0,
    outputRepairAttempts: 0,
    planRepairAttempts: 0,
    capabilityRepairAttempts: 0,
    exhausted: false,
  };
}

/**
 * Decide whether a repair budget is exhausted for a given repair level.
 * Uses the unified RepairBudget (hyperagent.ts) — the single source of truth
 * that replaces the split MAX_RETRIES=2 / MAX_TASK_RETRIES=3 counters.
 */
export function isBudgetExhausted(
  state: TaskRepairState,
  budget: RepairBudget,
  level: RepairLevel,
): boolean {
  switch (level) {
    case RepairLevel.R1_EXECUTION_RETRY:
      return state.executionAttempts >= budget.maxExecutionRetries;
    case RepairLevel.R2_OUTPUT_CORRECTION:
      return state.outputRepairAttempts >= budget.maxOutputRepairs;
    case RepairLevel.R3_PLAN_REPAIR:
      return state.planRepairAttempts >= budget.maxPlanRepairs;
    case RepairLevel.R4_CONFIG_REPAIR:
      return state.capabilityRepairAttempts >= budget.maxCapabilityRepairs;
    case RepairLevel.R5_CODE_REPAIR:
      // R5 is always human-gated; treat the capability budget as the ceiling.
      return state.capabilityRepairAttempts >= budget.maxCapabilityRepairs;
    default:
      return true; // unknown level → exhausted (fail closed)
  }
}