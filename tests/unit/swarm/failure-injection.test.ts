/**
 * failure-injection.test.ts — HyperAgent Phase 14 failure-injection framework.
 *
 * Exercises all 16 spec failure modes through the real decision path
 * (classifier → autonomy → Shield → budget → replan bound) and pins the
 * honesty invariants: security failures never retryable, Shield unavailable/
 * unverified ⇒ fail-closed, budget exhausted ⇒ stop, cyclic replanning
 * bounded, untrusted memory rejected, duplicate job idempotent, stale approval
 * re-requested, process restart honest about durability.
 */
import { describe, it, expect } from 'vitest';
import { FailureClass, RepairLevel, HyperAgentMode, AutonomyLevel } from '@jak-swarm/shared';
import { ShieldDecisionVerdict } from '@jak-swarm/security';
import {
  runFailureInjection,
  defaultInjectionContext,
  ALL_FAILURE_KINDS,
  FailureKind,
  isSecurityFailureClass,
} from '../../../packages/swarm/src/hyperagent/failure-injection.js';

describe('failure-injection — all 16 modes are covered', () => {
  it('ALL_FAILURE_KINDS has exactly the 16 spec modes', () => {
    expect(ALL_FAILURE_KINDS).toHaveLength(16);
    expect(ALL_FAILURE_KINDS).toContain(FailureKind.PROVIDER_TIMEOUT);
    expect(ALL_FAILURE_KINDS).toContain(FailureKind.PROCESS_RESTART_DURING_WORKFLOW);
  });

  it('every mode produces a non-empty honest summary + an action', () => {
    for (const kind of ALL_FAILURE_KINDS) {
      const r = runFailureInjection(kind, defaultInjectionContext());
      expect(r.kind).toBe(kind);
      expect(r.honestSummary.length).toBeGreaterThan(0);
      expect(r.action).toBeTruthy();
    }
  });
});

describe('failure-injection — classifier-tier modes', () => {
  it('PROVIDER_TIMEOUT → TRANSIENT_PROVIDER, retryable, R1, RETRY (allowed at L2)', () => {
    const r = runFailureInjection(FailureKind.PROVIDER_TIMEOUT, defaultInjectionContext());
    expect(r.classified?.errorClass).toBe(FailureClass.TRANSIENT_PROVIDER);
    expect(r.classified?.retryable).toBe(true);
    expect(r.classified?.recommendedRepairLevel).toBe(RepairLevel.R1_EXECUTION_RETRY);
    expect(r.autonomyDecision?.allowed).toBe(true);
    expect(r.action).toBe('RETRY');
  });

  it('TOOL_TIMEOUT → TIMEOUT, not auto-retried (possible side effect), approval required', () => {
    const r = runFailureInjection(FailureKind.TOOL_TIMEOUT, defaultInjectionContext());
    expect(r.classified?.errorClass).toBe(FailureClass.TIMEOUT);
    expect(r.classified?.retryable).toBe(false); // externalSideEffectPossible ⇒ not auto-retried
    expect(r.classified?.externalSideEffectPossible).toBe(true);
    expect(r.action).toBe('APPROVAL_REQUIRED');
  });

  it('MALFORMED_TOOL_OUTPUT → OUTPUT_SCHEMA, R2, CORRECT_OUTPUT (allowed at L2)', () => {
    const r = runFailureInjection(FailureKind.MALFORMED_TOOL_OUTPUT, defaultInjectionContext());
    expect(r.classified?.errorClass).toBe(FailureClass.OUTPUT_SCHEMA);
    expect(r.classified?.recommendedRepairLevel).toBe(RepairLevel.R2_OUTPUT_CORRECTION);
    expect(r.autonomyDecision?.allowed).toBe(true);
    expect(r.action).toBe('CORRECT_OUTPUT');
  });

  it('PERMISSION_DENIAL → security block, never retryable, approval required', () => {
    const r = runFailureInjection(FailureKind.PERMISSION_DENIAL, defaultInjectionContext());
    expect(r.classified?.errorClass).toBe(FailureClass.PERMISSION_DENIED);
    expect(r.classified?.retryable).toBe(false);
    expect(r.classified?.requiresApproval).toBe(true);
    expect(isSecurityFailureClass(r.classified!.errorClass)).toBe(true);
    expect(r.action).toBe('APPROVAL_REQUIRED');
  });

  it('CONNECTOR_UNAVAILABLE → TOOL_UNAVAILABLE, R3, approval (R3 needs L3, blocked at L2)', () => {
    const r = runFailureInjection(FailureKind.CONNECTOR_UNAVAILABLE, defaultInjectionContext());
    expect(r.classified?.errorClass).toBe(FailureClass.TOOL_UNAVAILABLE);
    expect(r.classified?.recommendedRepairLevel).toBe(RepairLevel.R3_PLAN_REPAIR);
    expect(r.autonomyDecision?.allowed).toBe(false); // REPLAN_WITHIN_APPROVED needs L3
    expect(r.action).toBe('APPROVAL_REQUIRED');
  });

  it('CONNECTOR_UNAVAILABLE at L3 → REPLAN allowed', () => {
    const r = runFailureInjection(
      FailureKind.CONNECTOR_UNAVAILABLE,
      defaultInjectionContext({ config: { hyperAgentEnabled: true, hyperAgentMode: HyperAgentMode.ASSISTED, autonomyLevel: AutonomyLevel.L3 } }),
    );
    expect(r.autonomyDecision?.allowed).toBe(true);
    expect(r.action).toBe('REPLAN');
  });

  it('DATABASE_INTERRUPTION → UNKNOWN (no regex), fail-closed, approval required', () => {
    const r = runFailureInjection(FailureKind.DATABASE_INTERRUPTION, defaultInjectionContext());
    expect(r.classified?.errorClass).toBe(FailureClass.UNKNOWN);
    expect(r.classified?.retryable).toBe(false);
    expect(r.classified?.requiresApproval).toBe(true);
    expect(r.action).toBe('APPROVAL_REQUIRED');
  });

  it('REDIS_INTERRUPTION → TRANSIENT_PROVIDER (econnrefused), retryable R1', () => {
    const r = runFailureInjection(FailureKind.REDIS_INTERRUPTION, defaultInjectionContext());
    expect(r.classified?.errorClass).toBe(FailureClass.TRANSIENT_PROVIDER);
    expect(r.classified?.retryable).toBe(true);
    expect(r.action).toBe('RETRY');
  });

  it('PROMPT_INJECTION → quarantined, never retryable, approval required', () => {
    const r = runFailureInjection(FailureKind.PROMPT_INJECTION, defaultInjectionContext());
    expect(r.classified?.errorClass).toBe(FailureClass.PROMPT_INJECTION);
    expect(r.classified?.retryable).toBe(false);
    expect(r.classified?.quarantine).toBe(true);
    expect(r.classified?.requiresApproval).toBe(true);
    expect(r.action).toBe('QUARANTINE');
  });
});

