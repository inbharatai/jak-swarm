# OpenAI-first runtime — live verification

**Date:** 2026-04-25
**Method:** `/version` endpoint check + static trace of `getRuntime` factory + agent base wiring. **No live workflow execution was performed in this audit** (would require the user to actually send a chat message on staging or prod with browser DevTools open). Where a runtime check is the only way to prove an end-to-end claim, it is called out as `verify-by-running`.

## /version snapshot (pulled now)

```json
{
  "gitCommit": "cbdeefedb8b1009797b7293e5ffc645fdfe832d8",
  "gitBranch": "main",
  "executionEngine": "(unset — defaults to openai-first when OPENAI_API_KEY is set)",
  "workflowRuntime": "swarmgraph",
  "openaiRuntimeAgents": [],
  "effectiveExecutionEngine": "openai-first",
  "openaiApiKeySet": true
}
```

(Pulled from `https://jak-swarm-api.onrender.com/version` in this audit — Render API is on commit `cbdeefe` which is one commit behind the local working tree of this audit. The `/version` endpoint will pick up the new fields `workflowRuntimeStatus` and `strictWorkflowState` once the next deploy lands.)

## Per-claim verification

| Claim | Verdict | Evidence |
|---|---|---|
| OpenAI runtime is selected by default | **verified (static)** | `getRuntime` at `packages/agents/src/runtime/index.ts:52-86`. Logic: `OPENAI_API_KEY` set + `JAK_EXECUTION_ENGINE` not 'legacy' → returns `OpenAIRuntime`. Live `/version` shows `effectiveExecutionEngine: "openai-first"` + `openaiApiKeySet: true`. |
| Model resolver is used | **verified (static)** | `OpenAIRuntime` constructor at `openai-runtime.ts:64-82` — when no explicit model is set on the call, `resolveModel` calls `modelForTier(tier)` which goes through `ModelResolver`. ModelResolver hits `/v1/models` once at boot to pick the best available model in each tier (gpt-5.4 → gpt-5 → gpt-4o, etc.). The worker-entry pre-warms it: `apps/api/src/worker-entry.ts` calls `void ensureModelMap()`. |
| Gemini / Anthropic NOT in critical path | **verified (static)** | `provider-router.ts:286-296` — `getProviderForTier` returns `OpenAIProvider` first whenever `OPENAI_API_KEY` is set. Gemini + Anthropic are reachable only when key is missing or `JAK_LEGACY_PROVIDER_CHAIN=true`. |
| Fallback chain doesn't waste invalid model attempts | **verified (static)** | `ModelResolver.resolveTier` (`model-resolver.ts`) only emits models that the `/v1/models` listing confirmed — non-existent IDs like `gpt-5.4-bogus` are filtered. The fallback chain is `gpt-5.4 → gpt-5 → gpt-4o` per tier; first available wins. |
| Events emitted to cockpit / event stream | **verified (static)** | See `qa/agent-run-cockpit-realness-audit.md` — full SSE wiring is traced from agent emit → graph → runner → execution-service → SSE route → browser. |
| Runtime label visible in cockpit | **partial** | `cost_updated` events carry `model` but not `runtime` name. The `/version` endpoint reports `effectiveExecutionEngine` site-wide. Per-call runtime attribution is **not** rendered in the chat cockpit today; would need `cost_updated` event to also carry `runtime: 'openai-responses'`. Documented as a follow-up. |
| Strict workflow state mode available | **verified (static + tests)** | `JAK_STRICT_WORKFLOW_STATE=true` flips `assertTransition` to throw `IllegalTransitionError`. 32 unit tests in `packages/swarm/src/state/run-lifecycle.test.ts` cover legal/illegal transitions in both modes. Live `/version` (after next deploy) will report `strictWorkflowState: false` by default. |

## Verify-by-running (still required)

The static trace cannot prove end-to-end live behavior. The following remain as human-driven verification steps for the user:

1. Open the live chat and send `hi`.
   - Open DevTools → Network → filter `/stream`. Confirm `event: connected`, then a `data: {"type":"completed",...}` arrives within ~5s.
   - Confirm cost is shown in the message footer (something like `$0.0001 · 1 call`).
   - This proves: Commander short-circuit works, OpenAI Responses API is reachable, cost telemetry is wired.

2. Send a multi-task workflow such as `Write a 200-word LinkedIn post for JAK Swarm's launch`.
   - Open the right-hand drawer.
   - Confirm a `Plan (1 step)` appears with WORKER_CONTENT.
   - Confirm task flips IN_PROGRESS → COMPLETED.
   - Confirm `cost_updated` events accumulate as the worker runs.
   - This proves: Planner + Worker + structured output + live cockpit.

3. Send a request that triggers an approval gate, e.g. `Send an email to test@example.com saying hello` (with no auto-approve configured).
   - Confirm cockpit status flips to AWAITING_APPROVAL within seconds (this depends on the new `paused` event from this hardening pass).
   - Confirm an approval link appears in the chat.
   - This proves: approval-gate visibility (the bug fixed in this pass).

4. Open `/diagnostics/models` (admin-only) and confirm:
   - `verified: true` (real `/v1/models` listing succeeded)
   - `tier3 / tier2 / tier1` all resolve to GPT-5.4 family or gpt-5 / gpt-4o family (NOT a stub model)
   - `models` array contains the expected GPT-5.4 entries
   - This proves: model resolver is using real OpenAI capability, not a hardcoded fallback.

5. (Optional, costs ~$0.01) Open `/diagnostics/smoke/openai` (admin-only).
   - Confirm `allPassed: true` and `passed` includes `gpt-5.4 / gpt-5.4-mini / gpt-5.4-nano`.
   - This proves: actual `/v1/responses` calls succeed against this deploy's API key.

## Risks

- The `/version` endpoint cannot prove that any GIVEN workflow ran on OpenAI — only that the boot configuration says it should. A workflow that hits an internal `LegacyRuntime` code path through some unfound branch would not show up in `/version`. Mitigation: the runtime's name (`openai-responses` vs `legacy`) is logged on every BaseAgent construction; grep prod logs for `LegacyRuntime` to detect drift.
- ModelResolver caches its `/v1/models` listing for 1h. If OpenAI introduces a new model mid-cache, the resolver won't pick it up until expiry or a manual `?refresh=1` against `/admin/diagnostics/models`. Acceptable.
