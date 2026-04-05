import OpenAI from 'openai';
import type { LLMProvider, LLMResponse } from '../llm-provider.js';

/**
 * Google Gemini-backed LLM provider.
 * Uses the OpenAI SDK with a custom baseURL pointing to Google AI Studio's
 * OpenAI-compatible endpoint.
 *
 * Configuration:
 *   - GEMINI_API_KEY: API key for Google AI Studio (required)
 *   - GEMINI_MODEL: Model name to use (default: gemini-2.0-flash)
 */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey?: string, model?: string) {
    const resolvedKey = apiKey ?? process.env['GEMINI_API_KEY'];
    if (!resolvedKey) {
      throw new Error(
        'Gemini API key not found. Set GEMINI_API_KEY environment variable or pass it to the constructor.',
      );
    }

    this.client = new OpenAI({
      apiKey: resolvedKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    });
    this.model = model ?? process.env['GEMINI_MODEL'] ?? 'gemini-2.0-flash';
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
