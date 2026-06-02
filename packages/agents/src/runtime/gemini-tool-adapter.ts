/**
 * Gemini Tool Adapter — converts between OpenAI and Gemini tool formats.
 *
 * Pure functions with no SDK dependency. Converts
 * `OpenAI.ChatCompletionTool[]` to Gemini `FunctionDeclaration[]` so
 * GeminiRuntime can pass tools to `model.generateContent()`.
 */

// ─── Gemini types (mirrored to avoid eager import) ────────────────────────────

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

// ─── OpenAI tool shape (subset needed for conversion) ─────────────────────────

interface OpenAIChatCompletionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

// ─── Conversion ──────────────────────────────────────────────────────────────

/**
 * Convert OpenAI ChatCompletionTool[] to Gemini FunctionDeclaration[].
 *
 * OpenAI wraps each function in `{ type: 'function', function: {...} }`.
 * Gemini uses flat `FunctionDeclaration` objects with `name`, `description`,
 * and `parameters` directly.
 *
 * Gemini's `parameters` must be a JSON Schema object with `$schema`,
 * `type`, and optionally `properties` / `required`. The OpenAI format
 * already follows this convention, so we pass it through with minimal
 * cleanup.
 */
export function chatToolsToFunctionDeclarations(
  tools: OpenAIChatCompletionTool[],
): GeminiFunctionDeclaration[] {
  return tools.map((tool) => {
    const decl: GeminiFunctionDeclaration = {
      name: tool.function.name,
    };

    if (tool.function.description) {
      decl.description = tool.function.description;
    }

    if (tool.function.parameters) {
      // Deep clone to avoid mutating the input, and strip OpenAI-specific
      // fields that Gemini doesn't understand.
      const params = JSON.parse(JSON.stringify(tool.function.parameters));
      // Remove $schema if present — Gemini doesn't need it
      delete params.$schema;
      decl.parameters = params;
    }

    return decl;
  });
}

/**
 * Convert a single Gemini FunctionDeclaration back to OpenAI ChatCompletionTool
 * format (used when building tool_calls in response parsing).
 */
export function functionDeclarationToChatTool(
  decl: GeminiFunctionDeclaration,
): OpenAIChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: decl.name,
      description: decl.description,
      parameters: decl.parameters,
    },
  };
}