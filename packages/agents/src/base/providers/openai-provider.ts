import OpenAI from 'openai';
import type { LLMProvider, LLMResponse, MessageContent } from '../llm-provider.js';
import { modelForTier, type ModelTier } from '../../runtime/model-resolver.js';

/**
 * OpenAI-backed LLM provider. Wraps the OpenAI SDK chat completions API.
 *
 * Reliability features:
 *   - Multi-model fallback chain — tries the configured model first, then
 *     OPENAI_FALLBACK_MODEL, then a curated list of known-good models so
 *     a single deprecated model name in env can't take down the agent.
 *   - Diagnostic error formatting — includes the base URL and the full
 *     fallback chain that was attempted, so a 404 on prod tells the
 *     operator exactly which env vars to inspect (OPENAI_BASE_URL,
 *     OPENAI_MODEL, OPENAI_API_KEY).
 *   - Custom base URL support via OPENAI_BASE_URL (Azure / proxy / etc.)
 *     captured explicitly so the error path can surface it.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;
  /**
   * Either an explicit model passed by caller / OPENAI_MODEL env, OR
   * undefined — meaning "ask the ModelResolver per-call so capability
   * changes pick up without a restart". The fallback chain in
   * chatCompletion() uses this as the FIRST attempt; even if it is
   * resolver-derived, we still gracefully fall through to the broader
   * chain on a 404.
   */
  private readonly explicitModel: string | undefined;
  private readonly defaultTier: ModelTier;
  private readonly baseURL: string;

  constructor(apiKey?: string, model?: string, opts: { tier?: ModelTier } = {}) {
    const resolvedKey = apiKey ?? process.env['OPENAI_API_KEY'];
    const resolvedBase = process.env['OPENAI_BASE_URL']?.trim() || undefined;
    this.client = new OpenAI({
      apiKey: resolvedKey,
      ...(resolvedBase ? { baseURL: resolvedBase } : {}),
    });
    // Caller-explicit model wins, then env, then resolver-per-call (lazy).
    this.explicitModel = model ?? (process.env['OPENAI_MODEL']?.trim() || undefined);
    this.defaultTier = opts.tier ?? 3;
    this.baseURL = resolvedBase ?? 'https://api.openai.com/v1';
  }

  /** First-attempt model: explicit override OR resolver pick for this tier. */
  private get firstAttemptModel(): string {
    return this.explicitModel ?? modelForTier(this.defaultTier);
  }

  private isModelNotFound(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const message = err.message.toLowerCase();
    if (message.includes('404')) return true;
    if (message.includes('model') && (message.includes('not found') || message.includes('does not exist'))) return true;
    const errWithStatus = err as { status?: number };
    return errWithStatus.status === 404;
  }

  /**
   * Build a diagnostic error message that gives the operator everything
   * needed to fix the misconfiguration in one glance: which model failed,
   * which fallback chain was attempted, what base URL was hit, the raw
   * provider error, and which env var to check.
   */
  private formatError(err: unknown, model: string, attemptedModels: string[]): Error {
    const message = err instanceof Error ? err.message : String(err);
    const isBaseUrlOverridden = this.baseURL !== 'https://api.openai.com/v1';
    const errStatus = (err as { status?: number }).status;
    const isBlank404 = errStatus === 404 && /404 status code \(no body\)/i.test(message);

    const hint = (() => {
      if (isBlank404) {
        return isBaseUrlOverridden
          ? ` — A 404 with empty body almost always means OPENAI_BASE_URL (currently '${this.baseURL}') is wrong. Either unset it to use api.openai.com, or correct the proxy/Azure endpoint. If using Azure, you also need OPENAI_MODEL set to your deployment name.`
          : ' — A 404 with empty body usually means the API key is project-scoped without access to this model, or a wrong OPENAI_BASE_URL is silently set in env.';
      }
      if (errStatus === 401) return ' — The API key is invalid. Check OPENAI_API_KEY.';
      if (errStatus === 429) return ' — Rate-limited. Retry, or upgrade the API key tier.';
      return '';
    })();

    return Object.assign(
      new Error(
        `OpenAI request failed (model: ${model}, base: ${this.baseURL}, attempted: [${attemptedModels.join(', ')}]): ${message}${hint}`,
      ),
      // Preserve the original status so upstream classifiers still work
      typeof errStatus === 'number' ? { status: errStatus } : {},
    );
  }

  async chatCompletion(params: {
    messages: Array<{ role: string; content: string | MessageContent[] | unknown }>;
    tools?: unknown[];
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
  }): Promise<LLMResponse> {
    const openaiMessages = params.messages as OpenAI.ChatCompletionMessageParam[];
    const tools = params.tools as OpenAI.ChatCompletionTool[] | undefined;
    const hasTools = tools && tools.length > 0;

    const systemMsg = openaiMessages.find((m) => m.role === 'system');
    const systemContent = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
    const wantsJson = params.jsonMode ??
      (!hasTools && /respond with (strict )?json|output.*json|return.*json|respond.*matching.*schema/i.test(systemContent));

    // Reliability fix: extended fallback chain. The first attempt is
    // either an explicit override OR what the ModelResolver picked for
    // this provider's tier. If that returns 404 (deprecated, restricted,
    // wrong base URL), we cycle through the rest of the GPT-5.4 family
    // and then GPT-5 / GPT-4o family before giving up. Resolver-cached
    // model picks mean the first attempt almost always succeeds, but the
    // chain remains as defence-in-depth for capability drift mid-process.
    const fallbackModel = process.env['OPENAI_FALLBACK_MODEL'] ?? 'gpt-4o-mini';
    const modelsToTry = [
      this.firstAttemptModel,
      fallbackModel,
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-3.5-turbo',
    ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

    let lastError: unknown;
    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i]!;
      try {
        const requestParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
          model,
          messages: openaiMessages,
          max_tokens: params.maxTokens ?? 4096,
          temperature: params.temperature ?? 0.2,
          ...(hasTools ? { tools, tool_choice: 'auto' as const } : {}),
          ...(wantsJson && !hasTools ? { response_format: { type: 'json_object' as const } } : {}),
        };

        const completion = await this.client.chat.completions.create(requestParams);
        const choice = completion.choices[0];

        return {
          content: choice?.message?.content ?? null,
          toolCalls: (choice?.message?.tool_calls ?? []).map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          })),
          usage: {
            promptTokens: completion.usage?.prompt_tokens ?? 0,
            completionTokens: completion.usage?.completion_tokens ?? 0,
            totalTokens: completion.usage?.total_tokens ?? 0,
          },
          finishReason: choice?.finish_reason ?? 'unknown',
        };
      } catch (err) {
        lastError = err;
        if (this.isModelNotFound(err) && i < modelsToTry.length - 1) {
          continue;
        }
        throw this.formatError(err, model, modelsToTry.slice(0, i + 1));
      }
    }

    throw this.formatError(lastError ?? 'Unknown error', this.firstAttemptModel, modelsToTry);
  }
}
