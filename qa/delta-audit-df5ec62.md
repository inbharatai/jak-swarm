# JAK Swarm — Delta audit: GPT-5.4 family + ModelResolver + OpenAI-first default

**Scope:** Focused delta against commit `df5ec62` (current `main`). Limited to the 6 areas the user asked for, NOT a full re-audit.
**Baseline:** `qa/post-fix-live-delta-report.md` against commit `833fae1` / `e25c835`.
**Prior artifacts:** `qa/a-to-z-product-evaluation.md`, `qa/feature-readiness-matrix.md`, `qa/bug-list.md`, `qa/implementation-gap-plan.md`.

## Focus areas (per user brief)

| # | Area | Verdict | What changed in df5ec62 |
|---|---|---|---|
| 1 | Model routing | ✓ resolver-driven | New `ModelResolver` picks GPT-5.4 / GPT-5 / GPT-4o family per tier based on capability check |
| 2 | OpenAI runtime activation | ✓ default-on | `getRuntime()` now returns `OpenAIRuntime` by default when `OPENAI_API_KEY` is set (was: only if `JAK_EXECUTION_ENGINE=openai-first` or `JAK_OPENAI_RUNTIME_AGENTS=*`) |
| 3 | Gemini/Anthropic removal from critical path | ✓ already done (Phase 7 commit `662e02c`); this commit does not reintroduce | `AGENT_TIER_MAP` / `getProviderForTier` still prefer OpenAI; Gemini + Anthropic remain compiled but not in the default chain |
| 4 | Fallback correctness | ✓ hardened | OpenAIProvider fallback chain now 10 models deep: resolver-pick → OPENAI_FALLBACK_MODEL → gpt-5.4 → gpt-5.4-mini → gpt-5 → gpt-5-mini → gpt-4o → gpt-4o-mini → gpt-4-turbo → gpt-3.5-turbo |
| 5 | Prod env flags | (no code change required) | Operator can now set `OPENAI_MODEL_TIER_{1,2,3}` to hard-pin per tier; `JAK_EXECUTION_ENGINE=openai-first` is no longer required because it's the code default |
| 6 | Planner 404 root cause | ✓ multi-layer defence | (a) resolver only picks models the API key has access to, (b) if resolver failed the failsafe map uses gpt-4o family, (c) if even the first-attempt model 404s at call time, the OpenAIProvider cycles through 9 more candidates before giving up, (d) if the workflow still fails the user sees the REAL error + which model+baseURL was attempted |

## What shipped

### 1. ModelResolver (`packages/agents/src/runtime/model-resolver.ts`)

- **One-time capability check:** calls `client.models.list()` at boot, caches the result for the process lifetime.
- **Per-tier resolution:** picks the first available model from a preference chain:
  - Tier 3 (premier — Commander / Planner / Verifier / Architect / Strategist): `gpt-5.4` → `gpt-5` → `gpt-4o`
  - Tier 2 (balanced — Coder / Research / Designer / Marketing / Browser): `gpt-5.4-mini` → `gpt-5-mini` → `gpt-4o-mini`
  - Tier 1 (fast+cheap — Email / Calendar / CRM / Document / helpers): `gpt-5.4-nano` → `gpt-5-nano` → `gpt-4o-mini`
- **Env overrides** (reversible): `OPENAI_MODEL_TIER_1`, `OPENAI_MODEL_TIER_2`, `OPENAI_MODEL_TIER_3` hard-pin a specific model per tier.
- **Fails open:** if `/v1/models` fails (network, auth, missing key), the resolver returns a **failsafe map** (gpt-4o family) so the system stays usable. Never throws.
- **Startup logs** (grep `[ModelResolver]`):
  ```
  [ModelResolver] Capability check OK. 42 models accessible to this key.
  [ModelResolver]   Tier 3 (premier   — Commander/Planner/Verifier/Architect/Strategist): gpt-5.4 [preferred]
  [ModelResolver]   Tier 2 (balanced  — Coder/Research/Designer/Marketing/Browser):       gpt-5.4-mini [preferred]
  [ModelResolver]   Tier 1 (fast+cheap — Email/Calendar/CRM/Document/helper tasks):       gpt-5.4-nano [preferred]
  ```
