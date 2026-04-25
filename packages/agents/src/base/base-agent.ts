import OpenAI from 'openai';
import type { AgentRole, AgentTrace, ToolCall, ToolExecutionContext } from '@jak-swarm/shared';
import { generateId, createLogger, calculateCost } from '@jak-swarm/shared';
import type { Logger } from '@jak-swarm/shared';
import type { AgentContext } from './agent-context.js';
import type { LLMProvider } from './llm-provider.js';
import {
  ProviderRouter,
  getModelOverride,
  getProviderForTier,
  getTierForAgent,
} from './provider-router.js';
import { getRuntime, type LLMRuntime } from '../runtime/index.js';
import { modelForTier } from '../runtime/model-resolver.js';

/** Memory provider interface — injected by the API layer at boot */
export interface MemoryProvider {
  getMemories(tenantId: string, limit?: number): Promise<Array<{
    key: string;
    value: unknown;
    memoryType: string;
    updatedAt: Date;
  }>>;
}

/** Loop detection: fingerprint → count */
type ToolCallFingerprints = Map<string, number>;

/**
 * Extract the first balanced JSON object or array blob from a string.
 *
 * Handles LLMs that wrap JSON in prose. Respects string escapes — `"\"}"`
 * inside a quoted value does NOT close the outer brace. Returns `null` if
 * no balanced blob is found. This is the fallback path used by
 * `parseJsonResponse` when direct `JSON.parse` fails.
 */
