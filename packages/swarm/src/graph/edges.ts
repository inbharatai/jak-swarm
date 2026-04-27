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
  // Short-circuit: Commander answered the user directly (greeting,
  // trivial factual Q). Skip Planner/Router/Workers/Verifier entirely.
  if (state.directAnswer) return '__end__';
  if (state.clarificationNeeded) return '__clarification__';
  return 'planner';
}

export function afterGuardrail(state: SwarmState): NodeName {
  if (state.blocked) return '__end__';
  const task = getCurrentTask(state);
  if (!task) return '__end__';
  if (task.requiresApproval) return 'approval';
  return 'worker';
}

export function afterApproval(state: SwarmState): NodeName {
  // If the last pending approval was rejected, end the workflow.
  const lastApproval = state.pendingApprovals[state.pendingApprovals.length - 1];
  if (lastApproval?.status === 'REJECTED') return '__end__';
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
