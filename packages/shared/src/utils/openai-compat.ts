/**
 * OpenAI model compatibility helpers.
 *
 * Newer reasoning/agentic model families intentionally reject some classic
 * chat-tuning parameters. Keep these rules in one place so live OpenAI calls
 * fail on real auth/quota/model-access issues, not avoidable request-shape
 * drift.
 */

function normalizeModel(model: string | undefined): string {
  return (model ?? '').trim().toLowerCase();
}

export function openAIModelUsesReasoningControls(model: string | undefined): boolean {
  const normalized = normalizeModel(model);
  return (
    normalized.startsWith('gpt-5') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4')
  );
}

export function openAISupportsCustomSampling(model: string | undefined): boolean {
  return !openAIModelUsesReasoningControls(model);
}

export function openAISamplingParams(
  model: string | undefined,
  params: { temperature?: number },
): { temperature?: number } {
  if (!openAISupportsCustomSampling(model)) return {};
  return params.temperature !== undefined ? { temperature: params.temperature } : {};
}

export function openAIChatTokenLimitParam(
  model: string | undefined,
  maxTokens: number,
): { max_tokens?: number; max_completion_tokens?: number } {
  if (openAIModelUsesReasoningControls(model)) {
    return { max_completion_tokens: maxTokens };
  }
  return { max_tokens: maxTokens };
}
