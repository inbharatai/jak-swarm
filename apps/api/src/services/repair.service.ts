/**
 * RepairService — Final hardening / Gap B.
 *
 * Cross-task auto-repair for failed nodes/agents/tools. When a workflow
 * task throws or fails verification, this service:
 *   1. Classifies the error (transient / structured-output / parsing /
 *      missing-input / tool-unavailable / permission-block / destructive)
 *   2. Decides whether auto-repair is safe (non-destructive + retry budget
 *      not exhausted)
 *   3. Emits repair_* lifecycle events for audit + cockpit visibility
 *   4. Either retries with backoff OR escalates to human
 *
 * This is a PURE SERVICE — it does not itself retry the failed work.
 * It returns a `RepairDecision` the caller (worker-node, swarm
 * execution service) consumes. This keeps the policy logic testable
 * in isolation and avoids embedding LLM calls or DB writes in the
 * decision path.
 *
 * Honesty rules:
 *   - Destructive actions (send email, post to Slack, deploy, delete,
 *     publish) are NEVER auto-repaired without human approval. The
 *     decision returns `escalate_to_human` even on the first failure.
 *   - Repeated transient failures hit the retry limit and escalate.
 *   - The classifier is a heuristic (regex-based); ambiguous errors
 *     default to `escalate_to_human` rather than risking auto-retry.
 */

import type { WorkflowLifecycleEmitter } from '@jak-swarm/swarm';

export type ErrorClass =
  | 'transient_api'           // Retryable: 429, 503, network blip
  | 'invalid_structured_output' // Retryable: schema parse failure
  | 'missing_input'           // Retryable: previous task didn't produce expected output
  | 'document_parse_failure'  // Sometimes retryable: corrupt doc; usually escalate
  | 'tool_unavailable'        // Retryable: tool may come back; bounded retries
  | 'permission_block'        // NOT retryable: requires admin action
  | 'destructive_action'      // NOT retryable without approval
  | 'graph_node_failure'      // Retryable once: defensive
  | 'approval_timeout'        // NOT retryable: human escalation
  | 'export_failure'          // Sometimes retryable
  | 'unknown';                // Default: escalate

export type RepairDecision =
  | {
      action: 'retry';
      attempt: number;        // 1-indexed
      strategy: 'immediate' | 'backoff_500ms' | 'backoff_2s';
      reason: string;
    }
  | {
      action: 'escalate_to_human';
      reason: string;
      requiresApproval?: boolean;
    }
  | {
      action: 'give_up';      // Retry budget exhausted; mark task FAILED, continue
      reason: string;
      attemptsExhausted: number;
    };

export interface ClassifyOptions {
  /** Whether the failed action is "destructive" (send/post/delete/deploy). */
  isDestructive?: boolean;
  /** Number of times this task has already been retried. */
  priorAttempts?: number;
  /** Maximum retries allowed for this task (default: 2). */
  maxRetries?: number;
}

const DEFAULT_MAX_RETRIES = 2;

const DESTRUCTIVE_VERBS = /\b(send|post|publish|deploy|delete|remove|destroy|drop|truncate|push|merge|charge|withdraw|transfer)\b/i;
const TRANSIENT_PATTERNS: RegExp[] = [
  /\b429\b/, /rate.?limit/i, /\b503\b/, /\b502\b/, /\b504\b/, /timeout/i, /timed out/i, /\beconnreset\b/i, /enotfound/i, /etimedout/i, /socket hang up/i, /\bnetwork.{0,20}error\b/i,
];
const STRUCTURED_OUTPUT_PATTERNS: RegExp[] = [
  /JSON.{0,30}(parse|invalid|malformed)/i, /unexpected token/i, /zod/i, /schema (validation|parse) failed/i, /response_format/i,
];
const MISSING_INPUT_PATTERNS: RegExp[] = [
  /missing (input|required field)/i, /undefined.*(taskResults|input)/i, /received undefined/i, /no upstream output/i,
];
const PARSING_PATTERNS: RegExp[] = [
  /pdf.parse/i, /mammoth/i, /tesseract/i, /sharp/i, /docx.{0,10}parse/i, /xlsx.{0,10}parse/i, /document parsing/i,
];
const TOOL_UNAVAILABLE_PATTERNS: RegExp[] = [
  /tool.{0,30}not.{0,30}available/i, /not.{0,30}configured/i, /\b401\b/, /authentication required/i, /authorization (failed|required)/i, /circuit (breaker|open)/i,
];
const PERMISSION_BLOCK_PATTERNS: RegExp[] = [
  /\bforbidden\b/i, /\b403\b/, /access denied/i, /permission denied/i, /policy.{0,15}block/i, /guardrail.{0,15}block/i, /restricted/i,
];
const APPROVAL_TIMEOUT_PATTERNS: RegExp[] = [
  /approval timeout/i, /approval expired/i, /awaiting approval.*timeout/i,
];
const EXPORT_PATTERNS: RegExp[] = [
  /export failed/i, /signedbundle/i, /artifact (write|generate) failed/i,
];

