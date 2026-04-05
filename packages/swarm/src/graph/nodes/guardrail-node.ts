import { WorkflowStatus } from '@jak-swarm/shared';
import { GuardrailAgent, AgentContext } from '@jak-swarm/agents';
import type { GuardrailInput } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';

export async function guardrailNode(state: SwarmState): Promise<Partial<SwarmState>> {
  const task = getCurrentTask(state);

  if (!task) {
    return { blocked: false };
  }

  const agent = new GuardrailAgent();

  const context = new AgentContext({
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
  });

  const guardrailInput: GuardrailInput = {
    content: JSON.stringify({
      taskName: task.name,
      taskDescription: task.description,
      goal: state.goal,
    }),
    action: task.name,
    riskLevel: task.riskLevel,
    toolsToExecute: task.toolsRequired,
    checkType: 'ACTION',
  };

  const result = await agent.execute(guardrailInput, context);
  const traces = context.getTraces();

  if (!result.safe) {
    return {
      guardrailResult: result,
      blocked: result.injectionAttempted || result.blockedAction !== undefined,
      error: result.violations.join('; '),
      status: result.injectionAttempted ? WorkflowStatus.FAILED : WorkflowStatus.EXECUTING,
      traces,
    };
  }

  return {
    guardrailResult: result,
    blocked: false,
    traces,
  };
}
