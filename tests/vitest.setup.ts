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
 *   - Same for ANTHROPIC_API_KEY (used by the optional Anthropic provider
 *     in some unit tests that exercise multi-provider routing).
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
  ANTHROPIC_API_KEY: 'sk-ant-test-not-real-do-not-use-vitest-placeholder-only-0000000000',
  NODE_ENV: 'test',
};

for (const [key, value] of Object.entries(placeholders)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
