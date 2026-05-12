/**
 * Runtime factory - single point that returns the LLMRuntime for an agent role.
 *
 * Production policy is OpenAI-only via OpenAIRuntime (Responses API). The old
 * migration flags are still parsed for backward-compatible diagnostics, but
 * they no longer enable a non-OpenAI provider chain. LegacyRuntime remains as a
 * no-key local/test harness wrapper only; production boot requires
 * OPENAI_API_KEY.
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
 * Returns the runtime an agent should use based on its role + current flags.
 *
 * Selection order:
 *   1. JAK_OPENAI_RUNTIME_AGENTS=* -> OpenAIRuntime for every agent.
 *   2. JAK_OPENAI_RUNTIME_AGENTS contains the role name -> OpenAIRuntime.
 *   3. JAK_EXECUTION_ENGINE=openai-first -> OpenAIRuntime for every agent.
 *   4. JAK_EXECUTION_ENGINE=legacy -> ignored; OpenAI-only is enforced.
 *   5. Default when OPENAI_API_KEY is set -> OpenAIRuntime (Responses API).
 *   6. No OPENAI_API_KEY -> LegacyRuntime only for local tests/no-key stubs.
 */
export function getRuntime(
  role: string,
  backend: LegacyAgentBackend,
): LLMRuntime {
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
export type { HostedToolsConfig } from './openai-tool-adapter.js';
