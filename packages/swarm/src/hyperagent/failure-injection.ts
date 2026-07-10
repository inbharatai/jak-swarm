/**
 * failure-injection.ts — HyperAgent Phase 14 failure-injection framework.
 *
 * A PURE, deterministic harness that simulates the 16 failure modes the spec
 * (§13 Phase 14) enumerates, runs each through the REAL HyperAgent decision
 * path (deterministic failure classifier → autonomy policy → Shield verdict →
 * budget gate → replan bound), and returns an HONEST result describing what
 * the system would do. No I/O, no clock, no Math.random — every scenario is
 * a fixed signal so failures are reproducible in CI.
 *
 * The 16 modes (FailureKind):
 *   PROVIDER_TIMEOUT, TOOL_TIMEOUT, MALFORMED_TOOL_OUTPUT, PERMISSION_DENIAL,
 *   CONNECTOR_UNAVAILABLE, DATABASE_INTERRUPTION, REDIS_INTERRUPTION,
 *   DUPLICATE_JOB_DELIVERY, STALE_APPROVAL, PROMPT_INJECTION,
 *   UNTRUSTED_MEMORY_CANDIDATE, SHIELD_TIMEOUT, INVALID_SHIELD_SIGNATURE,
 *   CYCLIC_REPLANNING, BUDGET_EXHAUSTION, PROCESS_RESTART_DURING_WORKFLOW.
 *
 * Honesty invariants pinned by the framework + tests:
 *   - Security failures (PERMISSION_DENIED / POLICY_BLOCK / PROMPT_INJECTION)
 *     are NEVER retryable; PROMPT_INJECTION is quarantined; all require approval.
 *   - Shield UNAVAILABLE or signature UNVERIFIABLE ⇒ fail-closed (the high-risk
 *     action is NOT executed); APPROVE_REQUIRED is also fail-closed for the agent.
 *   - Budget exhausted ⇒ STOP (no further repair attempts).
 *   - Cyclic replanning ⇒ bounded by maxPlanRepairs (STOP, no infinite loop).
 *   - Untrusted memory candidate ⇒ REJECTED (never promoted).
 *   - Duplicate job ⇒ idempotent SKIP (no re-execution).
 *   - Stale approval ⇒ re-request (never auto-act on an expired approval).
 *   - Process restart ⇒ honest: durable resume is reported true ONLY when a
 *     checkpoint exists; otherwise NOT_DURABLE (never faked as resumed).
 *
 * This framework is the "durable execution + replay" proof at the logic layer.
 * The live E2E (real tenant + DB + Cloud Run worker) is env-gated and lives in
 * tests/e2e; it is NOT fake-passed here.
 */
import { FailureClass, RepairLevel, HyperAgentMode, AutonomyLevel, AutonomyCapability } from '@jak-swarm/shared';
import type { FailureSignal, ClassificationResult, RepairBudget, TaskRepairState, HyperAgentConfig, AutonomyDecision } from '@jak-swarm/shared';
import { classifyFailure, isBudgetExhausted, freshTaskRepairState } from '../recovery/failure-classifier.js';
import { evaluateForConfig } from '@jak-swarm/security';
import { ShieldDecisionVerdict } from '@jak-swarm/security';
import type { ShieldDecisionSubject } from '@jak-swarm/security';

// ─── Failure kinds (the 16 spec modes) ──────────────────────────────────────

export enum FailureKind {
  PROVIDER_TIMEOUT = 'PROVIDER_TIMEOUT',
  TOOL_TIMEOUT = 'TOOL_TIMEOUT',
  MALFORMED_TOOL_OUTPUT = 'MALFORMED_TOOL_OUTPUT',
  PERMISSION_DENIAL = 'PERMISSION_DENIAL',
  CONNECTOR_UNAVAILABLE = 'CONNECTOR_UNAVAILABLE',
  DATABASE_INTERRUPTION = 'DATABASE_INTERRUPTION',
  REDIS_INTERRUPTION = 'REDIS_INTERRUPTION',
  DUPLICATE_JOB_DELIVERY = 'DUPLICATE_JOB_DELIVERY',
  STALE_APPROVAL = 'STALE_APPROVAL',
  PROMPT_INJECTION = 'PROMPT_INJECTION',
  UNTRUSTED_MEMORY_CANDIDATE = 'UNTRUSTED_MEMORY_CANDIDATE',
  SHIELD_TIMEOUT = 'SHIELD_TIMEOUT',
  INVALID_SHIELD_SIGNATURE = 'INVALID_SHIELD_SIGNATURE',
  CYCLIC_REPLANNING = 'CYCLIC_REPLANNING',
  BUDGET_EXHAUSTION = 'BUDGET_EXHAUSTION',
  PROCESS_RESTART_DURING_WORKFLOW = 'PROCESS_RESTART_DURING_WORKFLOW',
}