- **Loud warning** when GPT-5.4 family absent:
  ```
  [ModelResolver] No GPT-5.4 family models available to this API key. Resolution fell back to GPT-5 / GPT-4o family. If you expect GPT-5.4 access, check (a) the project-scoped key has the model entitlement, (b) OPENAI_BASE_URL points at api.openai.com, (c) the org has been granted access by OpenAI.
  ```

### 2. OpenAIRuntime now default (`packages/agents/src/runtime/index.ts`)

Selection order:

1. `JAK_OPENAI_RUNTIME_AGENTS=*` → OpenAIRuntime for every agent
2. `JAK_OPENAI_RUNTIME_AGENTS` contains the role name → OpenAIRuntime for that role
3. `JAK_EXECUTION_ENGINE=openai-first` → OpenAIRuntime for every agent
4. `JAK_EXECUTION_ENGINE=legacy` (explicit opt-out) → LegacyRuntime
5. **NEW default:** when `OPENAI_API_KEY` is set → OpenAIRuntime (Responses API)
6. Otherwise → LegacyRuntime (Chat Completions via OpenAIProvider)

**Safety:** OpenAIRuntime construction is wrapped in try/catch. If it fails (missing key edge case, SDK mismatch), the factory falls back to LegacyRuntime and logs a warning. Agent construction never throws.

### 3. Admin diagnostics endpoints (`apps/api/src/routes/admin-diagnostics.routes.ts`)

- `GET /admin/diagnostics/models` (admin-only) — returns the resolved map, full list of models the API key can access, preference chains per tier, and every relevant env var value. `?refresh=1` forces re-fetch.
- `POST /admin/diagnostics/smoke/openai` (admin-only) — runs a minimal `/v1/responses` call against each GPT-5.4 variant the key has access to. Returns pass/fail + latency + response sample per model. Confirms the full Responses-API path works, not just `/v1/models`.

### 4. Boot-time capability warmup (`apps/api/src/index.ts`)

`ensureModelMap()` is called at app start (non-blocking, `void ensureModelMap().catch(...)`). First real LLM call hits a pre-verified model; first-request latency isn't burdened by the capability check. Failure is logged but never breaks boot.

### 5. OpenAIProvider hardening (`packages/agents/src/base/providers/openai-provider.ts`)

- First-attempt model now resolver-derived per tier when no explicit override is set.
- Extended fallback chain (10 models):
  ```
  firstAttempt → OPENAI_FALLBACK_MODEL → gpt-5.4 → gpt-5.4-mini → gpt-5 → gpt-5-mini
   → gpt-4o → gpt-4o-mini → gpt-4-turbo → gpt-3.5-turbo
  ```
- Error messages include the base URL + full attempted chain so operators can diagnose `404 (no body)` pointing at the wrong proxy.

## How to verify in prod (post-deploy)

### Step 1: Confirm deploy landed
```bash
curl https://jak-swarm-api.onrender.com/version | jq
# Expect gitCommit: "df5ec62..."
```

### Step 2: Read the resolved model map
```bash
# As an admin user:
curl -H "Authorization: Bearer $JWT" https://jak-swarm-api.onrender.com/admin/diagnostics/models | jq
```

Expected shape:
```json
{
  "success": true,
  "data": {
    "resolved": { "tier3": "gpt-5.4", "tier2": "gpt-5.4-mini", "tier1": "gpt-5.4-nano" },
    "verified": true,
    "modelsAvailable": 42,
    "models": ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "..."],
    "env": {
      "OPENAI_API_KEY_set": true,
      "OPENAI_BASE_URL": null,
      "JAK_EXECUTION_ENGINE": "(default — openai-first when key present)"
    }
  }
}
```

