/**
 * ModelResolver — single source of truth for which OpenAI model each
 * agent tier should use.
 *
 * Why this exists:
 *   - Hard-coding `gpt-5.4` (or any model name) anywhere in the codebase
 *     creates a single point of failure. A typo, a deprecation, or a
 *     project-scoped key without access to that model takes down every
 *     workflow with a 404.
 *   - Per-call fallback chains (the existing OpenAIProvider pattern) work
 *     but burn the first attempt on a known-broken model on every single
 *     request. We waste latency + tokens proving the same model 404s
 *     thousands of times per hour in production.
 *
 * What it does:
 *   - On first use, calls `client.models.list()` ONCE and caches the result.
 *   - Verifies whether each preferred model exists in that list.
 *   - For every tier (1/2/3), resolves to the FIRST model in the
 *     preferred → fallback chain that the API key actually has access to.
 *   - Logs the resolved map at startup so operators know exactly which
 *     model each tier maps to in this environment.
 *   - Re-checks once per process — does NOT call models.list on every
 *     LLM request.
 *   - Fails OPEN: if the capability check itself fails (network, auth),
 *     resolution falls back to a hardcoded last-resort map (`gpt-4o` /
 *     `gpt-4o-mini`) so the system stays usable instead of bricking.
 *
 * Tier intent (per the user's confirmed model spec):
 *   - Tier 3 (premier reasoning): Commander, Planner, Verifier, Architect, Strategist
 *   - Tier 2 (balanced): Coder, Designer, Marketing, Research, browser-heavy agents
 *   - Tier 1 (cheap+fast): Email, Calendar, CRM, classification, helpers
 *
 * Override path:
 *   - `OPENAI_MODEL` env still works as a hard override for the default model.
 *   - Per-tier overrides via env (`OPENAI_MODEL_TIER_1/2/3`) are honored.
 *   - `AGENT_MODEL_MAP` per-role overrides keep working.
 */

import OpenAI from 'openai';

export type ModelTier = 1 | 2 | 3;

/**
 * Pluggable client for tests. Matches the small subset of the OpenAI SDK
 * we actually use — `models.list()` returning an async iterable of
 * `{ id: string }` entries. Production code passes an actual OpenAI
 * instance; unit tests inject a mock.
 */
export interface ModelListClient {
  models: {
    list: () => Promise<AsyncIterable<{ id?: string }>>;
  };
}

export interface ResolvedModelMap {
  /** Model picked for tier 3 (premier). */
  tier3: string;
  /** Model picked for tier 2 (balanced). */
  tier2: string;
  /** Model picked for tier 1 (cheap+fast). */
  tier1: string;
  /** Was the resolution backed by a real OpenAI models.list response? */
  verified: boolean;
  /** Full list of model IDs the API key reported (empty when unverified). */
  available: string[];
  /** Free-text diagnostic the operator can read to understand resolution. */
  diagnostic: string;
  /** When the resolution was performed. */
  resolvedAt: Date;
}

const TIER_PREFERENCES: Record<ModelTier, string[]> = {
  // Premier reasoning. GPT-5.4 → GPT-5 → GPT-4o.
  3: ['gpt-5.4', 'gpt-5', 'gpt-4o'],
  // Balanced. GPT-5.4-mini → GPT-5-mini → GPT-4o-mini.
  2: ['gpt-5.4-mini', 'gpt-5-mini', 'gpt-4o-mini'],
  // Cheap + fast. GPT-5.4-nano → GPT-5-nano → GPT-4o-mini.
  1: ['gpt-5.4-nano', 'gpt-5-nano', 'gpt-4o-mini'],
};

/** Hardcoded last-resort map when the capability check itself fails. */
const FAILSAFE_MAP: ResolvedModelMap = {
  tier3: 'gpt-4o',
  tier2: 'gpt-4o-mini',
  tier1: 'gpt-4o-mini',
  verified: false,
  available: [],
  diagnostic: 'Capability check has not run (or failed). Using failsafe gpt-4o family. Set OPENAI_API_KEY and call ensureModelMap() at boot to verify the GPT-5.4 family.',
  resolvedAt: new Date(0),
};

let cachedMap: ResolvedModelMap | null = null;
let inFlight: Promise<ResolvedModelMap> | null = null;

/** Honor env-var per-tier overrides. Returns the override or undefined. */
function envOverrideForTier(tier: ModelTier): string | undefined {
  const v = process.env[`OPENAI_MODEL_TIER_${tier}`]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/** Build a logger prefix the operator can grep for. */
function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  // eslint-disable-next-line no-console
  const w = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  w(`[ModelResolver] ${message}`);
}

/**
 * Fetch the list of models the configured API key has access to.
 * Returns null on any failure — caller falls back to the failsafe map.
 */
