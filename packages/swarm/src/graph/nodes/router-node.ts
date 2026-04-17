import { WorkflowStatus, Industry } from '@jak-swarm/shared';
import { RouterAgent, AgentContext } from '@jak-swarm/agents';
import { getIndustryPack } from '@jak-swarm/industry-packs';
import type { SwarmState } from '../../state/swarm-state.js';

export async function routerNode(state: SwarmState): Promise<Partial<SwarmState>> {
  if (!state.plan || !state.missionBrief) {
    return {
      error: 'Router node received no plan or mission brief',
      status: WorkflowStatus.FAILED,
    };
  }

  const industry = (state.industry as Industry | undefined) ?? Industry.GENERAL;
  const industryPack = getIndustryPack(industry);

  const agent = new RouterAgent();

  const context = new AgentContext({
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
    browserAutomationEnabled: state.browserAutomationEnabled,
    restrictedCategories: state.restrictedCategories,
    disabledToolNames: state.disabledToolNames,
    connectedProviders: state.connectedProviders,
  });

  const result = await agent.execute(
    { plan: state.plan, industryPack },
    context,
  );

  const traces = context.getTraces();

  return {
    routeMap: result.routeMap,
    restrictedCategories: industryPack.restrictedTools,
    status: WorkflowStatus.EXECUTING,
    traces,
  };
}
