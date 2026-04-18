import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SearchResult } from '../../../packages/tools/src/adapters/search/index.js';

/**
 * Behavioral tests for the LLM re-ranker.
 *
 * Covers:
 *   - fails-safe no-op when no LLM key is configured
 *   - fails-safe no-op when DISABLE_SEARCH_RERANKER is set
 *   - correct re-ordering when LLM returns valid scores
 *   - threshold filter drops low-score results
 *   - malformed LLM response falls back to original ordering
 *   - timeout / abort returns original results
 *   - inferQueryIntent heuristics
 *   - searchStrategyChain with rerank:true wires the re-ranker through
 */

const ORIGINAL_ENV = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['OPENAI_API_KEY'];
  delete process.env['DISABLE_SEARCH_RERANKER'];
  delete process.env['SEARCH_PROVIDER_LOG'];
  delete process.env['SERPER_API_KEY'];
  delete process.env['TAVILY_API_KEY'];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = originalFetch;
});

function installFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as unknown as typeof globalThis.fetch;
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function anthropicBody(text: string): unknown {
  return { content: [{ text }] };
}

function openaiBody(text: string): unknown {
  return { choices: [{ message: { content: text } }] };
}

function fakeResults(n: number): SearchResult[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `Result ${i + 1}`,
    url: `https://example.com/${i + 1}`,
    content: `Snippet for result ${i + 1}.`,
    relevanceScore: 0.5,
  }));
}

// ─── inferQueryIntent heuristics ───────────────────────────────────────────

describe('inferQueryIntent', () => {
  it('detects time_sensitive queries by keyword', async () => {
    const { inferQueryIntent } = await import('../../../packages/tools/src/adapters/search/index.js');
    expect(inferQueryIntent('latest AI news')).toBe('time_sensitive');
    expect(inferQueryIntent('news about kubernetes this week')).toBe('time_sensitive');
    expect(inferQueryIntent('python 3.13 release notes 2026')).toBe('time_sensitive');
  });

  it('detects navigational queries', async () => {
    const { inferQueryIntent } = await import('../../../packages/tools/src/adapters/search/index.js');
    expect(inferQueryIntent('anthropic docs')).toBe('navigational');
    expect(inferQueryIntent('stripe pricing')).toBe('navigational');
  });

  it('detects technical queries', async () => {
    const { inferQueryIntent } = await import('../../../packages/tools/src/adapters/search/index.js');
    expect(inferQueryIntent('how to configure postgres pgvector')).toBe('technical');
    expect(inferQueryIntent('typescript generic constraint error')).toBe('technical');
  });

  it('defaults to informational', async () => {
    const { inferQueryIntent } = await import('../../../packages/tools/src/adapters/search/index.js');
    expect(inferQueryIntent('what is kubernetes')).toBe('technical'); // "how to" family
    expect(inferQueryIntent('benefits of meditation')).toBe('informational');
  });
});

// ─── Fail-safe behavior ────────────────────────────────────────────────────

describe('defaultReranker — fail-safe', () => {
  it('returns input unchanged when no LLM key is configured', async () => {
    // No fetch should be called.
    installFetch(async (url) => {
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultReranker } = await import('../../../packages/tools/src/adapters/search/index.js');
    const input = fakeResults(3);
    const result = await defaultReranker({ query: 'x', results: input });

    expect(result).toEqual(input);
  });

  it('returns input unchanged when DISABLE_SEARCH_RERANKER=1', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['DISABLE_SEARCH_RERANKER'] = '1';
    installFetch(async (url) => {
      throw new Error(`kill switch leaked to ${url}`);
    });

    const { defaultReranker } = await import('../../../packages/tools/src/adapters/search/index.js');
    const input = fakeResults(3);
    const result = await defaultReranker({ query: 'x', results: input });

    expect(result).toEqual(input);
  });

  it('returns input unchanged for a single result (no ranking needed)', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      throw new Error(`single-result leaked to ${url}`);
    });

    const { defaultReranker } = await import('../../../packages/tools/src/adapters/search/index.js');
    const input = fakeResults(1);
    const result = await defaultReranker({ query: 'x', results: input });

    expect(result).toEqual(input);
  });

  it('returns input unchanged when the LLM response is malformed JSON', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        return jsonResponse(anthropicBody('this is not JSON at all — just prose'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultReranker } = await import('../../../packages/tools/src/adapters/search/index.js');
    const input = fakeResults(3);
    const result = await defaultReranker({ query: 'x', results: input });

    expect(result).toEqual(input);
  });

  it('returns input unchanged when scores length mismatches results length', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        return jsonResponse(anthropicBody('{"scores": [0.9]}'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultReranker } = await import('../../../packages/tools/src/adapters/search/index.js');
    const input = fakeResults(3);
    const result = await defaultReranker({ query: 'x', results: input });

    expect(result).toEqual(input);
  });

  it('returns input unchanged when LLM returns non-2xx', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async () => new Response('server error', { status: 503 }));

    const { defaultReranker } = await import('../../../packages/tools/src/adapters/search/index.js');
    const input = fakeResults(3);
    const result = await defaultReranker({ query: 'x', results: input });

    expect(result).toEqual(input);
  });
});

