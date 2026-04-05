import OpenAI from 'openai';
import type { LLMProvider, LLMResponse } from '../llm-provider.js';

/**
 * DeepSeek-backed LLM provider.
 * Uses the OpenAI SDK with a custom baseURL pointing to DeepSeek's API.
 *
 * Configuration:
 *   - DEEPSEEK_API_KEY: API key for DeepSeek (required)
 *   - DEEPSEEK_MODEL: Model name to use (default: deepseek-chat)
 */
export class DeepSeekProvider implements LLMProvider {
  readonly name = 'deepseek';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey?: string, model?: string) {
    const resolvedKey = apiKey ?? process.env['DEEPSEEK_API_KEY'];
    if (!resolvedKey) {
      throw new Error(
        'DeepSeek API key not found. Set DEEPSEEK_API_KEY environment variable or pass it to the constructor.',
      );
    }

    this.client = new OpenAI({
      apiKey: resolvedKey,
      baseURL: 'https://api.deepseek.com',
    });
    this.model = model ?? process.env['DEEPSEEK_MODEL'] ?? 'deepseek-chat';
  }

  async chatCompletion(params: {
    messages: Array<{ role: string; content: string | unknown }>;
    tools?: unknown[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<LLMResponse> {
    const messages = params.messages as OpenAI.ChatCompletionMessageParam[];
    const tools = params.tools as OpenAI.ChatCompletionTool[] | undefined;

    const requestParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.2,
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
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
  }
}
