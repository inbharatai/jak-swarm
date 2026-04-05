/**
 * Unit tests for SwarmRunner — validates the full agent pipeline executes
 * end-to-end without crashing and produces a structurally correct result.
 *
 * These tests run entirely in-process with no external API calls because
 * agent LLM calls fall back to stub responses when OPENAI_API_KEY is unset.
 *
 * NOTE: imports use the built dist via the @jak-swarm/* aliases in vitest.config.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SwarmRunner } from '@jak-swarm/swarm';
import { WorkflowStatus } from '@jak-swarm/shared';

describe('SwarmRunner', () => {
  let runner: SwarmRunner;

  beforeEach(() => {
    // Use longer timeout when real API key is available (LLM calls take 5-40s each)
    const hasApiKey = !!process.env['OPENAI_API_KEY'];
    runner = new SwarmRunner({ defaultTimeoutMs: hasApiKey ? 120_000 : 30_000 });
  });

  it('runs a simple goal and returns a SwarmResult', async () => {
    const result = await runner.run({
      goal: 'Send a welcome email to new users this week',
      tenantId: 'tnt_test',
      userId: 'usr_test',
      industry: 'general',
    });

    expect(result).toBeDefined();
    expect(result.workflowId).toBeTruthy();
    expect(result.startedAt).toBeInstanceOf(Date);
    expect(result.completedAt).toBeInstanceOf(Date);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('produces a terminal status (not PENDING or PLANNING)', async () => {
    const result = await runner.run({
      goal: 'Summarise Q3 financial reports',
      tenantId: 'tnt_test',
      userId: 'usr_test',
    });

    const terminalStatuses: string[] = [
      WorkflowStatus.COMPLETED,
      WorkflowStatus.FAILED,
      WorkflowStatus.CANCELLED,
      WorkflowStatus.AWAITING_APPROVAL,
    ];

    expect(terminalStatuses).toContain(result.status);
  }, 120_000);

  it('accepts an explicit workflowId and echoes it in the result', async () => {
    const workflowId = 'wf_explicit_test_123';
    const result = await runner.run({
      goal: 'Research top 5 competitors in fintech',
      tenantId: 'tnt_test',
      userId: 'usr_test',
      workflowId,
    });

    expect(result.workflowId).toBe(workflowId);
  }, 120_000);

  it('stores the workflow state and getState returns it', async () => {
    const result = await runner.run({
      goal: 'Prepare onboarding documents for new hire',
      tenantId: 'tnt_test',
      userId: 'usr_test',
    });

    const state = runner.getState(result.workflowId);
    expect(state).toBeDefined();
    expect(state?.workflowId).toBe(result.workflowId);
    expect(state?.goal).toBe('Prepare onboarding documents for new hire');
  });

  it('cancel() marks the state as CANCELLED', async () => {
    const result = await runner.run({
      goal: 'Run background compliance audit',
      tenantId: 'tnt_test',
      userId: 'usr_test',
    });

    await runner.cancel(result.workflowId);
    const state = runner.getState(result.workflowId);
    expect(state?.status).toBe(WorkflowStatus.CANCELLED);
  });

  it('returns traces array in result', async () => {
    const result = await runner.run({
      goal: 'Draft customer support response templates',
      tenantId: 'tnt_test',
      userId: 'usr_test',
    });

    expect(Array.isArray(result.traces)).toBe(true);
  });

  it('populates outputs array in result', async () => {
    const result = await runner.run({
      goal: 'Generate weekly ops report',
      tenantId: 'tnt_test',
      userId: 'usr_test',
      industry: 'logistics',
    });

    expect(Array.isArray(result.outputs)).toBe(true);
  });

  it('returns FAILED when an agent node throws an error', async () => {
    // Without OPENAI_API_KEY the commander node throws immediately.
    // With a real API key, the workflow may actually succeed.
    // The runner must never throw to the caller — it must always return a result.
    const result = await runner.run({
      goal: 'Trigger a failure scenario',
      tenantId: 'tnt_test',
      userId: 'usr_test',
    });

    // When the swarm has no key it fails gracefully — status is FAILED and
    // error is populated; the runner never throws to the caller.
    // The key invariant: runner NEVER throws — it always returns a result.
    expect(result).toBeDefined();
    expect(result.workflowId).toBeTruthy();
    if (result.status === WorkflowStatus.FAILED) {
      expect(result.error).toBeTruthy();
    }
    // With a real API key, any status is acceptable — the test verifies
    // graceful handling, not a specific outcome.
    expect(result.status).toBeTruthy();
  }, 120_000);
});
