import { WorkflowStatus } from '@jak-swarm/shared';
import { CommanderAgent, AgentContext, buildHelpfulClarification, inferIntentFromKeywords } from '@jak-swarm/agents';
import type { CommanderOutput } from '@jak-swarm/agents';
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
  cfo: 'WORKER_FINANCE',
  ceo: 'WORKER_STRATEGIST',
  coding: 'WORKER_CODER',
  code: 'WORKER_CODER',
  research: 'WORKER_RESEARCH',
  design: 'WORKER_DESIGNER',
  automation: 'WORKER_OPS',
  auto: 'WORKER_OPS',
  legal: 'WORKER_LEGAL',
  hr: 'WORKER_HR',
  success: 'WORKER_SUCCESS',
  growth: 'WORKER_GROWTH',
  pr: 'WORKER_PR',
  content: 'WORKER_CONTENT',
};

/** Human-readable label for each UX role (used in the focus-text block). */
const UX_ROLE_LABEL: Record<string, string> = {
  cto: 'CTO',
  cmo: 'CMO',
  cfo: 'CFO',
  ceo: 'CEO',
  coding: 'Code',
  code: 'Code',
  research: 'Research',
  design: 'Design',
  automation: 'Auto',
  auto: 'Auto',
  legal: 'Legal',
  hr: 'HR',
  success: 'Customer Success',
  growth: 'Growth',
  pr: 'PR',
  content: 'Content',
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

function buildConversationPrefix(history: Array<{ role: string; content: string }>): string {
  if (!history || history.length <= 1) return '';
  // Exclude the last entry — it's the current goal which is passed separately.
  const prior = history.slice(0, -1);
  const lines = prior.map((m) => {
    const label = m.role === 'user' ? 'User' : 'Assistant';
    return `${label}: ${m.content}`;
  });
  return `Previous conversation:\n${lines.join('\n')}\n\n`;
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
    agentRole: 'COMMANDER',
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
    idempotencyKey: state.idempotencyKey,
    allowedDomains: state.allowedDomains,
    ...(state.llmProvider ? { llmProvider: state.llmProvider } : {}),
  });

  const prefix = buildConversationPrefix(state.conversationHistory ?? []);
  const commanderInput = buildCommanderInput(prefix + state.goal, state.roleModes);
  const result = await agent.execute(commanderInput, context) as CommanderOutput;

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
      outputs: [result.directAnswer],
      traces,
    };
  }

  if (result.clarificationNeeded) {
    return {
      clarificationNeeded: true,
      clarificationQuestion: result.clarificationQuestion,
      // The graph ends after a Commander clarification. Mark the turn as
      // completed so callers do not leave the workflow looking stuck in
      // PLANNING; clarificationNeeded carries the user-facing next action.
      status: WorkflowStatus.COMPLETED,
      ...(result.clarificationQuestion ? { outputs: [result.clarificationQuestion] } : {}),
      traces,
    };
  }

  // Defensive: if Commander.execute somehow returned without missionBrief
  // AND without directAnswer/clarification, treat it as a clarification
  // request rather than a generic error. This prevents the workflow from
  // terminating with the unhelpful "I had trouble understanding" fallback.
  if (!result.missionBrief) {
    // Hardened URL defense: any input that looks like a website review
    // MUST produce a missionBrief, never a clarification. This catches
    // cases where the LLM returns an empty missionBrief despite the
    // hardened prompt and pre-LLM keyword inference.
    const urlInferred = inferIntentFromKeywords(state.goal);
    if (urlInferred && (urlInferred.intent === 'website_review_and_improvement' || urlInferred.intent === 'browser_inspection')) {
      const mb = {
        id: `mb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        goal: state.goal,
        intent: urlInferred.intent,
        intentConfidence: urlInferred.confidence,
        industry: (state.industry ?? 'GENERAL') as import('@jak-swarm/shared').Industry,
        subFunction: urlInferred.subFunction,
        urgency: 3 as const,
        riskIndicators: [],
        requiredOutputs: ['task completion'],
        clarificationNeeded: false,
        rawInput: state.goal,
        createdAt: new Date(),
      };
      return {
        missionBrief: mb,
        clarificationNeeded: false,
        status: WorkflowStatus.PLANNING,
        traces,
      };
    }

    const question = buildHelpfulClarification(state.goal, state.industry);
    return {
      clarificationNeeded: true,
      clarificationQuestion: question,
      status: WorkflowStatus.COMPLETED,
      outputs: [question],
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
