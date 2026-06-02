/**
 * Gemini Message Adapter — converts between OpenAI and Gemini message formats.
 *
 * Pure functions with no SDK dependency. Converts
 * `OpenAI.ChatCompletionMessageParam[]` to Gemini `Content[]` + system
 * instruction so GeminiRuntime can call `model.generateContent()` using
 * the same message arrays that OpenAIRuntime accepts.
 */

// ─── Gemini types (mirrored from @google/generative-ai to avoid eager import) ──

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export interface GeminiSystemInstruction {
  parts: [{ text: string }];
}

// ─── OpenAI message shape (subset needed for conversion) ─────────────────────

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | unknown[] | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

// ─── Conversion ──────────────────────────────────────────────────────────────

/**
 * Convert OpenAI ChatCompletionMessageParam[] to Gemini Content[] + system instruction.
 *
 * Gemini separates system instructions from the conversation history,
 * while OpenAI includes the system message in the message array.
 */
export function chatMessagesToGeminiContents(
  messages: Array<OpenAIMessage>,
): { contents: GeminiContent[]; systemInstruction?: GeminiSystemInstruction } {
  let systemInstruction: GeminiSystemInstruction | undefined;
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'system': {
        const text = extractTextContent(msg.content);
        if (text) {
          systemInstruction = { parts: [{ text }] };
        }
        break;
      }

      case 'user': {
        const text = extractTextContent(msg.content);
        if (text) {
          // Merge consecutive user messages into one Content (Gemini requires alternating roles)
          const last = contents[contents.length - 1];
          if (last && last.role === 'user') {
            last.parts.push({ text });
          } else {
            contents.push({ role: 'user', parts: [{ text }] });
          }
        }
        break;
      }

      case 'assistant': {
        const parts: GeminiPart[] = [];

        // Text content
        const text = extractTextContent(msg.content);
        if (text) {
          parts.push({ text });
        }

        // Tool calls
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              // Invalid JSON args — pass empty object
            }
            parts.push({
              functionCall: { name: tc.function.name, args },
            });
          }
        }

        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
        break;
      }

      case 'tool': {
        // Gemini represents tool results as functionResponse in a user Content
        const toolName = msg.name ?? msg.tool_call_id ?? 'unknown';
        let response: Record<string, unknown> = {};
        const text = extractTextContent(msg.content);
        if (text) {
          try {
            response = JSON.parse(text);
          } catch {
            // Not valid JSON — wrap as { result: text }
            response = { result: text };
          }
        }

        // Append functionResponse to the last user content, or create a new one
        const last = contents[contents.length - 1];
        if (last && last.role === 'user') {
          last.parts.push({
            functionResponse: { name: toolName, response },
          });
        } else {
          contents.push({
            role: 'user',
            parts: [{ functionResponse: { name: toolName, response } }],
          });
        }
        break;
      }
    }
  }

  return { contents, systemInstruction };
}

/**
 * Extract text from OpenAI message content (string or content array).
 */
function extractTextContent(content: string | unknown[] | null | undefined): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: 'text'; text: string } =>
        typeof part === 'object' && part !== null && 'type' in part && (part as { type: string }).type === 'text',
      )
      .map((part) => part.text)
      .join('');
  }
  return String(content);
}