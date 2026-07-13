import OpenAI from 'openai';
import type { AgentRole } from '@jak-swarm/shared';
import type { AgentContext } from './agent-context.js';
import type { MemoryProvider, CompanyContextProvider } from './base-agent.js';

interface TaskSpecificBrainProvider extends CompanyContextProvider {
  getContextPackage?: (input: {
    tenantId: string;
    task: string;
    agentRole: string;
    tokenBudget?: number;
  }) => Promise<{ contextText?: string } | null>;
}

function messageText(message: OpenAI.ChatCompletionMessageParam | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content.map((part) => (
    part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'
      ? part.text
      : ''
  )).filter(Boolean).join('\n');
}

function latestUserTask(messages: OpenAI.ChatCompletionMessageParam[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    const text = messageText(message).trim();
    if (text) return text.slice(0, 20_000);
  }
  return '';
}

function hasBlock(messages: OpenAI.ChatCompletionMessageParam[], tag: string): boolean {
  return messages.some((message) => typeof message.content === 'string' && message.content.includes(`<${tag}>`));
}

async function buildCompanyContextBlocks(input: {
  messages: OpenAI.ChatCompletionMessageParam[];
  context: AgentContext;
  role: AgentRole;
  provider: CompanyContextProvider | null;
}): Promise<{ blocks: OpenAI.ChatCompletionMessageParam[]; fieldsUsed: string[] }> {
  const provider = input.provider as TaskSpecificBrainProvider | null;
  const blocks: OpenAI.ChatCompletionMessageParam[] = [];
  const fieldsUsed: string[] = [];
  if (!provider || !input.context.tenantId) return { blocks, fieldsUsed };

  if (!hasBlock(input.messages, 'company_context')) {
    try {
      const profile = await provider.getApprovedProfile(input.context.tenantId);
      if (profile) {
        const lines: string[] = [];
        const push = (field: string, label: string, value: unknown): void => {
          if (value === null || value === undefined) return;
          if (typeof value === 'string' && value.trim().length === 0) return;
          if (Array.isArray(value) && value.length === 0) return;
          const text = typeof value === 'string' ? value : JSON.stringify(value);
          if (text.length > 1500) return;
          lines.push(`- ${label}: ${text}`);
          fieldsUsed.push(field);
        };
        push('name', 'Company name', profile.name);
        push('industry', 'Industry', profile.industry);
        push('description', 'What the company does', profile.description);
        push('productsServices', 'Products / services', profile.productsServices);
        push('targetCustomers', 'Target customers', profile.targetCustomers);
        push('brandVoice', 'Brand voice', profile.brandVoice);
        push('competitors', 'Known competitors', profile.competitors);
        push('pricing', 'Pricing context', profile.pricing);
        push('websiteUrl', 'Website', profile.websiteUrl);
        push('goals', 'Stated goals', profile.goals);
        push('constraints', 'Stated constraints', profile.constraints);
        push('preferredChannels', 'Preferred channels', profile.preferredChannels);
        if (lines.length > 0) {
          blocks.push({
            role: 'system',
            content: `<company_context>\nThe user's company has approved the following stable profile for use across all agents.\nGround your output in this context. Do not invent missing company facts.\n\n${lines.join('\n')}\n</company_context>`,
          });
        }
      }
    } catch {
      // Stable company profile is optional grounding.
    }
  }

  if (!hasBlock(input.messages, 'company_brain') && typeof provider.getContextPackage === 'function') {
    const task = latestUserTask(input.messages);
    if (task) {
      try {
        const brain = await provider.getContextPackage({
          tenantId: input.context.tenantId,
          task,
          agentRole: String(input.role),
          tokenBudget: 2400,
        });
        const text = brain?.contextText?.trim();
        if (text) {
          fieldsUsed.push('companyBrain');
          blocks.push({
            role: 'system',
            content: `<company_brain>\nThis is task-specific, evidence-backed organisational context.\nTreat ACTIVE claims as current truth, flag DISPUTED claims, cite evidence ids when material, and never infer access to omitted information.\n\n${text.slice(0, 16_000)}\n</company_brain>`,
          });
        }
      } catch {
        // Graph V2 may not be migrated yet. Agent execution must continue.
      }
    }
  }
  return { blocks, fieldsUsed };
}

