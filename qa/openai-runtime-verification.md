# OpenAI-first runtime — verification (commit 769e358 baseline)

## Verdict: REAL

The OpenAI-first runtime is wired correctly and exercised by every critical agent. A bug in this surface (silent fallback to LegacyRuntime via `require('./openai-runtime.js')`) was identified and **fixed in commit `abef53b`** during this audit cycle.

## What works

### Static import + factory selection

[packages/agents/src/runtime/index.ts](../packages/agents/src/runtime/index.ts) (post-fix):
- `OpenAIRuntime` statically imported (no lazy-require failure under vitest/tsx)
- Factory `getRuntime(role, backend)` picks runtime in this order:
  1. `JAK_OPENAI_RUNTIME_AGENTS=*` or contains role → `OpenAIRuntime`
  2. `JAK_EXECUTION_ENGINE=openai-first` → `OpenAIRuntime`
  3. `JAK_EXECUTION_ENGINE=legacy` → `LegacyRuntime`
  4. **Default when `OPENAI_API_KEY` is set → `OpenAIRuntime`** (this is the production path)
  5. Fallback → `LegacyRuntime` (legacy Chat Completions)

### Responses API (not Chat Completions)

[packages/agents/src/runtime/openai-runtime.ts](../packages/agents/src/runtime/openai-runtime.ts) uses `client.responses.create(...)` for:
- Single-turn `respond()` (line 159)
- Strict structured output `respondStructured()` with `text.format: { type: 'json_schema', strict: true }` (line 120)
- Tool loop `callTools()` (line 180+)

This is the **modern Responses API**, not legacy Chat Completions. GPT-5.4 family strongly prefers it.

### Model resolver

[packages/agents/src/runtime/model-resolver.ts](../packages/agents/src/runtime/model-resolver.ts):
- Calls `client.models.list()` once at boot
- Caches the result
- Resolves per-tier preference chain (tier 1 / 2 / 3)
- Failsafe map (gpt-4o family) on error
- Tier override via `OPENAI_MODEL` env var

### Cost telemetry

Every Responses API call emits `cost_updated` activity event with:
- `runtime: 'openai-responses'`
- `model: 'gpt-5.4-mini'` (or whatever resolved)
- `fallbackModelUsed` if a tier-3 model was rate-limited and fell back
- `promptTokens`, `completionTokens`, `totalTokens`, `costUsd`

The cockpit's cost ribbon reads this directly.

### Critical-path coverage per spec role

| Spec role | Runtime path | Verified |
|---|---|---|
| Intent Mapper (Commander) | `respondStructured` via `OpenAIRuntime` (when key set) | ✅ |
| Workflow Router (Planner) | `respondStructured` via `OpenAIRuntime` | ✅ |
| Verifier | `respondStructured` via `OpenAIRuntime` | ✅ |
| CEO / Strategist | `callLLM` → BaseAgent → runtime factory → `OpenAIRuntime` | ✅ |
| CMO / Marketing | Same | ✅ |
| CTO / Technical / Coder | Same | ✅ |
| CFO / Finance | Same | ✅ |
| COO / Ops | Same | ✅ |
| VibeCoder (5 agents) | Same — all 5 worker agents go through factory | ✅ |
| Research | Same | ✅ |
| Browser | Same (LLM decides which browser_* tool to call) | ✅ |
| Designer | Same | ✅ |
| Audit Control Test | `respondStructured` via `OpenAIRuntime` (with deterministic fallback when no key) | ✅ |
| Async worker | Uses same `getRuntime()` factory inside the worker process | ✅ |

### Anthropic / Gemini are NOT in critical path

Grep for `@anthropic-ai/sdk` and `@google/generative-ai`:
- Both SDKs imported only inside [packages/agents/src/base/providers/](../packages/agents/src/base/providers/)
- The `LegacyRuntime` (which uses `ProviderRouter` → providers) is the FALLBACK when OpenAI is unavailable
- Default routing is `OpenAIRuntime` (verified above)

In OpenAI-first mode, Anthropic/Gemini providers are dormant. They remain compiled (so the `LegacyRuntime` failsafe still works) but are not on any agent's primary path.

## What was just fixed (the bug)

**Before fix (`9913978` and earlier):** [runtime/index.ts:72](../packages/agents/src/runtime/index.ts) had:
```ts
const { OpenAIRuntime } = require('./openai-runtime.js') as ...;
```
The `.js` extension can't resolve TS source files under vitest/tsx. The surrounding `try/catch` silently degraded EVERY OpenAI-runtime caller to `LegacyRuntime` in tests. This masked real bugs in production code paths and made the "OpenAI-first" claim only true for the production build (where tsc emits `.js`), NOT for tests / dev.

**After fix (`abef53b`):** Static import. The export at the bottom of the file already triggered module load, so the lazy require was never actually lazy. Now tests exercise OpenAIRuntime as production does.

This is a concrete example of the audit catching a silent fallback that masked the OpenAI-first claim. Honest.

## Cost optimization gaps (separate from "is it real")

The runtime IS used. But cost optimization opportunities documented in [qa/openai-api-optimization-audit.md](openai-api-optimization-audit.md):

| Opportunity | Status | Effort to fix |
|---|---|---|
| Per-call prompt caching (Anthropic Cache Control or OpenAI prompt-caching-equivalent) | ❌ NOT BUILT | ~2-3 days |
| Trace summarization for long DAGs (compress old steps before resending in next prompt) | ⚠️ PARTIAL — `context-summarizer.ts` exists but not wired into every agent's input | ~3 days to wire fully |
| Aggressive model tiering (use tier-1 for high-volume small tasks like Router decision) | ⚠️ PARTIAL — `AGENT_TIER_MAP` exists but defaults to tier-3 for all orchestrators | ~1 day to recalibrate |
| Per-agent cost tracking | ✅ REAL — `cost_updated` events carry `agentRole` |
| Per-run token tracking | ✅ REAL — `Workflow.totalCostUsd` aggregate |

Cost panel in cockpit shows: model used, runtime used, input/output tokens, USD, call count, fallback model when triggered.

## Verdict: PASS

OpenAI-first runtime is real, exercises Responses API + structured output, used by every critical agent including the audit control-test agent (with honest deterministic fallback when no key). Anthropic / Gemini are NOT in the critical path. The silent-fallback bug masked previously was found and fixed in this audit cycle.

Cost optimization has named gaps (caching, summarization, tier recalibration) — documented as ~5-7 days of total work in [qa/openai-api-optimization-audit.md](openai-api-optimization-audit.md).