export function extractFirstJsonBlob(text: string): string | null {
  const len = text.length;
  let start = -1;
  let opener = '';
  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      start = i;
      opener = ch;
      break;
    }
  }
  if (start < 0) return null;

  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < len; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Unbalanced — no matching closer found.
  return null;
}
const LOOP_DETECTION_THRESHOLD = 3;

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

    // Auto-initialize provider routing/failover whenever any supported provider is configured.
    if (provider) {
      this.provider = provider;
    } else {
      const hasProviderCredentials = Boolean(
        process.env['OPENAI_API_KEY'] ||
        process.env['ANTHROPIC_API_KEY'] ||
        process.env['GEMINI_API_KEY'] ||
        process.env['DEEPSEEK_API_KEY'] ||
        process.env['OPENROUTER_API_KEY'] ||
        process.env['OLLAMA_URL'] ||
        process.env['OLLAMA_MODEL'],
      );

      // Any provider available — use ProviderRouter for automatic routing/failover
      if (hasProviderCredentials) {
      try {
        // Role-aware routing: pick a tier-aligned primary provider first,
        // then let ProviderRouter append environment-driven fallbacks.
        const tier = getTierForAgent(this.role);
        const primary = getProviderForTier(tier);
        this.provider = new ProviderRouter(primary);
      } catch {
        // ProviderRouter not available — fall through to direct OpenAI
      }
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

    // Phase 2: every agent gets an LLMRuntime. In Phase 2 this is always
    // LegacyRuntime that delegates back to BaseAgent's existing private
    // callLLM/executeWithTools. Future phases (4, 7) start returning
    // OpenAIRuntime instead, agent-by-agent. Callers that want the new
    // surface use `this.runtime.respond(...)` / `this.runtime.callTools(...)`
    // — existing `this.callLLM(...)` and `this.executeWithTools(...)` calls
    // continue to work unchanged.
    this.runtime = getRuntime(role, {
      callLLMPublic: (m, t, o) => this.callLLM(m, t, o),
      executeWithToolsPublic: (m, t, c, o) => this.executeWithTools(m, t, c, o),
    });
  }

  /** Phase 2 — JAK-owned LLM runtime (LegacyRuntime by default). */
  protected readonly runtime!: LLMRuntime;

  /**
   * Global hook called after every LLM call with cost information.
   * Set by the API layer to track per-call credit usage.
   * When not set, cost is still logged but not deducted from credits.
   */
  static onLLMCallComplete: ((info: {
    model: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    agentRole: string;
    tenantId?: string;
    userId?: string;
    workflowId?: string;
  }) => void) | null = null;

  /**
   * Memory provider — injected at application boot.
   * When set, all agents automatically receive relevant tenant memories
   * in their system prompt via <memory> tags.
   */
  static memoryProvider: MemoryProvider | null = null;

  abstract execute(input: unknown, context: AgentContext): Promise<unknown>;

  /**
   * Inject tenant memories into the message array.
   * Inserts a <memory> block after the system message with ranked, token-budgeted facts.
   * Non-blocking — memory fetch failures never break the LLM call.
   */
  protected async injectMemories(
    messages: OpenAI.ChatCompletionMessageParam[],
    context: AgentContext,
  ): Promise<OpenAI.ChatCompletionMessageParam[]> {
    if (!BaseAgent.memoryProvider || !context.tenantId) return messages;

    try {
      const memories = await BaseAgent.memoryProvider.getMemories(context.tenantId, 15);
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
        content: `<memory>
The following facts were learned from previous workflows for this organization.
Use them to inform your decisions but do not reference them explicitly.

${lines.join('\n')}
</memory>`,
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

    // Direct OpenAI SDK path with retry logic.
    // Per-agent model resolution order:
    //   1. AGENT_MODEL_MAP override for this exact role (if any)
    //   2. OPENAI_MODEL env (operator-wide override)
    //   3. ModelResolver pick for this role's tier (GPT-5.4 family default,
    //      with falsafe to gpt-4o family if capability check failed)
    const agentModel =
      getModelOverride(this.role) ??
      process.env['OPENAI_MODEL']?.trim() ??
      modelForTier(getTierForAgent(this.role));

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

        // Notify billing hook if registered (for per-call credit tracking)
        if (BaseAgent.onLLMCallComplete) {
          try {
            BaseAgent.onLLMCallComplete({
              model,
              provider: 'openai',
              promptTokens: promptTok,
              completionTokens: completionTok,
              costUsd,
              agentRole: this.role,
            });
          } catch { /* billing hook failure must not break LLM calls */ }
        }

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
    options?: { maxTokens?: number; temperature?: number; jsonMode?: boolean },
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
          jsonMode: options?.jsonMode,
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

        // Notify billing hook if registered
        if (BaseAgent.onLLMCallComplete) {
          try {
            BaseAgent.onLLMCallComplete({
              model: providerModel,
              provider: this.provider!.name,
              promptTokens: response.usage.promptTokens,
              completionTokens: response.usage.completionTokens,
              costUsd,
              agentRole: this.role,
            });
          } catch { /* billing hook failure must not break LLM calls */ }
        }

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
    const toolCallFingerprints: ToolCallFingerprints = new Map();

    // Lazy-import tool registries to avoid circular dep at module load time
    const { getTenantToolRegistry } = await import('@jak-swarm/tools');

    const declaredToolNames = new Set(tools.map((t) => t.function.name));
    const tenantToolRegistry = getTenantToolRegistry(
      context.tenantId ?? '',
      context.connectedProviders,
      {
        browserAutomationEnabled: context.browserAutomationEnabled,
        restrictedCategories: context.restrictedCategories,
        disabledToolNames: context.disabledToolNames,
      },
    );

    const toolExecContext: ToolExecutionContext = {
      tenantId: context.tenantId ?? '',
      userId: context.userId ?? '',
      workflowId: context.workflowId ?? '',
      runId: context.runId,
      approvalId: context.approvalId,
      idempotencyKey: context.idempotencyKey,
      allowedDomains: context.allowedDomains,
      subscriptionTier: context.subscriptionTier,
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
        const iterCost = calculateCost(iterModel, iterPrompt, iterCompletion);
        totalCostUsd += iterCost;

        // Stage 2.3: surface cost in real-time to the client SSE stream.
        // Fires once per LLM call; the UI cockpit aggregates across a run.
        context.emitActivity({
          type: 'cost_updated',
          agentRole: this.role,
          model: iterModel,
          promptTokens: iterPrompt,
          completionTokens: iterCompletion,
          costUsd: iterCost,
          timestamp: new Date().toISOString(),
        });
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

      // ── Loop Detection (DeerFlow LoopDetectionMiddleware pattern) ──────
      // Track tool-call fingerprints to detect infinite loops.
      // If the same tool+args is called 3+ times, inject a hard-stop message.
      let loopDetected = false;
      for (const tc of assistantMsg.tool_calls) {
        const fp = `${tc.function.name}:${tc.function.arguments}`;
        const count = (toolCallFingerprints.get(fp) ?? 0) + 1;
        toolCallFingerprints.set(fp, count);
        if (count >= LOOP_DETECTION_THRESHOLD) {
          loopDetected = true;
        }
      }

      if (loopDetected) {
        this.logger.warn(
          { iteration, fingerprints: toolCallFingerprints.size },
          'Loop detected — same tool call repeated 3+ times, forcing stop',
        );
        // Clear tool_calls and force a text response
        conversation.push({
          role: 'system' as const,
          content: 'STOP: You are repeating the same tool call in a loop. This wastes resources. Summarize what you have so far and provide your best answer with the information available. Do NOT call any more tools.',
        });
        // Still need to provide tool results for the pending calls
        for (const tc of assistantMsg.tool_calls) {
          conversation.push({
            role: 'tool' as const,
            tool_call_id: tc.id,
            content: JSON.stringify({ _loopDetected: true, message: 'Tool call skipped — loop detected. Provide your best answer now.' }),
          });
        }
        // Do one more LLM call to get the summary, then exit
        try {
          const finalCompletion = await this.callLLM(conversation, undefined, { maxTokens: options?.maxTokens, temperature: options?.temperature });
          const finalContent = finalCompletion.choices[0]?.message?.content ?? 'Agent stopped due to tool call loop.';
          return { content: finalContent, toolCalls: allToolCalls, totalTokens, totalCostUsd };
        } catch {
          return { content: 'Agent stopped due to tool call loop.', toolCalls: allToolCalls, totalTokens, totalCostUsd };
        }
      }

      // Execute each tool call with error normalization
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
        // Hardening pass: capture the registry's honest outcome so the
        // tool_completed event carries it through to the cockpit.
        let toolOutcome: import('@jak-swarm/shared').ToolOutcome | undefined;

        // Stage 2.2: emit tool_called BEFORE execution so the client
        // cockpit renders a live "running" row. inputSummary is capped
        // at 500 chars to keep SSE payloads small.
        const inputSummary = JSON.stringify(parsedArgs).slice(0, 500);
        context.emitActivity({
          type: 'tool_called',
          agentRole: this.role,
          toolName,
          inputSummary,
          timestamp: toolStartedAt.toISOString(),
        });

        try {
          if (!declaredToolNames.has(toolName)) {
            resultStr = JSON.stringify({
              error: `Tool '${toolName}' is not allowed for this agent run. Allowed tools: ${[...declaredToolNames].join(', ')}`,
              _toolNotAllowed: true,
            });
            toolError = `Tool '${toolName}' is outside agent allowlist`;
          } else if (tenantToolRegistry.has(toolName)) {
            // Execute through tenant-scoped registry with provider/category/browser gates
            const result = await tenantToolRegistry.execute(toolName, parsedArgs, toolExecContext);
            // Capture the honest tool outcome — registry sets it via inferOutcome.
            // Used below to stamp the tool_completed SSE event so the cockpit
            // can render a real/draft/mock/not_configured badge instead of
            // guessing from substring matches.
            toolOutcome = result.outcome;
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
            // Tool not available for tenant policy/integrations — return helpful error
            resultStr = JSON.stringify({
              error: `Tool '${toolName}' is not available for this tenant or current policy constraints. Allowed tools: ${[...declaredToolNames].join(', ')}.`,
              _toolNotFound: true,
            });
            toolError = `Tool '${toolName}' not available for tenant`;
          }
        } catch (toolExecErr) {
          // ── Tool Error Normalization (DeerFlow ToolErrorHandlingMiddleware) ──
          // Convert exceptions to recoverable error messages instead of crashing.
          // The agent can decide to retry, use an alternative tool, or give up.
          const errMsg = toolExecErr instanceof Error ? toolExecErr.message : String(toolExecErr);
          resultStr = JSON.stringify({
            error: errMsg,
            _toolCrashed: true,
            message: `Tool '${toolName}' threw an exception: ${errMsg}. Try a different approach or use an alternative tool.`,
          });
          toolError = errMsg;
          this.logger.warn({ toolName, error: errMsg }, 'Tool execution crashed — normalized to error message');
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

        // Stage 2.2: emit tool_completed AFTER execution so the cockpit
        // flips the row from running → success/failure. outputSummary
        // is capped at 500 chars; if the tool returned an `_mock` /
        // `_warning` / `_notice` flag we surface it honestly so the UI
        // can render the "draft only" / "mock data" state correctly.
        context.emitActivity({
          type: 'tool_completed',
          agentRole: this.role,
          toolName,
          success: !toolError,
          // Honest outcome from the tool registry — 'real_success',
          // 'draft_created', 'mock_provider', 'not_configured', etc.
          // The cockpit reads this directly instead of guessing from
          // substrings in outputSummary. Falls back to 'failed' when
          // the tool errored without classification.
          outcome: toolOutcome ?? (toolError ? 'failed' : 'real_success'),
          durationMs: toolCompletedAt.getTime() - toolStartedAt.getTime(),
          outputSummary: resultStr.slice(0, 500),
          ...(toolError ? { error: toolError } : {}),
          timestamp: toolCompletedAt.toISOString(),
        });

        // Stage 3.2 cost fix: truncate large tool outputs before
        // re-injection into the next LLM call. Tools like web_search +
        // web_fetch commonly return 20-100KB of content, which gets
        // resent in full on EVERY subsequent tool-loop iteration.
        // Truncating at 8KB (~2000 tokens) cuts per-iteration costs by
        // 40-80% on research-heavy workflows while preserving enough
        // context for the LLM to continue. Override via
        // JAK_TOOL_OUTPUT_MAX_CHARS if a caller genuinely needs full
        // context (e.g. VibeCoder reading a specific file).
        const maxChars = Number(process.env['JAK_TOOL_OUTPUT_MAX_CHARS'] ?? '8000');
        const truncatedResultStr =
          resultStr.length > maxChars
            ? resultStr.slice(0, maxChars) +
              `\n\n[… tool output truncated at ${maxChars} chars. Full output in trace; ${resultStr.length} chars original.]`
            : resultStr;

        // Append tool result to conversation so LLM can use it
        conversation.push({
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: truncatedResultStr,
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

  /**
   * Retrieve semantically relevant context from the vector knowledge base.
   * Returns a formatted string ready to inject into system prompts.
   * Returns empty string if no relevant context found or vector search unavailable.
   */
  protected async buildRAGContext(query: string, tenantId: string, topK = 3): Promise<string> {
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

  /**
   * Parse a JSON response from an LLM tolerantly.
   *
   * LLMs sometimes return the JSON we asked for, and sometimes return prose
   * with a JSON blob buried inside ("Looking at the transcript, here's the
   * result: { ... }"). Agents crashing on `Unexpected token 'L'` is an
   * avoidable class of bug — the raw strict parser was the fragile path.
   *
   * Strategy, in order:
   *   1. Fast path — strip markdown fences, try `JSON.parse`.
   *   2. Extract the first balanced `{...}` or `[...]` from the content
   *      (handles LLM prefaces + trailing commentary).
   *   3. Give up with an error that includes a truncated snippet of what
   *      was actually returned, so agent logs are actionable.
   *
   * Never returns `undefined` implicitly — either returns the parsed value
   * or throws a clear Error. Callers wrap this in try/catch and emit their
   * own "Manual review required" fallback.
   */
  protected parseJsonResponse<T>(content: string): T {
    const text = content ?? '';

    // Fast path: fenced or bare JSON.
    const fenceStripped = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    try {
      return JSON.parse(fenceStripped) as T;
    } catch {
      // fall through to extraction
    }

    // Extraction path: find the first balanced { ... } or [ ... ] blob in
    // the text, honoring string escapes so quoted braces don't throw it off.
    const extracted = extractFirstJsonBlob(text);
    if (extracted !== null) {
      try {
        return JSON.parse(extracted) as T;
      } catch {
        // Unbalanced brace count can still produce invalid JSON (e.g. the
        // LLM wrote `{"a": 1,}` or truncated mid-object). Fall through.
      }
    }

    const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    throw new Error(
      `parseJsonResponse: no valid JSON in LLM output (length=${text.length}). Preview: ${preview}`,
    );
  }

  protected generateId(prefix?: string): string {
    return generateId(prefix);
  }
}
