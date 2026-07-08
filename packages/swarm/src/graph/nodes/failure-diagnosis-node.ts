/**
 * failure-diagnosis-node.ts — HyperAgent Phase 4 graph node.
 *
 * Reached from the verifier when a task fails with an R3 (plan-repair) failure
 * class and the HyperAgent layer is ON. Runs the deterministic classifier FIRST
 * (Phase 2), then counterfactual replay (Innovation #1, injected re-executor),
 * then an OPTIONAL LLM diagnosis for UNKNOWN only — never overriding a
 * deterministic security block. Writes a `FailureDiagnosis` + `DiagnosisRecord`
 * into state for the replanner node to consume.
 *
 * Pure-orchestration: the heavy lifting is in
 * `packages/swarm/src/hyperagent/failure-diagnostician.ts`. This node is the
 * LangGraph adapter that builds the ExecutionFailure envelope from the
 * verifier result + task, stamps the timestamp, and stores the diagnosis.
 */

import { createHash } from 'node:crypto';
import { FailureClass, RepairLevel, WorkflowStatus } from '@jak-swarm/shared';
import type { ExecutionFailure, CounterfactualReplayHint } from '@jak-swarm/shared';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';
import { diagnoseFailure } from '../../hyperagent/failure-diagnostician.js';
import type { CounterfactualReExecutor, LlmDiagnoseFn } from '../../hyperagent/failure-diagnostician.js';

export interface FailureDiagnosisNodeDeps {
  /** Optional sandboxed re-executor for Innovation #1 counterfactual replay. */
  reExecutor?: CounterfactualReExecutor;
  /** Optional LLM diagnosis (UNKNOWN only). */
  llmDiagnose?: LlmDiagnoseFn;
}

/** Hash a task input for the ExecutionFailure envelope (stable correlation). */
function hashInput(workflowId: string, taskId: string, input: unknown): string {
  const serialized = JSON.stringify({ workflowId, taskId, input }) ?? '{}';
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}

export async function failureDiagnosisNode(
  state: SwarmState,
  deps: FailureDiagnosisNodeDeps = {},
): Promise<Partial<SwarmState>> {
  const task = getCurrentTask(state);
  if (!task) {
    return { status: WorkflowStatusForDiag(state) };
  }

  const verifierResult = state.verificationResults[task.id];
  const issues = verifierResult?.issues ?? [];
  const message = issues.length > 0 ? issues.join('; ') : (task.error ?? 'Task failed verification');

  // Build the structured failure envelope (spec §6 Step 1).
  const failure: ExecutionFailure = {
    workflowId: state.workflowId,
    taskId: task.id,
    agentRole: String(task.agentRole),
    toolName: task.toolsRequired[0],
    errorClass: FailureClass.UNKNOWN, // the classifier refines this
    message,
    retryable: false,
    externalSideEffectPossible: false,
    inputHash: hashInput(state.workflowId, task.id, state.taskResults[task.id]),
    stateVersion: state.activePlanVersion ?? 0,
    occurredAt: new Date().toISOString(),
  };

  const hint: CounterfactualReplayHint = {
    taskId: task.id,
    agentRole: String(task.agentRole),
    toolName: task.toolsRequired[0],
    inputHash: failure.inputHash,
    hypothesisSet: ['agent-only', 'tool-only', 'model-only'],
  };

  const result = await diagnoseFailure({
    failure,
    signal: { message, toolName: task.toolsRequired[0] },
    hint,
    verifierIssues: issues,
    tenantId: state.tenantId,
    now: failure.occurredAt,
    reExecutor: deps.reExecutor,
    llmDiagnose: deps.llmDiagnose,
  });

  // Store the diagnosis for the replanner + durable record.
  return {
    failureDiagnoses: { [task.id]: result.diagnosis },
    pendingDiagnoses: { [task.id]: { diagnosis: result.diagnosis, counterfactual: result.counterfactual, hint: result.hint } },
    // Keep the workflow in a non-terminal state so the graph advances to the replanner.
    status: WorkflowStatus.VERIFYING,
  };
}

/** Preserve the current status unless the workflow was already terminal. */
function WorkflowStatusForDiag(state: SwarmState): SwarmState['status'] {
  return state.status;
}

// Re-export the repair level so callers can branch on the diagnosis.
export { RepairLevel };