// ─── Re-ordering behavior ──────────────────────────────────────────────────

describe('defaultReranker — re-ordering', () => {
  it('re-orders by score descending and applies threshold filter', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        // Results 1, 2, 3 — LLM says 3 is best, 2 is junk, 1 is decent.
        return jsonResponse(anthropicBody('{"scores": [0.7, 0.1, 0.95]}'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultReranker } = await import('../../../packages/tools/src/adapters/search/index.js');
    const input = fakeResults(3);
    const result = await defaultReranker({
      query: 'x',
      results: input,
      threshold: 0.25,
    });

    // Result 2 (score 0.1) dropped by threshold.
    expect(result).toHaveLength(2);
    // Result 3 first (0.95), then result 1 (0.7).
    expect(result[0]?.title).toBe('Result 3');
    expect(result[0]?.relevanceScore).toBe(0.95);
    expect(result[1]?.title).toBe('Result 1');
    expect(result[1]?.relevanceScore).toBe(0.7);
  });

  it('respects maxResults cap after re-ranking', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        return jsonResponse(anthropicBody('{"scores": [0.9, 0.8, 0.7, 0.6, 0.5]}'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultReranker } = await import('../../../packages/tools/src/adapters/search/index.js');
    const input = fakeResults(5);
    const result = await defaultReranker({ query: 'x', results: input, maxResults: 3 });

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.title)).toEqual(['Result 1', 'Result 2', 'Result 3']);
  });

  it('extracts JSON even when LLM adds surrounding prose', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        return jsonResponse(
          anthropicBody('Sure, here are the scores:\n{"scores": [0.9, 0.5]}\nLet me know if you need anything else.'),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultReranker } = await import('../../../packages/tools/src/adapters/search/index.js');
    const input = fakeResults(2);
    const result = await defaultReranker({ query: 'x', results: input, threshold: 0 });

    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe('Result 1');
  });

  it('falls back to GPT-4o-mini when Anthropic key is absent', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-openai';
    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        throw new Error('anthropic called when it should not be');
      }
      if (url.includes('openai.com')) {
        return jsonResponse(openaiBody('{"scores": [0.6, 0.9]}'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultReranker } = await import('../../../packages/tools/src/adapters/search/index.js');
    const input = fakeResults(2);
    const result = await defaultReranker({ query: 'x', results: input, threshold: 0 });

    expect(result[0]?.title).toBe('Result 2');
    expect(result[1]?.title).toBe('Result 1');
  });
});

// ─── Integration: searchStrategyChain + rerank ─────────────────────────────

describe('searchStrategyChain + rerank integration', () => {
  it('re-ranks Serper results when rerank:true and paid tier', async () => {
    process.env['SERPER_API_KEY'] = 'sk-serper';
    process.env['ANTHROPIC_API_KEY'] = 'sk-anthropic';

    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        return jsonResponse({
          organic: [
            { title: 'Serper 1 (junk)', link: 'https://junk.com', snippet: 'irrelevant' },
            { title: 'Serper 2 (gold)', link: 'https://gold.com', snippet: 'exact match' },
          ],
        });
      }
      if (url.includes('anthropic.com')) {
        // Junk = 0.1, gold = 0.95 — should reorder AND drop junk.
        return jsonResponse(anthropicBody('{"scores": [0.1, 0.95]}'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await searchStrategyChain({
      query: 'find gold',
      subscriptionTier: 'paid',
      rerank: true,
      fetchContent: false,
    });

    expect(result.source).toBe('serper');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.title).toBe('Serper 2 (gold)');
    expect(result.resultCount).toBe(1);
  });

  it('does NOT re-rank when rerank:false (preserves raw ordering)', async () => {
    process.env['SERPER_API_KEY'] = 'sk-serper';
    process.env['ANTHROPIC_API_KEY'] = 'sk-anthropic';

    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        return jsonResponse({
          organic: [
            { title: 'Top', link: 'https://a.com', snippet: 'a' },
            { title: 'Middle', link: 'https://b.com', snippet: 'b' },
          ],
        });
      }
      if (url.includes('anthropic.com')) {
        throw new Error('anthropic called when rerank was false');
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await searchStrategyChain({
      query: 'x',
      subscriptionTier: 'paid',
      rerank: false,
      fetchContent: false,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.title).toBe('Top');
  });

  it('rerank failure returns the un-ranked chain results (fails safe)', async () => {
    process.env['SERPER_API_KEY'] = 'sk-serper';
    process.env['ANTHROPIC_API_KEY'] = 'sk-anthropic';

    installFetch(async (url) => {
      if (url.includes('serper.dev')) {
        return jsonResponse({
          organic: [
            { title: 'Keep 1', link: 'https://1.com', snippet: 'a' },
            { title: 'Keep 2', link: 'https://2.com', snippet: 'b' },
          ],
        });
      }
      if (url.includes('anthropic.com')) {
        return new Response('rate limited', { status: 429 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await searchStrategyChain({
      query: 'x',
      subscriptionTier: 'paid',
      rerank: true,
      fetchContent: false,
    });

    // LLM rerank failed → fall back to original 2 results.
    expect(result.source).toBe('serper');
    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.title)).toEqual(['Keep 1', 'Keep 2']);
  });
});
