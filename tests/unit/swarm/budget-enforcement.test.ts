/**
 * Budget enforcement tests for SwarmGraph.runParallel().
 *
 * These verify that the parallel execution path (the production path)
 * respects maxCostUsd and stops execution when budget is exceeded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSwarmGraph } from '@jak-swarm/swarm';
import { createInitialSwarmState } from '@jak-swarm/swarm';
import { WorkflowStatus } from '@jak-swarm/shared';

describe('Budget enforcement in runParallel', () => {
  const originalKey = process.env['OPENAI_API_KEY'];

  beforeEach(() => {
    // Ensure tests run without API key (agents use stub fallbacks)
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    if (originalKey) {
      process.env['OPENAI_API_KEY'] = originalKey;
    }
  });

  it('fails workflow when accumulatedCostUsd already exceeds maxCostUsd (pre-batch budget gate)', async () => {
    const graph = buildSwarmGraph();
    const state = createInitialSwarmState({
      goal: 'Test budget enforcement',
      tenantId: 'test',
      userId: 'test',
      workflowId: 'wf_budget_test',
      maxCostUsd: 0.001,
    });

    // Set accumulatedCostUsd above the budget before running
    const overBudgetState = { ...state, accumulatedCostUsd: 0.01 };

    const result = await graph.runParallel(overBudgetState);
    // The pre-batch budget check should catch this
    expect(result.status).toBe(WorkflowStatus.FAILED);
    expect(result.error).toContain('budget exceeded');
    // Should NOT have attempted any task execution
    expect(result.completedTaskIds?.length ?? 0).toBe(0);
  });

  it('tracks accumulatedCostUsd through parallel execution', async () => {
    const graph = buildSwarmGraph();
    const state = createInitialSwarmState({
      goal: 'Test cost accumulation',
      tenantId: 'test',
      userId: 'test',
      workflowId: 'wf_cost_track',
    });

    // No budget limit set — cost should still accumulate
    const result = await graph.runParallel(state);
    // accumulatedCostUsd should be a number (may be 0 without API key)
    expect(typeof result.accumulatedCostUsd).toBe('number');
    expect(result.accumulatedCostUsd).toBeGreaterThanOrEqual(0);
  });
});
