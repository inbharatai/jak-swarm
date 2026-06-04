/**
 * Unit tests for graph edge functions.
 *
 * Sprint 3: afterPlanner conditional edge — prevents router crash
 * when planner fails.
 */

import { describe, it, expect } from 'vitest';
import { WorkflowStatus } from '../../../packages/shared/src/index.js';
import {
  afterCommander,
  afterPlanner,
  afterGuardrail,
  afterApproval,
  afterVerifier,
} from '../../../packages/swarm/src/graph/edges.js';
import type { SwarmState } from '../../../packages/swarm/src/state/swarm-state.js';

function makeState(overrides: Partial<SwarmState> = {}): SwarmState {
  return {
    goal: 'Test goal',
    tenantId: 'test-tenant',
    userId: 'test-user',
    workflowId: 'test-workflow',
    industry: undefined,
    roleModes: [],
    idempotencyKey: undefined,
    missionBrief: undefined,
    clarificationNeeded: false,
    clarificationQuestion: undefined,
    directAnswer: undefined,
    plan: undefined,
    routeMap: undefined,
    currentTaskIndex: 0,
    taskResults: {},
    pendingApprovals: [],
    guardrailResult: undefined,
    blocked: false,
    verificationResults: {},
    completedTaskIds: [],
    failedTaskIds: [],
    taskRetryCount: {},
    accumulatedCostUsd: 0,
    maxCostUsd: undefined,
    autoApproveEnabled: undefined,
    approvalThreshold: undefined,
    allowedDomains: [],
    browserAutomationEnabled: false,
    restrictedCategories: [],
    disabledToolNames: [],
    allowedToolNames: [],
    connectedProviders: [],
    subscriptionTier: undefined,
    userRole: undefined,
    llmProvider: undefined,
    status: WorkflowStatus.PENDING,
    error: undefined,
    outputs: [],
    traces: [],
    ...overrides,
  } as SwarmState;
}

describe('afterPlanner', () => {
  it('routes to router when planner produced a plan', () => {
    const state = makeState({
      plan: { tasks: [{ id: 't1', name: 'Task 1' }] } as any,
      status: WorkflowStatus.ROUTING,
    });
    expect(afterPlanner(state)).toBe('router');
  });

  it('routes to __end__ when planner failed (status=FAILED)', () => {
    const state = makeState({
      plan: undefined,
      status: WorkflowStatus.FAILED,
      error: 'Error in node planner: LLM provider not configured',
    });
    expect(afterPlanner(state)).toBe('__end__');
  });

  it('routes to __end__ when plan is missing but status is not FAILED (defensive)', () => {
    const state = makeState({
      plan: undefined,
      status: WorkflowStatus.ROUTING,
    });
    expect(afterPlanner(state)).toBe('__end__');
  });

  it('routes to __end__ when status is FAILED even if plan exists', () => {
    // If the planner somehow produced a plan AND set FAILED status,
    // FAILED takes priority — route to END.
    const state = makeState({
      plan: { tasks: [{ id: 't1', name: 'Task 1' }] } as any,
      status: WorkflowStatus.FAILED,
    });
    expect(afterPlanner(state)).toBe('__end__');
  });
});

describe('afterCommander', () => {
  it('routes to planner for a normal request', () => {
    const state = makeState();
    expect(afterCommander(state)).toBe('planner');
  });

  it('routes to __end__ for direct answers', () => {
    const state = makeState({ directAnswer: 'The answer is 42' });
    expect(afterCommander(state)).toBe('__end__');
  });

  it('routes to __clarification__ when clarification is needed', () => {
    const state = makeState({ clarificationNeeded: true });
    expect(afterCommander(state)).toBe('__clarification__');
  });
});