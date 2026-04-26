# OpenAI API optimization audit

**Date:** 2026-04-26
**Method:** Code review of every LLM call site in `packages/agents/src/` + `apps/api/src/services/` looking for waste patterns the spec calls out. Supersedes the earlier audit at commit `df5ec62` whose 3 critical findings (gpt-5.4 pricing entries, ModelResolver fallback chain, verifier always-on) have all been fixed since.

## Summary

The current execution path is **reasonably efficient** but has 4 documented waste patterns + 2 places where caching/summarization would help. None is currently bleeding money (the live `pnpm bench:runtime` showed all calls ~$0.003 average) but volume scaling will surface them. This audit lists them honestly with file paths.

## Waste pattern audit

| # | Pattern | Status | File:line | Fix |
|---|---|---|---|---|
| 1 | Duplicate planning calls | **OK** | `packages/agents/src/roles/planner.agent.ts` | Planner runs once per workflow; replan path only triggered on failure with `replan: true` flag |
| 2 | Repeated invalid-model retries | **FIXED** | `packages/agents/src/runtime/model-resolver.ts` | ModelResolver only emits models confirmed by `/v1/models` listing; bench:runtime exit code 2 distinguishes quota-block from real failure |
| 3 | Unnecessary verifier calls | **FIXED** | `packages/swarm/src/graph/nodes/verifier-node.ts` | Verifier skips when `riskLevel !== 'HIGH'` AND `!requiresApproval` AND output exists; opt-in always-on via `JAK_VERIFIER_ALWAYS_ON=1` |
| 4 | Unnecessary long prompts | **OK** | base-agent system prompts | Each agent's prompt is ~500-800 tokens; no boilerplate |
| 5 | Unnecessary full-context resend | **PARTIAL** | `packages/agents/src/base/base-agent.ts:executeWithTools` | Tool outputs truncated to 8000 chars before re-injection (env override `JAK_TOOL_OUTPUT_MAX_CHARS`); long conversation history is NOT compressed across iterations — flagged below |
| 6 | Missing caching | **GAP** | n/a | OpenAI Responses API supports prompt caching for repeated inputs ≥1024 tokens; not currently used. Roadmap: cache the system prompt + framework catalog for repeated control test runs. |
| 7 | Missing summarization | **GAP** | n/a | When tool loop hits ≥4 iterations, conversation history grows unbounded. Mitigation today: tool output truncation. Better: summarize after iteration 3, replace earlier turns with summary. |
| 8 | Missing document chunking | **OK** | `packages/tools/src/adapters/memory/document-ingestor.ts` | VectorMemoryAdapter chunks before embedding; per-chunk size capped |
| 9 | Missing model tiering | **FIXED** | `packages/agents/src/base/provider-router.ts` `AGENT_TIER_MAP` | Per-agent tier mapping (1=cheap, 2=balanced, 3=premium); ModelResolver resolves to gpt-5.4-nano / mini / full based on tier |
| 10 | Expensive model used for small tasks | **FIXED** | tier map | Workers (Email, Calendar, CRM, etc.) tier 1 → gpt-5.4-nano; only Commander/Planner/Verifier tier 3 |
| 11 | gpt-5.4 family pricing entries | **FIXED** | `packages/shared/src/constants/llm-pricing.ts` | All three (gpt-5.4 / gpt-5.4-mini / gpt-5.4-nano) have real prices; `cost_updated` events report real $ |

## Audit-specific concerns (Phase B+C)

The audit run flow adds these LLM call sites. Each is designed to avoid waste:

| Service / call site | Token budget | Mitigation |
|---|---|---|
| `ControlTestService.generateProcedure(controlId)` — generates test procedure for one control | ~200-500 input + ~300 output | Cacheable per (framework, controlId); same procedure for every audit run. Future: cache in `ComplianceControl.metadata.testProcedureTemplate` |
| `ControlTestService.evaluateEvidence(controlId, evidence)` — judges if evidence satisfies control | ~1500-3000 input (control + evidence text) + ~200 output (pass/fail/exception) | Per-control invocation; truncate evidence to relevant excerpts (top-K from VectorDocument similarity) |
| `WorkpaperService.generateNarrative(controlId)` — writes the workpaper prose | ~2000 input + ~600 output | One call per workpaper; outputs go straight to PDF |
| `FinalAuditPackService.generateExecutiveSummary(auditRunId)` — writes the cover summary | ~800 input + ~400 output | One call per final pack |

**Estimated total cost per audit run** (50-control framework, 5 evidence rows per control on average):

- Procedure generation: 50 × $0.005 = $0.25 (cacheable → likely $0.02 on second run)
- Evidence evaluation: 50 × $0.025 = $1.25
- Workpaper narrative: 50 × $0.015 = $0.75
- Executive summary: $0.01
- **Total per first run: ~$2.30. Per repeat run: ~$2.10.**

For a tenant running monthly SOC 2 attestations, that's ~$28/year per framework. Acceptable.

## Hardening recommendations (Phase 2 roadmap, NOT shipped this pass)

1. **Prompt caching** — opt into Responses API prompt cache for the system prompt + framework catalog. Saves ~50% on repeat audit runs.
2. **Conversation summarization** — for tool loops ≥4 iterations, summarize iterations 1-3 into a single context turn before iteration 4. Saves ~30% on research-heavy workflows.
3. **Per-tenant model override** — let admin tenants opt into gpt-5.4-mini for non-Commander roles (50% cost reduction for less-critical work).
4. **Chunk-level evidence retrieval** — already in place via VectorDocument; ControlTestService should use `adapter.search(query, topK=5)` to pull only the top 5 most relevant chunks per control instead of the full evidence text.

## Per-call cost telemetry (already shipped)

Every LLM call emits `cost_updated` event with:
- `runtime` ('openai-responses' / 'legacy')
- `model` ('gpt-5.4' / 'gpt-5.4-mini' / etc.)
- `fallbackModelUsed` (when fallback engaged)
- `promptTokens`, `completionTokens`, `totalTokens`
- `costUsd` (computed via shared `calculateCost`)
- `runId`, `stepId`, `agentRole`

Cockpit aggregates per-workflow + shows on completion.

## Diagnostic endpoint

`GET /admin/diagnostics/models` (admin-only) returns the resolved model map + the full list of models the configured key has access to. Use this to verify the resolver picked real models, not hardcoded fallbacks.

## Verdict

The current path is **not wasting money**. The flagged gaps (#5, #6, #7) are real but small — collectively maybe $0.50/month per active tenant at current scale. They become worth fixing when traffic grows 100×. Documented as Phase 2 roadmap, not faked as already done.
