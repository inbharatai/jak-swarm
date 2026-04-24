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

| Phase | Flag state | What changes |
|---|---|---|
| 1 (current) | both defaults | Pure no-op. Flags read + logged + surfaced in `/version`. Behavior identical to pre-migration. |
| 2 | both defaults | `LLMRuntime` interface introduced. `LegacyRuntime` wraps the current path. `BaseAgent` delegates `callLLM`/`executeWithTools` through it. No external behavior change. |
| 3 | both defaults | `OpenAIRuntime` implemented but not wired into any agent. Parity tests vs `LegacyRuntime`. |
| 4 | `JAK_OPENAI_RUNTIME_AGENTS=PLANNER,COMMANDER,WORKER_RESEARCH` | Three agents flip onto `OpenAIRuntime` (Responses API + structured output). The other 23 stay on Legacy. |
| 5 | both defaults | Run-lifecycle state machine replaces ad-hoc status strings. UI Runs page renders all 9 states. |
| 6 | `JAK_WORKFLOW_RUNTIME=langgraph` for one workflow template (CMO) | LangGraph runs CMO behind `WorkflowRuntime`. Approval pause/resume use LangGraph `interrupt()`. |
| 7 | `JAK_EXECUTION_ENGINE=openai-first`, `JAK_WORKFLOW_RUNTIME=langgraph` | All 26 workers on OpenAIRuntime. Gemini/Anthropic disabled in default routing (adapters stay compiling for break-glass). |
| 8 | same as 7 | Benchmark harness proves parity. Gemini/Anthropic adapters deleted, SDKs removed. |

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
