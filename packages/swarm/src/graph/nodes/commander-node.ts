import { WorkflowStatus } from '@jak-swarm/shared';
import { CommanderAgent, AgentContext } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';

/**
 * Mapping from UX role IDs (what the dashboard role picker surfaces) to the
 * runtime AgentRole enum values (what the Router actually dispatches to).
 *
 * This is the SINGLE source of truth for that mapping on the backend. The
 * frontend mirrors it in `apps/web/src/lib/role-config.ts` under
 * `canonicalAgentRole`. If either side drifts, the Commander will fall back
 * to the appended-focus-text behavior and the router picks workers on its
 * own heuristics — degraded but not broken.
 */
const UX_ROLE_TO_AGENT_ROLE: Record<string, string> = {
  cto: 'WORKER_TECHNICAL',
  cmo: 'WORKER_MARKETING',
  ceo: 'WORKER_STRATEGIST',
  coding: 'WORKER_CODER',
  code: 'WORKER_CODER',
  research: 'WORKER_RESEARCH',
  design: 'WORKER_DESIGNER',
  automation: 'WORKER_OPS',
  auto: 'WORKER_OPS',
};

/** Human-readable label for each UX role (used in the focus-text block). */
const UX_ROLE_LABEL: Record<string, string> = {
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

function normalizeRoleMode(role: string): string {
  const lowered = role.trim().toLowerCase();
  return UX_ROLE_LABEL[lowered] ?? role.trim();
}

/**
 * Resolve UX role IDs to the AgentRole enum values the Router dispatches to.
 * Unknown UX roles are dropped — we prefer "missing preference" over "wrong
 * preference" because the Router's heuristic is a safe fallback.
 */
function resolveAgentRoles(roleModes: string[]): string[] {
  const resolved = roleModes
    .map((r) => UX_ROLE_TO_AGENT_ROLE[r.trim().toLowerCase()])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  return [...new Set(resolved)];
}

/**
 * Build the Commander's input goal string, augmented with role-mode context
 * when the user's picked one or more roles in the dashboard.
 *
 * The appended block gives the Commander TWO facts:
 *   1. Human-readable role labels ("CTO, CMO") — this is the same behavior
 *      the Commander has seen historically, kept for backwards compatibility
 *      with prompts it already knows how to interpret.
 *   2. Canonical AgentRole values ("WORKER_TECHNICAL, WORKER_MARKETING") —
 *      a hard instruction that biases task assignment toward those workers.
 *      The Commander's system prompt is updated to honor this bias when
 *      creating the plan.
 */
export function buildCommanderInput(goal: string, roleModes: string[]): string {
  if (!roleModes || roleModes.length === 0) return goal;

  const labels = [...new Set(roleModes.map(normalizeRoleMode).filter(Boolean))];
  const agentRoles = resolveAgentRoles(roleModes);

  if (labels.length === 0 && agentRoles.length === 0) return goal;

  const parts = [`${goal}`];
  if (labels.length > 0) {
    parts.push(`Role focus modes selected by user: ${labels.join(', ')}.`);
  }
  if (agentRoles.length > 0) {
    parts.push(
      `PREFER these worker agents when creating the plan and assigning tasks: ${agentRoles.join(', ')}.\n` +
        `These workers have the specific tools the user's selected roles expect. ` +
        `Do NOT route around them unless a task genuinely requires a capability they lack.`,
    );
  }
  return parts.join('\n\n');
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

  // Short-circuit: Commander direct-answered the user (trivial input
  // like a greeting or simple factual question). Terminate the workflow
  // immediately — no Planner, no Workers, no Verifier. The swarm-
  // execution service prefers state.directAnswer over compileFinalOutput.
  if (result.directAnswer) {
    return {
      directAnswer: result.directAnswer,
      clarificationNeeded: false,
      status: WorkflowStatus.COMPLETED,
      traces,
    };
  }

  if (result.clarificationNeeded) {
    return {
      clarificationNeeded: true,
      clarificationQuestion: result.clarificationQuestion,
      status: WorkflowStatus.PLANNING,
      traces,
    };
  }

  // Defensive: if Commander.execute somehow returned without missionBrief
  // AND without directAnswer/clarification, terminate the workflow with a
  // clear error instead of letting Planner choke on undefined missionBrief
  // (the historical "Planner node received no mission brief" failure mode).
  if (!result.missionBrief) {
    return {
      directAnswer: 'I had trouble understanding that request. Could you rephrase it with a bit more detail about what you want me to do?',
      clarificationNeeded: false,
      status: WorkflowStatus.COMPLETED,
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
