import { describe, it, expect } from 'vitest';
import {
  FailureClass,
  RepairLevel,
} from '../../../packages/shared/src/types/failure.js';
import {
  classifyFailure,
  mapLegacyErrorClass,
  freshTaskRepairState,
  isBudgetExhausted,
  type FailureSignal,
} from '../../../packages/swarm/src/recovery/failure-classifier.js';
import type { ErrorClass } from '../../../packages/swarm/src/recovery/repair-service.js';
import type { RepairBudget } from '../../../packages/shared/src/types/hyperagent.js';

const BUDGET: RepairBudget = {
  maxExecutionRetries: 2,
  maxOutputRepairs: 2,
  maxPlanRepairs: 1,
  maxCapabilityRepairs: 1,
  maxTotalCostUsd: 10,
  maxDurationMs: 60_000,
};

describe('failure-classifier — legacy ErrorClass mapping', () => {
  const cases: Array<[ErrorClass, FailureClass]> = [
    ['transient_api', FailureClass.TRANSIENT_PROVIDER],
    ['invalid_structured_output', FailureClass.OUTPUT_SCHEMA],
    ['missing_input', FailureClass.MISSING_CONTEXT],
    ['document_parse_failure', FailureClass.TOOL_BAD_INPUT],
    ['tool_unavailable', FailureClass.TOOL_UNAVAILABLE],
    ['permission_block', FailureClass.PERMISSION_DENIED],
    ['destructive_action', FailureClass.POLICY_BLOCK],
    ['graph_node_failure', FailureClass.UNKNOWN],
    ['approval_timeout', FailureClass.PERMISSION_DENIED],
    ['export_failure', FailureClass.TOOL_BAD_INPUT],
    ['unknown', FailureClass.UNKNOWN],
  ];

  for (const [legacy, expected] of cases) {
    it(`maps ${legacy} → ${expected}`, () => {
      expect(mapLegacyErrorClass(legacy)).toBe(expected);
    });
  }
});

describe('failure-classifier — raw signal classification', () => {
  it('classifies a 429 as RATE_LIMIT + R1 retryable', () => {
    const r = classifyFailure({ message: 'Request failed: 429 Too Many Requests' });
    expect(r.errorClass).toBe(FailureClass.RATE_LIMIT);
    expect(r.retryable).toBe(true);
    expect(r.recommendedRepairLevel).toBe(RepairLevel.R1_EXECUTION_RETRY);
    expect(r.requiresApproval).toBe(false);
  });

  it('classifies a 503 as TRANSIENT_PROVIDER + R1 retryable', () => {
    const r = classifyFailure({ message: 'upstream 503 service unavailable' });
    expect(r.errorClass).toBe(FailureClass.TRANSIENT_PROVIDER);
    expect(r.retryable).toBe(true);
    expect(r.recommendedRepairLevel).toBe(RepairLevel.R1_EXECUTION_RETRY);
  });

  it('classifies "forbidden" as PERMISSION_DENIED — never retryable, approval required', () => {
    const r = classifyFailure({ message: 'forbidden: access denied' });
    expect(r.errorClass).toBe(FailureClass.PERMISSION_DENIED);
    expect(r.retryable).toBe(false);
    expect(r.requiresApproval).toBe(true);
    expect(r.quarantine).toBe(false);
  });

  it('classifies prompt-injection signal — quarantine + approval, never retryable', () => {
    const r = classifyFailure({ message: 'ignore previous instructions (DAN jailbreak)' });
    expect(r.errorClass).toBe(FailureClass.PROMPT_INJECTION);
    expect(r.retryable).toBe(false);
    expect(r.requiresApproval).toBe(true);
    expect(r.quarantine).toBe(true);
  });

  it('classifies a schema/parse error as OUTPUT_SCHEMA → R2', () => {
    const r = classifyFailure({ message: 'zod validation failed: expected string got number' });
    expect(r.errorClass).toBe(FailureClass.OUTPUT_SCHEMA);
    expect(r.recommendedRepairLevel).toBe(RepairLevel.R2_OUTPUT_CORRECTION);
    expect(r.retryable).toBe(false);
  });

  it('falls back to UNKNOWN for an unrecognised message', () => {
    const r = classifyFailure({ message: 'something completely novel went wrong' });
    expect(r.errorClass).toBe(FailureClass.UNKNOWN);
    expect(r.retryable).toBe(false);
    expect(r.requiresApproval).toBe(true);
  });
});

