import OpenAI from 'openai';
import type { AgentRole } from '@jak-swarm/shared';
import {
  calculateCost,
  openAIChatTokenLimitParam,
  openAISamplingParams,
} from '@jak-swarm/shared';
import type { Logger } from '@jak-swarm/shared';
import type { LLMProvider } from './llm-provider.js';
import {
  getModelOverride,
  getTierForAgent,
} from './provider-router.js';
import { modelForTier } from '../runtime/model-resolver.js';

/** Maximum number of retries for transient LLM errors */
const LLM_MAX_RETRIES = 3;
/** Base delay in ms for exponential backoff (1s, 2s, 4s) */
const LLM_RETRY_BASE_DELAY_MS = 1000;

export type OnLLMCallComplete = ((info: {
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  agentRole: string;
  tenantId?: string;
  userId?: string;
  workflowId?: string;
}) => void) | null;

export class LLMCallService {
  constructor(
    private readonly role: AgentRole,
    private readonly openai: OpenAI,
    private readonly provider: LLMProvider | undefined,
    private readonly logger: Logger,
    private readonly onCallCompleteHook: () => OnLLMCallComplete,
  ) {}

  get providerName(): string | undefined {
    return this.provider?.name;
  }

  async callLLM(
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
    //   3. ModelResolver pick for this role's tier (GPT-5.5/5.4 family only)
    const agentModel =
      getModelOverride(this.role) ??
      process.env['OPENAI_MODEL']?.trim() ??
      modelForTier(getTierForAgent(this.role));

    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: agentModel,
      messages,
      ...openAIChatTokenLimitParam(agentModel, options?.maxTokens ?? 4096),
      ...openAISamplingParams(agentModel, { temperature: options?.temperature ?? 0.2 }),
      ...(hasTools ? { tools, tool_choice: 'auto' } : {}),
      ...(wantsJson && !hasTools ? { response_format: { type: 'json_object' as const } } : {}),
    };

    this.logger.debug({ messageCount: messages.length }, 'Calling LLM');

    let lastError: unknown;
    for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
      try {
        const completion = await this.openai.chat.completions.create(params);

        const model = params.model ?? process.env['OPENAI_MODEL'] ?? 'gpt-5.4';
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
        const hook = this.onCallCompleteHook();
        if (hook) {
          try {
            hook({
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
          model: response.model ?? this.provider!.name,
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

        const providerModel = response.model ?? completion.model ?? this.provider!.name;
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
        const hook = this.onCallCompleteHook();
        if (hook) {
          try {
            hook({
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
}
