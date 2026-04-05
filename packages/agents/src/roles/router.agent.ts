import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import type { WorkflowPlan } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';
import type { IndustryPack } from '@jak-swarm/shared';

export type RouteMap = Record<
  string,
  {
    agentRole: AgentRole;
    tools: string[];
    warnings: string[];
    alternativeTools: string[];
  }
>;

export interface RouterOutput {
  routeMap: RouteMap;
  warnings: string[];
}

const ROUTER_SUPPLEMENT = `You are a Router agent. Your role is to map each workflow task to the most appropriate worker agent and validate tool availability.

Given a workflow plan and industry pack constraints, you must:
1. Confirm each task's assigned agentRole is appropriate for the tools required
2. Flag tools not in the industry's allowedTools
3. Suggest alternative tools if primary tools are restricted

Respond with JSON:
{
  "routes": {
    "<taskId>": {
      "agentRole": "<AgentRole>",
      "tools": ["allowed_tool_1"],
      "warnings": ["warning if any"],
      "alternativeTools": ["alt_tool if primary blocked"]
    }
  }
}`;

export class RouterAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.ROUTER, apiKey);
  }

  async execute(
    input: { plan: WorkflowPlan; industryPack: IndustryPack },
    context: AgentContext,
  ): Promise<RouterOutput> {
    const startedAt = new Date();
    const { plan, industryPack } = input;

    this.logger.info(
      { runId: context.runId, planId: plan.id, industry: industryPack.industry },
      'Router mapping tasks to agents',
    );

    const allowedToolSet = new Set(industryPack.allowedTools.map((c) => c.toLowerCase()));
    const restrictedToolSet = new Set(industryPack.restrictedTools.map((c) => c.toLowerCase()));

    // Build route map — first pass is heuristic (no LLM needed for simple validation)
    const routeMap: RouteMap = {};
    const globalWarnings: string[] = [];

    for (const task of plan.tasks) {
      const taskWarnings: string[] = [];
      const approvedTools: string[] = [];
      const alternativeTools: string[] = [];

      for (const tool of task.toolsRequired) {
        // Determine the category of the tool based on name prefix
        const toolCategory = this.inferToolCategory(tool);

        if (restrictedToolSet.has(toolCategory)) {
          taskWarnings.push(
            `Tool '${tool}' belongs to restricted category '${toolCategory}' for industry ${industryPack.industry}. Requires TENANT_ADMIN permission.`,
          );
          alternativeTools.push(...this.suggestAlternatives(tool, allowedToolSet));
        } else if (!allowedToolSet.has(toolCategory) && toolCategory !== 'unknown') {
          taskWarnings.push(
            `Tool '${tool}' (category: ${toolCategory}) is not in the allowed tools list for ${industryPack.industry}.`,
          );
          alternativeTools.push(...this.suggestAlternatives(tool, allowedToolSet));
        } else {
          approvedTools.push(tool);
        }
      }

      // Apply industry policy overlays
      for (const overlay of industryPack.policyOverlays) {
        for (const tool of task.toolsRequired) {
          const toolCat = this.inferToolCategory(tool);
          if (overlay.appliesTo.some((c) => c.toLowerCase() === toolCat)) {
            if (overlay.enforcement === 'BLOCK') {
              taskWarnings.push(
                `Policy '${overlay.name}' BLOCKS tool '${tool}': ${overlay.rule}`,
              );
            } else {
              taskWarnings.push(
                `Policy '${overlay.name}' WARNING for tool '${tool}': ${overlay.rule}`,
              );
            }
          }
        }
      }

      if (taskWarnings.length > 0) {
        globalWarnings.push(...taskWarnings.map((w) => `[${task.id}] ${w}`));
      }

      routeMap[task.id] = {
        agentRole: task.agentRole,
        tools: approvedTools.length > 0 ? approvedTools : task.toolsRequired,
        warnings: taskWarnings,
        alternativeTools: [...new Set(alternativeTools)],
      };
    }

    // LLM pass for any complex routing decisions
    if (plan.tasks.some((t) => t.toolsRequired.length > 3)) {
      try {
        await this.enrichWithLLM(plan, industryPack, routeMap, context);
      } catch (err) {
        this.logger.warn({ err }, 'LLM routing enrichment failed, using heuristic results');
      }
    }

    const output: RouterOutput = { routeMap, warnings: globalWarnings };
    this.recordTrace(context, input, output, [], startedAt);

    this.logger.info(
      { taskCount: plan.tasks.length, warningCount: globalWarnings.length },
      'Router produced route map',
    );

    return output;
  }

  private inferToolCategory(toolName: string): string {
    const lower = toolName.toLowerCase();
    if (lower.includes('email')) return 'email';
    if (lower.includes('calendar')) return 'calendar';
    if (lower.includes('crm') || lower.includes('contact') || lower.includes('deal')) return 'crm';
    if (lower.includes('document') || lower.includes('doc') || lower.includes('extract')) return 'document';
    if (lower.includes('browser') || lower.includes('navigate') || lower.includes('web')) return 'browser';
    if (lower.includes('webhook')) return 'webhook';
    if (lower.includes('knowledge') || lower.includes('search')) return 'knowledge';
    if (lower.includes('storage') || lower.includes('file')) return 'storage';
    if (lower.includes('spreadsheet') || lower.includes('report') || lower.includes('excel')) return 'spreadsheet';
    if (lower.includes('message') || lower.includes('slack') || lower.includes('sms')) return 'messaging';
    if (lower.includes('research') || lower.includes('classify')) return 'research';
    return 'unknown';
  }

  private suggestAlternatives(tool: string, allowedCategories: Set<string>): string[] {
    const alternatives: string[] = [];
    const lower = tool.toLowerCase();

    if (lower.includes('send') && allowedCategories.has('email')) {
      alternatives.push('draft_email (requires human to send)');
    }
    if (lower.includes('browser') && allowedCategories.has('knowledge')) {
      alternatives.push('search_knowledge');
    }
    if (lower.includes('webhook') && allowedCategories.has('email')) {
      alternatives.push('draft_email (manual notification)');
    }

    return alternatives;
  }

  private async enrichWithLLM(
    plan: WorkflowPlan,
    industryPack: IndustryPack,
    _routeMap: RouteMap,
    _context: AgentContext,
  ): Promise<void> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(ROUTER_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          tasks: plan.tasks.map((t) => ({
            id: t.id,
            name: t.name,
            agentRole: t.agentRole,
            toolsRequired: t.toolsRequired,
            riskLevel: t.riskLevel,
          })),
          allowedTools: industryPack.allowedTools,
          restrictedTools: industryPack.restrictedTools,
        }),
      },
    ];

    await this.callLLM(messages, undefined, { maxTokens: 1024 });
    // Results used as advisory — primary routing already done heuristically
  }
}
