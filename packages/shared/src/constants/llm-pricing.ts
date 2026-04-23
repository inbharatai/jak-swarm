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
  // GPT-4.1 series — missing these was the 2026-04 cost-tracking bug. Every
  // workflow using gpt-4.1 silently tracked $0 because `calculateCost` fell
  // through to the zero-pricing sentinel. Kept prefix-matchable so future
  // minor revisions (e.g. gpt-4.1-2025-05-01) also hit this row.
  'gpt-4.1': { inputPer1M: 2.00, outputPer1M: 8.00 },
  'gpt-4.1-mini': { inputPer1M: 0.40, outputPer1M: 1.60 },
  'gpt-4.1-nano': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gpt-4-turbo': { inputPer1M: 10.00, outputPer1M: 30.00 },
  'gpt-3.5-turbo': { inputPer1M: 0.50, outputPer1M: 1.50 },
  'o1': { inputPer1M: 15.00, outputPer1M: 60.00 },
  'o1-mini': { inputPer1M: 3.00, outputPer1M: 12.00 },
  'o3-mini': { inputPer1M: 1.10, outputPer1M: 4.40 },

  // ─── Anthropic ───────────────────────────────────────────────────────────────
  // Include newer Claude 4.7 and keep 4.0-dated variant for backward compat.
  'claude-sonnet-4-7': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-7': { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-haiku-4-5': { inputPer1M: 0.80, outputPer1M: 4.00 },
  'claude-sonnet-4-20250514': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-20250514': { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-3-5-haiku-20241022': { inputPer1M: 0.80, outputPer1M: 4.00 },

  // ─── DeepSeek ────────────────────────────────────────────────────────────────
  'deepseek-chat': { inputPer1M: 0.14, outputPer1M: 0.28 },
  'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19 },

  // ─── Google Gemini ──────────────────────────────────────────────────────────
  // 2.5 series was missing — every gemini-2.5-flash call tracked $0.
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.00 },
  'gemini-2.5-flash': { inputPer1M: 0.30, outputPer1M: 2.50 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.10, outputPer1M: 0.40 },
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
 * Tracks which unknown model names have been warned about so we only
 * complain once per process per model, not on every token.
 */
const UNKNOWN_MODEL_WARNED = new Set<string>();

/**
 * Calculate the USD cost for a given model and token counts.
 * Falls back to prefix matching for Ollama models, then to zero cost if
 * unknown — but logs a one-time warning per unknown model so operators
 * know cost tracking silently zeroed out. The 2026-04 finding: gpt-4.1
 * and gemini-2.5-flash were in real use but missing from MODEL_PRICING,
 * so every workflow tracked $0 with no signal.
 */
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const exactMatch = MODEL_PRICING[model];
  const prefixMatch = !exactMatch
    ? Object.entries(MODEL_PRICING).find(([k]) => model.startsWith(k))?.[1]
    : undefined;
  const pricing = exactMatch ?? prefixMatch ?? { inputPer1M: 0, outputPer1M: 0 };

  // Warn once per process per unknown model so the silent-$0 bug can't
  // recur. Only warn when tokens > 0 — zero-token calls don't indicate
  // missing pricing. Ollama/local models have known-zero pricing and
  // match prefixes cleanly, so they never hit this warning.
  if (!exactMatch && !prefixMatch && (promptTokens > 0 || completionTokens > 0)) {
    if (!UNKNOWN_MODEL_WARNED.has(model)) {
      UNKNOWN_MODEL_WARNED.add(model);
      // eslint-disable-next-line no-console
      console.warn(
        `[calculateCost] Unknown model "${model}" — tokens will be tracked but cost=$0. ` +
          `Add pricing to MODEL_PRICING in packages/shared/src/constants/llm-pricing.ts.`,
      );
    }
  }

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
