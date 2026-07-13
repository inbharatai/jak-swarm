/**
 * failure-diagnostician.ts — HyperAgent Phase 4 failure diagnosis (Innovation #1).
 *
 * Spec §6 Step 2: "Create FailureDiagnosticianAgent, but combine it with
 * deterministic rules. The deterministic classifier should run first. The LLM
 * should only explain ambiguous root causes, compare alternative repairs,
 * generate a structured diagnosis, and NEVER override a deterministic security
 * block."
 *
 * Innovation #1 — causal fault attribution via counterfactual replay: instead
 * of LLM-guessing a root cause from log strings, the diagnostician replays
 * three single-variable variants of the failed task on a sandboxed clone
 * (hold-the-agent / hold-the-tool / hold-the-model). Whichever variant flips
 * the outcome from fail → pass isolates the fault dimension. The re-executor is
 * an injected interface — when no sandbox is configured, the result honestly
 * records `executed: false` rather than fabricating a diagnosis.
 *
 * The orchestrator is async (it may await the re-executor + an optional LLM),
 * but the deterministic classification path is pure and runs FIRST. The LLM is
 * consulted ONLY for UNKNOWN failures, and even then it can never flip a
 * deterministic block (PERMISSION_DENIED / POLICY_BLOCK / PROMPT_INJECTION /
 * UNKNOWN-not-retryable / requiresApproval / quarantine) — those are sealed in
 * `evidence.deterministicBlock` and the replanner + DB layer treat them as
 * immutable.
 */

import {
  FailureClass,
} from '@jak-swarm/shared';
import type {
  ExecutionFailure,
  FailureDiagnosis,
} from '@jak-swarm/shared';
import type { CounterfactualReplayHint, CounterfactualReplayResult } from '@jak-swarm/shared';
import type { AgentRole } from '@jak-swarm/shared';
import { classifyFailure, securityFieldsForClass } from '../recovery/failure-classifier.js';
import type { ClassificationResult, FailureSignal } from '../recovery/failure-classifier.js';

/**
 * Sandboxed re-executor for Innovation #1. Implementations run a single
 * counterfactual variant in isolation and report whether it passed. The
 * production wiring (Phase 14) clones the task into a sandbox; tests inject a
 * deterministic stub. When undefined, counterfactual replay is honestly
 * marked `executed: false`.
 */
export interface CounterfactualReExecutor {
  replayVariant(input: {
    taskId: string;
    dimension: 'agent-only' | 'tool-only' | 'model-only';
    /** Alternate agent role to swap in for the agent-only variant. */
    alternateAgentRole?: AgentRole;
    /** Alternate tool name to swap in for the tool-only variant. */
    alternateTool?: string;
    /** Alternate model id to swap in for the model-only variant. */
    alternateModel?: string;
  }): Promise<{ passed: boolean; note: string }>;
}

/** Optional LLM diagnosis — only ever called for UNKNOWN failures. */
export interface LlmDiagnoseFn {
  (input: {
    failure: ExecutionFailure;
    deterministic: ClassificationResult;
    counterfactual?: CounterfactualReplayResult;
    verifierIssues: string[];
  }): Promise<{
    rootCause: string;
    confidence: number;
    recommendedChanges: Record<string, unknown>;
    /**
     * The LLM may suggest a different failure class. The orchestrator
     * INTENTIONALLY IGNORES this field: UNKNOWN is a sealed deterministic block
     * and the LLM can never re-classify it (a reclassify would risk downgrading
     * UNKNOWN → a retryable class, reopening an auto-retry loop on a failure we
     * do not understand). Kept on the interface only so the LLM parser stays
     * permissive; it has no behavioural effect.
     */
    suggestedFailureClass?: FailureClass;
  }>;
}

export interface DiagnoseInput {
  failure: ExecutionFailure;
  signal: FailureSignal;
  hint: CounterfactualReplayHint;
  verifierIssues: string[];
  tenantId: string;
  /** ISO timestamp — caller stamps it (no Date.now in the pure path). */
  now: string;
  reExecutor?: CounterfactualReExecutor;
  llmDiagnose?: LlmDiagnoseFn;
}

export interface DiagnoseOutput {
  diagnosis: FailureDiagnosis;
  counterfactual: CounterfactualReplayResult;
  hint: CounterfactualReplayHint;
  /** True when the deterministic block is sealed (LLM cannot override). */
  deterministicBlock: boolean;
}

/** The failure classes that constitute a deterministic security block. */
// DETERMINISTIC_BLOCK_CLASSES now lives in failure-classifier.ts (single source
// of truth) and is re-exported via `securityFieldsForClass` below.

/**
 * Run the three single-variable counterfactual variants. Pure w.r.t. the
 * injected re-executor; when none is present, returns `executed: false` with
 * no fault isolated (honest — never fabricates a dimension).
 */
