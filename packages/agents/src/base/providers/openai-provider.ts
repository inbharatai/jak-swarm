import OpenAI from 'openai';
import type { LLMProvider, LLMResponse, MessageContent } from '../llm-provider.js';

/**
 * OpenAI-backed LLM provider. Wraps the OpenAI SDK chat completions API.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey?: string, model?: string) {
    const resolvedKey = apiKey ?? process.env['OPENAI_API_KEY'];
    this.client = new OpenAI({ apiKey: resolvedKey });
    this.model = model ?? process.env['OPENAI_MODEL'] ?? 'gpt-4o';
  }

  private isModelNotFound(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const message = err.message.toLowerCase();
    if (message.includes('404')) return true;
    if (message.includes('model') && (message.includes('not found') || message.includes('does not exist'))) return true;
    const errWithStatus = err as { status?: number };
    return errWithStatus.status === 404;
  }

  private formatError(err: unknown, model: string): Error {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(`OpenAI request failed (model: ${model}): ${message}`);
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

    const fallbackModel = process.env['OPENAI_FALLBACK_MODEL'] ?? 'gpt-4o-mini';
    const modelsToTry = [this.model, fallbackModel, 'gpt-4o']
      .filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

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
        throw this.formatError(err, model);
      }
    }

    throw this.formatError(lastError ?? 'Unknown error', this.model);
  }
}
