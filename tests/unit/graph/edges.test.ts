/**
 * Unit tests for graph edge functions.
 *
 * Sprint 3: afterPlanner conditional edge — prevents router crash
 * when planner fails.
 */

import { describe, it, expect } from 'vitest';
import { WorkflowStatus, HyperAgentMode } from '../../../packages/shared/src/index.js';
import {
  afterCommander,
  afterPlanner,
  afterGuardrail,
  afterApproval,
  afterVerifier,
  MAX_TASK_RETRIES,
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

// afterVerifier same-input (R1/R2) retry accounting. Previously the verifier
// tracked retries in `taskResults[${id}_retries]` under MAX=2 while this edge
// read `taskRetryCount` under MAX=3 — two counters, two ceilings, two storages.
// Both now read `taskRetryCount` against the single shared `MAX_TASK_RETRIES`
// ceiling, so the verifier's retry decision and the edge's routing decision
// can never disagree. These tests pin that contract.
describe('afterVerifier — unified retry accounting', () => {
  // A failing verification result that still wants a same-input retry.
  const failRetry = (): unknown => ({
    passed: false,
    issues: ['bad'],
    confidence: 0.4,
    needsRetry: true,
  });

  function makeVerifyingState(overrides: Partial<SwarmState> = {}): SwarmState {
    return makeState({
      plan: { tasks: [{ id: 't1', name: 'Task 1' }] } as unknown as SwarmState['plan'],
      currentTaskIndex: 0,
      status: WorkflowStatus.VERIFYING,
      verificationResults: { t1: failRetry() as never },
      ...overrides,
    });
  }

  it('routes back to worker while the same-input retry budget remains', () => {
    expect(afterVerifier(makeVerifyingState({ taskRetryCount: { t1: 0 } }))).toBe('worker');
    expect(afterVerifier(makeVerifyingState({ taskRetryCount: { t1: 1 } }))).toBe('worker');
  });

  it('stops routing to worker once the shared retry ceiling is reached', () => {
    // MAX_TASK_RETRIES is the single ceiling shared with verifier-node — the
    // verifier and the edge agree on exactly when retries are exhausted.
    const exhausted = makeVerifyingState({ taskRetryCount: { t1: MAX_TASK_RETRIES } });
    expect(afterVerifier(exhausted)).not.toBe('worker');
  });

  it('advances to the next task (guardrail) when retries are exhausted and more tasks remain', () => {
    const state = makeVerifyingState({
      taskRetryCount: { t1: MAX_TASK_RETRIES },
      plan: {
        tasks: [{ id: 't1', name: 'Task 1' }, { id: 't2', name: 'Task 2' }],
      } as unknown as SwarmState['plan'],
    });
    expect(afterVerifier(state)).toBe('guardrail');
  });

  it('routes to __end__ when retries are exhausted and no more tasks remain', () => {
    const state = makeVerifyingState({ taskRetryCount: { t1: MAX_TASK_RETRIES } });
    expect(afterVerifier(state)).toBe('__end__');
  });

  it('never routes to worker when the task passed', () => {
    const state = makeVerifyingState({
      taskRetryCount: { t1: 0 },
      verificationResults: {
        t1: { passed: true, issues: [], confidence: 1, needsRetry: false } as never,
      },
    });
    expect(afterVerifier(state)).not.toBe('worker');
  });

  it('routes to diagnosis when HyperAgent is active and same-input retries are exhausted', () => {
    const state = makeVerifyingState({
      taskRetryCount: { t1: MAX_TASK_RETRIES },
      hyperAgentEnabled: true,
      hyperAgentMode: HyperAgentMode.OBSERVE,
      hyperAgentIteration: 0,
      maxHyperAgentIterations: 3,
    });
    expect(afterVerifier(state)).toBe('diagnosis');
  });
});