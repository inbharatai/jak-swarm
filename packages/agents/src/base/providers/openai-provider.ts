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

  async chatCompletion(params: {
    messages: Array<{ role: string; content: string | MessageContent[] | unknown }>;
    tools?: unknown[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<LLMResponse> {
    const openaiMessages = params.messages as OpenAI.ChatCompletionMessageParam[];
    const tools = params.tools as OpenAI.ChatCompletionTool[] | undefined;

    const requestParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: openaiMessages,
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