If `verified: false`, check the `env` block for misconfigured base URL or missing key.

### Step 3: Run the Responses-API smoke test
```bash
curl -X POST -H "Authorization: Bearer $JWT" https://jak-swarm-api.onrender.com/admin/diagnostics/smoke/openai | jq
```

Expected:
```json
{
  "success": true,
  "data": {
    "allPassed": true,
    "passed": ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
    "failed": [],
    "results": [
      { "model": "gpt-5.4", "ok": true, "latencyMs": 420, "sample": "SMOKE_OK", "error": null }
    ]
  }
}
```

If any model is in `failed[]`, the error field shows exactly why (4xx code + OpenAI's message).

### Step 4: Run a real workflow
Navigate to `https://jakswarm.com/workspace`, send any prompt. Expected behavior:
- Workflow completes
- Real content appears in chat (not the "JAK couldn't complete" fallback)
- `/swarm` Inspector shows status Completed instead of Failed

If it still fails, the NEW error message in chat will name the exact model + base URL that 404'd, giving you the env var to fix.

## Rollback

The whole change is reversible without a code revert:

```bash
# In Render env:
JAK_EXECUTION_ENGINE=legacy                    # Pin to legacy runtime
OPENAI_MODEL_TIER_3=gpt-4o                     # Pre-GPT-5.4 tier 3
OPENAI_MODEL_TIER_2=gpt-4o-mini                # Pre-GPT-5.4 tier 2
OPENAI_MODEL_TIER_1=gpt-4o-mini                # Pre-GPT-5.4 tier 1
```

Restart API + worker. Behavior identical to `e25c835`.

## Risks + remaining work

- **Responses API unknown-unknowns:** OpenAIRuntime uses `/v1/responses` — if an org's API key is scoped to Chat Completions only, tier 3 workflows on OpenAIRuntime could 4xx. Mitigation: the legacy LegacyRuntime + OpenAIProvider chain (Chat Completions) is always available via `JAK_EXECUTION_ENGINE=legacy`. We'll see this in `/admin/diagnostics/smoke/openai` before any user does.
- **Cost delta:** GPT-5.4 family pricing is higher than gpt-4o. Tier 3 routing is unchanged (premier for planner/verifier/strategist), but now using a more expensive model. Add per-role budget caps if that becomes a concern.
- **Model ID drift:** OpenAI sometimes aliases / renames model IDs (`gpt-5.4` vs `gpt-5.4-2026-02-xx` vs `gpt-5.4-latest`). The resolver uses exact-string match on `/v1/models` IDs. If OpenAI retires `gpt-5.4` in favor of `gpt-5.5`, we fall through to `gpt-5` / `gpt-4o` automatically — but we won't pick up `gpt-5.5` until preferences are updated.
- **Not yet removed:** Gemini / Anthropic adapters. They're already out of the critical path (`provider-router.ts` prefers OpenAI at every tier), but the files still compile. Phase 8 benchmark / parity proof is the gate for deletion — unchanged from prior plan.

## Summary verdict

| Area user asked about | Verdict |
|---|---|
| Model routing | ✓ resolver-driven, tier-based, capability-verified |
| OpenAI runtime activation | ✓ default-on when key present; explicit opt-out via `JAK_EXECUTION_ENGINE=legacy` |
| Gemini / Anthropic removal from critical path | ✓ already gone (Phase 7); not reintroduced |
| Fallback correctness | ✓ 10-model chain + resolver + diagnostic errors |
| Prod env flags | ✓ no flip required; `OPENAI_MODEL_TIER_*` available as soft overrides |
| Planner 404 root cause | ✓ addressed at 3 layers (resolver · provider chain · error surfacing) |

The planner 404 should now either (a) never happen because the resolver has already verified the model exists, (b) happen transiently on one model and auto-recover via the fallback chain, OR (c) happen with a crystal-clear diagnostic that names the exact env var to fix. All three beat the previous state of "no final response was generated, full stop."
