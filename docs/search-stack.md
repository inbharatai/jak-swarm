# Search Stack

JAK's web-search layer uses a **three-provider strategy chain** behind a single
tool (`web_search`). Callers don't need to know which provider answered; each
provider adapter normalises its response to the same shape.

## Provider chain (priority order)

| Tier | Provider | Env var | When it runs | Quality | Cost |
|---|---|---|---|---|---|
| 1 | **Serper** (google.serper.dev) | `SERPER_API_KEY` | Always, if key set | Google-grade: organic + knowledge graph + answer box | ~$0.30 per 1k queries |
| 2 | **Tavily** (api.tavily.com) | `TAVILY_API_KEY` | If Serper fails transiently OR if no Serper key | Research-oriented with answer synthesis | ~$1 per 1k queries (free tier available) |
| 3 | **DuckDuckGo HTML scrape** | none (free) | Always last in chain | Heuristic — brittle to markup changes, no answer box | $0 |

The chain lives at [`packages/tools/src/adapters/search/index.ts`](../packages/tools/src/adapters/search/index.ts).

## Failure policy

Errors are classified (same taxonomy as `provider-router.ts`):

| Error kind | Behavior |
|---|---|
| `rate_limit` (429) | Fail over to next provider |
| `server_error` (5xx) | Fail over |
| `timeout` | Fail over |
| `auth_error` (401/403) | **Fail fast** — don't mask a bad key behind DDG |
| `bad_request` (400) | **Fail fast** — next provider won't fix a malformed query |
| "not configured" | Silent skip (adapter signals the key is absent) |

Rationale: silently demoting to DDG on an `auth_error` would mask a revoked
or misconfigured production key. The fail-fast policy surfaces real misconfig
loudly while letting transient failures fail over cleanly.

## Honest naming

**There is no branded "Ducky Duck" crawler product in this repo.** The
DuckDuckGo path is an HTML scrape against `html.duckduckgo.com/html/` —
zero-cost, no key, but also lower quality and more brittle than Serper or
Tavily. Keeping it as the free-tier fallback is a deliberate dev-
friendliness choice; it is NOT marketed as a distinct product.

The CI truth-check (`pnpm check:truth`) fails on any `Ducky Duck` /
`DuckyDuck` reference in README or landing copy.

## Benchmark harness

`scripts/bench-search.ts` runs a fixed 30-query set through every available
provider and reports latency (p50 / p95), result count, expected-domain hit
rate, and failure rate. Emits `docs/_generated/search-bench.json` (gitignored).

```bash
pnpm bench:search
```

Requires at least one of `SERPER_API_KEY` / `TAVILY_API_KEY` to exercise the
paid tiers — DuckDuckGo is benchmarked unconditionally. When only DuckDuckGo
is available the harness still runs and reports its results alone.

Queries live at `scripts/_bench/search-queries.json` — 30 hand-curated
queries across four intent classes: `informational`, `navigational`,
`technical_deep`, `comparison`, plus a `freshness_sensitive` bucket.

## Adapter contract

Each provider exports a `SearchAdapter` conforming to:

```ts
(opts: SearchOptions) => Promise<SearchResponse>
```

Where `SearchResponse` is a normalised shape with `results[{title, url,
content, relevanceScore}]`, `source`, `query`, optional `answer`, and a
`resultCount`. See [`types.ts`](../packages/tools/src/adapters/search/types.ts).

Adding a fourth provider (e.g. Brave Search via MCP, already available in
`mcp-providers.ts`) means writing a 50-line adapter that returns
`SearchResponse` and registering it in the strategy chain.

## Internal call sites

The registry has 17 internal tools that use DuckDuckGo directly via the
legacy helper `searchDuckDuckGoLegacy(query, n)` — CRM enrichment, deal
search, SERP analysis, social monitoring. They preserve the legacy
`{title, url, snippet}` shape to avoid a 19-site rewrite. New code should
prefer the full adapter contract (`searchDuckDuckGo` returning
`SearchResponse`).