async function fetchAvailableModels(client: ModelListClient): Promise<string[] | null> {
  try {
    const list = await client.models.list();
    const ids: string[] = [];
    for await (const m of list) {
      if (typeof m.id === 'string') ids.push(m.id);
    }
    return ids;
  } catch (err) {
    log(`models.list failed: ${err instanceof Error ? err.message : String(err)}`, 'warn');
    return null;
  }
}

/**
 * Resolve the model map. First call hits OpenAI; subsequent calls within
 * the same process return the cached result.
 *
 * Callers can inject a `client` for testing or to reuse an existing SDK
 * instance. When omitted, the resolver constructs its own from
 * OPENAI_API_KEY + OPENAI_BASE_URL env.
 */
export async function ensureModelMap(
  opts: { force?: boolean; client?: ModelListClient } = {},
): Promise<ResolvedModelMap> {
  if (cachedMap && !opts.force) return cachedMap;
  if (inFlight && !opts.force) return inFlight;

  inFlight = (async (): Promise<ResolvedModelMap> => {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey && !opts.client) {
      log('OPENAI_API_KEY not set — using failsafe map (gpt-4o family).', 'warn');
      cachedMap = { ...FAILSAFE_MAP, resolvedAt: new Date() };
      return cachedMap;
    }

    const client: ModelListClient = opts.client ?? new OpenAI({
      apiKey: apiKey!,
      ...(process.env['OPENAI_BASE_URL']?.trim()
        ? { baseURL: process.env['OPENAI_BASE_URL']!.trim() }
        : {}),
    });

    const available = await fetchAvailableModels(client);
    if (!available) {
      log('Capability check failed — using failsafe map (gpt-4o family). Workflows will still work.', 'warn');
      cachedMap = { ...FAILSAFE_MAP, resolvedAt: new Date() };
      return cachedMap;
    }
    const availableSet = new Set(available);

    const resolveTier = (tier: ModelTier): { model: string; source: string } => {
      const override = envOverrideForTier(tier);
      if (override) return { model: override, source: `env OPENAI_MODEL_TIER_${tier}` };
      for (const candidate of TIER_PREFERENCES[tier]) {
        if (availableSet.has(candidate)) return { model: candidate, source: 'preferred' };
      }
      // Nothing in preference chain matches — last resort: any model with
      // 'gpt' in name as a sanity floor.
      const fallback = available.find((m) => m.startsWith('gpt-')) ?? FAILSAFE_MAP[`tier${tier}` as 'tier3' | 'tier2' | 'tier1'];
      return { model: fallback, source: 'last-resort' };
    };

    const t3 = resolveTier(3);
    const t2 = resolveTier(2);
    const t1 = resolveTier(1);

    const lines = [
      `Capability check OK. ${available.length} models accessible to this key.`,
      `  Tier 3 (premier   — Commander/Planner/Verifier/Architect/Strategist): ${t3.model} [${t3.source}]`,
      `  Tier 2 (balanced  — Coder/Research/Designer/Marketing/Browser):       ${t2.model} [${t2.source}]`,
      `  Tier 1 (fast+cheap — Email/Calendar/CRM/Document/helper tasks):       ${t1.model} [${t1.source}]`,
    ];
    for (const line of lines) log(line);

    // Loud warning when GPT-5.4 family is missing — operator action item.
    const has54Family = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'].some((m) => availableSet.has(m));
    if (!has54Family) {
      log(
        'No GPT-5.4 family models available to this API key. Resolution fell back to GPT-5 / GPT-4o family. ' +
        'If you expect GPT-5.4 access, check (a) the project-scoped key has the model entitlement, ' +
        '(b) OPENAI_BASE_URL points at api.openai.com, (c) the org has been granted access by OpenAI.',
        'warn',
      );
    }

    cachedMap = {
      tier3: t3.model,
      tier2: t2.model,
      tier1: t1.model,
      verified: true,
      available,
      diagnostic: lines.join('\n'),
      resolvedAt: new Date(),
    };
    return cachedMap;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Synchronous accessor for the cached map. Returns the failsafe map when
 * called before `ensureModelMap()` has resolved — never throws.
 */
export function getModelMapSync(): ResolvedModelMap {
  return cachedMap ?? FAILSAFE_MAP;
}

/** Resolve a model name for a given tier, honoring the cached map. */
export function modelForTier(tier: ModelTier): string {
  const map = getModelMapSync();
  if (tier === 3) return map.tier3;
  if (tier === 2) return map.tier2;
  return map.tier1;
}

/**
 * Test/admin hook — clears the cached map so the next ensureModelMap()
 * call re-fetches. NOT for production hot-paths.
 */
export function _resetModelMapCacheForTests(): void {
  cachedMap = null;
  inFlight = null;
}
