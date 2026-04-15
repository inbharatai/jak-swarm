import type { LLMProvider, LLMResponse } from '../llm-provider.js';

/**
 * Ollama message format for the /api/chat endpoint.
 */
interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

/**
 * Ollama /api/chat response shape (stream: false).
 */
interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Ollama tool definition format.
 */
interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Convert OpenAI-style messages to Ollama format.
 * Ollama accepts a similar structure but tool results are handled differently.
 */
function convertMessages(
  messages: Array<{ role: string; content: string | unknown }>,
): OllamaMessage[] {
  const result: OllamaMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Ollama expects tool results as a tool-role message with string content
      const toolMsg = msg as { role: string; content: string | unknown; tool_call_id?: string };
      result.push({
        role: 'tool',
        content: typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content),
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const assistantMsg = msg as {
        role: string;
        content: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };

      const ollamaMsg: OllamaMessage = {
        role: 'assistant',
        content: assistantMsg.content ?? '',
      };

      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        ollamaMsg.tool_calls = assistantMsg.tool_calls.map((tc) => {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            parsedArgs = { _raw: tc.function.arguments };
          }
          return {
            function: { name: tc.function.name, arguments: parsedArgs },
          };
        });
      }

      result.push(ollamaMsg);
      continue;
    }

    // system and user messages pass through with string content
    result.push({
      role: msg.role as OllamaMessage['role'],
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    });
  }

  return result;
}

/**
 * Convert OpenAI-style tool definitions to Ollama format.
 */
function convertTools(tools?: unknown[]): OllamaTool[] | undefined {
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
      type: 'function' as const,
      function: {
        name: t.function.name,
        description: t.function.description ?? '',
        parameters: t.function.parameters ?? { type: 'object', properties: {} },
      },
    };
  });
}

/**
 * Ollama-backed LLM provider. Uses the Ollama REST API directly via fetch().
 * No SDK dependency required.
 *
 * Configuration:
 *   - OLLAMA_URL: Base URL for Ollama server (default: http://localhost:11434)
 *   - OLLAMA_MODEL: Model name to use (default: llama3.1)
 */
export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(baseUrl?: string, model?: string) {
    this.baseUrl = (baseUrl ?? process.env['OLLAMA_URL'] ?? 'http://localhost:11434').replace(
      /\/$/,
      '',
    );
    this.model = model ?? process.env['OLLAMA_MODEL'] ?? 'llama3.1';
  }

  async chatCompletion(params: {
    messages: Array<{ role: string; content: string | unknown }>;
    tools?: unknown[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<LLMResponse> {
    const ollamaMessages = convertMessages(params.messages);
    const ollamaTools = convertTools(params.tools);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: ollamaMessages,
      stream: false,
      options: {
        num_predict: params.maxTokens ?? 4096,
        temperature: params.temperature ?? 0.2,
      },
    };

    if (ollamaTools && ollamaTools.length > 0) {
      body['tools'] = ollamaTools;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Ollama not running at ${this.baseUrl}. Connection failed: ${message}. Install: https://ollama.ai/download`,
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(
        `Ollama request failed (${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as OllamaChatResponse;

    // Extract tool calls from the response if present
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    if (data.message.tool_calls && data.message.tool_calls.length > 0) {
      for (let i = 0; i < data.message.tool_calls.length; i++) {
        const tc = data.message.tool_calls[i]!;
        toolCalls.push({
          id: `ollama_tc_${Date.now()}_${i}`,
          name: tc.function.name,
          arguments: JSON.stringify(tc.function.arguments),
        });
      }
    }

    const promptTokens = data.prompt_eval_count ?? 0;
    const completionTokens = data.eval_count ?? 0;

    return {
      content: data.message.content || null,
      toolCalls,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }
}