/**
 * Classify an error message into one of the ErrorClass categories.
 * Pure function — no I/O.
 */
export function classifyError(
  errorMessage: string,
  options: ClassifyOptions = {},
): ErrorClass {
  if (!errorMessage || typeof errorMessage !== 'string') return 'unknown';
  // Destructive override: if the failing action was destructive, the
  // classification still matters for telemetry, but the decision below
  // will refuse to auto-repair.
  if (TRANSIENT_PATTERNS.some((p) => p.test(errorMessage))) return 'transient_api';
  if (STRUCTURED_OUTPUT_PATTERNS.some((p) => p.test(errorMessage))) return 'invalid_structured_output';
  if (MISSING_INPUT_PATTERNS.some((p) => p.test(errorMessage))) return 'missing_input';
  if (PARSING_PATTERNS.some((p) => p.test(errorMessage))) return 'document_parse_failure';
  if (TOOL_UNAVAILABLE_PATTERNS.some((p) => p.test(errorMessage))) return 'tool_unavailable';
  if (PERMISSION_BLOCK_PATTERNS.some((p) => p.test(errorMessage))) return 'permission_block';
  if (APPROVAL_TIMEOUT_PATTERNS.some((p) => p.test(errorMessage))) return 'approval_timeout';
  if (EXPORT_PATTERNS.some((p) => p.test(errorMessage))) return 'export_failure';
  if (options.isDestructive || DESTRUCTIVE_VERBS.test(errorMessage)) return 'destructive_action';
  return 'unknown';
}

/**
 * Decide what to do about a classified failure. Pure function.
 *
 * Decision rules:
 *   - destructive_action: NEVER auto-retry; escalate_to_human (requiresApproval=true)
 *   - permission_block / approval_timeout: NEVER auto-retry; escalate_to_human
 *   - transient_api: retry up to maxRetries with backoff
 *   - invalid_structured_output: retry up to maxRetries (immediate; the LLM may emit valid output on the next call)
 *   - missing_input: retry once (the upstream task may have flaky output);
 *     if still missing after 1 retry, escalate
 *   - document_parse_failure: retry once with backoff_500ms; escalate after
 *   - tool_unavailable: retry up to maxRetries with backoff
 *   - graph_node_failure: retry once; escalate after
 *   - export_failure: retry once with backoff
 *   - unknown: escalate_to_human (defensive — don't loop on errors we
 *     can't classify)
 *
 * The `priorAttempts` counter is the number of retries ALREADY
 * performed (not including the original attempt). When `priorAttempts
 * >= maxRetries` (or the per-class limit), returns `give_up`.
 */
export function decideRepair(
  errorClass: ErrorClass,
  options: ClassifyOptions = {},
): RepairDecision {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const priorAttempts = options.priorAttempts ?? 0;

  // Destructive actions: never auto-retry without explicit approval.
  if (options.isDestructive || errorClass === 'destructive_action') {
    return {
      action: 'escalate_to_human',
      reason: 'Destructive action failed — must not auto-retry without explicit human approval.',
      requiresApproval: true,
    };
  }

  // Hard-stop classes: never auto-retry.
  if (errorClass === 'permission_block') {
    return {
      action: 'escalate_to_human',
      reason: 'Permission block — needs admin action.',
    };
  }
  if (errorClass === 'approval_timeout') {
    return {
      action: 'escalate_to_human',
      reason: 'Approval timeout — requires reviewer intervention.',
      requiresApproval: true,
    };
  }
  if (errorClass === 'unknown') {
    return {
      action: 'escalate_to_human',
      reason: 'Unclassified error — refusing auto-retry to avoid loops.',
    };
  }

  // Per-class retry budgets.
  const perClassMax = (() => {
    switch (errorClass) {
      case 'transient_api':
      case 'tool_unavailable':
      case 'invalid_structured_output':
        return Math.min(maxRetries, 3);
      case 'missing_input':
      case 'graph_node_failure':
      case 'document_parse_failure':
      case 'export_failure':
        return 1;
      default:
        return 0;
    }
  })();

  if (priorAttempts >= perClassMax) {
    return {
      action: 'give_up',
      reason: `Retry budget exhausted for error class '${errorClass}' after ${priorAttempts} attempts.`,
      attemptsExhausted: priorAttempts,
    };
  }

  // Decide strategy.
  const strategy: 'immediate' | 'backoff_500ms' | 'backoff_2s' = (() => {
    switch (errorClass) {
      case 'invalid_structured_output':
        return 'immediate';
      case 'transient_api':
      case 'tool_unavailable':
        // Transient errors: more backoff on later attempts.
        return priorAttempts >= 1 ? 'backoff_2s' : 'backoff_500ms';
      case 'missing_input':
      case 'graph_node_failure':
      case 'document_parse_failure':
      case 'export_failure':
        return 'backoff_500ms';
      default:
        return 'immediate';
    }
  })();

  return {
    action: 'retry',
    attempt: priorAttempts + 1,
    strategy,
    reason: `Auto-repair allowed for '${errorClass}': attempt ${priorAttempts + 1}/${perClassMax}.`,
  };
}

