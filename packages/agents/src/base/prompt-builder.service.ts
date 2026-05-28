import OpenAI from 'openai';
import type { AgentRole } from '@jak-swarm/shared';
import type { AgentContext } from './agent-context.js';
import type { MemoryProvider, CompanyContextProvider } from './base-agent.js';

export class PromptBuilder {
  constructor(
    private readonly role: AgentRole,
    private readonly memoryProviderGetter: () => MemoryProvider | null,
    private readonly companyContextProviderGetter: () => CompanyContextProvider | null,
  ) {}

  /**
   * Inject the tenant's approved CompanyProfile as a `<company_context>`
   * system block. Inserts AFTER the agent's primary system prompt so it
   * reads as supplementary grounding, not primary instructions.
   * Non-blocking — any failure swallows + returns the messages unchanged.
   */
  async injectCompanyContext(
    messages: OpenAI.ChatCompletionMessageParam[],
    context: AgentContext,
  ): Promise<{ messages: OpenAI.ChatCompletionMessageParam[]; fieldsUsed: string[] }> {
    const provider = this.companyContextProviderGetter();
    if (!provider || !context.tenantId) return { messages, fieldsUsed: [] };
    try {
      const profile = await provider.getApprovedProfile(context.tenantId);
      if (!profile) return { messages, fieldsUsed: [] };

      const lines: string[] = [];
      const fieldsUsed: string[] = [];
      const push = (field: string, label: string, value: unknown): void => {
        if (value === null || value === undefined) return;
        if (typeof value === 'string' && value.trim().length === 0) return;
        if (Array.isArray(value) && value.length === 0) return;
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        if (str.length > 1500) return; // skip overly long fields
        lines.push(`- ${label}: ${str}`);
        fieldsUsed.push(field);
      };
      push('name',             'Company name',      profile.name);
      push('industry',         'Industry',          profile.industry);
      push('description',      'What the company does', profile.description);
      push('productsServices', 'Products / services', profile.productsServices);
      push('targetCustomers',  'Target customers',  profile.targetCustomers);
      push('brandVoice',       'Brand voice',       profile.brandVoice);
      push('competitors',      'Known competitors', profile.competitors);
      push('pricing',          'Pricing context',   profile.pricing);
      push('websiteUrl',       'Website',           profile.websiteUrl);
      push('goals',            'Stated goals',      profile.goals);
      push('constraints',      'Stated constraints', profile.constraints);
      push('preferredChannels','Preferred channels', profile.preferredChannels);

      if (lines.length === 0) return { messages, fieldsUsed: [] };

      const block: OpenAI.ChatCompletionMessageParam = {
        role: 'system',
        content: `<company_context>\nThe user's company has approved the following context for use across all agents.\nGround your output in this context — match brand voice, target audience, and product positioning.\nDo not invent additional facts about the company; if a needed field is missing here, say so honestly.\n\n${lines.join('\n')}\n</company_context>`,
      };

      const result = [...messages];
      const sysIdx = result.findIndex((m) => m.role === 'system');
      result.splice(sysIdx + 1, 0, block);
      return { messages: result, fieldsUsed };
    } catch {
      return { messages, fieldsUsed: [] };
    }
  }

