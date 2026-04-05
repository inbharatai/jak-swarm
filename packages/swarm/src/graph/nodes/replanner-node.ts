import { WorkflowStatus } from '@jak-swarm/shared';
import { PlannerAgent, AgentContext } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';

/**
 * Replanner node — invoked when a task fails and the plan needs adjustment.
 * Calls the PlannerAgent with replan=true to get an updated plan that
 * works around the failure.
 */
export async function replannerNode(state: SwarmState): Promise<Partial<SwarmState>> {
  if (!state.plan) {
    return { error: 'No plan to replan', status: WorkflowStatus.FAILED };
  }

  const failedTaskIds = state.failedTaskIds ?? [];
  if (failedTaskIds.length === 0) {
    // Nothing to replan — no failures
    return {};
  }

  const agent = new PlannerAgent();
  const context = new AgentContext({
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
  });

  // Gather failed task info
  const failedTasks = state.plan.tasks.filter((t) => failedTaskIds.includes(t.id));
  const completedResults: Record<string, unknown> = {};
  for (const taskId of state.completedTaskIds ?? []) {
    if (state.taskResults[taskId] !== undefined) {
      completedResults[taskId] = state.taskResults[taskId];
    }
  }

  try {
    const replanInput = {
      replan: true,
      failedTasks: failedTasks.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        error: t.error ?? state.taskResults[t.id],
      })),
      existingPlan: state.plan,
      completedResults,
      goal: state.goal,
      missionBrief: state.missionBrief,
    };

    const result = await agent.execute(replanInput, context);
    const traces = context.getTraces();

    return {
      plan: result.plan,
      traces,
      // Reset failed task IDs since the plan is new
      failedTaskIds: [],
      status: WorkflowStatus.EXECUTING,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      error: `Replanning failed: ${errorMessage}`,
      traces: context.getTraces(),
    };
  }
}
