import { WorkflowStatus } from '@jak-swarm/shared';
import { PlannerAgent, AgentContext } from '@jak-swarm/agents';
import type { PlannerOutput } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getActivityEmitter } from '../../supervisor/activity-registry.js';

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

  // Emit the plan to the live SSE stream + audit translator. Without this the
  // cockpit never receives plan_created and the planJson replay column is
  // never populated, so reconnecting clients see no plan.
  const onActivity = getActivityEmitter(state.workflowId);
  if (onActivity && result.plan) {
    onActivity({
      type: 'plan_created',
      planId: state.workflowId + '-plan',
      plan: result.plan as { goal?: string; tasks: unknown[] },
      timestamp: new Date().toISOString(),
    });
  }

  return {
    plan: result.plan,
    status: WorkflowStatus.ROUTING,
    traces,
  };
}