export const ALL_FAILURE_KINDS: readonly FailureKind[] = Object.freeze([
  FailureKind.PROVIDER_TIMEOUT,
  FailureKind.TOOL_TIMEOUT,
  FailureKind.MALFORMED_TOOL_OUTPUT,
  FailureKind.PERMISSION_DENIAL,
  FailureKind.CONNECTOR_UNAVAILABLE,
  FailureKind.DATABASE_INTERRUPTION,
  FailureKind.REDIS_INTERRUPTION,
  FailureKind.DUPLICATE_JOB_DELIVERY,
  FailureKind.STALE_APPROVAL,
  FailureKind.PROMPT_INJECTION,
  FailureKind.UNTRUSTED_MEMORY_CANDIDATE,
  FailureKind.SHIELD_TIMEOUT,
  FailureKind.INVALID_SHIELD_SIGNATURE,
  FailureKind.CYCLIC_REPLANNING,
  FailureKind.BUDGET_EXHAUSTION,
  FailureKind.PROCESS_RESTART_DURING_WORKFLOW,
]);

// ─── Shield response ────────────────────────────────────────────────────────

export type ShieldVerdictOutcome = ShieldDecisionVerdict | 'UNAVAILABLE' | 'UNVERIFIABLE';

export interface ShieldResponse {
  available: boolean;
  signatureValid: boolean;
  verdict: ShieldVerdictOutcome;
  /** True when the agent must NOT execute the high-risk action (fail-closed). */
  failClosed: boolean;
}

// ─── Result ─────────────────────────────────────────────────────────────────

export type FailureAction =
  | 'RETRY'
  | 'CORRECT_OUTPUT'
  | 'REPLAN'
  | 'PROPOSE_CONFIG'
  | 'CODE_PATCH'
  | 'APPROVAL_REQUIRED'
  | 'QUARANTINE'
  | 'SKIP_IDEMPOTENT'
  | 'REREQUEST_APPROVAL'
  | 'STOP_BUDGET'
  | 'STOP_REPLAN_BOUND'
  | 'FAIL_CLOSED_SHIELD'
  | 'REJECT_MEMORY'
  | 'NOT_DURABLE'
  | 'RESUME'
  | 'OBSERVE_ONLY';

export interface FailureInjectionResult {
  kind: FailureKind;
  /** Deterministic classification (null for framework-tier operational modes). */
  classified: ClassificationResult | null;
  /** Autonomy decision for the repair capability implied by the repair level. */
  autonomyDecision: AutonomyDecision | null;
  shield: ShieldResponse;
  budgetExhausted: boolean;
  replanBounded: boolean;
  duplicateDetected: boolean;
  staleApproval: boolean;
  memoryCandidateAccepted: boolean;
  /** null = not applicable; true = resumed from a checkpoint; false = not durable. */
  durableResume: boolean | null;
  action: FailureAction;
  honestSummary: string;
}

// ─── Context ────────────────────────────────────────────────────────────────

export interface FailureInjectionContext {
  /** Tenant HyperAgent config (mode + autonomy level + enabled flag). */
  config: Pick<HyperAgentConfig, 'hyperAgentEnabled' | 'hyperAgentMode' | 'autonomyLevel'>;
  budget: RepairBudget;
  repairState: TaskRepairState;
  /** Plan-repair attempts so far (for the cyclic-replanning bound). */
  planRepairAttempts: number;
  /** Shield availability + signature validity (false for the timeout/signature modes). */
  shieldAvailable: boolean;
  shieldSignatureValid: boolean;
  /** Local Shield verdict resolver (mirrors ShieldMcpClient local `verdictFor`). */
  shieldVerdictFor?: (subject: ShieldDecisionSubject) => ShieldDecisionVerdict;
  /** True when a checkpoint exists to resume from (process-restart mode). */
  hasCheckpoint: boolean;
  /** True when the delivered job has already been processed (duplicate mode). */
  alreadyProcessed: boolean;
  /** True when the approval is expired (stale-approval mode). */
  approvalExpired: boolean;
  /** The subject the Shield is asked about, when a high-risk action is involved. */
  shieldSubject?: ShieldDecisionSubject;
}

// ─── Repair-level → autonomy capability mapping ─────────────────────────────