function buildAgentSystemMessage(role: AgentRole, supplement?: string): string {
  const base = `You are the ${role} agent in the JAK Swarm autonomous agent platform.
You are a world-class expert in your domain. Your output should be better than what 95% of human professionals would produce.

CORE PRINCIPLES:
1. ACCURACY — Never hallucinate. If you don't know, say so. Cite sources when possible.
2. COMPLETENESS — Address every aspect of the task. Don't leave gaps.
3. ACTIONABILITY — Every recommendation must be specific and implementable.
4. STRUCTURE — Always output valid JSON when requested. Use clear hierarchies.
5. SELF-AWARENESS — State your confidence level. Flag assumptions explicitly.
6. CHAIN-OF-THOUGHT — Think step-by-step before producing output.

QUALITY STANDARDS:
- Your work will be verified by a Verifier agent. Anticipate what it checks: completeness, accuracy, format, hallucination detection.
- If a task is ambiguous, make your best interpretation AND note the ambiguity.
- If a task requires information you don't have, say what's missing rather than guessing.
- Always consider edge cases, risks, and failure modes.

ANTI-HALLUCINATION RULES (NON-NEGOTIABLE):
1. NEVER invent statistics, percentages, or specific numbers. If you cite a number, it must come from a tool result or be explicitly marked as "estimated based on general knowledge."
2. NEVER claim you performed an action (sent email, created event, wrote file) unless a tool_call in this conversation proves it. If a tool returned {connected: false}, say "tool not connected" — do NOT fabricate what the tool would have returned.
3. NEVER cite specific studies, papers, reports, or named sources unless they appeared in web_search results. Say "based on general knowledge" instead.
4. ALWAYS state your confidence level: 0.3-0.5 for general knowledge, 0.6-0.8 for tool-backed claims, 0.9+ only with verified sources.
5. When a task is ambiguous, state your interpretation AND flag the ambiguity — never silently assume.
6. PREFER saying "I don't know" or "insufficient data" over fabricating a plausible-sounding answer.
7. Every recommendation must be SPECIFIC and ACTIONABLE — no vague platitudes like "consider improving efficiency."

RESEARCH & PLANNING METHODOLOGY:
1. THINK step by step before producing output. Show your reasoning.
2. GATHER information before concluding. Use web_search when available.
3. PLAN before executing. Break complex tasks into steps.
4. VALIDATE your output against the original task requirements before returning.
5. DOUBLE-CHECK numbers, dates, and factual claims.`;
  return supplement ? `${base}\n\n${supplement}` : base;
}

export class PromptBuilder {
  constructor(
    private readonly role: AgentRole,
    private readonly memoryProviderGetter: () => MemoryProvider | null,
    private readonly companyContextProviderGetter: () => CompanyContextProvider | null,
  ) {}

  async injectCompanyContext(
    messages: OpenAI.ChatCompletionMessageParam[],
    context: AgentContext,
  ): Promise<{ messages: OpenAI.ChatCompletionMessageParam[]; fieldsUsed: string[] }> {
    const { blocks, fieldsUsed } = await buildCompanyContextBlocks({
      messages,
      context,
      role: this.role,
      provider: this.companyContextProviderGetter(),
    });
    if (blocks.length === 0) return { messages, fieldsUsed };
    const result = [...messages];
    const systemIndex = result.findIndex((message) => message.role === 'system');
    result.splice(systemIndex === -1 ? 0 : systemIndex + 1, 0, ...blocks);
    return { messages: result, fieldsUsed };
  }