  /**
   * Inject bundled SKILL.md packs into the message array — Item A of the
   * OpenClaw-inspired Phase 1.
   *
   * For each bundled skill pack whose `allowed-tools` overlaps with the
   * tools this agent has declared for this run, append the skill's
   * system-prompt block AFTER the agent's primary system prompt. The
   * resulting block reads as additional guidance, not primary
   * instructions.
   *
   * Non-blocking: any failure (filesystem absent, parse failure, no
   * matching skill) returns the messages unchanged. The cockpit doesn't
   * need to know whether skills fired — the trace records the full
   * system message so an operator can confirm post-hoc.
   *
   * Lazy-loaded so a stripped-down test environment that doesn't link
   * `@jak-swarm/skills` doesn't blow up on import. The Phase 1 plan ships
   * only the bundled tier; the full precedence cascade (workspace > project
   * > org > tenant > user > bundled) composes by passing additional
   * directories into `loadSkills()`.
   */
  async injectBundledSkills(
    messages: OpenAI.ChatCompletionMessageParam[],
    declaredToolNames: Set<string>,
  ): Promise<OpenAI.ChatCompletionMessageParam[]> {
    if (declaredToolNames.size === 0) return messages;
    try {
      const skillsModule = await import('@jak-swarm/skills');
      const formatBundledSkillsForAgent = (
        skillsModule as { formatBundledSkillsForAgent?: (tools: string[]) => string }
      ).formatBundledSkillsForAgent;
      if (typeof formatBundledSkillsForAgent !== 'function') return messages;

      const block = formatBundledSkillsForAgent([...declaredToolNames]);
      if (!block) return messages;

      const skillBlock: OpenAI.ChatCompletionMessageParam = {
        role: 'system',
        content: block,
      };
      const result = [...messages];
      const sysIdx = result.findIndex((m) => m.role === 'system');
      // Insert AFTER any company-context block (which is already at sysIdx+1
      // by injectCompanyContext convention) so skills sit below it.
      const insertAt = sysIdx === -1 ? 0 : Math.min(sysIdx + 2, result.length);
      result.splice(insertAt, 0, skillBlock);
      return result;
    } catch {
      return messages;
    }
  }

  /**
   * Inject tenant memories into the message array.
   * Inserts a <memory> block after the system message with ranked, token-budgeted facts.
   * Non-blocking — memory fetch failures never break the LLM call.
   */
  async injectMemories(
    messages: OpenAI.ChatCompletionMessageParam[],
    context: AgentContext,
  ): Promise<OpenAI.ChatCompletionMessageParam[]> {
    const provider = this.memoryProviderGetter();
    if (!provider || !context.tenantId) return messages;

    try {
      const memories = await provider.getMemories(context.tenantId, 15);
      if (memories.length === 0) return messages;

      // Build token-budgeted memory block (max ~2000 tokens / ~8000 chars)
      const lines: string[] = [];
      let charCount = 0;
      const MAX_CHARS = 8000;

      for (const mem of memories) {
        const valStr = typeof mem.value === 'string' ? mem.value : JSON.stringify(mem.value);
        const line = `- [${mem.memoryType}] ${mem.key}: ${valStr}`;
        if (charCount + line.length > MAX_CHARS) break;
        lines.push(line);
        charCount += line.length;
      }

      if (lines.length === 0) return messages;

      const memoryBlock: OpenAI.ChatCompletionMessageParam = {
        role: 'system',
        content: `<memory>\nThe following facts were learned from previous workflows for this organization.\nUse them to inform your decisions but do not reference them explicitly.\n\n${lines.join('\n')}\n</memory>`,
      };

      // Insert after the first system message
      const result = [...messages];
      const sysIdx = result.findIndex(m => m.role === 'system');
      result.splice(sysIdx + 1, 0, memoryBlock);
      return result;
    } catch {
      // Memory is non-critical — never block agent execution
      return messages;
    }
  }

  /**
   * Chain-of-thought reasoning before answering.
   * Prepends a thinking phase that forces the LLM to reason step by step
   * before producing the final output.
   */
  buildChainOfThoughtPrompt(
    taskDescription: string,
    constraints: string[],
  ): string {
    return `Before answering, reason step-by-step through this task:\n\nTASK: ${taskDescription}\n\nCONSTRAINTS:\n${constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nREASONING PROCESS:\n1. What is being asked? (restate in your own words)\n2. What information do I need?\n3. What are the key constraints and edge cases?\n4. What is my approach?\n5. Execute the approach.\n6. Verify my output against the constraints.\n\nNow produce your final output as valid JSON.`;
  }

