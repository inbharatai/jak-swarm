import { describe, expect, it } from 'vitest';
import { WorkflowStatus } from '@jak-swarm/shared';
import { afterCommander } from './edges.js';
import { createInitialSwarmState } from '../state/swarm-state.js';

function baseState() {
  return createInitialSwarmState({
    goal: 'test goal',
    tenantId: 't-1',
    userId: 'u-1',
    workflowId: 'wf-1',
  });
}

describe('afterCommander', () => {
  it('ends immediately when commander failed', () => {
    const state = baseState();
    state.status = WorkflowStatus.FAILED;

    expect(afterCommander(state)).toBe('__end__');
  });

  it('ends when commander produced direct answer', () => {
    const state = baseState();
    state.directAnswer = 'hello';

    expect(afterCommander(state)).toBe('__end__');
  });

  it('returns clarification branch when clarification is needed', () => {
    const state = baseState();
    state.clarificationNeeded = true;

    expect(afterCommander(state)).toBe('__clarification__');
  });

  it('routes to planner on normal commander output', () => {
    const state = baseState();
    state.status = WorkflowStatus.PLANNING;

    expect(afterCommander(state)).toBe('planner');
  });
});