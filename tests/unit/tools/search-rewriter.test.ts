import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Behavioral tests for the query rewriter.
 *
 * Covers:
 *   - needsRewrite heuristic gating (short/focused queries skip LLM)
 *   - fails-safe no-op when no LLM key / kill switch / malformed JSON / 5xx
 *   - Successful rewrite picks the first (best) rewrite
 *   - GPT-4o-mini fallback when Anthropic key is absent
 *   - searchStrategyChain sets rewrittenFrom when the query changes
 *   - searchStrategyChain skips rewriter when needsRewrite returns false
 */

const ORIGINAL_ENV = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['OPENAI_API_KEY'];
  delete process.env['DISABLE_SEARCH_REWRITER'];
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

// ─── needsRewrite heuristic ────────────────────────────────────────────────

describe('needsRewrite heuristic', () => {
  it('skips short keyword-focused queries', async () => {
    const { needsRewrite } = await import('../../../packages/tools/src/adapters/search/index.js');
    expect(needsRewrite('postgres skip locked')).toBe(false);
    expect(needsRewrite('serper api')).toBe(false);
    expect(needsRewrite('kubernetes')).toBe(false);
  });

  it('triggers on question-form queries', async () => {
    const { needsRewrite } = await import('../../../packages/tools/src/adapters/search/index.js');
    expect(needsRewrite('how do i cache postgres queries')).toBe(true);
    expect(needsRewrite('what is the best way to handle retries')).toBe(true);
    expect(needsRewrite('why does my build keep failing')).toBe(true);
  });

  it('triggers on conversational phrasings', async () => {
    const { needsRewrite } = await import('../../../packages/tools/src/adapters/search/index.js');
    expect(needsRewrite('tell me about openai pricing changes')).toBe(true);
    expect(needsRewrite('help me find the anthropic docs')).toBe(true);
    expect(needsRewrite('i need a way to monitor my redis cluster health')).toBe(true);
  });

  it('triggers on long queries (>= 8 words)', async () => {
    const { needsRewrite } = await import('../../../packages/tools/src/adapters/search/index.js');
    expect(needsRewrite('building a multi agent system with distributed workflow persistence and redis coordination')).toBe(true);
  });

  it('skips medium queries that are already specific', async () => {
    const { needsRewrite } = await import('../../../packages/tools/src/adapters/search/index.js');
    expect(needsRewrite('serper api vs tavily')).toBe(false);
    expect(needsRewrite('prisma migrate deploy command')).toBe(false);
  });
});

// ─── defaultRewriter — fail-safe ───────────────────────────────────────────

describe('defaultRewriter — fail-safe', () => {
  it('returns [query] when no LLM key is configured', async () => {
    installFetch(async (url) => {
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultRewriter } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await defaultRewriter({ query: 'how do i cache postgres' });

    expect(result).toEqual(['how do i cache postgres']);
  });

  it('returns [query] when DISABLE_SEARCH_REWRITER=1', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['DISABLE_SEARCH_REWRITER'] = '1';
    installFetch(async (url) => {
      throw new Error(`kill switch leaked to ${url}`);
    });

    const { defaultRewriter } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await defaultRewriter({ query: 'how do i cache postgres' });

    expect(result).toEqual(['how do i cache postgres']);
  });

  it('returns [query] on malformed LLM response', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        return jsonResponse(anthropicBody('this is prose, not JSON'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultRewriter } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await defaultRewriter({ query: 'how do i cache postgres' });

    expect(result).toEqual(['how do i cache postgres']);
  });

  it('returns [query] on LLM 5xx', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async () => new Response('busy', { status: 503 }));

    const { defaultRewriter } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await defaultRewriter({ query: 'how do i cache postgres' });

    expect(result).toEqual(['how do i cache postgres']);
  });

  it('returns [query] when queries array is empty', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        return jsonResponse(anthropicBody('{"queries": []}'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultRewriter } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await defaultRewriter({ query: 'how do i cache postgres' });

    expect(result).toEqual(['how do i cache postgres']);
  });
});

// ─── defaultRewriter — success paths ───────────────────────────────────────