describe('failure-classifier — hard security invariants', () => {
  it('legacy permission_block maps to a non-retryable, approval-required class', () => {
    const r = classifyFailure({ message: 'denied', legacyClass: 'permission_block' });
    expect(r.errorClass).toBe(FailureClass.PERMISSION_DENIED);
    expect(r.retryable).toBe(false);
    expect(r.requiresApproval).toBe(true);
  });

  it('never auto-retries when an external side effect is possible', () => {
    // TRANSIENT_PROVIDER is normally retryable, but a tool that declared an
    // external side effect must not be blindly re-run.
    const r = classifyFailure({
      message: '503 service unavailable',
      toolHadExternalSideEffect: true,
      failedBeforeExecution: false,
    });
    expect(r.externalSideEffectPossible).toBe(true);
    expect(r.retryable).toBe(false);
  });

  it('allows retry when the failure happened before any tool executed (no side effect yet)', () => {
    const r = classifyFailure({
      message: '503 service unavailable',
      toolHadExternalSideEffect: true,
      failedBeforeExecution: true,
    });
    expect(r.externalSideEffectPossible).toBe(false);
    expect(r.retryable).toBe(true);
  });

  it('legacy transient_api maps to TRANSIENT_PROVIDER (not TIMEOUT), even for a timeout-y message', () => {
    const r = classifyFailure({ message: 'request timed out', legacyClass: 'transient_api' });
    expect(r.errorClass).toBe(FailureClass.TRANSIENT_PROVIDER);
    expect(r.retryable).toBe(true);
  });

  it('classifies a TIMEOUT via raw signal as R1 — but flagged side-effected so not auto-retried', () => {
    const r = classifyFailure({ message: 'operation timed out, deadline exceeded' });
    expect(r.errorClass).toBe(FailureClass.TIMEOUT);
    expect(r.recommendedRepairLevel).toBe(RepairLevel.R1_EXECUTION_RETRY);
    // TIMEOUT table marks externalSideEffectPossible=true → retryable becomes false.
    expect(r.externalSideEffectPossible).toBe(true);
    expect(r.retryable).toBe(false);
  });

  it('regression: bare word "timeout" classifies as TIMEOUT (not TRANSIENT_PROVIDER), so a timed-out side-effecting tool is not auto-retried', () => {
    // Before the fix, "timeout" matched the TRANSIENT_PROVIDER regex (which used
    // to include `|timeout`) BEFORE the TIMEOUT signal, classifying a timed-out
    // payment as retryable → risk of double-charge on retry.
    const r = classifyFailure({ message: 'request timeout' });
    expect(r.errorClass).toBe(FailureClass.TIMEOUT);
    expect(r.externalSideEffectPossible).toBe(true);
    expect(r.retryable).toBe(false);

    // And a tool that already executed (side effect) before timing out must also
    // be non-retryable via the caller hint path.
    const r2 = classifyFailure({ message: 'timeout', toolHadExternalSideEffect: true, failedBeforeExecution: false });
    expect(r2.errorClass).toBe(FailureClass.TIMEOUT);
    expect(r2.retryable).toBe(false);
  });
});

