# Execution engines

JAK Swarm is migrating from a multi-provider routed engine to an OpenAI-first
runtime + LangGraph orchestrator. Both are gated behind two environment-level
feature flags so the migration ships incrementally with rollback at every step.

## Flags

| Env var | Values | Default | Purpose |
|---|---|---|---|
| `JAK_EXECUTION_ENGINE` | `legacy` \| `openai-first` | `legacy` | Picks the LLM execution path. `legacy` uses the existing `ProviderRouter` + `AGENT_TIER_MAP` across 6 providers. `openai-first` will use `OpenAIRuntime` (Responses API + hosted tools) — implemented in Phase 3. |
| `JAK_WORKFLOW_RUNTIME` | `swarmgraph` \| `langgraph` | `swarmgraph` | Picks the workflow orchestrator. `swarmgraph` runs the existing custom graph loop. `langgraph` will use `@langchain/langgraph` behind a JAK-owned `WorkflowRuntime` interface — implemented in Phase 6. |
| `JAK_OPENAI_RUNTIME_AGENTS` | comma-separated agent role names (e.g. `PLANNER,COMMANDER,WORKER_RESEARCH`) | empty | Per-agent allowlist used in Phase 4 to flip individual agents onto `OpenAIRuntime` even when `JAK_EXECUTION_ENGINE=legacy`. Empty means every agent stays on `LegacyRuntime`. |

Boot fails loud with a clear error if any flag has an unknown value, so
deploy-time typos are caught immediately.

## Phase rollout

| Phase | Status | What landed |
|---|---|---|
| 1 | ✅ shipped | Flags wired + `/version` reports `effectiveExecutionEngine`. |
| 2 | ✅ shipped | `LLMRuntime` interface + `LegacyRuntime` wrapping the existing path. `BaseAgent` delegates through it. |
| 3 | ✅ shipped | `OpenAIRuntime` implemented (Responses API + hosted tools). Default for every agent when `OPENAI_API_KEY` is set and operator hasn't explicitly opted into legacy. |
| 4 | ✅ shipped | Central zod schemas (`packages/agents/src/runtime/schemas/`) for Planner, Commander, Research. `runtime.respondStructured` enforces at the model layer (OpenAI) or post-parse (Legacy). Deterministic verb→worker overrides KEPT in Planner as defense-in-depth. |
| 5 | ✅ shipped | Run-lifecycle state machine (`packages/swarm/src/state/run-lifecycle.ts`) wired into `WorkflowService.updateWorkflowStatus`. Log-only in this phase — surfaces drift without blocking writes. |
| 6 | ✅ shipped (narrow) | `WorkflowRuntime` interface + `SwarmGraphRuntime` + `LangGraphRuntime` (proof-of-life). Resume + cancel paths in `SwarmExecutionService` go through it. The `start` path stays on direct `runner.run()` for now — extending `StartContext` with all the existing callbacks is its own follow-up. |
| 7 | ⚠️ deferred (operational) | Default-engine flip is an env-var change in ops, not code. As of today `getRuntime` already returns `OpenAIRuntime` for every agent when `OPENAI_API_KEY` is set, so the practical effect is in place. The remaining work — flipping `AGENT_TIER_MAP` defaults to OpenAI-only and removing the Gemini/Anthropic rows from the Legacy router — should land only AFTER the per-worker shadow run hits ≥95% match. Not run yet. |
| 8 | ⚠️ deferred (irreversible) | Adapter deletion is a one-way door. Will not run without the 30+ scenario benchmark harness in `packages/agents/src/benchmarks/` actually executing and showing OpenAI-first ≥90% on the persona suite. The harness scaffold exists; the runs do not. |

### Why Phases 7 + 8 are deferred

The full migration plan is in `C:\Users\reetu\.claude\plans\blunt-truth-first-8-5-misty-kettle.md`. Phase 7 + 8 each list explicit entry gates (≥1 week of clean prod, ≥72h zero fallback log lines, ≥95% per-worker shadow-run match, ≥90% benchmark parity). Running them inside one session — without the gates — would be the half-measure category we explicitly avoid. They land later, in their own PRs, with the gates honored.

The default `effectiveExecutionEngine` reported in `/version` is already `openai-first` whenever `OPENAI_API_KEY` is set, so day-to-day traffic gets the OpenAI Responses path today. Legacy stays available as `JAK_EXECUTION_ENGINE=legacy` for break-glass.

## Verification

- `curl https://jak-swarm-api.onrender.com/version` returns the current flag values.
- Each phase has explicit entry conditions + exit conditions documented in
  `C:\Users\reetu\.claude\plans\blunt-truth-first-8-5-misty-kettle.md`.
- Per-phase rollback is one env-var flip plus a single git revert.

## Architectural invariants

These never change across phases:

- `@langchain/langgraph` is only imported under `packages/swarm/src/workflow-runtime/`.
- `openai` SDK is only imported under `packages/agents/src/runtime/openai-*`.
- `stripNonSerializable` (`apps/api/src/services/swarm-execution.service.ts`)
  is the single safe-serialization point for state persistence; LangGraph
  checkpointer wraps it, does not replace it.
- `TenantToolRegistry.isAllowed` (`packages/tools/src/registry/tenant-tool-registry.ts`)
  remains the only tool-policy gate. Both runtimes go through it unchanged.
- All HTTP routes, RBAC middleware, audit-log emitters, SSE event names,
  and dashboard pages remain stable across the migration.
