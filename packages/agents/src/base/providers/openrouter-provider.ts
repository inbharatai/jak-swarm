import OpenAI from 'openai';
import type { LLMProvider, LLMResponse } from '../llm-provider.js';

/**
 * OpenRouter-backed LLM provider.
 * Uses the OpenAI SDK with a custom baseURL pointing to OpenRouter's API.
 * Covers: Qwen, Llama, Mixtral, Gemma, Claude, GPT, DeepSeek -- anything on OpenRouter.
 *
 * Configuration:
 *   - OPENROUTER_API_KEY: API key for OpenRouter (required)
 *   - OPENROUTER_MODEL: Model name to use (default: meta-llama/llama-3.1-8b-instruct)
 */
export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey?: string, model?: string) {
    const resolvedKey = apiKey ?? process.env['OPENROUTER_API_KEY'];
    if (!resolvedKey) {
      throw new Error(
        'OpenRouter API key not found. Set OPENROUTER_API_KEY environment variable or pass it to the constructor.',
      );
    }

    this.client = new OpenAI({
      apiKey: resolvedKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://jak-swarm.dev',
        'X-Title': 'JAK Swarm',
      },
    });
    this.model = model ?? process.env['OPENROUTER_MODEL'] ?? 'meta-llama/llama-3.1-8b-instruct';
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