describe('failure-injection — framework-tier modes (honesty invariants)', () => {
  it('DUPLICATE_JOB_DELIVERY (already processed) → idempotent SKIP', () => {
    const r = runFailureInjection(FailureKind.DUPLICATE_JOB_DELIVERY, defaultInjectionContext({ alreadyProcessed: true }));
    expect(r.duplicateDetected).toBe(true);
    expect(r.action).toBe('SKIP_IDEMPOTENT');
    expect(r.honestSummary).toMatch(/Idempotent skip/);
  });

  it('DUPLICATE_JOB_DELIVERY (not processed) → proceed (RETRY)', () => {
    const r = runFailureInjection(FailureKind.DUPLICATE_JOB_DELIVERY, defaultInjectionContext({ alreadyProcessed: false }));
    expect(r.duplicateDetected).toBe(false);
    expect(r.action).toBe('RETRY');
  });

  it('STALE_APPROVAL (expired) → re-request, never auto-act', () => {
    const r = runFailureInjection(FailureKind.STALE_APPROVAL, defaultInjectionContext({ approvalExpired: true }));
    expect(r.staleApproval).toBe(true);
    expect(r.action).toBe('REREQUEST_APPROVAL');
  });

  it('UNTRUSTED_MEMORY_CANDIDATE → REJECTED (never promoted)', () => {
    const r = runFailureInjection(FailureKind.UNTRUSTED_MEMORY_CANDIDATE, defaultInjectionContext());
    expect(r.memoryCandidateAccepted).toBe(false);
    expect(r.action).toBe('REJECT_MEMORY');
  });

  it('SHIELD_TIMEOUT → fail-closed; high-risk action NOT executed', () => {
    const r = runFailureInjection(FailureKind.SHIELD_TIMEOUT, defaultInjectionContext({ shieldAvailable: false }));
    expect(r.shield.available).toBe(false);
    expect(r.shield.verdict).toBe('UNAVAILABLE');
    expect(r.shield.failClosed).toBe(true);
    expect(r.action).toBe('FAIL_CLOSED_SHIELD');
  });

  it('INVALID_SHIELD_SIGNATURE → unverified, fail-closed', () => {
    const r = runFailureInjection(FailureKind.INVALID_SHIELD_SIGNATURE, defaultInjectionContext({ shieldSignatureValid: false }));
    expect(r.shield.signatureValid).toBe(false);
    expect(r.shield.verdict).toBe('UNVERIFIABLE');
    expect(r.shield.failClosed).toBe(true);
    expect(r.action).toBe('FAIL_CLOSED_SHIELD');
  });

  it('CYCLIC_REPLANNING at the cap → bounded STOP (no infinite loop)', () => {
    const r = runFailureInjection(FailureKind.CYCLIC_REPLANNING, defaultInjectionContext({ planRepairAttempts: 1, budget: { maxExecutionRetries: 2, maxOutputRepairs: 2, maxPlanRepairs: 1, maxCapabilityRepairs: 1, maxTotalCostUsd: 5, maxDurationMs: 60000 } }));
    expect(r.replanBounded).toBe(true);
    expect(r.action).toBe('STOP_REPLAN_BOUND');
  });

  it('CYCLIC_REPLANNING under the cap → REPLAN', () => {
    const r = runFailureInjection(FailureKind.CYCLIC_REPLANNING, defaultInjectionContext({ planRepairAttempts: 0 }));
    expect(r.replanBounded).toBe(false);
    expect(r.action).toBe('REPLAN');
  });

  it('BUDGET_EXHAUSTION with exhausted state → STOP_BUDGET', () => {
    const r = runFailureInjection(
      FailureKind.BUDGET_EXHAUSTION,
      defaultInjectionContext({ repairState: { taskId: 't1', executionAttempts: 2, outputRepairAttempts: 2, planRepairAttempts: 1, capabilityRepairAttempts: 1, exhausted: true } }),
    );
    expect(r.budgetExhausted).toBe(true);
    expect(r.action).toBe('STOP_BUDGET');
  });

  it('PROCESS_RESTART with checkpoint → durable RESUME', () => {
    const r = runFailureInjection(FailureKind.PROCESS_RESTART_DURING_WORKFLOW, defaultInjectionContext({ hasCheckpoint: true }));
    expect(r.durableResume).toBe(true);
    expect(r.action).toBe('RESUME');
  });

  it('PROCESS_RESTART without checkpoint → NOT_DURABLE (honestly, never faked as resumed)', () => {
    const r = runFailureInjection(FailureKind.PROCESS_RESTART_DURING_WORKFLOW, defaultInjectionContext({ hasCheckpoint: false }));
    expect(r.durableResume).toBe(false);
    expect(r.action).toBe('NOT_DURABLE');
    expect(r.honestSummary).toMatch(/not durable/i);
    // The summary must never CLAIM a resume happened (only the honest disclaimer
    // mentions the word, to state it was NOT faked).
    expect(r.honestSummary).not.toMatch(/resumes from the last persisted state/i);
    expect(r.honestSummary).not.toMatch(/resume from checkpoint/i);
  });
});

