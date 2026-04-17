import { WorkflowStatus, TaskStatus } from '@jak-swarm/shared';
import { VerifierAgent, AgentContext } from '@jak-swarm/agents';
import type { VerifierInput } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';

const MAX_RETRIES = 2;  // max worker retries per task before accepting the result as-is

export async function verifierNode(state: SwarmState): Promise<Partial<SwarmState>> {
  const task = getCurrentTask(state);

  if (!task) {
    return { status: WorkflowStatus.COMPLETED };
  }

  const taskOutput = state.taskResults[task.id];
  const agent = new VerifierAgent();

  const context = new AgentContext({
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
    idempotencyKey: state.idempotencyKey,
    allowedDomains: state.allowedDomains,
  });

  const verifierInput: VerifierInput = {
    task,
    agentOutput: taskOutput,
  };

  const result = await agent.execute(verifierInput, context);
  const traces = context.getTraces();

  // Count how many times this task has been retried
  const retryKey = `${task.id}_retries`;
  const currentRetries = (state.taskResults[retryKey] as number | undefined) ?? 0;

  if (!result.passed && result.needsRetry && currentRetries < MAX_RETRIES) {
    // Budget remaining — schedule a retry. Store the raw result (needsRetry:true)
    // so afterVerifier() correctly routes back to the worker node.
    return {
      verificationResults: { [task.id]: result },
      taskResults: { [retryKey]: currentRetries + 1 },
      traces,
      // Status stays VERIFYING so the graph goes back to worker
    };
  }

  // ── Retries exhausted (or task passed, or needsRetry was false) ───────────────
  // CRITICAL FIX: force needsRetry=false on the stored result.
  // The raw agent result may still carry needsRetry:true, but we must NOT honour
  // it once the retry budget is spent — otherwise afterVerifier() re-routes to
  // the worker indefinitely.
  const finalResult = {
    ...result,
    needsRetry: false,
  };

  // Update task status in the plan
  const updatedPlan = state.plan
    ? {
        ...state.plan,
        tasks: state.plan.tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: finalResult.passed ? TaskStatus.COMPLETED : TaskStatus.FAILED,
                error: finalResult.passed ? undefined : finalResult.issues.join('; '),
              }
            : t,
        ),
      }
    : state.plan;

  return {
    verificationResults: { [task.id]: finalResult },
    plan: updatedPlan,
    traces,
    // VERIFYING tells the graph runner "routing should decide what happens next".
    // afterVerifier() reads finalResult.needsRetry (now false) → advances correctly.
    status: WorkflowStatus.VERIFYING,
    // Surface error only when task ultimately failed after exhausting all retries
    error: !finalResult.passed
      ? `Task '${task.name}' failed verification after ${currentRetries + 1} attempt(s): ${finalResult.issues.join('; ')}`
      : undefined,
  };
}
