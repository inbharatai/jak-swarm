/**
 * Gemini Model Resolver — tier-based model selection for Gemini runtime.
 *
 * Mirrors the pattern from OpenAI's ModelResolver but for Gemini model names.
 * Supports per-tier overrides via GEMINI_MODEL_TIER_{1,2,3} env vars.
 */

import type { ProviderTier } from '../base/provider-router.js';

// ─── Default model tier mapping ───────────────────────────────────────────────

const DEFAULT_GEMINI_MODELS: Record<ProviderTier, string> = {
  1: 'gemini-2.5-flash-lite',
  2: 'gemini-2.5-flash',
  3: 'gemini-2.5-pro',
};

// ─── Env overrides ────────────────────────────────────────────────────────────

/** Per-tier env var names */
const TIER_ENV_VARS: Record<ProviderTier, string> = {
  1: 'GEMINI_MODEL_TIER_1',
  2: 'GEMINI_MODEL_TIER_2',
  3: 'GEMINI_MODEL_TIER_3',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve a Gemini model name for the given tier.
 *
 * Precedence: per-tier env var > GEMINI_MODEL (global override) > default for tier
 */
export function modelForGeminiTier(tier: ProviderTier): string {
  // Per-tier override first
  const tierEnv = process.env[TIER_ENV_VARS[tier]]?.trim();
  if (tierEnv) return tierEnv;

  // Global override
  const globalModel = process.env['GEMINI_MODEL']?.trim();
  if (globalModel) return globalModel;

  // Default
  return DEFAULT_GEMINI_MODELS[tier];
}

/**
 * Get the default Gemini model (used when no tier is specified).
 * Defaults to tier 2 (balanced).
 */
export function getDefaultGeminiModel(): string {
  const globalModel = process.env['GEMINI_MODEL']?.trim();
  if (globalModel) return globalModel;
  return DEFAULT_GEMINI_MODELS[2];
}

/**
 * Check if a model name is a Gemini model.
 */
export function isGeminiModel(model: string): boolean {
  return model.toLowerCase().startsWith('gemini-');
}