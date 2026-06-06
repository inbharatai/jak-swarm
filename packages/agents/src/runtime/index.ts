/**
 * Runtime factory - single point that returns the LLMRuntime for an agent role.
 *
 * Production policy supports OpenAI and Gemini as LLM providers, selected
 * via LLM_PROVIDER env var (default: 'existing' = OpenAI-only). The old
 * migration flags are still parsed for backward-compatible diagnostics, but
 * they no longer enable a non-OpenAI provider chain. LegacyRuntime remains
 * as a no-key local/test harness wrapper only; production boot requires
 * OPENAI_API_KEY (or GEMINI_API_KEY when LLM_PROVIDER=gemini).
 */

import type { LLMRuntime } from './llm-runtime.js';
import { LegacyRuntime, type LegacyAgentBackend } from './legacy-runtime.js';
// Static import (was previously a require('./openai-runtime.js') that masked
// real OpenAI runtime errors under vitest/tsx by silently degrading to legacy).
import { OpenAIRuntime as OpenAIRuntimeImpl } from './openai-runtime.js';

/**
 * Read the per-agent allowlist from env. Returns uppercase role names so
 * the comparison is case-insensitive. The literal "*" is treated as a
 * wildcard meaning "every agent".
 */
function getOpenaiRuntimeAgents(): { wildcard: boolean; roles: Set<string> } {
  const raw = process.env['JAK_OPENAI_RUNTIME_AGENTS'] ?? '';
  const tokens = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (tokens.includes('*')) return { wildcard: true, roles: new Set() };
  return {
    wildcard: false,
    roles: new Set(tokens.map(s => s.toUpperCase())),
  };
}

let warnedAboutIgnoredLegacyEngine = false;

/**
 * Per-tenant provider hints passed to getRuntime() and getProviderForTier()
 * to override the process.env default. When set, the hint takes precedence
 * over the LLM_PROVIDER env var. Undefined = use env-var default (backward
 * compatible).
 */
export interface ProviderHints {
  provider?: 'openai' | 'gemini';
  apiKey?: string;
  /** Google Search grounding + Vertex AI Search config (Gemini only). Ignored for OpenAI. */
  grounding?: {
    googleSearchEnabled?: boolean;
    vertexAISearchDatastore?: string;
  };
}

/**
 * Returns the runtime an agent should use based on its role + current flags.
 *
 * Selection order:
 *   1. hints.provider='gemini' + (hints.apiKey or GEMINI_API_KEY) -> GeminiRuntime.
 *   2. hints.provider='openai' + (hints.apiKey or OPENAI_API_KEY) -> OpenAIRuntime.
 *   3. LLM_PROVIDER=gemini + GEMINI_API_KEY set -> GeminiRuntime.
 *   4. JAK_OPENAI_RUNTIME_AGENTS=* -> OpenAIRuntime for every agent.
 *   5. JAK_OPENAI_RUNTIME_AGENTS contains the role name -> OpenAIRuntime.
 *   6. JAK_EXECUTION_ENGINE=openai-first -> OpenAIRuntime for every agent.
 *   7. JAK_EXECUTION_ENGINE=legacy -> ignored; OpenAI-only is enforced.
 *   8. Default when OPENAI_API_KEY is set -> OpenAIRuntime (Responses API).
 *   9. No OPENAI_API_KEY -> LegacyRuntime only for local tests/no-key stubs.
 */
export function getRuntime(
  role: string,
  backend: LegacyAgentBackend,
  hints?: ProviderHints,
): LLMRuntime {
  // Per-tenant hints take precedence over env vars
  if (hints?.provider === 'gemini') {
    const apiKey = hints.apiKey ?? process.env['GEMINI_API_KEY'];
    if (apiKey) {
      const { GeminiRuntime } = require('./gemini-runtime.js') as { GeminiRuntime: typeof import('./gemini-runtime.js').GeminiRuntime };
      return new GeminiRuntime({ apiKey, grounding: hints.grounding });
    }
    // No key available for Gemini — fall through to env-var logic
  }
  if (hints?.provider === 'openai') {
    const apiKey = hints.apiKey ?? process.env['OPENAI_API_KEY'];
    if (apiKey) {
      return new OpenAIRuntimeImpl({ apiKey });
    }
    // No key available for OpenAI — fall through to env-var logic
  }

  const llmProvider = (process.env['LLM_PROVIDER'] ?? 'existing').trim().toLowerCase();

  // Gemini provider: dynamic import so @google/generative-ai is never loaded
  // when LLM_PROVIDER is unset or 'existing'
  if (llmProvider === 'gemini') {
    const hasGeminiKey = Boolean(process.env['GEMINI_API_KEY']);
    if (hasGeminiKey) {
      // Lazy require — only loads the SDK when actually needed
      const { GeminiRuntime } = require('./gemini-runtime.js') as { GeminiRuntime: typeof import('./gemini-runtime.js').GeminiRuntime };
      return new GeminiRuntime();
    }
    // Fall through to OpenAI if no Gemini key (will use LegacyRuntime if
    // no OpenAI key either, which is the existing behavior)
  }

  const { wildcard, roles } = getOpenaiRuntimeAgents();
  const engineFlag = (process.env['JAK_EXECUTION_ENGINE'] ?? '').trim().toLowerCase();
  const hasKey = Boolean(process.env['OPENAI_API_KEY']);

  const explicitOpenAI =
    wildcard || roles.has(role.toUpperCase()) || engineFlag === 'openai-first';
  const explicitLegacy = engineFlag === 'legacy';
  // OpenAI-only: a legacy engine flag no longer enables the old provider chain.
  const useOpenAI = explicitOpenAI || hasKey || explicitLegacy;

  if (useOpenAI) {
    if (explicitLegacy && !warnedAboutIgnoredLegacyEngine) {
      warnedAboutIgnoredLegacyEngine = true;
      // eslint-disable-next-line no-console
      console.warn('[getRuntime] JAK_EXECUTION_ENGINE=legacy is ignored; OpenAI-only runtime is enforced.');
    }
    return new OpenAIRuntimeImpl();
  }

  return new LegacyRuntime(backend);
}

export {
  ensureModelMap,
  getModelMapSync,
  modelForTier,
  _resetModelMapCacheForTests,
} from './model-resolver.js';
export type { ModelTier, ResolvedModelMap } from './model-resolver.js';
export { smokeResponsesApi } from './smoke-test.js';
export type { ResponsesSmokeResult } from './smoke-test.js';

export type { LLMRuntime, LLMCallOptions, ToolLoopOptions, ToolLoopResult } from './llm-runtime.js';
export { LegacyRuntime } from './legacy-runtime.js';
export type { LegacyAgentBackend } from './legacy-runtime.js';
export { OpenAIRuntime } from './openai-runtime.js';
export { GeminiRuntime, type GeminiGroundingConfig } from './gemini-runtime.js';
export { extractGroundingMetadata, type GeminiGroundingMetadata } from './gemini-response-parser.js';
export type { HostedToolsConfig } from './openai-tool-adapter.js';
export { modelForGeminiTier, getDefaultGeminiModel, isGeminiModel } from './gemini-model-resolver.js';
