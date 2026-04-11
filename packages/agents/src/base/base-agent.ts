import OpenAI from 'openai';
import type { AgentRole, AgentTrace, ToolCall, ToolExecutionContext } from '@jak-swarm/shared';
import { generateId, createLogger, calculateCost } from '@jak-swarm/shared';
import type { Logger } from '@jak-swarm/shared';
import type { AgentContext } from './agent-context.js';
import type { LLMProvider } from './llm-provider.js';
import { getModelOverride } from './provider-router.js';

/** Result of a multi-turn tool execution loop */
export interface ToolLoopResult {
  /** Final text content from the LLM after all tool calls complete */
  content: string;
  /** All tool calls executed during the loop */
  toolCalls: ToolCall[];
  /** Total tokens used across all LLM calls */
  totalTokens: { prompt: number; completion: number; total: number };
  /** Total estimated cost in USD across all LLM calls */
  totalCostUsd: number;
}

/** Maximum number of retries for transient LLM errors */
const LLM_MAX_RETRIES = 3;
/** Base delay in ms for exponential backoff (1s, 2s, 4s) */
const LLM_RETRY_BASE_DELAY_MS = 1000;

export abstract class BaseAgent {
  protected readonly role: AgentRole;
  protected readonly logger: Logger;
  protected readonly openai: OpenAI;
  protected readonly provider?: LLMProvider;

  constructor(role: AgentRole, apiKey?: string, provider?: LLMProvider) {
    this.role = role;
    this.logger = createLogger(`agent:${role.toLowerCase()}`, { role });

    // Auto-initialize provider with failover when both API keys are available
    if (provider) {
      this.provider = provider;
    } else if (process.env['ANTHROPIC_API_KEY'] && process.env['OPENAI_API_KEY']) {
      // Both keys available — use ProviderRouter for automatic failover
      try {
        // Lazy require to avoid circular deps at module load
        const { ProviderRouter } = require('./provider-router.js') as { ProviderRouter: new () => LLMProvider };
        this.provider = new ProviderRouter();
      } catch {
        // ProviderRouter not available — fall through to direct OpenAI
      }
    }

    const resolvedKey = apiKey ?? process.env['OPENAI_API_KEY'];
    if (!resolvedKey && !this.provider) {
      this.logger.error(
        { role },
        '[BaseAgent] No OPENAI_API_KEY or ANTHROPIC_API_KEY set — LLM calls will fail. Set at least one API key in your environment.',
      );
    }

    this.openai = new OpenAI({ apiKey: resolvedKey });
  }

  abstract execute(input: unknown, context: AgentContext): Promise<unknown>;

  protected async callLLM(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools?: OpenAI.ChatCompletionTool[],
    options?: { maxTokens?: number; temperature?: number; jsonMode?: boolean },
  ): Promise<OpenAI.ChatCompletion> {
    // If an LLM provider is configured, use it and convert the response
    if (this.provider) {
      return this.callLLMViaProvider(messages, tools, options);
    }

    // Fail loudly if no API key is configured — do not silently return empty results
    if (!process.env['OPENAI_API_KEY']) {
      throw new Error(
        `[${this.role}] No OPENAI_API_KEY set. Cannot make LLM calls. ` +
        'Set OPENAI_API_KEY in your environment or configure an LLM provider.',
      );
    }

    // When no tools are passed, enable JSON mode if the system prompt asks for JSON.
    // This forces OpenAI to return valid JSON — no extra text, no markdown fences.
    const hasTools = tools && tools.length > 0;
    const systemMsg = messages.find(m => m.role === 'system');
    const systemContent = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
    const wantsJson = options?.jsonMode ??
      (!hasTools && /respond with json|output.*json|return.*json/i.test(systemContent));

    // Direct OpenAI SDK path with retry logic
    // Per-agent model override: check AGENT_MODEL_MAP first, then env, then default
    const agentModel = getModelOverride(this.role) ?? process.env['OPENAI_MODEL'] ?? 'gpt-4o';

    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: agentModel,
      messages,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.2,
      ...(hasTools ? { tools, tool_choice: 'auto' } : {}),
      ...(wantsJson && !hasTools ? { response_format: { type: 'json_object' as const } } : {}),
    };

    this.logger.debug({ messageCount: messages.length }, 'Calling LLM');

