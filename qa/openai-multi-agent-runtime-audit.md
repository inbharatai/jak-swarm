# OpenAI Multi-Agent Runtime Audit (Phase 4)

Verified at commit `c2fb125`. Static + tests-based audit; live-API
verification noted explicitly.

---

## 1. Architecture

```
BaseAgent.executeWithTools / respondStructured / callLLM
  ↓
LLMRuntime interface (packages/agents/src/runtime/llm-runtime.ts)
  ├─ OpenAIRuntime  ← default + only one wired in critical path
  └─ LegacyRuntime  ← still compiled, only used when an agent's role
                      isn't in JAK_OPENAI_RUNTIME_AGENTS allowlist
```

**Default runtime:** OpenAI Responses API.

**Critical-path verification:**
- `packages/agents/src/runtime/openai-runtime.ts` — `client.responses.create()` (line 120, 159, 221) — uses Responses API, NOT chat.completions.
- Structured output: `text.format.type: 'json_schema'` with `strict: true` (line 124–129).
- Tool loop: native function-call tool format adapted from ChatCompletionTool
  via `adaptChatToolsToResponses()` (line 187).

✅ **Responses API used everywhere.** No fallback to legacy chat.completions
in the OpenAI runtime path.

---

## 2. Model resolver

`packages/agents/src/runtime/model-resolver.ts`:
- Calls `client.models.list()` ONCE at boot, caches result (lines 17–25 of docblock).
- Per-tier preferred chains (line 73–78):
  - Tier 3: `gpt-5.4` → `gpt-5` → `gpt-4o`
  - Tier 2: `gpt-5.4-mini` → `gpt-5-mini` → `gpt-4o-mini`
  - Tier 1: `gpt-5.4-nano` → `gpt-5-nano` → `gpt-4o-mini`
- Failsafe map when capability check fails: `gpt-4o` / `gpt-4o-mini` / `gpt-4o-mini`
  (lines 83–88) — fails OPEN, NEVER bricks.
- Operator override: `OPENAI_MODEL` (global) and `OPENAI_MODEL_TIER_1/2/3`
  (per-tier).

**Tests:** `tests/unit/agents/model-resolver.test.ts` — verifies:
- Default failsafe when no API key
- Preferred-model selection when capability list contains it
- Fallback to next preferred when first not in list
- Per-tier env-var override

---

## 3. Per-agent tier mapping

`packages/agents/src/base/provider-router.ts:161` — `AGENT_TIER_MAP`
records per-role tier:
- Tier 3 (premium reasoning): COMMANDER, PLANNER, VERIFIER, WORKER_STRATEGIST,
  WORKER_APP_ARCHITECT
- Tier 2 (balanced): WORKER_CODER, WORKER_DESIGNER, WORKER_MARKETING,
  WORKER_RESEARCH, WORKER_BROWSER, WORKER_LEGAL
- Tier 1 (cheap+fast): WORKER_EMAIL, WORKER_CALENDAR, WORKER_CRM,
  WORKER_HR, classifier-style helpers
- Default for unmapped roles: tier 2 (line 215)

✅ Every agent gets a deterministic tier; no random selection.

---

## 4. Gemini / Anthropic in critical path?

`grep` for `gemini`, `anthropic`, `claude` in provider-router.ts:

```ts
if (!legacyChain && available.openai) {
  const p = tryCreate(() => new OpenAIProvider(undefined, undefined, { tier }));
  if (p) return p;
}
```

**Default branch only enters non-OpenAI providers when OPENAI_API_KEY is
absent.** With key set:
- Tier 1: never falls through to Gemini/Anthropic
- Tier 2: never falls through
- Tier 3: never falls through

Without OPENAI_API_KEY:
- Tier 1: ollama → deepseek → openrouter → gemini → tier 2 fallbacks
- Tier 2: gemini → anthropic → deepseek → openrouter → ollama → OpenAI (which will fail honestly)
- Tier 3: anthropic → gemini → ...