  async injectBundledSkills(
    messages: OpenAI.ChatCompletionMessageParam[],
    declaredToolNames: Set<string>,
  ): Promise<OpenAI.ChatCompletionMessageParam[]> {
    if (declaredToolNames.size === 0) return messages;
    try {
      const skillsModule = await import('@jak-swarm/skills');
      const formatter = (skillsModule as { formatBundledSkillsForAgent?: (tools: string[]) => string }).formatBundledSkillsForAgent;
      if (typeof formatter !== 'function') return messages;
      const block = formatter([...declaredToolNames]);
      if (!block) return messages;
      const result = [...messages];
      const systemIndex = result.findIndex((message) => message.role === 'system');
      let insertAt = systemIndex === -1 ? 0 : systemIndex + 1;
      while (insertAt < result.length && result[insertAt]?.role === 'system') insertAt += 1;
      result.splice(insertAt, 0, { role: 'system', content: block });
      return result;
    } catch {
      return messages;
    }
  }

  async injectMemories(
    messages: OpenAI.ChatCompletionMessageParam[],
    context: AgentContext,
  ): Promise<OpenAI.ChatCompletionMessageParam[]> {
    const provider = this.memoryProviderGetter();
    if (!provider || !context.tenantId) return messages;
    try {
      const memories = await provider.getMemories(context.tenantId, 15);
      if (memories.length === 0) return messages;
      const lines: string[] = [];
      let chars = 0;
      for (const memory of memories) {
        const value = typeof memory.value === 'string' ? memory.value : JSON.stringify(memory.value);
        const line = `- [${memory.memoryType}] ${memory.key}: ${value}`;
        if (chars + line.length > 8000) break;
        lines.push(line);
        chars += line.length;
      }
      if (lines.length === 0) return messages;
      const result = [...messages];
      const systemIndex = result.findIndex((message) => message.role === 'system');
      result.splice(systemIndex + 1, 0, {
        role: 'system',
        content: `<memory>\nThe following facts were learned from previous workflows for this organization.\nUse them to inform your decisions but do not reference them explicitly.\n\n${lines.join('\n')}\n</memory>`,
      });
      return result;
    } catch {
      return messages;
    }
  }

  buildChainOfThoughtPrompt(taskDescription: string, constraints: string[]): string {
    return `Before answering, reason step-by-step through this task:\n\nTASK: ${taskDescription}\n\nCONSTRAINTS:\n${constraints.map((constraint, index) => `${index + 1}. ${constraint}`).join('\n')}\n\nREASONING PROCESS:\n1. What is being asked? (restate in your own words)\n2. What information do I need?\n3. What are the key constraints and edge cases?\n4. What is my approach?\n5. Execute the approach.\n6. Verify my output against the constraints.\n\nNow produce your final output as valid JSON.`;
  }

  buildSystemMessage(supplement?: string): string {
    return buildAgentSystemMessage(this.role, supplement);
  }

  async buildRAGContext(query: string, tenantId: string, topK = 3): Promise<string> {
    try {
      const toolsModule = await import('@jak-swarm/tools');
      const getAdapter = (toolsModule as Record<string, unknown>)['getVectorMemoryAdapter'] as
        | (() => { search: (tenantId: string, query: string, topK: number, threshold: number) => Promise<Array<{ content: string; score: number }>> })
        | undefined;
      if (!getAdapter) return '';
      const results = await getAdapter().search(tenantId, query, topK, 0.55);
      if (results.length === 0) return '';
      const blocks = results.map((result, index) => `[${index + 1}] (relevance: ${Math.round(result.score * 100)}%) ${result.content}`);
      return `\n\n## Relevant Knowledge Base Context\nThe following was retrieved from the organization's knowledge base. Use it to inform your response:\n${blocks.join('\n\n')}`;
    } catch {
      return '';
    }
  }
}