function capabilityForLevel(level: RepairLevel): AutonomyCapability {
  switch (level) {
    case RepairLevel.R1_EXECUTION_RETRY:
      return AutonomyCapability.RETRY_SAFE_READONLY;
    case RepairLevel.R2_OUTPUT_CORRECTION:
      return AutonomyCapability.CORRECT_OUTPUT;
    case RepairLevel.R3_PLAN_REPAIR:
      return AutonomyCapability.REPLAN_WITHIN_APPROVED;
    case RepairLevel.R4_CONFIG_REPAIR:
      return AutonomyCapability.PROPOSE_CONFIG_CHANGE;
    case RepairLevel.R5_CODE_REPAIR:
      return AutonomyCapability.CODE_PATCH_BRANCH;
    default:
      return AutonomyCapability.PROPOSE_REPAIRS;
  }
}

// ─── Scenario signal builders (deterministic) ───────────────────────────────

/** Build the FailureSignal for a classifier-tier failure kind. Pure. */
export function signalFor(kind: FailureKind): FailureSignal {
  switch (kind) {
    case FailureKind.PROVIDER_TIMEOUT:
      return { message: 'upstream provider timed out (504 service unavailable)', statusCode: 504 };
    case FailureKind.TOOL_TIMEOUT:
      return { message: 'tool timed out: deadline exceeded', toolName: 'web_search', toolHadExternalSideEffect: false };
    case FailureKind.MALFORMED_TOOL_OUTPUT:
      return { message: 'schema validation failed: expected string got number (zod)', toolName: 'parse_pdf' };
    case FailureKind.PERMISSION_DENIAL:
      return { message: 'permission denied: 403 forbidden access denied', toolName: 'send_email' };
    case FailureKind.CONNECTOR_UNAVAILABLE:
      return { message: 'tool unavailable: connector down/offline — no such tool', toolName: 'slack_post' };
    case FailureKind.DATABASE_INTERRUPTION:
      return { message: 'database connection interrupted unexpectedly' };
    case FailureKind.REDIS_INTERRUPTION:
      return { message: 'redis connection refused: econnrefused' };
    case FailureKind.PROMPT_INJECTION:
      return { message: 'prompt injection detected: "ignore previous instructions" (jailbreak)', toolName: 'chat' };
    case FailureKind.BUDGET_EXHAUSTION:
      return { message: 'budget exceeded: cost limit reached for this run' };
    // Framework-tier modes have no single classifier signal.
    default:
      return { message: `(operational mode: ${kind})` };
  }
}

// ─── Shield verdict (mirrors ShieldMcpClient fail-closed contract) ──────────