`JAK_LEGACY_PROVIDER_CHAIN=true` is the documented break-glass to restore
multi-provider routing. **Production default = OpenAI-only.**

**Honest classification:** Gemini + Anthropic adapters compile and are
reachable ONLY when OpenAI is unavailable OR break-glass env is set.
**Not in default critical path.** Verdict: ✅ honest deferral, not a leak.

---

## 5. Structured output

`OpenAIRuntime.respondStructured` (line 102–150):
- Converts zod schema → JSON Schema via `zod-to-json-schema`
- Sends as `text.format.type: 'json_schema'` with `strict: true`
- Parses response, validates with zod
- Throws explicit error when JSON parse fails — does NOT silent-fallback

✅ Structured output enforced at the model layer + zod validation on top.

**Tests:** `tests/unit/agents/json-parse-tolerance.test.ts` covers the
parse-failure path. `tests/unit/agents/role-behavioral.test.ts` and
`tests/unit/agents/role-behavioral-extended.test.ts` cover specific
agents (Email, CRM, Research, Calendar, AppDeployer, AppArchitect)
producing structured output.

---

## 6. Tool calling

`OpenAIRuntime.callTools` (line 180–309):
- Adapts ChatCompletionTool[] → Responses tool spec
- Loops: call → execute tool calls (via TenantToolRegistry) → append → repeat
- Per-iteration cost tracking (line 230–238):
  ```ts
  const cached = resp.usage.input_tokens_details?.cached_tokens ?? 0;
  totalCostUsd += calculateCost(resp.model, prompt, completion, cached);
  ```
- `MAX_TOOL_LOOP_ITERATIONS_DEFAULT = 5` — bounded loop
- Tool execution comes from caller's context (TenantToolRegistry) — runtime
  itself never invokes a tool

✅ Bounded loop, cached-token-aware cost, tenant-scoped tool execution.

---

## 7. Token + cost tracking

`packages/agents/src/runtime/openai-response-parser.ts:107–124`:
- `_jakCachedInputTokens`: from `response.usage.input_tokens_details.cached_tokens`
- `_jakReasoningTokens`: from `response.usage.output_tokens_details.reasoning_tokens`
- Both surfaced to `BaseAgent.executeWithTools` for the `cost_updated` activity event

`packages/shared/src/constants/llm-pricing.ts:99–138`:
- `calculateCost(model, prompt, completion, cachedTokens?)`
- Discounts cached tokens at 50% (default) or `cachedInputPer1M` when
  set explicitly (gpt-5.4: $5/$0.50, gpt-4o: $2.50/$1.25)
- Defensive clamp: `cachedTokens > promptTokens` → clamps to promptTokens
- One-time warn for unknown models with non-zero usage

**Tests:** 3 `calculateCost` tests in `tests/unit/agents/agent-execution-behavioral.test.ts`
including the clamp + discount logic.

---

## 8. Retry behavior

- BaseAgent direct path: `LLM_MAX_RETRIES` constant + per-retry log
  (base-agent.ts ~line 384)
- Errors wrapped via `executeGuarded` in `packages/swarm/src/coordination/`
- Per-task verifier-retry (max 2) via `verifier-node.ts`
- Repair service (Final hardening / Gap B): error classifier + backoff

✅ Multi-layer retry: LLM-call retry, verifier-retry, repair-service decision.

---

## 9. Logging + diagnostics

`packages/agents/src/base/base-agent.ts:382-401` — `[BaseAgent.callLLM]`
logs at debug level: model, tokens, costUsd, finishReason.

`apps/api/src/routes/admin-diagnostics.routes.ts` — admin diagnostic
endpoint exists; surface for ops.

`packages/agents/src/runtime/smoke-test.ts` — runtime smoke test exists
(structural check).

---

## 10. Error handling

