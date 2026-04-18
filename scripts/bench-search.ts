/**
 * scripts/bench-search.ts
 *
 * Offline benchmark harness for the search strategy chain. Runs a fixed query
 * set through every available provider and reports latency, result count,
 * expected-domain hit rate, and failure rate.
 *
 * Run: `pnpm bench:search`
 * Requires: `SERPER_API_KEY` and/or `TAVILY_API_KEY` to exercise paid tiers;
 * DuckDuckGo runs unconditionally.
 *
 * Output: `docs/_generated/search-bench.json` (gitignored) + a summary table
 * printed to stdout. Exits 0 regardless of individual-query failures — the
 * harness reports them, it doesn't gate CI (that's the truth-check's job).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  searchSerper,
  searchTavily,
  searchDuckDuckGo,
  availableSearchProviders,
  type SearchAdapter,
  type SearchResponse,
} from '../packages/tools/src/adapters/search/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outDir = resolve(repoRoot, 'docs/_generated');
const outFile = resolve(outDir, 'search-bench.json');

interface BenchQuery {
  query: string;
  intent: string;
  expectedDomains: string[];
}

interface QueryResult {
  query: string;
  intent: string;
  latencyMs: number;
  resultCount: number;
  expectedDomainHits: number;
  expectedDomainTotal: number;
  topUrls: string[];
  error?: string;
}

interface ProviderReport {
  provider: string;
  totalQueries: number;
  successfulQueries: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgResultCount: number;
  expectedDomainHitRate: number;
  failureRate: number;
  errors: Array<{ query: string; message: string }>;
  perQuery: QueryResult[];
}

const queriesPath = resolve(repoRoot, 'scripts/_bench/search-queries.json');
const queriesFile = JSON.parse(readFileSync(queriesPath, 'utf8')) as { queries: BenchQuery[] };
const queries = queriesFile.queries;

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx] ?? 0;
}

async function runProvider(name: string, adapter: SearchAdapter): Promise<ProviderReport> {
  const perQuery: QueryResult[] = [];
  const errors: Array<{ query: string; message: string }> = [];

  for (const q of queries) {
    const started = Date.now();
    let response: SearchResponse | null = null;
    let errorMessage: string | undefined;
    try {
      response = await adapter({ query: q.query, maxResults: 5, fetchContent: false });
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      errors.push({ query: q.query, message: errorMessage });
    }

    const latencyMs = Date.now() - started;
    const urls = response?.results.map((r) => r.url) ?? [];
    const hitDomains = new Set<string>();
    for (const url of urls) {
      const d = domainOf(url);
      if (!d) continue;
      for (const exp of q.expectedDomains) {
        if (d === exp || d.endsWith(`.${exp}`)) hitDomains.add(exp);
      }
    }

    perQuery.push({
      query: q.query,
      intent: q.intent,
      latencyMs,
      resultCount: response?.results.length ?? 0,
      expectedDomainHits: hitDomains.size,
      expectedDomainTotal: q.expectedDomains.length,
      topUrls: urls.slice(0, 3),
      ...(errorMessage && { error: errorMessage }),
    });
  }

  const successful = perQuery.filter((r) => !r.error);
  const latencies = successful.map((r) => r.latencyMs).sort((a, b) => a - b);
  const totalExpectedDomains = successful.reduce((acc, r) => acc + r.expectedDomainTotal, 0);
  const totalHits = successful.reduce((acc, r) => acc + r.expectedDomainHits, 0);
  const avgResultCount =
    successful.length > 0
      ? successful.reduce((acc, r) => acc + r.resultCount, 0) / successful.length
      : 0;

  return {
    provider: name,
    totalQueries: perQuery.length,
    successfulQueries: successful.length,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    avgResultCount,
    expectedDomainHitRate: totalExpectedDomains > 0 ? totalHits / totalExpectedDomains : 0,
    failureRate: perQuery.length > 0 ? (perQuery.length - successful.length) / perQuery.length : 0,
    errors,
    perQuery,
  };
}

async function main(): Promise<void> {
  const available = availableSearchProviders();
  // eslint-disable-next-line no-console
  console.log(`[bench-search] Running ${queries.length} queries across available providers:`);
  // eslint-disable-next-line no-console
  console.log(
    `  serper=${available.serper ? 'YES' : 'no'} · tavily=${available.tavily ? 'YES' : 'no'} · duckduckgo=always`,
  );

  const reports: ProviderReport[] = [];
  if (available.serper) reports.push(await runProvider('serper', searchSerper));
  if (available.tavily) reports.push(await runProvider('tavily', searchTavily));
  reports.push(await runProvider('duckduckgo', searchDuckDuckGo));

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        queryCount: queries.length,
        available,
        reports,
      },
      null,
      2,
    ) + '\n',
  );

  // Stdout summary — compact table.
  // eslint-disable-next-line no-console
  console.log('\n[bench-search] Summary:');
  // eslint-disable-next-line no-console
  console.log('  provider    | ok/tot | p50ms | p95ms | avgN | expDomHit | fail%');
  // eslint-disable-next-line no-console
  console.log('  ------------|--------|-------|-------|------|-----------|------');
  for (const r of reports) {
    // eslint-disable-next-line no-console
    console.log(
      `  ${r.provider.padEnd(11)} | ${String(r.successfulQueries).padStart(2)}/${String(r.totalQueries).padStart(2)}  | ${String(r.p50LatencyMs).padStart(5)} | ${String(r.p95LatencyMs).padStart(5)} | ${r.avgResultCount.toFixed(1).padStart(4)} | ${(r.expectedDomainHitRate * 100).toFixed(1).padStart(8)}% | ${(r.failureRate * 100).toFixed(1).padStart(4)}%`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(`\n[bench-search] Report: ${outFile}`);

  if (available.serper === false && available.tavily === false) {
    // eslint-disable-next-line no-console
    console.log(
      '\n[bench-search] NOTE: Only DuckDuckGo was benchmarked. Set SERPER_API_KEY / TAVILY_API_KEY to compare production-grade providers.',
    );
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[bench-search] Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