    let lastError: unknown;
    for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
      try {
        const completion = await this.openai.chat.completions.create(params);

        const model = params.model ?? process.env['OPENAI_MODEL'] ?? 'gpt-4o';
        const promptTok = completion.usage?.prompt_tokens ?? 0;
        const completionTok = completion.usage?.completion_tokens ?? 0;
        const costUsd = calculateCost(model, promptTok, completionTok);

        this.logger.debug(
          {
            model,
            tokens: { prompt: promptTok, completion: completionTok },
            costUsd,
            finishReason: completion.choices[0]?.finish_reason,
          },
          'LLM call cost',
        );

        return completion;
      } catch (err) {
        lastError = err;

        if (attempt < LLM_MAX_RETRIES && this.isRetryableError(err)) {
          const delayMs = LLM_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          this.logger.warn(
            { attempt: attempt + 1, delayMs, error: err instanceof Error ? err.message : String(err) },
            'LLM call failed with retryable error, backing off',
          );
          await this.sleep(delayMs);
          continue;
        }

        throw err;
      }
    }

    // Should not reach here, but satisfy TypeScript
    throw lastError;
  }

  /**
   * Call LLM via the pluggable provider interface and convert the response
   * to OpenAI ChatCompletion format for backward compatibility.
   */
  private async callLLMViaProvider(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools?: OpenAI.ChatCompletionTool[],
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<OpenAI.ChatCompletion> {
    this.logger.debug(
      { messageCount: messages.length, provider: this.provider!.name },
      'Calling LLM via provider',
    );

    let lastError: unknown;
    for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
      try {
        const response = await this.provider!.chatCompletion({
          messages: messages as Array<{ role: string; content: string | unknown }>,
          tools: tools as unknown[],
          maxTokens: options?.maxTokens,
          temperature: options?.temperature,
        });

        // Convert LLMResponse to OpenAI ChatCompletion shape
        const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = (response.toolCalls ?? []).map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));

        const completion: OpenAI.ChatCompletion = {
          id: `provider-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: this.provider!.name,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: response.content,
                refusal: null,
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
              },
              finish_reason: (response.finishReason === 'end_turn' ? 'stop' : response.finishReason) as 'stop' | 'length' | 'tool_calls' | 'content_filter',
              logprobs: null,
            },
          ],
          usage: {
            prompt_tokens: response.usage.promptTokens,
            completion_tokens: response.usage.completionTokens,
            total_tokens: response.usage.totalTokens,
          },
        };

        const providerModel = completion.model || this.provider!.name;
        const costUsd = calculateCost(providerModel, response.usage.promptTokens, response.usage.completionTokens);

        this.logger.debug(
          {
            model: providerModel,
            tokens: { prompt: response.usage.promptTokens, completion: response.usage.completionTokens },
            costUsd,
            finishReason: response.finishReason,
            provider: this.provider!.name,
          },
          'LLM call cost',
        );

        return completion;
      } catch (err) {
        lastError = err;

        if (attempt < LLM_MAX_RETRIES && this.isRetryableError(err)) {
          const delayMs = LLM_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          this.logger.warn(
            { attempt: attempt + 1, delayMs, provider: this.provider!.name, error: err instanceof Error ? err.message : String(err) },
            'Provider LLM call failed with retryable error, backing off',
          );
          await this.sleep(delayMs);
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  /**
   * Check if an error is retryable (429 rate limit or 5xx server error).
   */
  private isRetryableError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;

    const message = err.message.toLowerCase();
    if (message.includes('429') || message.includes('rate limit')) return true;
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) return true;
    if (message.includes('internal server error') || message.includes('service unavailable')) return true;
    if (message.includes('overloaded') || message.includes('capacity')) return true;

    const errWithStatus = err as { status?: number };
    if (errWithStatus.status) {
      return errWithStatus.status === 429 || errWithStatus.status >= 500;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Multi-turn tool execution loop.
   *
   * 1. Sends messages + tools to the LLM
   * 2. If the LLM returns tool_calls, executes each via ToolRegistry
   * 3. Appends tool results as `role: 'tool'` messages
   * 4. Calls the LLM again with the extended conversation
   * 5. Repeats until the LLM responds with text (no more tool_calls) or maxIterations
   *
   * Returns the final text content and all tool call records for tracing.
   */
  protected async executeWithTools(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: OpenAI.ChatCompletionTool[],
    context: AgentContext,
    options?: { maxTokens?: number; temperature?: number; maxIterations?: number },
  ): Promise<ToolLoopResult> {
    const maxIterations = options?.maxIterations ?? 10;
    const allToolCalls: ToolCall[] = [];
    const totalTokens = { prompt: 0, completion: 0, total: 0 };
    let totalCostUsd = 0;
    const conversation = [...messages];

    // Lazy-import ToolRegistry to avoid circular dep at module load time
    const { toolRegistry } = await import('@jak-swarm/tools');

    const toolExecContext: ToolExecutionContext = {
      tenantId: context.tenantId ?? '',
      userId: context.userId ?? '',
      workflowId: context.workflowId ?? '',
      runId: context.runId,
    };

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const completion = await this.callLLM(
        conversation,
        tools.length > 0 ? tools : undefined,
        { maxTokens: options?.maxTokens, temperature: options?.temperature },
      );

      // Accumulate token usage and cost
      if (completion.usage) {
        const iterPrompt = completion.usage.prompt_tokens ?? 0;
        const iterCompletion = completion.usage.completion_tokens ?? 0;
        totalTokens.prompt += iterPrompt;
        totalTokens.completion += iterCompletion;
        totalTokens.total += completion.usage.total_tokens ?? 0;

        const iterModel = completion.model || this.provider?.name || 'gpt-4o';
        totalCostUsd += calculateCost(iterModel, iterPrompt, iterCompletion);
      }

      const choice = completion.choices[0];
      if (!choice) break;

      const assistantMsg = choice.message;

      // If the LLM returned content without tool calls, we're done
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        return {
          content: assistantMsg.content ?? '',
          toolCalls: allToolCalls,
          totalTokens,
          totalCostUsd,
        };
      }

      // LLM wants to call tools — add assistant message to conversation
      conversation.push(assistantMsg);

      // Execute each tool call
      for (const tc of assistantMsg.tool_calls) {
        const toolStartedAt = new Date();
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          parsedArgs = { _raw: tc.function.arguments };
        }

        const toolName = tc.function.name;
        let resultStr: string;
        let toolError: string | undefined;

        if (toolRegistry.has(toolName)) {
          // Execute through the real registry
          const result = await toolRegistry.execute(toolName, parsedArgs, toolExecContext);
          if (result.success) {
            const data = result.data as Record<string, unknown> | string | undefined;
            // Detect mock/demo data — inform the agent honestly
            if (data && typeof data === 'object' && (data as Record<string, unknown>)._mock) {
              const notice = (data as Record<string, unknown>)._notice ?? 'This is demo data — real integration not connected.';
              resultStr = JSON.stringify({ ...data as Record<string, unknown>, _warning: notice });
            } else {
              resultStr = typeof data === 'string'
                ? data
                : JSON.stringify(data ?? { success: true });
            }
          } else {
            resultStr = JSON.stringify({ error: result.error, _toolFailed: true, message: `Tool '${toolName}' failed: ${result.error}. Try a different approach or use an alternative tool.` });
            toolError = result.error;
          }
        } else {
          // Tool not registered — return a helpful error so LLM can adapt
          resultStr = JSON.stringify({
            error: `Tool '${toolName}' is not available. Available tools: ${tools.map(t => t.function.name).join(', ')}. Please choose from the available tools.`,
            _toolNotFound: true,
          });
          toolError = `Tool '${toolName}' not found in registry`;
        }

        const toolCompletedAt = new Date();

        // Record for tracing
        allToolCalls.push({
          toolName,
          input: parsedArgs,
          output: toolError ? { error: toolError } : resultStr,
          startedAt: toolStartedAt,
          completedAt: toolCompletedAt,
          durationMs: toolCompletedAt.getTime() - toolStartedAt.getTime(),
          error: toolError,
        });

        // Append tool result to conversation so LLM can use it
        conversation.push({
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: resultStr,
        });
      }

      this.logger.debug(
        { iteration, toolCallCount: assistantMsg.tool_calls.length },
        'Tool loop iteration complete, calling LLM again',
      );
    }

    // Max iterations reached — return whatever content we have
    this.logger.warn(
      { maxIterations },
      'executeWithTools reached max iterations without final response',
    );

    return {
      content: 'Agent reached maximum tool call iterations. Partial results may be available in tool call outputs.',
      toolCalls: allToolCalls,
      totalTokens,
      totalCostUsd,
    };
  }

  // ─── AUTONOMOUS COWORK CAPABILITIES ────────────────────────────────────────

  /**
   * Self-reflection and correction loop (Claude-level autonomy).
   *
   * After the agent produces an initial result, this method:
   * 1. Asks the LLM to critique its own output (chain-of-thought reflection)
   * 2. If the critique finds issues, asks the LLM to produce a corrected version
   * 3. Returns the corrected output (or original if no issues found)
   *
   * This gives every agent the ability to self-correct without human intervention.
   */
  async reflectAndCorrect(
    originalOutput: string,
    taskDescription: string,
    options?: { maxTokens?: number },
  ): Promise<{ corrected: string; wasChanged: boolean; reflection: string }> {
    const reflectionMessages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `You are a critical reviewer. Analyze the following output for errors, gaps, hallucinations, or quality issues. Think step by step.

Respond with JSON:
{
  "hasIssues": <boolean>,
  "issues": ["specific issue 1", "specific issue 2"],
  "severity": "none" | "minor" | "major" | "critical",
  "suggestion": "brief description of what needs fixing"
}

Be strict. Check for:
- Factual accuracy and logical consistency
- Completeness relative to the task description
- Format compliance (proper JSON, required fields present)
- Hallucinated data (made-up statistics, names, dates)
- Vague or non-actionable recommendations`,
      },
      {
        role: 'user',
        content: `TASK: ${taskDescription}\n\nOUTPUT TO REVIEW:\n${originalOutput}`,
      },
    ];

    try {
      const reflectionCompletion = await this.callLLM(reflectionMessages, undefined, {
        maxTokens: options?.maxTokens ?? 512,
        temperature: 0.1,
      });

      const reflectionContent = reflectionCompletion.choices[0]?.message?.content ?? '';
      let reflection: { hasIssues?: boolean; issues?: string[]; severity?: string; suggestion?: string };

      try {
        reflection = this.parseJsonResponse(reflectionContent);
      } catch {
        // If we can't parse reflection, trust the original
        return { corrected: originalOutput, wasChanged: false, reflection: reflectionContent };
      }

      if (!reflection.hasIssues || reflection.severity === 'none') {
        this.logger.debug({ role: this.role }, 'Self-reflection: output passed quality check');
        return { corrected: originalOutput, wasChanged: false, reflection: reflectionContent };
      }

      // Issues found — ask for a corrected version
      this.logger.info(
        { role: this.role, severity: reflection.severity, issueCount: reflection.issues?.length },
        'Self-reflection: issues found, requesting correction',
      );

      const correctionMessages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: `You are the ${this.role} agent. Your previous output had issues. Fix them and produce a corrected version.
Maintain the same JSON format. Only fix the identified issues — don't change things that were correct.`,
        },
        {
          role: 'user',
          content: `ORIGINAL TASK: ${taskDescription}

YOUR PREVIOUS OUTPUT:
${originalOutput}

ISSUES FOUND:
${(reflection.issues ?? []).map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

SUGGESTION: ${reflection.suggestion ?? 'Fix the issues above'}

Produce a corrected output in the same format.`,
        },
      ];

      const correctionCompletion = await this.callLLM(correctionMessages, undefined, {
        maxTokens: options?.maxTokens ?? 4096,
        temperature: 0.15,
      });

      const corrected = correctionCompletion.choices[0]?.message?.content ?? originalOutput;
      return { corrected, wasChanged: true, reflection: reflectionContent };
    } catch (err) {
      // Reflection failed — return original (don't break the pipeline)
      this.logger.warn({ err }, 'Self-reflection failed, using original output');
      return { corrected: originalOutput, wasChanged: false, reflection: 'Reflection failed' };
    }
  }

  /**
   * Analyze an image using the vision-capable LLM (GPT-4o or Claude).
   * Accepts base64-encoded image data and a text prompt.
   * Returns the LLM's text analysis of the image.
   */
  protected async analyzeImage(
    imageBase64: string,
    prompt: string,
    options?: { detail?: 'low' | 'high' | 'auto'; mimeType?: string },
  ): Promise<string> {
    const mimeType = options?.mimeType ?? 'image/png';
    const detail = options?.detail ?? 'auto';

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'user' as const,
        content: [
          {
            type: 'image_url' as const,
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
              detail,
            },
          },
          {
            type: 'text' as const,
            text: prompt,
          },
        ],
      },
    ];

    try {
      const completion = await this.callLLM(messages);
      return completion.choices[0]?.message?.content ?? 'Unable to analyze image.';
    } catch (err) {
      this.logger.warn({ err }, 'Vision analysis failed');
      return `Vision analysis failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * Persist a learning to tenant memory so future runs benefit.
   *
   * Call this when an agent discovers something useful:
   * - A pattern that worked well
   * - A common error to avoid
   * - User preference inferred from approval decisions
   */
  protected async persistLearning(
    context: AgentContext,
    key: string,
    learning: { type: 'KNOWLEDGE' | 'POLICY' | 'WORKFLOW'; value: unknown; source: string },
  ): Promise<void> {
    try {
      const { toolRegistry } = await import('@jak-swarm/tools');
      if (toolRegistry.has('memory_store')) {
        await toolRegistry.execute(
          'memory_store',
          {
            key: `${this.role}:${key}`,
            value: learning.value,
            type: learning.type,
            source: learning.source,
          },
          {
            tenantId: context.tenantId ?? '',
            userId: context.userId ?? '',
            workflowId: context.workflowId ?? '',
            runId: context.runId,
          },
        );
        this.logger.debug({ key, type: learning.type }, 'Persisted learning to memory');
      }
    } catch {
      // Non-critical — don't fail the task for a memory write error
    }
  }

  /**
   * Recall previous learnings from tenant memory to inform current task.
   */
  protected async recallLearnings(
    context: AgentContext,
    queryKeys: string[],
  ): Promise<Record<string, unknown>> {
    const memories: Record<string, unknown> = {};
    try {
      const { toolRegistry } = await import('@jak-swarm/tools');
      if (toolRegistry.has('memory_retrieve')) {
        for (const key of queryKeys) {
          const result = await toolRegistry.execute(
            'memory_retrieve',
            { key: `${this.role}:${key}` },
            {
              tenantId: context.tenantId ?? '',
              userId: context.userId ?? '',
              workflowId: context.workflowId ?? '',
              runId: context.runId,
            },
          );
          if (result.success && result.data) {
            memories[key] = result.data;
          }
        }
      }
    } catch {
      // Non-critical
    }
    return memories;
  }

  /**
   * Chain-of-thought reasoning before answering.
   * Prepends a thinking phase that forces the LLM to reason step by step
   * before producing the final output.
   */
  protected buildChainOfThoughtPrompt(
    taskDescription: string,
    constraints: string[],
  ): string {
    return `Before answering, reason step-by-step through this task:

TASK: ${taskDescription}

CONSTRAINTS:
${constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}

REASONING PROCESS:
1. What is being asked? (restate in your own words)
2. What information do I need?
3. What are the key constraints and edge cases?
4. What is my approach?
5. Execute the approach.
6. Verify my output against the constraints.

Now produce your final output as valid JSON.`;
  }

  protected buildSystemMessage(supplement?: string): string {
    const base = `You are the ${this.role} agent in the JAK Swarm autonomous agent platform.
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

  protected recordTrace(
    context: AgentContext,
    input: unknown,
    output: unknown,
    toolCalls: ToolCall[],
    startedAt: Date,
    tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number },
    costUsd?: number,
  ): AgentTrace {
    const completedAt = new Date();
    const trace: AgentTrace = {
      traceId: context.traceId,
      runId: context.runId,
      agentRole: this.role,
      stepIndex: context.getTraces().length,
      input,
      output,
      toolCalls,
      handoffs: [],
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      tokenUsage,
      costUsd,
    };
    context.addTrace(trace);
    return trace;
  }

  protected parseJsonResponse<T>(content: string): T {
    // Strip markdown code fences if present
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    return JSON.parse(cleaned) as T;
  }

  protected generateId(prefix?: string): string {
    return generateId(prefix);
  }
}
