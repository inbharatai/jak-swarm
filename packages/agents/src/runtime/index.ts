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
 * the comparison is case-insensitive.
 */
function getOpenaiRuntimeAgents(): Set<string> {
  const raw = process.env['JAK_OPENAI_RUNTIME_AGENTS'] ?? '';
  return new Set(
    raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
  );
}

/**
 * Returns the runtime an agent should use based on its role + current flags.
 *
 * In Phase 2 every call returns LegacyRuntime regardless of flags — the
 * scaffold is there so Phase 4 can flip individual agents without the
 * factory shape changing.
 */
export function getRuntime(
  role: string,
  backend: LegacyAgentBackend,
): LLMRuntime {
  const allowlist = getOpenaiRuntimeAgents();
  const useOpenAI =
    allowlist.has(role.toUpperCase()) ||
    (process.env['JAK_EXECUTION_ENGINE'] ?? 'legacy').trim().toLowerCase() === 'openai-first';

  if (useOpenAI) {
    // Phase 3: real OpenAIRuntime. Lazily imported so test paths that don't
    // need it never pay the cost of constructing an OpenAI client.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OpenAIRuntime } = require('./openai-runtime.js') as typeof import('./openai-runtime.js');
    return new OpenAIRuntime();
  }

  return new LegacyRuntime(backend);
}

export type { LLMRuntime, LLMCallOptions, ToolLoopOptions, ToolLoopResult } from './llm-runtime.js';
export { LegacyRuntime } from './legacy-runtime.js';
export type { LegacyAgentBackend } from './legacy-runtime.js';
export { OpenAIRuntime } from './openai-runtime.js';
export type { HostedToolsConfig } from './openai-tool-adapter.js';
