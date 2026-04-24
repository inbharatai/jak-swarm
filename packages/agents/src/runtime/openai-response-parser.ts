/**
 * Convert a Responses-API `Response` into the `ChatCompletion` shape every
 * caller in the codebase already understands. This is the bridge that lets
 * Phase 4+ flip individual agents onto OpenAIRuntime without touching any
 * downstream parser code.
 *
 * Mapping rules:
 *   - response.output_text → choices[0].message.content
 *   - response.output[] of type 'function_call' → choices[0].message.tool_calls
 *   - finish_reason: 'tool_calls' if any function_call items present, else 'stop'
 *   - usage tokens copied 1:1
 *
 * Hosted-tool outputs (web_search results, file_search citations, code
 * interpreter output) are surfaced under a non-OpenAI extension field
 * `_jakHostedTools` for callers that opt into them. Existing callers
 * ignore the field and see only the plain text + function calls.
 */

import type OpenAI from 'openai';

export interface JakHostedToolOutput {
  type: 'web_search' | 'file_search' | 'code_interpreter' | 'computer_use' | 'reasoning';
  raw: unknown;
}

export interface JakAdaptedChatCompletion extends OpenAI.ChatCompletion {
  /** Hosted-tool outputs surfaced for callers that asked for them. Optional + ignorable. */
  _jakHostedTools?: JakHostedToolOutput[];
}

export function responsesToChatCompletion(
  resp: OpenAI.Responses.Response,
): JakAdaptedChatCompletion {
  const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];
  const hostedOutputs: JakHostedToolOutput[] = [];

  for (const item of resp.output ?? []) {
    switch (item.type) {
      case 'function_call':
        toolCalls.push({
          id: item.call_id,
          type: 'function',
          function: {
            name: item.name,
            arguments: item.arguments,
          },
        });
        break;
      case 'web_search_call':
        hostedOutputs.push({ type: 'web_search', raw: item });
        break;
      case 'file_search_call':
        hostedOutputs.push({ type: 'file_search', raw: item });
        break;
      case 'code_interpreter_call':
        hostedOutputs.push({ type: 'code_interpreter', raw: item });
        break;
      case 'computer_call':
        hostedOutputs.push({ type: 'computer_use', raw: item });
        break;
      case 'reasoning':
        hostedOutputs.push({ type: 'reasoning', raw: item });
        break;
      default:
        // 'message' items are picked up via output_text below; ignore here.
        break;
    }
  }

  const finalText =
    typeof (resp as { output_text?: string }).output_text === 'string'
      ? (resp as { output_text: string }).output_text
      : extractTextFromOutput(resp.output ?? []);

  const finishReason: OpenAI.ChatCompletion.Choice['finish_reason'] = (() => {
    if (toolCalls.length > 0) return 'tool_calls';
    if (resp.incomplete_details?.reason === 'max_output_tokens') return 'length';
    if (resp.incomplete_details?.reason === 'content_filter') return 'content_filter';
    return 'stop';
  })();

  const completion: JakAdaptedChatCompletion = {
    id: resp.id,
    object: 'chat.completion',
    created: resp.created_at,
    model: resp.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: finalText.length > 0 ? finalText : null,
          refusal: null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
    usage: resp.usage
      ? {
          prompt_tokens: resp.usage.input_tokens ?? 0,
          completion_tokens: resp.usage.output_tokens ?? 0,
          total_tokens: resp.usage.total_tokens ?? 0,
        }
      : undefined,
  };

  if (hostedOutputs.length > 0) {
    completion._jakHostedTools = hostedOutputs;
  }

  return completion;
}

/**
 * Fallback text extraction when output_text helper is absent on older SDKs.
 * Walks output[] for message items and concatenates their output_text parts.
 */
function extractTextFromOutput(items: OpenAI.Responses.ResponseOutputItem[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'output_text' && typeof c.text === 'string') {
        parts.push(c.text);
      }
    }
  }
  return parts.join('').trim();
}
