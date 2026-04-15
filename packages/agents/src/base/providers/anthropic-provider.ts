import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMResponse, MessageContent } from '../llm-provider.js';

/**
 * Convert OpenAI-style multi-modal content to Anthropic content blocks.
 * Handles text pass-through and image_url → Anthropic image source conversion.
 */
function convertContent(content: string | MessageContent[] | unknown): string | Anthropic.ContentBlockParam[] {
  if (typeof content === 'string') return content;

  if (!Array.isArray(content)) return JSON.stringify(content);

  return (content as MessageContent[]).map((part): Anthropic.ContentBlockParam => {
    if (part.type === 'text') {
      return { type: 'text' as const, text: part.text };
    }
    if (part.type === 'image_url') {
      const url = part.image_url.url;
      // Extract base64 from data URL
      const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: match[1]! as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
            data: match[2]!,
          },
        };
      }
      // URL-based image
      return {
        type: 'image' as const,
        source: { type: 'url' as const, url },
      } as Anthropic.ContentBlockParam;
    }
    return { type: 'text' as const, text: JSON.stringify(part) };
  });
}

/**
 * Convert OpenAI-style messages to Anthropic format.
 * Anthropic requires a separate system parameter and uses different message structure.
 */
function convertMessages(messages: Array<{ role: string; content: string | MessageContent[] | unknown }>): {
  system: string;
  anthropicMessages: Anthropic.MessageParam[];
} {
  let system = '';
  const anthropicMessages: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system += (system ? '\n\n' : '') + String(msg.content);
      continue;
    }

    if (msg.role === 'tool') {
      // Convert OpenAI tool result to Anthropic tool_result content block
      const toolMsg = msg as { role: string; content: string; tool_call_id?: string };
      anthropicMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolMsg.tool_call_id ?? 'unknown',
            content: typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content),
          },
        ],
      });
      continue;
    }

    if (msg.role === 'assistant') {
      // Check if this assistant message has tool_calls (OpenAI format)
      const assistantMsg = msg as {
        role: string;
        content: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };

      const contentBlocks: Anthropic.ContentBlockParam[] = [];

      if (assistantMsg.content) {
        contentBlocks.push({ type: 'text', text: assistantMsg.content });
      }

      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        for (const tc of assistantMsg.tool_calls) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            parsedInput = { _raw: tc.function.arguments };
          }
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: parsedInput,
          });
        }
      }

      if (contentBlocks.length > 0) {
        anthropicMessages.push({ role: 'assistant', content: contentBlocks });
      } else {
        anthropicMessages.push({
          role: 'assistant',
          content: String(assistantMsg.content ?? ''),
        });
      }
      continue;
    }

    // user message — supports multi-modal (vision) content arrays
    const converted = convertContent(msg.content);
    anthropicMessages.push({
      role: 'user',
      content: converted as string | Anthropic.ContentBlockParam[],
    });
  }

  return { system, anthropicMessages };
}

/**
 * Convert OpenAI-style tool definitions to Anthropic tool format.
 */
function convertTools(
  tools?: unknown[],
): Anthropic.Tool[] | undefined {
  if (!tools) return undefined;

  const normalizedTools = Array.isArray(tools) ? tools : [tools];
  if (normalizedTools.length === 0) return undefined;

  return normalizedTools
    .filter((tool) => {
      const t = tool as { function?: { name?: string } };
      return Boolean(t?.function?.name);
    })
    .map((tool) => {
    const t = tool as {
      type: string;
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    };
    return {
      name: t.function.name,
      description: t.function.description ?? '',
      input_schema: (t.function.parameters ?? { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema,
    };
  });
}

/**
 * Anthropic-backed LLM provider. Wraps the Anthropic SDK messages API.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey?: string, model?: string) {
    const resolvedKey = apiKey ?? process.env['ANTHROPIC_API_KEY'];
    this.client = new Anthropic({ apiKey: resolvedKey });
    this.model = model ?? process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-20250514';
  }

  async chatCompletion(params: {
    messages: Array<{ role: string; content: string | MessageContent[] | unknown }>;
    tools?: unknown[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<LLMResponse> {
    const { system, anthropicMessages } = convertMessages(params.messages);
    const anthropicTools = convertTools(params.tools);

    const requestParams: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.2,
      messages: anthropicMessages,
      ...(system ? { system } : {}),
      ...(anthropicTools ? { tools: anthropicTools } : {}),
    };

    const response = await this.client.messages.create(requestParams);

    // Extract text content and tool use blocks
    let textContent = '';
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    return {
      content: textContent || null,
      toolCalls,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason ?? 'end_turn',
    };
  }
}