export async function runCounterfactualReplay(
  hint: CounterfactualReplayHint,
  reExecutor?: CounterfactualReExecutor,
  alternates?: { agent?: AgentRole; tool?: string; model?: string },
): Promise<CounterfactualReplayResult> {
  const dimensions: Array<'agent-only' | 'tool-only' | 'model-only'> = [
    'agent-only',
    'tool-only',
    'model-only',
  ];
  if (!reExecutor) {
    return {
      taskId: hint.taskId,
      variants: dimensions.map((d) => ({ dimension: d, faultIsolated: false, note: 'no sandboxed re-executor configured' })),
      executed: false,
    };
  }
  const variants = await Promise.all(
    dimensions.map(async (d) => {
      const r = await reExecutor.replayVariant({
        taskId: hint.taskId,
        dimension: d,
        alternateAgentRole: d === 'agent-only' ? alternates?.agent : undefined,
        alternateTool: d === 'tool-only' ? alternates?.tool : undefined,
        alternateModel: d === 'model-only' ? alternates?.model : undefined,
      });
      return { dimension: d, faultIsolated: r.passed, note: r.note };
    }),
  );
  const isolated = variants.find((v) => v.faultIsolated)?.dimension;
  return { taskId: hint.taskId, variants, isolatedDimension: isolated, executed: true };
}

/**
 * Diagnose a failure. Deterministic classifier FIRST, counterfactual replay
 * second, LLM ONLY for ambiguous (UNKNOWN) cases — and never overriding a
 * deterministic block.
 */
export async function diagnoseFailure(input: DiagnoseInput): Promise<DiagnoseOutput> {
  // 1. Deterministic classification — always runs, always wins on security.
  const deterministic = classifyFailure(input.signal);
  // The security seal surfaced as typed top-level fields on the diagnosis
  // (Phase 3 hardening). `deterministicBlock` is sealed when the class is a
  // hard security class OR the policy table requires approval / quarantine —
  // the LLM can never un-block these; it may only refine rootCause text.
  const seal = securityFieldsForClass(deterministic.errorClass);
  const deterministicBlock = seal.deterministicBlock;

  // 2. Counterfactual replay (Innovation #1).
  const counterfactual = await runCounterfactualReplay(input.hint, input.reExecutor);

  // 3. LLM — ONLY for UNKNOWN, and only to fill in rootCause / recommendedChanges.
  //    It can never un-block a deterministic block.
  let rootCause = deterministic.reason;
  let confidence = deterministic.quarantine ? 1 : 0.5;
  let recommendedChanges: Record<string, unknown> = {
    repairLevel: deterministic.recommendedRepairLevel,
    retryable: deterministic.retryable,
    requiresApproval: deterministic.requiresApproval,
    quarantine: deterministic.quarantine,
  };
  let failureClass = deterministic.errorClass;

  if (deterministic.errorClass === FailureClass.UNKNOWN && input.llmDiagnose) {
    try {
      const llm = await input.llmDiagnose({
        failure: input.failure,
        deterministic,
        counterfactual,
        verifierIssues: input.verifierIssues,
      });
      rootCause = llm.rootCause;
      confidence = clamp01(llm.confidence);
      recommendedChanges = { ...recommendedChanges, ...llm.recommendedChanges, llmProposed: true };
      // SECURITY: the LLM can NEVER re-classify an UNKNOWN failure. UNKNOWN is a
      // sealed deterministic block (DETERMINISTIC_BLOCK_CLASSES + requiresApproval
      // ⇒ deterministicBlock === true whenever this branch runs), and the
      // classifier invariant "UNKNOWN ⇒ retryable = false (never loop / never
      // bypass)" must hold regardless of any LLM suggestion. Honoring
      // `suggestedFailureClass` here — even restricted to "non-block" classes —
      // would let the LLM downgrade UNKNOWN → TRANSIENT_PROVIDER (retryable),
      // reopening an auto-retry loop on a failure we do not understand: a
      // security hole. The field is therefore intentionally IGNORED; the LLM may
      // only refine rootCause / recommendedChanges TEXT. (The reclassify branch
      // that used to live here was dead — `!deterministicBlock` was always false
      // on the UNKNOWN path — and was removed so a future "drop UNKNOWN from the
      // block set" cleanup can never accidentally revive it.)
      void llm.suggestedFailureClass; // explicitly acknowledged + discarded
    } catch {
      // LLM failure must never block diagnosis — fall back to deterministic.
      rootCause = `${deterministic.reason} (LLM diagnosis unavailable; fell back to deterministic)`;
    }
  }

  // Use counterfactual evidence to refine rootCause when a dimension was isolated.
  if (counterfactual.isolatedDimension) {
    rootCause = `${rootCause} [counterfactual isolated dimension: ${counterfactual.isolatedDimension}]`;
    recommendedChanges = { ...recommendedChanges, isolatedDimension: counterfactual.isolatedDimension };
  }

  const diagnosisId = `diag_${input.failure.workflowId}_${input.failure.taskId}_${input.failure.stateVersion}`;

  const diagnosis: FailureDiagnosis = {
    id: diagnosisId,
    tenantId: input.tenantId,
    workflowId: input.failure.workflowId,
    taskId: input.failure.taskId,
    failureClass,
    rootCause,
    evidence: {
      deterministic,
      counterfactual,
      verifierIssues: input.verifierIssues,
      deterministicBlock,
      inputHash: input.failure.inputHash,
    },
    confidence,
    recommendedRepairLevel: deterministic.recommendedRepairLevel, // never overridden by LLM
    recommendedChanges,
    createdAt: input.now,
    // Security seal (Phase 3) — typed top-level fields copied from the
    // deterministic classifier. The LLM can never override these; the graph
    // edge + replanner read them directly to seal security-blocked diagnoses.
    requiresApproval: seal.requiresApproval,
    quarantine: seal.quarantine,
    deterministicBlock: seal.deterministicBlock,
    externalSideEffectPossible: seal.externalSideEffectPossible,
  };

  return { diagnosis, counterfactual, hint: input.hint, deterministicBlock };
}

const clamp01 = (n: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;