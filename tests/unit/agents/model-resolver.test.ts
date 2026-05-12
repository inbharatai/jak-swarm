import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Unit tests for the ModelResolver.
 *
 * Strategy: inject a fake `ModelListClient` directly via `ensureModelMap
 * ({ client })` — avoids cross-package SDK-mocking gymnastics while
 * still exercising every branch of the resolver.
 */

import {
  ensureModelMap,
  getModelMapSync,
  modelForTier,
  _resetModelMapCacheForTests,
  type ModelListClient,
} from '../../../packages/agents/src/runtime/model-resolver.js';

const ORIGINAL_ENV = { ...process.env };

interface FakeClientState {
  listCalls: number;
  modelIds: string[];
  throwOnList: boolean;
}

function makeFakeClient(state: FakeClientState): ModelListClient {
  return {
    models: {
      list: async () => {
        state.listCalls++;
        if (state.throwOnList) throw new Error('401 Unauthorized (fake)');
        const ids = state.modelIds;
        return {
          [Symbol.asyncIterator]: async function* () {
            for (const id of ids) yield { id };
          },
        };
      },
    },
  };
}

let state: FakeClientState;
let client: ModelListClient;

beforeEach(() => {
  state = { listCalls: 0, modelIds: [], throwOnList: false };
  client = makeFakeClient(state);
  delete process.env['OPENAI_API_KEY'];
  delete process.env['OPENAI_MODEL_TIER_1'];
  delete process.env['OPENAI_MODEL_TIER_2'];
  delete process.env['OPENAI_MODEL_TIER_3'];
  delete process.env['OPENAI_BASE_URL'];
  _resetModelMapCacheForTests();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('ModelResolver — preferred model picks', () => {
  it('picks the configured GPT-5.5/5.4 OpenAI tiers when available', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    state.modelIds = ['gpt-5.5', 'gpt-5.4', 'gpt-4o'];
    const map = await ensureModelMap({ client });

    expect(map.tier3).toBe('gpt-5.5');
    expect(map.tier2).toBe('gpt-5.4');
    expect(map.tier1).toBe('gpt-5.4');
    expect(map.verified).toBe(true);
    expect(map.available).toContain('gpt-5.5');
  });

  it('uses tier-adjacent GPT-5.4 models when GPT-5.5 is unavailable', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    state.modelIds = ['gpt-5.4'];
    const map = await ensureModelMap({ client });

    expect(map.tier3).toBe('gpt-5.4');
    expect(map.tier2).toBe('gpt-5.4');
    expect(map.tier1).toBe('gpt-5.4');
    expect(map.verified).toBe(true);
  });

  it('keeps configured GPT-5.5/5.4 defaults when preferred models are not listed', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    state.modelIds = ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'];
    const map = await ensureModelMap({ client });

    expect(map.tier3).toBe('gpt-5.5');
    expect(map.tier2).toBe('gpt-5.4');
    expect(map.tier1).toBe('gpt-5.4');
    expect(map.verified).toBe(false);
  });

  it('does not fall back to legacy GPT-4 models for missing tiers', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    state.modelIds = ['gpt-5.4', 'gpt-4o-mini'];
    const map = await ensureModelMap({ client });

    expect(map.tier3).toBe('gpt-5.4');
    expect(map.tier2).toBe('gpt-5.4');
    expect(map.tier1).toBe('gpt-5.4');
    expect(map.verified).toBe(true);
  });
});

describe('ModelResolver — env overrides', () => {
  it('honors OPENAI_MODEL_TIER_3 / _TIER_2 / _TIER_1 overrides', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    process.env['OPENAI_MODEL_TIER_3'] = 'my-custom-model';
    process.env['OPENAI_MODEL_TIER_2'] = 'my-custom-mini';
    process.env['OPENAI_MODEL_TIER_1'] = 'my-custom-nano';
    state.modelIds = ['gpt-5.4'];
    const map = await ensureModelMap({ client });

    expect(map.tier3).toBe('my-custom-model');
    expect(map.tier2).toBe('my-custom-mini');
    expect(map.tier1).toBe('my-custom-nano');
  });
});

describe('ModelResolver — failure paths', () => {
  it('keeps configured GPT-5.5/5.4 defaults when OPENAI_API_KEY is missing and no client injected', async () => {
    // key intentionally not set, no client injected
    const map = await ensureModelMap();

    expect(map.verified).toBe(false);
    expect(map.tier3).toBe('gpt-5.5');
    expect(map.tier2).toBe('gpt-5.4');
    expect(map.tier1).toBe('gpt-5.4');
  });

  it('does not call OpenAI when OPENAI_API_KEY is a local placeholder and no client is injected', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-local-e2e-0000';
    const map = await ensureModelMap();

    expect(map.verified).toBe(false);
    expect(map.tier3).toBe('gpt-5.5');
    expect(map.tier2).toBe('gpt-5.4');
    expect(map.diagnostic).toContain('placeholder');
  });

  it('keeps configured GPT-5.5/5.4 defaults when models.list throws', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    state.throwOnList = true;
    const map = await ensureModelMap({ client });

    expect(map.verified).toBe(false);
    expect(map.tier3).toBe('gpt-5.5');
    expect(map.tier2).toBe('gpt-5.4');
    expect(map.tier1).toBe('gpt-5.4');
  });
});

describe('ModelResolver — caching', () => {
  it('calls models.list only once across multiple ensureModelMap() calls', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    state.modelIds = ['gpt-5.5', 'gpt-5.4'];
    await ensureModelMap({ client });
    await ensureModelMap({ client });
    await ensureModelMap({ client });
    expect(state.listCalls).toBe(1);
  });

  it('force=true bypasses the cache and re-fetches', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    state.modelIds = ['gpt-5.4'];
    await ensureModelMap({ client });
    expect(state.listCalls).toBe(1);
    await ensureModelMap({ client, force: true });
    expect(state.listCalls).toBe(2);
  });

  it('getModelMapSync returns failsafe before ensureModelMap() runs', () => {
    const m = getModelMapSync();
    expect(m.verified).toBe(false);
    expect(m.tier3).toBe('gpt-5.5');
  });

  it('modelForTier returns the resolved model after ensure completes', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    state.modelIds = ['gpt-5.5', 'gpt-5.4'];
    await ensureModelMap({ client });
    expect(modelForTier(3)).toBe('gpt-5.5');
    expect(modelForTier(2)).toBe('gpt-5.4');
    expect(modelForTier(1)).toBe('gpt-5.4');
  });
});