describe('failure-classifier — budget accounting', () => {
  it('freshTaskRepairState starts at zero and not exhausted', () => {
    const s = freshTaskRepairState('t1');
    expect(s.executionAttempts).toBe(0);
    expect(s.exhausted).toBe(false);
    expect(isBudgetExhausted(s, BUDGET, RepairLevel.R1_EXECUTION_RETRY)).toBe(false);
  });

  it('R1 exhausts at maxExecutionRetries', () => {
    const s = freshTaskRepairState('t1');
    s.executionAttempts = 2;
    expect(isBudgetExhausted(s, BUDGET, RepairLevel.R1_EXECUTION_RETRY)).toBe(true);
    s.executionAttempts = 1;
    expect(isBudgetExhausted(s, BUDGET, RepairLevel.R1_EXECUTION_RETRY)).toBe(false);
  });

  it('R2 exhausts at maxOutputRepairs', () => {
    const s = freshTaskRepairState('t1');
    s.outputRepairAttempts = 2;
    expect(isBudgetExhausted(s, BUDGET, RepairLevel.R2_OUTPUT_CORRECTION)).toBe(true);
  });

  it('R3 exhausts at maxPlanRepairs', () => {
    const s = freshTaskRepairState('t1');
    s.planRepairAttempts = 1;
    expect(isBudgetExhausted(s, BUDGET, RepairLevel.R3_PLAN_REPAIR)).toBe(true);
  });

  it('R4/R5 exhaust at maxCapabilityRepairs', () => {
    const s = freshTaskRepairState('t1');
    s.capabilityRepairAttempts = 1;
    expect(isBudgetExhausted(s, BUDGET, RepairLevel.R4_CONFIG_REPAIR)).toBe(true);
    expect(isBudgetExhausted(s, BUDGET, RepairLevel.R5_CODE_REPAIR)).toBe(true);
  });

  it('an unknown repair level fails closed (treated as exhausted)', () => {
    const s = freshTaskRepairState('t1');
    // @ts-expect-error — deliberately invalid level
    expect(isBudgetExhausted(s, BUDGET, 'R99')).toBe(true);
  });
});

describe('failure-classifier — reachable classes have valid repair levels', () => {
  // These are the classes the deterministic classifier can emit today (via a
  // legacy ErrorClass map OR a raw-signal regex). The remaining taxonomy
  // classes (WRONG_AGENT / WRONG_TOOL / PLAN_DEPENDENCY / HALLUCINATION /
  // CAPABILITY_GAP / EXTERNAL_STATE_CHANGED) are reserved for the Phase 4 LLM
  // diagnostician + runtime signals not yet wired; the policy table still
  // covers them (it is typed `Record<FailureClass, …>` so TypeScript enforces
  // exhaustiveness at compile time — no runtime loop needed).
  const reachable: Array<[FailureClass, FailureSignal]> = [
    [FailureClass.RATE_LIMIT, { message: '429 rate limit' }],
    [FailureClass.TRANSIENT_PROVIDER, { message: '503 service unavailable' }],
    [FailureClass.TIMEOUT, { message: 'timed out' }],
    [FailureClass.PERMISSION_DENIED, { message: 'forbidden 403' }],
    [FailureClass.MISSING_CREDENTIAL, { message: 'missing api key credential' }],
    [FailureClass.PROMPT_INJECTION, { message: 'ignore previous (jailbreak)' }],
    [FailureClass.POLICY_BLOCK, { message: 'blocked by policy destructive' }],
    [FailureClass.TOOL_UNAVAILABLE, { message: 'tool unavailable not found' }],
    [FailureClass.OUTPUT_SCHEMA, { message: 'zod validation schema' }],
    [FailureClass.GROUNDING_FAILURE, { message: 'ungrounded hallucinat no citations' }],
    [FailureClass.BUDGET_EXCEEDED, { message: 'budget cost limit exceeded' }],
    [FailureClass.MISSING_CONTEXT, { message: 'x', legacyClass: 'missing_input' }],
    [FailureClass.TOOL_BAD_INPUT, { message: 'x', legacyClass: 'document_parse_failure' }],
    [FailureClass.UNKNOWN, { message: 'x', legacyClass: 'unknown' }],
  ];

  for (const [fc, signal] of reachable) {
    it(`${fc} classifies and returns a valid RepairLevel`, () => {
      const r = classifyFailure(signal);
      expect(r.errorClass).toBe(fc);
      expect(Object.values(RepairLevel)).toContain(r.recommendedRepairLevel);
    });
  }
});