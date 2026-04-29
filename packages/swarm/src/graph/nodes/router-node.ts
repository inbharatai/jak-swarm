import { WorkflowStatus, Industry } from '@jak-swarm/shared';
import { RouterAgent, AgentContext } from '@jak-swarm/agents';
import { getIndustryPack } from '@jak-swarm/industry-packs';
import type { SwarmState } from '../../state/swarm-state.js';
import { getActivityEmitter } from '../../supervisor/activity-registry.js';

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
    idempotencyKey: state.idempotencyKey,
    browserAutomationEnabled: state.browserAutomationEnabled,
    allowedDomains: state.allowedDomains,
    restrictedCategories: state.restrictedCategories,
    disabledToolNames: state.disabledToolNames,
    // Item C — StandingOrder whitelist propagation. Router doesn't
    // call tools, but the AgentContext type carries it for consistency
    // with worker-node + downstream agents that may.
    allowedToolNames: state.allowedToolNames,
    connectedProviders: state.connectedProviders,
  });

  const result = await agent.execute(
    { plan: state.plan, industryPack },
    context,
  );

  const traces = context.getTraces();

  // Sprint 2.1 / Item K — emit one `agent_assigned` activity event per
  // (task → agentRole) mapping the Router produced. The
  // swarm-execution.service.ts onAgentActivity translator picks these up
  // and emits a workflow-lifecycle `agent_assigned` event for the
  // cockpit + AuditLog. Fire-and-forget; never blocks the routing
  // decision.
  try {
    const emitter = getActivityEmitter(state.workflowId);
    if (emitter && result.routeMap) {
      const taskById = new Map<string, { id: string; name?: string }>();
      for (const t of state.plan.tasks ?? []) {
        taskById.set(t.id, { id: t.id, name: t.name });
      }
      const nowIso = new Date().toISOString();
      for (const [taskId, agentRole] of Object.entries(result.routeMap)) {
        if (typeof agentRole !== 'string') continue;
        const task = taskById.get(taskId);
        emitter({
          type: 'agent_assigned',
          taskId,
          ...(task?.name ? { taskName: task.name } : {}),
          agentRole,
          timestamp: nowIso,
        });
      }
    }
  } catch {
    // Activity emission failure must never break the routing decision.
  }

  return {
    routeMap: result.routeMap,
    restrictedCategories: industryPack.restrictedTools,
    status: WorkflowStatus.EXECUTING,
    traces,
  };
}
