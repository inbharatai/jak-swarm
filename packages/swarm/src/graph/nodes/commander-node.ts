import { WorkflowStatus } from '@jak-swarm/shared';
import { CommanderAgent, AgentContext } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';

function normalizeRoleMode(role: string): string {
  const lowered = role.trim().toLowerCase();
  const map: Record<string, string> = {
    cto: 'CTO',
    cmo: 'CMO',
    ceo: 'CEO',
    coding: 'Code',
    code: 'Code',
    research: 'Research',
    design: 'Design',
    automation: 'Auto',
    auto: 'Auto',
  };
  return map[lowered] ?? role.trim();
}

export function buildCommanderInput(goal: string, roleModes: string[]): string {
  if (!roleModes || roleModes.length === 0) return goal;

  const normalizedModes = [...new Set(roleModes.map(normalizeRoleMode).filter(Boolean))];
  if (normalizedModes.length === 0) return goal;

  return `${goal}\n\nRole focus modes selected by user: ${normalizedModes.join(', ')}.`;
}

export async function commanderNode(
  state: SwarmState,
): Promise<Partial<SwarmState>> {
  const agent = new CommanderAgent();

  const context = new AgentContext({
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
    idempotencyKey: state.idempotencyKey,
    allowedDomains: state.allowedDomains,
  });

  const commanderInput = buildCommanderInput(state.goal, state.roleModes);
  const result = await agent.execute(commanderInput, context);

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
