import OpenAI from 'openai';
import { openAIChatTokenLimitParam, openAISamplingParams } from '@jak-swarm/shared';
import type { LLMProvider, LLMResponse, MessageContent } from '../llm-provider.js';
import { modelForTier, type ModelTier } from '../../runtime/model-resolver.js';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;
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
    this.explicitModel = model ?? (process.env['OPENAI_MODEL']?.trim() || undefined);
    this.defaultTier = opts.tier ?? 3;
    this.baseURL = resolvedBase ?? 'https://api.openai.com/v1';
  }

  private get model(): string {
    return this.explicitModel ?? modelForTier(this.defaultTier);
  }

  private formatError(err: unknown, model: string): Error {
    const message = err instanceof Error ? err.message : String(err);
    const isBaseUrlOverridden = this.baseURL !== 'https://api.openai.com/v1';
    const errStatus = (err as { status?: number }).status;
    const isBlank404 = errStatus === 404 && /404 status code \(no body\)/i.test(message);

    const hint = (() => {
      if (isBlank404) {
        return isBaseUrlOverridden
          ? ` - A 404 with empty body usually means OPENAI_BASE_URL (currently '${this.baseURL}') is wrong.`
          : ' - The API key may not have access to this GPT-5.5/5.4 model, or OPENAI_BASE_URL may be wrong.';
      }
      if (errStatus === 401) return ' - The API key is invalid. Check OPENAI_API_KEY.';
      if (errStatus === 429) return ' - Rate-limited or quota-bound on OpenAI.';
      return '';
    })();

    return Object.assign(
      new Error(`OpenAI request failed (model: ${model}, base: ${this.baseURL}): ${message}${hint}`),
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

    const model = this.model;

    try {
      const completion = await this.client.chat.completions.create({
        model,
        messages: openaiMessages,
        ...openAIChatTokenLimitParam(model, params.maxTokens ?? 4096),
        ...openAISamplingParams(model, { temperature: params.temperature ?? 0.2 }),
        ...(hasTools ? { tools, tool_choice: 'auto' as const } : {}),
        ...(wantsJson && !hasTools ? { response_format: { type: 'json_object' as const } } : {}),
      });
      const choice = completion.choices[0];

      return {
        model: completion.model ?? model,
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
      throw this.formatError(err, model);
    }
  }
}
