/**
 * Token pricing for all supported LLM models.
 * Prices are in USD. Local/free models have zero cost.
 */

export interface ModelPricing {
  /** USD per 1 million input tokens */
  inputPer1M: number;
  /** USD per 1 million output tokens */
  outputPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // ─── OpenAI ──────────────────────────────────────────────────────────────────
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gpt-4-turbo': { inputPer1M: 10.00, outputPer1M: 30.00 },
  'gpt-3.5-turbo': { inputPer1M: 0.50, outputPer1M: 1.50 },
  'o1': { inputPer1M: 15.00, outputPer1M: 60.00 },
  'o1-mini': { inputPer1M: 3.00, outputPer1M: 12.00 },
  'o3-mini': { inputPer1M: 1.10, outputPer1M: 4.40 },

  // ─── Anthropic ───────────────────────────────────────────────────────────────
  'claude-sonnet-4-20250514': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-20250514': { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-3-5-haiku-20241022': { inputPer1M: 0.80, outputPer1M: 4.00 },

  // ─── DeepSeek ────────────────────────────────────────────────────────────────
  'deepseek-chat': { inputPer1M: 0.14, outputPer1M: 0.28 },
  'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19 },

  // ─── Google Gemini ──────────────────────────────────────────────────────────
  'gemini-2.0-flash': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gemini-2.0-flash-lite': { inputPer1M: 0.0, outputPer1M: 0.0 },
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.00 },
  'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.30 },

  // ─── Free / Local (Ollama) ───────────────────────────────────────────────────
  'ollama': { inputPer1M: 0, outputPer1M: 0 },
  'llama3.1': { inputPer1M: 0, outputPer1M: 0 },
  'llama3': { inputPer1M: 0, outputPer1M: 0 },
  'mistral': { inputPer1M: 0, outputPer1M: 0 },
  'qwen2.5': { inputPer1M: 0, outputPer1M: 0 },
  'codellama': { inputPer1M: 0, outputPer1M: 0 },
  'phi3': { inputPer1M: 0, outputPer1M: 0 },
  'gemma2': { inputPer1M: 0, outputPer1M: 0 },

  // ─── OpenRouter hosted (prices vary) ─────────────────────────────────────────
  'meta-llama/llama-3.1-8b-instruct': { inputPer1M: 0.06, outputPer1M: 0.06 },
  'meta-llama/llama-3.1-70b-instruct': { inputPer1M: 0.52, outputPer1M: 0.75 },
  'qwen/qwen-2.5-72b-instruct': { inputPer1M: 0.36, outputPer1M: 0.36 },
  'google/gemma-2-9b-it': { inputPer1M: 0.08, outputPer1M: 0.08 },
  'mistralai/mixtral-8x7b-instruct': { inputPer1M: 0.24, outputPer1M: 0.24 },
};

/**
 * Calculate the USD cost for a given model and token counts.
 * Falls back to prefix matching for Ollama models, then to zero cost if unknown.
 */
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing =
    MODEL_PRICING[model] ??
    Object.entries(MODEL_PRICING).find(([k]) => model.startsWith(k))?.[1] ??
    { inputPer1M: 0, outputPer1M: 0 };

  return (
    (promptTokens * pricing.inputPer1M) / 1_000_000 +
    (completionTokens * pricing.outputPer1M) / 1_000_000
  );
}

/**
 * Get pricing info for a model.
 * Falls back to prefix matching, then zero cost.
 */
export function getModelPricing(model: string): ModelPricing {
  return (
    MODEL_PRICING[model] ??
    Object.entries(MODEL_PRICING).find(([k]) => model.startsWith(k))?.[1] ??
    { inputPer1M: 0, outputPer1M: 0 }
  );
}

/**
 * Check if a model is free (zero cost for both input and output).
 */
export function isFreeTier(model: string): boolean {
  const pricing = getModelPricing(model);
  return pricing.inputPer1M === 0 && pricing.outputPer1M === 0;
}
