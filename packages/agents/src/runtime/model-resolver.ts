import OpenAI from 'openai';

export type ModelTier = 1 | 2 | 3;

export interface ModelListClient {
  models: {
    list: () => Promise<AsyncIterable<{ id?: string }>>;
  };
}

export interface ResolvedModelMap {
  tier3: string;
  tier2: string;
  tier1: string;
  verified: boolean;
  available: string[];
  diagnostic: string;
  resolvedAt: Date;
}

const DEFAULT_MODEL_MAP: ResolvedModelMap = {
  tier3: 'gpt-5.5',
  tier2: 'gpt-5.4',
  tier1: 'gpt-5.4',
  verified: false,
  available: [],
  diagnostic: 'OpenAI-only configured defaults: tier3=gpt-5.5, tier2=gpt-5.4, tier1=gpt-5.4.',
  resolvedAt: new Date(0),
};

const TIER_PREFERENCES: Record<ModelTier, string[]> = {
  3: ['gpt-5.5', 'gpt-5.4'],
  2: ['gpt-5.4'],
  1: ['gpt-5.4'],
};

let cachedMap: ResolvedModelMap | null = null;
let inFlight: Promise<ResolvedModelMap> | null = null;

function envOverrideForTier(tier: ModelTier): string | undefined {
  const v = process.env[`OPENAI_MODEL_TIER_${tier}`]?.trim();
  return v && v.length > 0 ? v : undefined;
}

function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const w = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  w(`[ModelResolver] ${message}`);
}

function isPlaceholderOpenAIKey(apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  const trimmed = apiKey.trim();
  return (
    trimmed === 'sk-test' ||
    trimmed.startsWith('sk-test-') ||
    trimmed === 'test-openai' ||
    /placeholder|not-real|do-not-use|local-e2e/i.test(trimmed)
  );
}

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

function configuredDefaultForTier(tier: ModelTier): string {
  if (tier === 3) return DEFAULT_MODEL_MAP.tier3;
  if (tier === 2) return DEFAULT_MODEL_MAP.tier2;
  return DEFAULT_MODEL_MAP.tier1;
}

export async function ensureModelMap(
  opts: { force?: boolean; client?: ModelListClient } = {},
): Promise<ResolvedModelMap> {
  if (cachedMap && !opts.force) return cachedMap;
  if (inFlight && !opts.force) return inFlight;

  inFlight = (async (): Promise<ResolvedModelMap> => {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey && !opts.client) {
      log('OPENAI_API_KEY not set. Keeping GPT-5.5/5.4 configured model names; calls will fail until the key is set.', 'warn');
      cachedMap = { ...DEFAULT_MODEL_MAP, resolvedAt: new Date() };
      return cachedMap;
    }

    if (!opts.client && isPlaceholderOpenAIKey(apiKey)) {
      log('OPENAI_API_KEY is a local test placeholder. Skipping remote capability check and keeping GPT-5.5/5.4 configured model names.', 'info');
      cachedMap = {
        ...DEFAULT_MODEL_MAP,
        diagnostic: 'Local test placeholder key detected; remote OpenAI model capability check skipped.',
        resolvedAt: new Date(),
      };
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
      log('Capability check failed. Keeping GPT-5.5/5.4 configured model names; no non-OpenAI or GPT-4 fallback will be used.', 'warn');
      cachedMap = { ...DEFAULT_MODEL_MAP, resolvedAt: new Date() };
      return cachedMap;
    }

    const availableSet = new Set(available);
    const resolveTier = (tier: ModelTier): { model: string; source: string; verified: boolean } => {
      const override = envOverrideForTier(tier);
      if (override) return { model: override, source: `env OPENAI_MODEL_TIER_${tier}`, verified: availableSet.has(override) };
      for (const candidate of TIER_PREFERENCES[tier]) {
        if (availableSet.has(candidate)) return { model: candidate, source: 'preferred', verified: true };
      }
      return { model: configuredDefaultForTier(tier), source: 'configured-default-unverified', verified: false };
    };

    const t3 = resolveTier(3);
    const t2 = resolveTier(2);
    const t1 = resolveTier(1);
    const verified = t3.verified && t2.verified && t1.verified;

    const lines = [
      `Capability check OK. ${available.length} models accessible to this key.`,
      `  Tier 3 (premier): ${t3.model} [${t3.source}]`,
      `  Tier 2 (balanced): ${t2.model} [${t2.source}]`,
      `  Tier 1 (fast):     ${t1.model} [${t1.source}]`,
    ];
    for (const line of lines) log(line);

    if (!verified) {
      log(
        'One or more GPT-5.5/5.4 tier models were not listed by this API key. ' +
        'JAK will still use the configured GPT-5.5/5.4 names and fail loudly if access is missing.',
        'warn',
      );
    }

    cachedMap = {
      tier3: t3.model,
      tier2: t2.model,
      tier1: t1.model,
      verified,
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

export function getModelMapSync(): ResolvedModelMap {
  return cachedMap ?? DEFAULT_MODEL_MAP;
}

export function modelForTier(tier: ModelTier): string {
  const map = getModelMapSync();
  if (tier === 3) return map.tier3;
  if (tier === 2) return map.tier2;
  return map.tier1;
}

export function _resetModelMapCacheForTests(): void {
  cachedMap = null;
  inFlight = null;
}