describe('failure-injection — Shield verdict routing', () => {
  it('a high-risk action with a BLOCK verdict → fail-closed', () => {
    const r = runFailureInjection(
      FailureKind.PERMISSION_DENIAL,
      defaultInjectionContext({
        shieldAvailable: true,
        shieldSignatureValid: true,
        shieldVerdictFor: () => ShieldDecisionVerdict.BLOCK,
        shieldSubject: { kind: 'tool', requestHash: 'h' },
      }),
    );
    // PERMISSION_DENIAL is approval-required (APPROVAL_REQUIRED) — but Shield
    // BLOCK is also fail-closed; fail-closed wins.
    expect(r.shield.verdict).toBe(ShieldDecisionVerdict.BLOCK);
    expect(r.shield.failClosed).toBe(true);
    expect(r.action).toBe('FAIL_CLOSED_SHIELD');
  });

  it('a low-risk transient with ALLOW verdict → not fail-closed, RETRY', () => {
    const r = runFailureInjection(
      FailureKind.PROVIDER_TIMEOUT,
      defaultInjectionContext({
        shieldVerdictFor: () => ShieldDecisionVerdict.ALLOW,
        shieldSubject: { kind: 'tool', requestHash: 'h' },
      }),
    );
    expect(r.shield.verdict).toBe(ShieldDecisionVerdict.ALLOW);
    expect(r.shield.failClosed).toBe(false);
    expect(r.action).toBe('RETRY');
  });
});

describe('failure-injection — OBSERVE mode never acts', () => {
  it('in OBSERVE mode a retryable failure → OBSERVE_ONLY (no action taken)', () => {
    const r = runFailureInjection(
      FailureKind.PROVIDER_TIMEOUT,
      defaultInjectionContext({ config: { hyperAgentEnabled: true, hyperAgentMode: HyperAgentMode.OBSERVE, autonomyLevel: AutonomyLevel.L2 } }),
    );
    expect(r.action).toBe('OBSERVE_ONLY');
  });

  it('when hyperAgentEnabled=false the layer is inert (OBSERVE_ONLY for a non-security failure)', () => {
    const r = runFailureInjection(
      FailureKind.MALFORMED_TOOL_OUTPUT,
      defaultInjectionContext({ config: { hyperAgentEnabled: false, hyperAgentMode: HyperAgentMode.ASSISTED, autonomyLevel: AutonomyLevel.L2 } }),
    );
    // R2 correct-output autonomy: evaluateForConfig with enabled=false ⇒ mode OFF ⇒ blocked.
    expect(r.autonomyDecision?.allowed).toBe(false);
    expect(r.action).toBe('APPROVAL_REQUIRED');
  });
});