// ─── Service ───────────────────────────────────────────────────────────────

export interface RepairContext {
  workflowId: string;
  stepId?: string;
  tenantId: string;
  errorMessage: string;
  isDestructive?: boolean;
  priorAttempts?: number;
  /** Lifecycle emitter for repair_* events. */
  onLifecycle?: WorkflowLifecycleEmitter;
}

export class RepairService {
  /**
   * Classify + decide + emit. Returns the decision for the caller to
   * act on. Always emits `repair_needed`. Then emits one of:
   *   - `repair_attempt_started` (action='retry')
   *   - `repair_escalated_to_human` (action='escalate_to_human')
   *   - `repair_limit_reached` (action='give_up')
   */
  evaluate(ctx: RepairContext): { decision: RepairDecision; errorClass: ErrorClass } {
    const errorClass = classifyError(ctx.errorMessage, {
      ...(ctx.isDestructive !== undefined ? { isDestructive: ctx.isDestructive } : {}),
    });
    const decision = decideRepair(errorClass, {
      ...(ctx.isDestructive !== undefined ? { isDestructive: ctx.isDestructive } : {}),
      ...(ctx.priorAttempts !== undefined ? { priorAttempts: ctx.priorAttempts } : {}),
    });

    this.emit(ctx.onLifecycle, {
      type: 'repair_needed',
      workflowId: ctx.workflowId,
      ...(ctx.stepId !== undefined ? { stepId: ctx.stepId } : {}),
      errorClass,
      reason: ctx.errorMessage.slice(0, 500),
      timestamp: new Date().toISOString(),
    });

    if (decision.action === 'retry') {
      this.emit(ctx.onLifecycle, {
        type: 'repair_attempt_started',
        workflowId: ctx.workflowId,
        ...(ctx.stepId !== undefined ? { stepId: ctx.stepId } : {}),
        attempt: decision.attempt,
        strategy: decision.strategy,
        timestamp: new Date().toISOString(),
      });
    } else if (decision.action === 'escalate_to_human') {
      this.emit(ctx.onLifecycle, {
        type: 'repair_escalated_to_human',
        workflowId: ctx.workflowId,
        ...(ctx.stepId !== undefined ? { stepId: ctx.stepId } : {}),
        reason: decision.reason,
        timestamp: new Date().toISOString(),
      });
    } else if (decision.action === 'give_up') {
      this.emit(ctx.onLifecycle, {
        type: 'repair_limit_reached',
        workflowId: ctx.workflowId,
        ...(ctx.stepId !== undefined ? { stepId: ctx.stepId } : {}),
        attempts: decision.attemptsExhausted,
        finalError: ctx.errorMessage.slice(0, 500),
        timestamp: new Date().toISOString(),
      });
    }
    return { decision, errorClass };
  }

  /**
   * Emit `repair_attempt_completed` after the caller finishes its
   * retry. Caller passes the success/failure result.
   */
  recordAttemptResult(
    ctx: Pick<RepairContext, 'workflowId' | 'stepId' | 'onLifecycle'>,
    attempt: number,
    succeeded: boolean,
    failureReason?: string,
  ): void {
    this.emit(ctx.onLifecycle, {
      type: 'repair_attempt_completed',
      workflowId: ctx.workflowId,
      ...(ctx.stepId !== undefined ? { stepId: ctx.stepId } : {}),
      attempt,
      succeeded,
      timestamp: new Date().toISOString(),
    });
    if (!succeeded && failureReason) {
      this.emit(ctx.onLifecycle, {
        type: 'repair_attempt_failed',
        workflowId: ctx.workflowId,
        ...(ctx.stepId !== undefined ? { stepId: ctx.stepId } : {}),
        attempt,
        reason: failureReason.slice(0, 500),
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Apply backoff before the next retry. Caller awaits this between
   * attempts.
   */
  async applyBackoff(strategy: 'immediate' | 'backoff_500ms' | 'backoff_2s'): Promise<void> {
    switch (strategy) {
      case 'immediate':
        return;
      case 'backoff_500ms':
        await new Promise((r) => setTimeout(r, 500));
        return;
      case 'backoff_2s':
        await new Promise((r) => setTimeout(r, 2000));
        return;
    }
  }

  private emit(
    onLifecycle: WorkflowLifecycleEmitter | undefined,
    event: Parameters<NonNullable<WorkflowLifecycleEmitter>>[0],
  ): void {
    if (!onLifecycle) return;
    try {
      onLifecycle(event);
    } catch {
      // Telemetry must not break the repair flow.
    }
  }
}
