/**
 * Runtime factory — single point that returns the right `LLMRuntime` for
 * a given agent role based on the migration flags.
 *
 * Reading order at construction time:
 *   1. JAK_OPENAI_RUNTIME_AGENTS env var (CSV of agent role names).
 *      If the agent's role is in this allowlist, return OpenAIRuntime
 *      (Phase 4+). Otherwise fall through.
 *   2. JAK_EXECUTION_ENGINE env var. If 'openai-first', return
 *      OpenAIRuntime for every agent (Phase 7). Otherwise fall through.
 *   3. Default: LegacyRuntime (Phase 2 default).
 *
 * Phase 2 hardcodes LegacyRuntime; the env-var checks are scaffolded but
 * the OpenAIRuntime import is a stub that throws. Phase 3 wires it up.
 */

import type { LLMRuntime } from './llm-runtime.js';
import { LegacyRuntime, type LegacyAgentBackend } from './legacy-runtime.js';

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

/**
 * Returns the runtime an agent should use based on its role + current flags.
 *
 * Selection order:
 *   1. JAK_OPENAI_RUNTIME_AGENTS=* → OpenAIRuntime for every agent.
 *   2. JAK_OPENAI_RUNTIME_AGENTS contains the role name → OpenAIRuntime.
 *   3. JAK_EXECUTION_ENGINE=openai-first → OpenAIRuntime for every agent.
 *   4. JAK_EXECUTION_ENGINE explicitly set to 'legacy' → LegacyRuntime.
 *   5. Default when OPENAI_API_KEY is set → OpenAIRuntime (Responses API).
 *   6. Fallback → LegacyRuntime (Chat Completions via OpenAIProvider).
 *
 * The default changed in the GPT-5.4 migration: if a caller has an
 * OPENAI_API_KEY set and has NOT explicitly chosen legacy, we use the
 * Responses API because GPT-5.4 strongly prefers it. Legacy Chat
 * Completions still works for existing callers who set
 * JAK_EXECUTION_ENGINE=legacy.
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
  // Default: OpenAI-first when we have a key and the operator has NOT
  // explicitly opted into legacy.
  const useOpenAI = explicitOpenAI || (!explicitLegacy && hasKey);

  if (useOpenAI) {
    try {
      // Phase 3: real OpenAIRuntime. Lazily imported so test paths that don't
      // need it never pay the cost of constructing an OpenAI client.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { OpenAIRuntime } = require('./openai-runtime.js') as typeof import('./openai-runtime.js');
      return new OpenAIRuntime();
    } catch (err) {
      // If OpenAIRuntime construction fails (missing key edge case, SDK
      // mismatch), fall back to LegacyRuntime so the agent still works.
      // Never throw here — agent construction must not fail during boot.
      // eslint-disable-next-line no-console
      console.warn(
        `[getRuntime] OpenAIRuntime unavailable (${err instanceof Error ? err.message : String(err)}), falling back to LegacyRuntime for role ${role}.`,
      );
    }
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

export type { LLMRuntime, LLMCallOptions, ToolLoopOptions, ToolLoopResult } from './llm-runtime.js';
export { LegacyRuntime } from './legacy-runtime.js';
export type { LegacyAgentBackend } from './legacy-runtime.js';
export { OpenAIRuntime } from './openai-runtime.js';
export type { HostedToolsConfig } from './openai-tool-adapter.js';