| Layer | Behavior |
|---|---|
| Model resolver capability check | Fails OPEN → failsafe gpt-4o map |
| OpenAIRuntime structured output JSON parse | Throws explicit error |
| OpenAIRuntime tool loop | Bounded iterations; tool errors captured per-tool-call |
| BaseAgent | Throws `[role] No OPENAI_API_KEY...` when no key (no fake response) |
| Provider router | Returns OpenAIProvider which fails with helpful error if no key + no fallback |

✅ Honest failure paths everywhere.

---

## 11. Env flags verified

`JAK_EXECUTION_ENGINE` — config.ts validates at boot
`JAK_OPENAI_RUNTIME_AGENTS` — comma-separated allowlist; per-agent
`JAK_LEGACY_PROVIDER_CHAIN` — break-glass for multi-provider routing
`OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` — standard

---

## 12. Tests run for runtime

- `tests/unit/agents/model-resolver.test.ts` — 7 tests
- `tests/unit/agents/agent-execution-behavioral.test.ts` — 13 tests (incl. cost cache clamp)
- `tests/unit/agents/agent-context.test.ts` — N tests
- `tests/unit/agents/base-agent-provider-routing.test.ts` — N tests
- `tests/unit/agents/json-parse-tolerance.test.ts` — N tests
- `tests/unit/agents/provider-error-taxonomy.test.ts` — N tests
- `tests/unit/agents/provider-router-failover.test.ts` — N tests
- `tests/unit/agents/role-behavioral.test.ts` — 8 tests
- `tests/unit/agents/role-behavioral-extended.test.ts` — N tests

All pass within the 751/751 baseline.

---

## 13. NEEDS RUNTIME (live verification)

The following can ONLY be verified against a live OPENAI_API_KEY (out of scope for this audit):
- Actual model selection at runtime (model resolver works against fake list in tests)
- Live structured-output JSON validity from Responses API
- Cache hit ratios (`cached_tokens > 0`) for repeated prompts
- Real fallback to gpt-4o family when GPT-5.4 unavailable
- End-to-end tool-loop on a real prompt

Recommendation: an operator running `pnpm exec tsx packages/agents/src/runtime/smoke-test.ts`
with a real key would close these last verifications.

---

## 14. Issues / risks

1. **Tier 2/3 fallback to `gpt-4o-mini` for tier 1 last-resort** — if
   GPT-5.4 family vanishes AND GPT-5 family vanishes AND GPT-4o-mini
   isn't in the org's available models, system uses gpt-4o for tier 1
   too (cost rises silently). Mitigation: model-resolver logs the
   resolved map at boot.
2. **`MAX_TOOL_LOOP_ITERATIONS_DEFAULT = 5`** — for complex multi-tool
   tasks this may be too low. The legacy executeWithTools path uses
   `maxIterations = 10` (base-agent.ts). The two diverge — may surprise
   operators who set tier-aware limits.
3. **No prompt-cache hit ratio metric in admin diagnostics.** Token
   breakdown is in the `cost_updated` event but operators have to
   stitch it themselves.

---

## 15. Rating

**OpenAI multi-agent runtime: 8.5 / 10**

- ✅ Real Responses API
- ✅ Real structured output with zod validation
- ✅ Bounded tool loop, cached-token-aware cost
- ✅ Per-tier model resolution with capability check + failsafe
- ✅ Per-agent tier map
- ✅ Honest failure paths (no fake responses)
- ✅ Gemini/Anthropic OUT of default critical path
- ✅ Tests covering model resolver, structured output, cost calculation,
  provider routing, role behaviors

**Why not 10/10:**
- Live-API verification not done in this session (NEEDS RUNTIME)
- Tool-loop iteration limit divergence (5 vs 10) between OpenAIRuntime
  and BaseAgent legacy path
- No admin-diagnostics surface for prompt-cache hit ratio

These are POLISH items, not correctness gaps. The runtime itself is
production-grade.
