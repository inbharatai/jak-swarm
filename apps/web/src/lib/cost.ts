/**
 * Client-side cost derivation — mirrors the backend `calculateCost`
 * (packages/shared/src/constants/llm-pricing.ts) so the web shows the SAME
 * USD figure the API persists in UsageLedger.usdCost, without a schema
 * migration (AgentTrace has no costUsd column; cost is derived from the
 * tokenUsage blob the agents already persist).
 *
 * Honest: returns null when the model is missing — cost is not computable
 * without a model (the pricing table is model-keyed). The UI then shows
 * "N/A" only when truly underivable, never a fabricated $0.
 *
 * Two tokenUsage shapes exist in the wild:
 *   - timeline-service shape: { inputTokens, outputTokens, model, provider }
 *     (written by the agent runtime; read by workflow-timeline.service.ts)
 *   - seed shape: { promptTokens, completionTokens, totalTokens }
 *     (packages/db/prisma/seed.ts) — no model → null (honest N/A)
 */
import { calculateCost } from '@jak-swarm/shared';

export interface TokenUsageBlob {
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  model?: string;
  provider?: string;
}

/**
 * Derive USD cost from a persisted tokenUsage JSON blob using the shared
 * `calculateCost` formula. Returns null when no model is present (cost not
 * computable) or the blob is absent/not-an-object.
 */
export function deriveCostFromTokenUsage(tokenUsage: unknown): number | null {
  if (!tokenUsage || typeof tokenUsage !== 'object') return null;
  const u = tokenUsage as TokenUsageBlob;
  const model = typeof u.model === 'string' && u.model.length > 0 ? u.model : null;
  if (!model) return null;
  // Prefer the timeline-service shape (inputTokens/outputTokens); fall back
  // to the seed shape (promptTokens/completionTokens) so historical seeded
  // rows with a model still resolve.
  const input = u.inputTokens ?? u.promptTokens ?? 0;
  const output = u.outputTokens ?? u.completionTokens ?? 0;
  return calculateCost(model, input, output);
}

/**
 * Format a USD cost for compact UI readouts. $0.0000 when cost is literally
 * zero (a real, computed value — e.g. a local model with zero pricing); the
 * caller distinguishes null → "N/A" separately.
 */
export function formatCostUsd(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return 'N/A';
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}