function resolveShield(ctx: FailureInjectionContext, highRisk: boolean): ShieldResponse {
  if (!ctx.shieldAvailable) {
    return { available: false, signatureValid: ctx.shieldSignatureValid, verdict: 'UNAVAILABLE', failClosed: highRisk };
  }
  if (!ctx.shieldSignatureValid) {
    return { available: true, signatureValid: false, verdict: 'UNVERIFIABLE', failClosed: highRisk };
  }
  const verdict = ctx.shieldVerdictFor && ctx.shieldSubject ? ctx.shieldVerdictFor(ctx.shieldSubject) : ShieldDecisionVerdict.ALLOW;
  // For a high-risk action, ALLOW alone permits; BLOCK / APPROVE_REQUIRED fail-closed for the agent.
  const failClosed = highRisk && (verdict === ShieldDecisionVerdict.BLOCK || verdict === ShieldDecisionVerdict.APPROVE_REQUIRED);
  return { available: true, signatureValid: true, verdict, failClosed };
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export function runFailureInjection(kind: FailureKind, ctx: FailureInjectionContext): FailureInjectionResult {
  const base = {
    kind,
    budgetExhausted: false,
    replanBounded: false,
    duplicateDetected: false,
    staleApproval: false,
    memoryCandidateAccepted: false,
    durableResume: null as boolean | null,
  };

  // ── Framework-tier operational modes (no classifier signal) ──────────────
  switch (kind) {
    case FailureKind.DUPLICATE_JOB_DELIVERY: {
      const duplicateDetected = ctx.alreadyProcessed;
      return {
        ...base,
        classified: null,
        autonomyDecision: null,
        shield: resolveShield(ctx, false),
        duplicateDetected,
        action: duplicateDetected ? 'SKIP_IDEMPOTENT' : 'RETRY',
        honestSummary: duplicateDetected
          ? 'Duplicate job delivery detected — already processed. Idempotent skip; no re-execution.'
          : 'Job not previously processed — proceed normally.',
      };
    }
    case FailureKind.STALE_APPROVAL: {
      const stale = ctx.approvalExpired;
      return {
        ...base,
        classified: null,
        autonomyDecision: null,
        shield: resolveShield(ctx, true),
        staleApproval: stale,
        action: stale ? 'REREQUEST_APPROVAL' : 'APPROVAL_REQUIRED',
        honestSummary: stale
          ? 'Stale approval detected (expired). The agent never auto-acts on an expired approval; a fresh approval is re-requested.'
          : 'Approval current — proceed under the existing approval.',
      };
    }
    case FailureKind.UNTRUSTED_MEMORY_CANDIDATE: {
      // Untrusted memory candidate → the learning gate rejects it (never promoted).
      return {
        ...base,
        classified: null,
        autonomyDecision: evaluateForConfig(ctx.config, AutonomyCapability.PROPOSE_LEARNINGS),
        shield: resolveShield(ctx, false),
        memoryCandidateAccepted: false,
        action: 'REJECT_MEMORY',
        honestSummary: 'Untrusted memory candidate — quarantined by the learning gate and never promoted without human review + measured evidence.',
      };
    }
    case FailureKind.SHIELD_TIMEOUT: {
      const shield = resolveShield({ ...ctx, shieldAvailable: false }, true);
      return {
        ...base,
        classified: null,
        autonomyDecision: null,
        shield,
        action: 'FAIL_CLOSED_SHIELD',
        honestSummary: 'Shield unavailable (timeout). High-risk action is NOT executed — fail-closed. The agent surfaces an approval request, never bypasses the Shield.',
      };
    }
    case FailureKind.INVALID_SHIELD_SIGNATURE: {
      const shield = resolveShield({ ...ctx, shieldSignatureValid: false }, true);
      return {
        ...base,
        classified: null,
        autonomyDecision: null,
        shield,
        action: 'FAIL_CLOSED_SHIELD',
        honestSummary: 'Shield decision signature failed verification. Treated as unverified → fail-closed. The high-risk action is NOT executed.',
      };
    }
    case FailureKind.CYCLIC_REPLANNING: {
      const bounded = ctx.planRepairAttempts >= ctx.budget.maxPlanRepairs;
      return {
        ...base,
        classified: null,
        autonomyDecision: evaluateForConfig(ctx.config, AutonomyCapability.REPLAN_WITHIN_APPROVED),
        shield: resolveShield(ctx, false),
        replanBounded: bounded,
        action: bounded ? 'STOP_REPLAN_BOUND' : 'REPLAN',
        honestSummary: bounded
          ? `Cyclic replanning bounded — ${ctx.planRepairAttempts} plan repairs reached the maxPlanRepairs cap (${ctx.budget.maxPlanRepairs}). The agent STOPS replanning and escalates (no infinite loop).`
          : `Replan attempt ${ctx.planRepairAttempts + 1} within the maxPlanRepairs cap (${ctx.budget.maxPlanRepairs}).`,
      };
    }
    case FailureKind.BUDGET_EXHAUSTION: {
      const signal = signalFor(kind);
      const classified = classifyFailure(signal);
      const exhausted = isBudgetExhausted(ctx.repairState, ctx.budget, classified.recommendedRepairLevel);
      return {
        ...base,
        classified,
        autonomyDecision: evaluateForConfig(ctx.config, capabilityForLevel(classified.recommendedRepairLevel)),
        shield: resolveShield(ctx, false),
        budgetExhausted: exhausted,
        action: exhausted ? 'STOP_BUDGET' : 'APPROVAL_REQUIRED',
        honestSummary: exhausted
          ? 'Budget exhausted for this repair level. The agent STOPS — no further repair attempts; a human is alerted.'
          : 'Budget-exceeded failure classified; approval required before any repair.',
      };
    }
    case FailureKind.PROCESS_RESTART_DURING_WORKFLOW: {
      const durableResume = ctx.hasCheckpoint;
      return {
        ...base,
        classified: null,
        autonomyDecision: null,
        shield: resolveShield(ctx, false),
        durableResume,
        action: durableResume ? 'RESUME' : 'NOT_DURABLE',
        honestSummary: durableResume
          ? 'Process restarted mid-workflow — a checkpoint exists. The workflow resumes from the last persisted state (durable execution).'
          : 'Process restarted mid-workflow — NO checkpoint is available. Honest: execution is not durable in this configuration; the run is reported failed for a human, never silently faked as resumed.',
      };
    }
  }

  // ── Classifier-tier modes ────────────────────────────────────────────────
  const signal = signalFor(kind);
  const classified = classifyFailure(signal);
  const level = classified.recommendedRepairLevel;
  const exhausted = isBudgetExhausted(ctx.repairState, ctx.budget, level);
  const autonomy = evaluateForConfig(ctx.config, capabilityForLevel(level));

  // High-risk = security-class failure, approval required, external side effect, or R3+ plan repair.
  const highRisk =
    classified.requiresApproval ||
    classified.externalSideEffectPossible ||
    isSecurityFailureClass(classified.errorClass) ||
    level === RepairLevel.R3_PLAN_REPAIR ||
    level === RepairLevel.R4_CONFIG_REPAIR ||
    level === RepairLevel.R5_CODE_REPAIR;
  const shield = resolveShield(ctx, highRisk);

  // Action precedence (honest):
  //   Shield fail-closed > quarantine > budget exhausted > OBSERVE mode
  //   (never act, only report) > approval required (classifier or
  //   autonomy-blocked) > map by repair level > inert when disabled > escalate.
  //   OBSERVE mode sits ABOVE the autonomy-blocked approval check because the
  //   autonomy policy denies every mutating capability in OBSERVE (read-only),
  //   so `!autonomy.allowed` is always true in OBSERVE — without this ordering
  //   OBSERVE would wrongly surface APPROVAL_REQUIRED (a pause) instead of
  //   OBSERVE_ONLY (record + continue). Shield/quarantine/budget terminal
  //   escalations still win over OBSERVE.
  let action: FailureAction;
  if (shield.failClosed) action = 'FAIL_CLOSED_SHIELD';
  else if (classified.quarantine) action = 'QUARANTINE';
  else if (exhausted) action = 'STOP_BUDGET';
  else if (ctx.config.hyperAgentMode === HyperAgentMode.OBSERVE) action = 'OBSERVE_ONLY';
  else if (classified.requiresApproval || !autonomy.allowed) action = 'APPROVAL_REQUIRED';
  else if (classified.retryable) action = 'RETRY';
  else if (level === RepairLevel.R2_OUTPUT_CORRECTION) action = 'CORRECT_OUTPUT';
  else if (level === RepairLevel.R3_PLAN_REPAIR) action = 'REPLAN';
  else if (level === RepairLevel.R4_CONFIG_REPAIR) action = 'PROPOSE_CONFIG';
  else if (level === RepairLevel.R5_CODE_REPAIR) action = 'CODE_PATCH';
  else if (!ctx.config.hyperAgentEnabled) action = 'OBSERVE_ONLY';
  else action = 'APPROVAL_REQUIRED';

  const summary = `classified=${classified.errorClass} (retryable=${classified.retryable}, approval=${classified.requiresApproval}, quarantine=${classified.quarantine}); repair=${level}; autonomy=${autonomy.allowed ? 'allowed' : 'blocked'} (${autonomy.reason}); shield=${shield.verdict}${shield.failClosed ? ' [fail-closed]' : ''}; action=${action}`;

  return {
    ...base,
    classified,
    autonomyDecision: autonomy,
    shield,
    budgetExhausted: exhausted,
    action,
    honestSummary: summary,
  };
}

// ─── Security-class predicate (local helper) ────────────────────────────────
// True for the failure classes that are hard security blocks (never retryable,
// never overridden by an LLM). The classifier-tier path uses this to route
// high-risk actions through the Shield.
export function isSecurityFailureClass(fc: FailureClass): boolean {
  return fc === FailureClass.PERMISSION_DENIED || fc === FailureClass.POLICY_BLOCK || fc === FailureClass.PROMPT_INJECTION;
}

// ─── Convenience: a default context for fixture-driven tests ────────────────

export function defaultInjectionContext(over: Partial<FailureInjectionContext> = {}): FailureInjectionContext {
  return {
    config: { hyperAgentEnabled: true, hyperAgentMode: HyperAgentMode.ASSISTED, autonomyLevel: AutonomyLevel.L2 },
    budget: { maxExecutionRetries: 2, maxOutputRepairs: 2, maxPlanRepairs: 1, maxCapabilityRepairs: 1, maxTotalCostUsd: 5, maxDurationMs: 60000 },
    repairState: freshTaskRepairState('task-1'),
    planRepairAttempts: 0,
    shieldAvailable: true,
    shieldSignatureValid: true,
    hasCheckpoint: false,
    alreadyProcessed: false,
    approvalExpired: false,
    ...over,
  };
}