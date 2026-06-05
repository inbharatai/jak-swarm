/**
 * Pure conditional-edge functions for the JAK workflow graph.
 *
 * Extracted from swarm-graph.ts in Sprint 2.5 / A.6 so that the LangGraph
 * builder (langgraph-graph-builder.ts) can import them without depending
 * on the deleted SwarmGraph class. Each function reads `SwarmState` and
 * returns the next-node label.
 *
 * `__clarification__` and `__end__` are sentinel labels mapped to
 * LangGraph's `END` by the builder; nothing else uses them.
 */

import { WorkflowStatus } from '@jak-swarm/shared';
import type { SwarmState } from '../state/swarm-state.js';
import {
  getCurrentTask,
  hasMoreTasks,
  getCurrentVerificationResult,
} from '../state/swarm-state.js';

export type NodeName =
  | 'commander'
  | 'planner'
  | 'router'
  | 'guardrail'
  | 'worker'
  | 'verifier'
  | 'approval'
  | 'validator'
  | 'replanner'
  | '__end__'
  | '__clarification__';

export function afterCommander(state: SwarmState): NodeName {
  // If commander failed (provider error, timeout, malformed response),
  // stop immediately so planner doesn't run without a mission brief.
  if (state.status === WorkflowStatus.FAILED) return '__end__';

  // Short-circuit: Commander answered the user directly (greeting,
  // trivial factual Q). Skip Planner/Router/Workers/Verifier entirely.
  if (state.directAnswer) return '__end__';
  if (state.clarificationNeeded) return '__clarification__';
  return 'planner';
}

export function afterPlanner(state: SwarmState): NodeName {
  // If the planner failed (no LLM key, timeout, budget exceeded, etc.),
  // do NOT advance to the router — it will crash with "no plan or mission
  // brief". Instead, route to END with the FAILED status already set.
  if (state.status === WorkflowStatus.FAILED || !state.plan) return '__end__';
  return 'router';
}

export function afterGuardrail(state: SwarmState): NodeName {
  if (state.blocked) return '__end__';
  const task = getCurrentTask(state);
  if (!task) return '__end__';
  if (task.requiresApproval) return 'approval';
  return 'worker';
}

export function afterApproval(state: SwarmState): NodeName {
  // Pending, rejected, or deferred decisions must not advance to the worker. The
  // approval node keeps DEFERRED runs in AWAITING_APPROVAL so the reviewer
  // can decide later through the proper approval endpoint.
  const lastApproval = state.pendingApprovals[state.pendingApprovals.length - 1];
  if (lastApproval?.status === 'PENDING') return '__end__';
  if (lastApproval?.status === 'REJECTED') return '__end__';
  if (lastApproval?.status === 'DEFERRED') return '__end__';
  return 'worker';
}

export function afterVerifier(state: SwarmState): NodeName {
  const currentResult = getCurrentVerificationResult(state);

  if (currentResult && !currentResult.passed && currentResult.needsRetry) {
    const task = getCurrentTask(state);
    const MAX_TASK_RETRIES = 3;
    const retries = task ? (state.taskRetryCount[task.id] ?? 0) : MAX_TASK_RETRIES;
    if (retries < MAX_TASK_RETRIES) {
      return 'worker';
    }
  }

  if (hasMoreTasks(state)) {
    return 'guardrail';
  }

  return '__end__';
}
