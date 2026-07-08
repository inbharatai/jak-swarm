/**
 * failure-diagnostician.test.ts — HyperAgent Phase 4 diagnosis (Innovation #1).
 *
 * Pins the spec §6 Step 2 invariants:
 *   - deterministic classifier runs FIRST and always wins on security;
 *   - the LLM is consulted ONLY for UNKNOWN, and can NEVER un-block a
 *     deterministic security block (PERMISSION_DENIED / POLICY_BLOCK /
 *     PROMPT_INJECTION / UNKNOWN / requiresApproval / quarantine);
 *   - counterfactual replay honestly reports `executed: false` when no
 *     sandboxed re-executor is injected, and isolates the fault dimension
 *     when one is;
 *   - recommendedRepairLevel is never overridden by the LLM.
 */
import { describe, it, expect, vi } from 'vitest';
import { FailureClass, RepairLevel } from '../../../packages/shared/src/index.js';
import type { ExecutionFailure, CounterfactualReplayHint } from '../../../packages/shared/src/index.js';
import {
  diagnoseFailure,
  runCounterfactualReplay,
  type CounterfactualReExecutor,
  type LlmDiagnoseFn,
} from '../../../packages/swarm/src/hyperagent/failure-diagnostician.js';

function failure(over: Partial<ExecutionFailure> = {}): ExecutionFailure {
  return {
    workflowId: 'wf-1',
    taskId: 't-1',
    agentRole: 'WORKER_RESEARCH',
    toolName: 'web_search',
    errorClass: FailureClass.UNKNOWN,
    message: 'failed',
    retryable: false,
    externalSideEffectPossible: false,
    inputHash: 'abc123',
    stateVersion: 0,
    occurredAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function hint(): CounterfactualReplayHint {
  return {
    taskId: 't-1',
    agentRole: 'WORKER_RESEARCH',
    toolName: 'web_search',
    inputHash: 'abc123',
    hypothesisSet: ['agent-only', 'tool-only', 'model-only'],
  };
}

describe('failure-diagnostician — deterministic classifier runs first + wins', () => {
  it('classifies a 403/forbidden signal as PERMISSION_DENIED with a sealed block', async () => {
    const llmDiagnose = vi.fn() as unknown as LlmDiagnoseFn;
    const out = await diagnoseFailure({
      failure: failure(),
      signal: { message: '403 Forbidden: access denied', toolName: 'web_search' },
      hint: hint(),
      verifierIssues: [],
      tenantId: 't-1',
      now: '2026-01-01T00:00:00Z',
      llmDiagnose,
    });
    expect(out.diagnosis.failureClass).toBe(FailureClass.PERMISSION_DENIED);
    expect(out.deterministicBlock).toBe(true);
    expect(out.diagnosis.recommendedRepairLevel).toBe(RepairLevel.R3_PLAN_REPAIR);
    // The LLM must NEVER be consulted for a non-UNKNOWN deterministic block.
    expect(llmDiagnose).not.toHaveBeenCalled();
  });

  it('never lets the LLM un-block a PERMISSION_DENIED (recommendedRepairLevel sealed)', async () => {
    const out = await diagnoseFailure({
      failure: failure(),
      signal: { message: 'permission denied' },
      hint: hint(),
      verifierIssues: [],
      tenantId: 't-1',
      now: '2026-01-01T00:00:00Z',
      llmDiagnose: (async () => ({
        rootCause: 'llm guess',
        confidence: 0.99,
        recommendedChanges: { llmProposed: true },
        suggestedFailureClass: FailureClass.TRANSIENT_PROVIDER, // attempt to downgrade
      })) as unknown as LlmDiagnoseFn,
    });
    expect(out.diagnosis.failureClass).toBe(FailureClass.PERMISSION_DENIED);
    expect(out.deterministicBlock).toBe(true);
    expect(out.diagnosis.recommendedRepairLevel).toBe(RepairLevel.R3_PLAN_REPAIR);
  });
});

describe('failure-diagnostician — LLM only for UNKNOWN, rootCause refined only', () => {
  it('calls the LLM for UNKNOWN and adopts its rootCause but keeps the class', async () => {
    const out = await diagnoseFailure({
      failure: failure(),
      signal: { message: 'something completely novel and unmatched' },
      hint: hint(),
      verifierIssues: ['issue-1'],
      tenantId: 't-1',
      now: '2026-01-01T00:00:00Z',
      llmDiagnose: (async () => ({
        rootCause: 'novel root cause explained',
        confidence: 0.6,
        recommendedChanges: { hint: 'retry with context' },
      })) as unknown as LlmDiagnoseFn,
    });
    expect(out.diagnosis.failureClass).toBe(FailureClass.UNKNOWN);
    expect(out.diagnosis.rootCause).toContain('novel root cause explained');
    expect(out.diagnosis.confidence).toBeCloseTo(0.6, 5);
    // recommendedRepairLevel is never overridden by the LLM.
    expect(out.diagnosis.recommendedRepairLevel).toBe(RepairLevel.R3_PLAN_REPAIR);
  });

  it('falls back to the deterministic rootCause when the LLM throws', async () => {
    const out = await diagnoseFailure({
      failure: failure(),
      signal: { message: 'totally unheard-of failure mode xyzzy' },
      hint: hint(),
      verifierIssues: [],
      tenantId: 't-1',
      now: '2026-01-01T00:00:00Z',
      llmDiagnose: (async () => {
        throw new Error('llm down');
      }) as unknown as LlmDiagnoseFn,
    });
    expect(out.diagnosis.failureClass).toBe(FailureClass.UNKNOWN);
    expect(out.diagnosis.rootCause).toMatch(/deterministic|fallback/i);
  });
});

describe('failure-diagnostician — counterfactual replay (Innovation #1)', () => {
  it('honestly reports executed:false when no re-executor is configured', async () => {
    const r = await runCounterfactualReplay(hint());
    expect(r.executed).toBe(false);
    expect(r.isolatedDimension).toBeUndefined();
    expect(r.variants).toHaveLength(3);
  });

  it('isolates the fault dimension when a re-executor variant flips fail→pass', async () => {
    const reExecutor: CounterfactualReExecutor = {
      replayVariant: async ({ dimension }) => ({
        passed: dimension === 'tool-only',
        note: dimension === 'tool-only' ? 'passed with alternate tool' : 'still failed',
      }),
    };
    const r = await runCounterfactualReplay(hint(), reExecutor, { tool: 'alt_tool' });
    expect(r.executed).toBe(true);
    expect(r.isolatedDimension).toBe('tool-only');
  });

  it('records no isolated dimension when no variant flips the outcome', async () => {
    const reExecutor: CounterfactualReExecutor = {
      replayVariant: async () => ({ passed: false, note: 'still failed' }),
    };
    const r = await runCounterfactualReplay(hint(), reExecutor);
    expect(r.executed).toBe(true);
    expect(r.isolatedDimension).toBeUndefined();
  });

  it('appends the isolated dimension to the diagnosis rootCause + evidence', async () => {
    const out = await diagnoseFailure({
      failure: failure(),
      signal: { message: 'totally unmatched novel failure' },
      hint: hint(),
      verifierIssues: [],
      tenantId: 't-1',
      now: '2026-01-01T00:00:00Z',
      reExecutor: {
        replayVariant: async ({ dimension }) => ({
          passed: dimension === 'agent-only',
          note: 'passed with alternate agent',
        }),
      },
    });
    expect(out.counterfactual.isolatedDimension).toBe('agent-only');
    expect(out.diagnosis.rootCause).toContain('agent-only');
  });
});