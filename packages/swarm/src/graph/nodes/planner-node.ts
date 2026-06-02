import { WorkflowStatus } from '@jak-swarm/shared';
import { PlannerAgent, AgentContext } from '@jak-swarm/agents';
import type { PlannerOutput } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';

export async function plannerNode(state: SwarmState): Promise<Partial<SwarmState>> {
  if (!state.missionBrief) {
    return {
      error: 'Planner node received no mission brief',
      status: WorkflowStatus.FAILED,
    };
  }

  const agent = new PlannerAgent();

  const context = new AgentContext({
    agentRole: 'PLANNER',
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
    idempotencyKey: state.idempotencyKey,
    allowedDomains: state.allowedDomains,
    ...(state.llmProvider ? { llmProvider: state.llmProvider } : {}),
  });

  const result = await agent.execute(state.missionBrief, context) as PlannerOutput;

  const traces = context.getTraces();

  return {
    plan: result.plan,
    status: WorkflowStatus.ROUTING,
    traces,
  };
}