describe('defaultRewriter — success paths', () => {
  it('returns rewrites sorted with best first', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        return jsonResponse(anthropicBody('{"queries": ["postgres query result caching", "PgBouncer Redis cache", "materialized views caching strategy"]}'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultRewriter } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await defaultRewriter({ query: 'how can i cache postgres queries better' });

    expect(result).toHaveLength(3);
    expect(result[0]).toBe('postgres query result caching');
  });

  it('respects maxRewrites cap', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        return jsonResponse(anthropicBody('{"queries": ["a", "b", "c", "d"]}'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultRewriter } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await defaultRewriter({ query: 'how can i cache postgres queries', maxRewrites: 2 });

    expect(result).toHaveLength(2);
  });

  it('extracts JSON when LLM wraps it in prose', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        return jsonResponse(anthropicBody('Here are the rewrites:\n{"queries": ["redis pubsub reliability"]}\nHope this helps.'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultRewriter } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await defaultRewriter({ query: 'how do i use redis pubsub reliably' });

    expect(result).toEqual(['redis pubsub reliability']);
  });

  it('falls back to GPT-4o-mini when Anthropic key is absent', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-openai';
    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        throw new Error('anthropic called when key absent');
      }
      if (url.includes('openai.com')) {
        return jsonResponse(openaiBody('{"queries": ["fallback rewrite"]}'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { defaultRewriter } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await defaultRewriter({ query: 'how do i find a fallback rewrite' });

    expect(result).toEqual(['fallback rewrite']);
  });
});

// ─── Integration: searchStrategyChain with rewrite ─────────────────────────

describe('searchStrategyChain + rewrite integration', () => {
  const DDG_STUB_HTML = `
<html><body>
  <div class="result__body">
    <a class="result__a" href="https://duckduckgo.com/l/?kh=-1&uddg=https%3A%2F%2Fexample.com%2F">DDG stub</a>
    <a class="result__snippet">snippet</a>
  </div>
</body></html>`;

  it('rewrites the query and surfaces rewrittenFrom on the response', async () => {
    process.env['SERPER_API_KEY'] = 'sk-serper';
    process.env['ANTHROPIC_API_KEY'] = 'sk-anthropic';
    let serperQuerySeen: string | null = null;

    installFetch(async (url, init) => {
      if (url.includes('anthropic.com')) {
        return jsonResponse(anthropicBody('{"queries": ["postgres query caching strategies"]}'));
      }
      if (url.includes('serper.dev')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { q?: string };
        serperQuerySeen = body.q ?? null;
        return jsonResponse({
          organic: [{ title: 'Cache doc', link: 'https://a.com', snippet: 'x' }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await searchStrategyChain({
      query: 'how do i cache postgres queries in production',
      subscriptionTier: 'paid',
      rewrite: true,
      rerank: false,
      fetchContent: false,
    });

    expect(serperQuerySeen).toBe('postgres query caching strategies');
    expect(result.query).toBe('postgres query caching strategies');
    expect(result.rewrittenFrom).toBe('how do i cache postgres queries in production');
    expect(result.source).toBe('serper');
  });

  it('skips the rewriter for short keyword queries (needsRewrite=false)', async () => {
    process.env['SERPER_API_KEY'] = 'sk-serper';
    process.env['ANTHROPIC_API_KEY'] = 'sk-anthropic';

    installFetch(async (url, init) => {
      if (url.includes('anthropic.com')) {
        throw new Error('rewriter called on already-focused query');
      }
      if (url.includes('serper.dev')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { q?: string };
        return jsonResponse({
          organic: [{ title: `matched: ${body.q}`, link: 'https://a.com', snippet: 'x' }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await searchStrategyChain({
      query: 'postgres skip locked',
      subscriptionTier: 'paid',
      rewrite: true,
      rerank: false,
      fetchContent: false,
    });

    expect(result.query).toBe('postgres skip locked');
    expect(result.rewrittenFrom).toBeUndefined();
  });

  it('rewriter failure falls back to original query (fails safe)', async () => {
    process.env['SERPER_API_KEY'] = 'sk-serper';
    process.env['ANTHROPIC_API_KEY'] = 'sk-anthropic';

    installFetch(async (url, init) => {
      if (url.includes('anthropic.com')) {
        return new Response('busy', { status: 503 });
      }
      if (url.includes('serper.dev')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { q?: string };
        return jsonResponse({
          organic: [{ title: `original: ${body.q}`, link: 'https://a.com', snippet: 'x' }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await searchStrategyChain({
      query: 'how do i handle this edge case',
      subscriptionTier: 'paid',
      rewrite: true,
      rerank: false,
      fetchContent: false,
    });

    expect(result.query).toBe('how do i handle this edge case');
    expect(result.rewrittenFrom).toBeUndefined();
    expect(result.source).toBe('serper');
  });

  it('does not rewrite when rewrite:false', async () => {
    process.env['SERPER_API_KEY'] = 'sk-serper';
    process.env['ANTHROPIC_API_KEY'] = 'sk-anthropic';

    installFetch(async (url, init) => {
      if (url.includes('anthropic.com')) {
        throw new Error('rewriter called when rewrite:false');
      }
      if (url.includes('serper.dev')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { q?: string };
        return jsonResponse({
          organic: [{ title: `q=${body.q}`, link: 'https://a.com', snippet: 'x' }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await searchStrategyChain({
      query: 'how do i cache postgres queries',
      subscriptionTier: 'paid',
      rewrite: false,
      rerank: false,
      fetchContent: false,
    });

    expect(result.query).toBe('how do i cache postgres queries');
    expect(result.rewrittenFrom).toBeUndefined();
  });

  it('ignores rewrite when LLM returns the same query as original', async () => {
    process.env['SERPER_API_KEY'] = 'sk-serper';
    process.env['ANTHROPIC_API_KEY'] = 'sk-anthropic';

    installFetch(async (url) => {
      if (url.includes('anthropic.com')) {
        return jsonResponse(
          anthropicBody('{"queries": ["how do i handle edge cases in node"]}'),
        );
      }
      if (url.includes('serper.dev')) {
        return jsonResponse({
          organic: [{ title: 'r', link: 'https://a.com', snippet: 'x' }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { searchStrategyChain } = await import('../../../packages/tools/src/adapters/search/index.js');
    const result = await searchStrategyChain({
      query: 'how do i handle edge cases in node',
      subscriptionTier: 'paid',
      rewrite: true,
      rerank: false,
      fetchContent: false,
    });

    // LLM returned identical text — no rewrittenFrom surfaced.
    expect(result.rewrittenFrom).toBeUndefined();
  });
});
