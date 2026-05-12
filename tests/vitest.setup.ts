/**
 * vitest.setup.ts — runs once per worker before any test file.
 *
 * Why this exists: BaseAgent's constructor instantiates the OpenAI client
 * (`new OpenAI({ apiKey })`) which throws when the key is missing or empty
 * — even if the test never makes a real API call. Without a setup file,
 * 24 test files that import anything that constructs a BaseAgent fail at
 * import time with `OPENAI_API_KEY environment variable is missing`.
 *
 * What this DOES:
 *   - Sets a placeholder OPENAI_API_KEY that satisfies the SDK constructor
 *     ONLY IF one is not already set (so a real key in the env wins).
 *   - Marks NODE_ENV as 'test' so any code that branches on it sees the
 *     correct mode.
 *
 * What this does NOT do:
 *   - Does NOT fake any other secret (no DATABASE_URL, no REDIS_URL,
 *     no AUTH_SECRET) — tests that genuinely need DB/Redis still need a
 *     real connection or their own per-test mock.
 *   - Does NOT bypass any production validation. The constructor accepts
 *     the placeholder string; calls to api.openai.com will fail loudly
 *     (which is correct — tests that need a real model call should mock
 *     the provider boundary).
 *
 * Safety: the sentinel format `sk-test-not-real-do-not-use-...` is
 * obviously fake and matches no live key shape used by OpenAI in
 * production. It cannot accidentally authenticate against a real account.
 */

const placeholders: Record<string, string> = {
  OPENAI_API_KEY: 'sk-test-not-real-do-not-use-vitest-placeholder-only-000000000000000000',
  NODE_ENV: 'test',
  // Suppress noisy module-load console.warn in @jak-swarm/tools that
  // fires every time the package is imported. Production deploys still
  // see the warning at boot.
  JAK_TOOLS_QUIET: '1',
};

for (const [key, value] of Object.entries(placeholders)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

// Bump the EventEmitter max-listeners cap on `process`. Vitest spawns
// multiple workers; each worker imports a chunk of our 137 test files,
// and several of our dependencies (Prisma query engine, OpenAI client,
// Playwright, Pino) register their own SIGINT/SIGTERM/exit hooks. With
// the default cap of 10 we routinely tripped MaxListenersExceededWarning
// in CI logs even though nothing was leaking — every hook is legitimate.
// Bumping to 100 absorbs the legitimate listeners while still being
// well below any actual leak threshold.
//
// PRODUCTION CODE must not rely on this — the API server keeps the
// default cap so a real leak still surfaces.
process.setMaxListeners(100);