  buildSystemMessage(supplement?: string): string {
    const base = `You are the ${this.role} agent in the JAK Swarm autonomous agent platform.\nYou are a world-class expert in your domain. Your output should be better than what 95% of human professionals would produce.\n\nCORE PRINCIPLES:\n1. ACCURACY — Never hallucinate. If you don't know, say so. Cite sources when possible.\n2. COMPLETENESS — Address every aspect of the task. Don't leave gaps.\n3. ACTIONABILITY — Every recommendation must be specific and implementable.\n4. STRUCTURE — Always output valid JSON when requested. Use clear hierarchies.\n5. SELF-AWARENESS — State your confidence level. Flag assumptions explicitly.\n6. CHAIN-OF-THOUGHT — Think step-by-step before producing output.\n\nQUALITY STANDARDS:\n- Your work will be verified by a Verifier agent. Anticipate what it checks: completeness, accuracy, format, hallucination detection.\n- If a task is ambiguous, make your best interpretation AND note the ambiguity.\n- If a task requires information you don't have, say what's missing rather than guessing.\n- Always consider edge cases, risks, and failure modes.\n\nANTI-HALLUCINATION RULES (NON-NEGOTIABLE):\n1. NEVER invent statistics, percentages, or specific numbers. If you cite a number, it must come from a tool result or be explicitly marked as "estimated based on general knowledge."\n2. NEVER claim you performed an action (sent email, created event, wrote file) unless a tool_call in this conversation proves it. If a tool returned {connected: false}, say "tool not connected" — do NOT fabricate what the tool would have returned.\n3. NEVER cite specific studies, papers, reports, or named sources unless they appeared in web_search results. Say "based on general knowledge" instead.\n4. ALWAYS state your confidence level: 0.3-0.5 for general knowledge, 0.6-0.8 for tool-backed claims, 0.9+ only with verified sources.\n5. When a task is ambiguous, state your interpretation AND flag the ambiguity — never silently assume.\n6. PREFER saying "I don't know" or "insufficient data" over fabricating a plausible-sounding answer.\n7. Every recommendation must be SPECIFIC and ACTIONABLE — no vague platitudes like "consider improving efficiency."\n\nRESEARCH & PLANNING METHODOLOGY:\n1. THINK step by step before producing output. Show your reasoning.\n2. GATHER information before concluding. Use web_search when available.\n3. PLAN before executing. Break complex tasks into steps.\n4. VALIDATE your output against the original task requirements before returning.\n5. DOUBLE-CHECK numbers, dates, and factual claims.`;

    return supplement ? `${base}\n\n${supplement}` : base;
  }

  /**
   * Retrieve semantically relevant context from the vector knowledge base.
   * Returns a formatted string ready to inject into system prompts.
   * Returns empty string if no relevant context found or vector search unavailable.
   */
  async buildRAGContext(query: string, tenantId: string, topK = 3): Promise<string> {
    try {
      // Dynamic import to avoid circular deps and handle missing vector module gracefully
      const toolsModule = await import('@jak-swarm/tools');
      const getAdapter = (toolsModule as Record<string, unknown>)['getVectorMemoryAdapter'] as
        | (() => { search: (tenantId: string, query: string, topK: number, threshold: number) => Promise<Array<{ content: string; score: number }>> })
        | undefined;

      if (!getAdapter) return '';

      const adapter = getAdapter();
      const results = await adapter.search(tenantId, query, topK, 0.55);

      if (results.length === 0) return '';

      const contextBlocks = results.map((r: { content: string; score: number }, i: number) =>
        `[${i + 1}] (relevance: ${Math.round(r.score * 100)}%) ${r.content}`,
      );

      return `\n\n## Relevant Knowledge Base Context\nThe following was retrieved from the organization's knowledge base. Use it to inform your response:\n${contextBlocks.join('\n\n')}`;
    } catch {
      return '';
    }
  }
}
