import { WorkflowStatus } from '@jak-swarm/shared';
import { CommanderAgent, AgentContext } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';

export async function commanderNode(
  state: SwarmState,
): Promise<Partial<SwarmState>> {
  const agent = new CommanderAgent();

  const context = new AgentContext({
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
  });

  const result = await agent.execute(state.goal, context);

  const traces = context.getTraces();

  if (result.clarificationNeeded) {
    return {
      clarificationNeeded: true,
      clarificationQuestion: result.clarificationQuestion,
      status: WorkflowStatus.PLANNING,
      traces,
    };
  }

  return {
    missionBrief: result.missionBrief,
    clarificationNeeded: false,
    industry: result.missionBrief?.industry,
    status: WorkflowStatus.PLANNING,
    traces,
  };
}
