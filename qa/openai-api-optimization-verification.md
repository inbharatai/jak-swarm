# OpenAI API + cost optimization — verification (commit 769e358 baseline)

## What works

| Optimization | Status | Backing |
|---|---|---|
| Per-call cost telemetry | ✅ REAL | Every Responses API call emits `cost_updated` with model, runtime, prompt/completion/total tokens, USD, and `fallbackModelUsed` if a tier model rate-limited |
| Per-agent cost tracking | ✅ REAL | `cost_updated.agentRole` field — cockpit groups by role |
| Per-run cost aggregate | ✅ REAL | `Workflow.totalCostUsd` updated atomically on every LLM call |
| Model resolver with tier preference | ✅ REAL | [model-resolver.ts](../packages/agents/src/runtime/model-resolver.ts) — pre-verified at boot, cached, failsafe map |
| Model tiering (3 tiers) | ⚠️ PARTIAL | `AGENT_TIER_MAP` in [provider-router.ts](../packages/agents/src/base/provider-router.ts) routes high-cost orchestrators (Commander/Planner/Verifier) to tier-3, workers to tier-2/1. **Honest gap:** Router agent uses tier-3 by default — could be tier-1 (~1 day to recalibrate). |
| Strict JSON schema (avoid retries on prose drift) | ✅ REAL | `OpenAIRuntime.respondStructured` uses `text.format: { type: 'json_schema', strict: true }` — model layer enforces shape, no schema-validation retries |
| Cost-cap budget enforcement | ✅ REAL | `Workflow.maxCostUsd` enforced; `BudgetExceededError` blocks further LLM calls |
| Credit reservation on workflow create | ✅ REAL | `CreditService` reserves credits at workflow start; reconciles at end |
| Provider failover chain | ✅ REAL | `[openai-primary, openai-fallback-model]` chain in `provider-router.ts` |

## Cost-waste audit (per spec checklist)

| Pattern | Status | Evidence / Fix |
|---|---|---|
| **Duplicate planning calls** | ✅ NOT WASTED | Planner runs ONCE per workflow; replan only on Verifier failure (max 1 replan in default config) |
| **Repeated invalid-model retries** | ✅ FIXED | Just-fixed in commit `abef53b` — Commander/Planner now propagate fatal config errors (401, model_not_found) instead of silently retrying with default brief |
| **Unnecessary verifier calls** | ⚠️ PARTIAL | Verifier runs on every worker output by default. Could be tier-1 for low-risk steps; today it's tier-3. ~1 day to add risk-based tier override. |
| **Unnecessary long prompts** | ⚠️ PARTIAL | BaseAgent prompt construction is relatively lean. **Honest gap:** the system prompt for orchestrators is hand-tuned but not minified. |
| **Repeated full-context resends** | ⚠️ NOT FIXED | Commander gets full input. Planner gets MissionBrief (compact). Worker gets full task input. **No prompt-cache reuse.** Adding OpenAI prompt caching would save ~20-40% on repeated agent invocations. ~2-3 days. |
| **Missing caching** | ❌ NOT BUILT | No prompt cache layer. Documented gap. |
| **Missing summarization** | ⚠️ PARTIAL | `context-summarizer.ts` exists in `packages/swarm/src/context/` but is not wired into every agent's input on long DAGs. ~3 days to wire. |
| **Missing document chunking** | ✅ REAL | `find_document` tool returns top-k chunks (not full document). `documents-upload` route chunks PDFs into ~1500-char windows for vector search. |
| **Missing model tiering** | ⚠️ PARTIAL — see above |
| **Expensive model used for small tasks** | ⚠️ PARTIAL | Router decision is small task but uses tier-3 by default. ~1 day to fix. |
| **Missing per-agent cost tracking** | ✅ REAL — see above |
| **Missing per-run token tracking** | ✅ REAL — see above |

## Cost panel coverage (per spec)

| Field | Cockpit shows? | Backing event |
|---|---|---|
| Model used | ✅ | `cost_updated.model` |
| Runtime used | ✅ | `cost_updated.runtime` (`'openai-responses'` / `'legacy'`) |
| Input tokens | ✅ | `cost_updated.promptTokens` |
| Output tokens | ✅ | `cost_updated.completionTokens` |
| Estimated cost | ✅ | `cost_updated.costUsd` |
| Number of model calls | ✅ via aggregate count of `cost_updated` events | — |
| Number of tool calls | ✅ via count of `tool_called` events | — |
| Cache hits | ❌ NOT BUILT | No prompt caching layer |
| Retry count | ⚠️ partial | Worker retries logged in `WorkflowJob.retryCount`; LLM-level retries (within OpenAI SDK) not exposed |
| Fallback model used | ✅ | `cost_updated.fallbackModelUsed` |

## Estimated cost per common workflow

Documented in [qa/openai-api-optimization-audit.md](openai-api-optimization-audit.md):

| Workflow | Estimated cost (per run) | Tier mix |
|---|---|---|
| Audit run (10 controls) | ~$2.30 first run, ~$2.10 repeat | Tier-3 for control test eval; tier-1 for procedure templates |
| Vibe Coder app generation | $0.50 - $2.00 (first), $0.05 - $0.30 (per iteration) | Tier-3 for architect, tier-2 for code gen, tier-1 for debug |
| CMO campaign generation | $0.05 - $0.20 | Tier-3 commander, tier-2 marketing worker |
| Research + report | $0.10 - $0.50 | Tier-3 commander/verifier, tier-2 research/document |

## Honest gaps with effort estimates

| Gap | Effort | Estimated cost reduction |
|---|---|---|
| Add OpenAI prompt caching for repeated agent invocations | ~2-3 days | ~20-40% on multi-step workflows |
| Wire context-summarizer into every agent's input on long DAGs | ~3 days | ~30-60% on workflows with 5+ steps |
| Recalibrate `AGENT_TIER_MAP`: Router → tier-1, Verifier → tier-2 (with tier-3 escalation on uncertainty) | ~1 day | ~15-25% on every workflow |
| Minify system prompts via prompt compression | ~2 days | ~10-15% on every call |
| Add LLM-call retry budget per workflow (cap at N retries; surface to cockpit) | ~1 day | Caps runaway cost on edge cases |

**Total cost optimization effort:** ~7-10 days. Estimated combined reduction: ~40-60% on multi-step workflows.

## Verdict: PASS_WITH_NAMED_OPTIMIZATION_GAPS

Cost telemetry is real and per-call accurate. Tier routing exists but underused. Prompt caching + summarization not built. None of these are dangerous fakes — the cost panel shows real numbers. They're optimization opportunities, not correctness bugs. Documented for future work.
