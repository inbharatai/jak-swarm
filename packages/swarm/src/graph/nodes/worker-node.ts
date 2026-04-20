import { WorkflowStatus, TaskStatus } from '@jak-swarm/shared';
import { AgentContext } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';
import { getCircuitBreaker, CircuitOpenError } from '../../supervisor/circuit-breaker.js';
import { getBreakerFactory } from '../../supervisor/breaker-registry.js';
import { createWorkerAgent } from './worker/agent-factory.js';
import { buildTaskInput } from './worker/task-input-builders.js';

// ─── Public browser types + plan builder (preserved from pre-P5b worker-node.ts) ─
//
// External consumers (apps/web traces, @jak-swarm/swarm public API, and the
// worker-node-browser behavioral test) import these names from this file. The
// implementation now lives in ./worker/intent-inference/browser.ts.
export type {
  BrowserActionType,
  BrowserActionRisk,
  BrowserActionShape,
  BrowserExecutionPlan,
  BrowserIntentCandidate,
  IntentConfidence,
} from './worker/intent-inference/browser.js';
export { buildBrowserExecutionPlan } from './worker/intent-inference/browser.js';

/**
 * Worker node — orchestration only.
 *
 * Resolves the agent for the current task, builds the role-specific input,
 * executes through a circuit breaker (local or distributed), lets the agent
 * self-correct its output, and records the result on the task/state.
 *
 * Everything interesting about per-role behavior lives under ./worker/.
 */
export async function workerNode(state: SwarmState): Promise<Partial<SwarmState>> {
  const task = getCurrentTask(state);

  if (!task) {
    return {
      status: WorkflowStatus.FAILED,
      error: 'Worker node: no current task found',
    };
  }

  const context = new AgentContext({
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
    idempotencyKey: state.idempotencyKey,
    browserAutomationEnabled: state.browserAutomationEnabled,
    allowedDomains: state.allowedDomains,
    restrictedCategories: state.restrictedCategories,
    disabledToolNames: state.disabledToolNames,
    connectedProviders: state.connectedProviders,
    subscriptionTier: state.subscriptionTier,
  });

  let output: unknown;
  let taskFailed = false;

  try {
    const agent = createWorkerAgent(task.agentRole);

    if (!agent) {
      taskFailed = true;
      output = {
        error: `No worker agent registered for role: ${task.agentRole}`,
        taskId: task.id,
      };
    } else {
      const taskInput = buildTaskInput(task, state);

      // Distributed breaker (shared across instances) if registered for this
      // workflow in the breaker-registry side-channel; else local per-process.
      // State cannot carry the factory directly — Function values crash Prisma
      // persistence (`[object Function]` serialization error).
      const breakerFactory = getBreakerFactory(state.workflowId);

      const breaker = breakerFactory
        ? breakerFactory(`worker:${task.agentRole}`, { failureThreshold: 5, resetTimeoutMs: 30_000 })
        : getCircuitBreaker(`worker:${task.agentRole}`, { failureThreshold: 5, resetTimeoutMs: 30_000, tenantId: state.tenantId });

      try {
        output = await breaker.call<unknown>(() => agent.execute(taskInput, context));
      } catch (err) {
        if (err instanceof CircuitOpenError || (err instanceof Error && err.message.includes('circuit breaker'))) {
          taskFailed = true;
          output = {
            error: `Circuit breaker open for ${task.agentRole}: ${err.message}`,
            taskId: task.id,
          };
        } else {
          throw err;
        }
      }

      // Self-correction: agent reviews its own output before the verifier sees it.
      // Catches obvious errors early, reducing verifier retry loops.
      if (!taskFailed && output && typeof output === 'object') {
        try {
          const outputStr = JSON.stringify(output);
          const { corrected, wasChanged } = await agent.reflectAndCorrect(
            outputStr,
            task.description,
            { maxTokens: 2048 },
          );
          if (wasChanged) {
            try {
              output = JSON.parse(corrected);
            } catch {
              // Correction wasn't valid JSON — keep original
            }
          }
        } catch {
          // Self-reflection failed — continue with original output
        }
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    taskFailed = true;
    output = { error: errorMessage, taskId: task.id };
  }

  const traces = context.getTraces();

  const updatedPlan = state.plan
    ? {
        ...state.plan,
        tasks: state.plan.tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: taskFailed ? TaskStatus.FAILED : TaskStatus.COMPLETED,
                completedAt: new Date(),
                error: taskFailed
                  ? String((output as Record<string, unknown>)['error'] ?? 'Unknown worker error')
                  : undefined,
              }
            : t,
        ),
      }
    : state.plan;

  return {
    taskResults: { [task.id]: output },
    outputs: [output],
    plan: updatedPlan,
    traces,
    // Hand off to verifier even on failure — verifier decides retry vs pass-through.
    status: WorkflowStatus.VERIFYING,
    error: taskFailed
      ? String((output as Record<string, unknown>)['error'] ?? 'Worker failed')
      : undefined,
  };
}
