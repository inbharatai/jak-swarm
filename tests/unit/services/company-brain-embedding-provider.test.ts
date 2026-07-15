/**
 * company-brain-embedding-provider.test.ts — pins C3 real-provider wiring:
 * resolveBrainEmbeddingProvider is env-gated (OFF by default so the running app
 * degrades to lexical+graph), and OpenAIEmbeddingProvider degrades to null on
 * error so the vector channel is skipped, never throws.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveBrainEmbeddingProvider,
  OpenAIEmbeddingProvider,
  DeterministicEmbeddingProvider,
} from '../../../apps/api/src/services/company-brain/company-brain-embeddings.js';

const origFlag = process.env['COMPANY_BRAIN_EMBEDDINGS'];
afterEach(() => {
  if (origFlag === undefined) delete process.env['COMPANY_BRAIN_EMBEDDINGS'];
  else process.env['COMPANY_BRAIN_EMBEDDINGS'] = origFlag;
  vi.unstubAllGlobals();
});

describe('resolveBrainEmbeddingProvider (env-gated, OFF by default)', () => {
  it('returns undefined when the flag is unset (lexical-only, the safe default)', () => {
    delete process.env['COMPANY_BRAIN_EMBEDDINGS'];
    expect(resolveBrainEmbeddingProvider()).toBeUndefined();
  });
  it('returns the deterministic provider when flag=deterministic', () => {
    process.env['COMPANY_BRAIN_EMBEDDINGS'] = 'deterministic';
    const p = resolveBrainEmbeddingProvider();
    expect(p).toBeInstanceOf(DeterministicEmbeddingProvider);
  });
  it('returns an OpenAIEmbeddingProvider when flag=1 and an OpenAI key is configured', () => {
    process.env['COMPANY_BRAIN_EMBEDDINGS'] = '1';
    // The dev/test env carries an OPENAI_API_KEY -> the real provider is wired.
    const p = resolveBrainEmbeddingProvider();
    expect(p).toBeInstanceOf(OpenAIEmbeddingProvider);
  });
});

describe('OpenAIEmbeddingProvider degrades to null (never throws)', () => {
  it('returns null on an empty string', async () => {
    const p = new OpenAIEmbeddingProvider('sk-test');
    expect(await p.embed('   ')).toBeNull();
    expect(await p.embed('')).toBeNull();
  });
  it('returns null when the API responds non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    const p = new OpenAIEmbeddingProvider('sk-test');
    expect(await p.embed('some text')).toBeNull();
  });
  it('returns the embedding vector on a 200 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) })));
    const p = new OpenAIEmbeddingProvider('sk-test');
    expect(await p.embed('hello world')).toEqual([0.1, 0.2, 0.3]);
  });
  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    const p = new OpenAIEmbeddingProvider('sk-test');
    expect(await p.embed('hello world')).toBeNull();
  });
});
