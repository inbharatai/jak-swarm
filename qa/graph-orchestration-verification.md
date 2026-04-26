# Graph / DAG orchestration — verification (commit 769e358 baseline)

## What the user is told (in marketing/docs)

The README and landing page mention "DAG execution", "graph", and reference LangGraph as a future / present capability. The audit pack's lifecycle docs reference an "audit graph". This audit verifies what's actually executable vs documented.

## What's actually shipping

### SwarmGraph — REAL

[packages/swarm/src/graph/swarm-graph.ts](../packages/swarm/src/graph/swarm-graph.ts) is the production execution graph. Real DAG with:
- Commander → Planner → Router → Guardrail → (parallel Worker fan-out) → Verifier → Approval → final
- Real node implementations in [packages/swarm/src/graph/nodes/](../packages/swarm/src/graph/nodes/)
- State persisted via `DbWorkflowStateStore` ([db-state-store.ts](../apps/api/src/services/db-state-store.ts))
- Pause/resume via [approval-node.ts](../packages/swarm/src/graph/nodes/approval-node.ts)
- Cross-instance signal bus via Redis (when configured)
- Used by both in-process API and standalone queue worker

### LangGraph — HONEST SHIM

[packages/swarm/src/workflow-runtime/langgraph-runtime.ts](../packages/swarm/src/workflow-runtime/langgraph-runtime.ts) imports `@langchain/langgraph` and compiles a `StateGraph`, but the runtime self-declares:

```ts
readonly isFullyImplemented = false;
readonly status = 'present-but-not-active';
readonly statusReason = '...full LangGraph orchestration is a future-phase rewrite.';
```

The graph is a one-node shim: `START → execute → END` where `execute` delegates to `SwarmGraphRuntime.start()`. **This is intentional honesty** — it lets the LangGraph dependency be installed + verified without claiming LangGraph orchestrates anything. Documented in commit history and in the runtime file's preamble.

The README and landing page never claim "powered by LangGraph". They describe SwarmGraph (the real engine) without overselling LangGraph integration.

### Workflow runtime selection

[apps/api/src/services/swarm-execution.service.ts](../apps/api/src/services/swarm-execution.service.ts) picks the runtime via env var `JAK_WORKFLOW_RUNTIME`:
- `swarmgraph` (default) → `SwarmGraphRuntime`
- `langgraph` → `LangGraphRuntime` (shim — currently delegates to SwarmGraph)

Both implement the JAK-owned `WorkflowRuntime` interface so the rest of the system is shim-agnostic.

## Per-spec-feature verdict

| Feature | Status | Evidence |
|---|---|---|
| Real LangGraph orchestration | NOT BUILT (honest shim only) | [langgraph-runtime.ts:51-58](../packages/swarm/src/workflow-runtime/langgraph-runtime.ts) declares `isFullyImplemented = false`, status='present-but-not-active' |
| Real SwarmGraph orchestration | REAL | [swarm-graph.ts](../packages/swarm/src/graph/swarm-graph.ts) + [graph/nodes/](../packages/swarm/src/graph/nodes/) — used in production |
| JAK-owned workflow graph + event model | REAL | `WorkflowRuntime` interface in [packages/swarm/src/workflow-runtime/workflow-runtime.ts](../packages/swarm/src/workflow-runtime/workflow-runtime.ts) — both runtimes implement it |
| Intent detection node | ✅ via `CommanderAgent` | [commander.agent.ts](../packages/agents/src/roles/commander.agent.ts) |
| Workflow selection node | ❌ NOT_BUILT (no template selection — Planner decomposes dynamically) | — |
| Planning node | ✅ via `PlannerAgent` | [planner.agent.ts](../packages/agents/src/roles/planner.agent.ts) |
| Role-agent assignment nodes | ✅ via `RouterAgent` + `Worker-Node` factory | [router.agent.ts](../packages/agents/src/roles/router.agent.ts) + [worker-node.ts](../packages/swarm/src/graph/nodes/worker-node.ts) |
| Execution nodes | ✅ via `WorkerNode` | worker-node.ts (per-task execution + tool loop) |
| Approval interrupt node | ✅ via `approval-node.ts` | [approval-node.ts](../packages/swarm/src/graph/nodes/approval-node.ts) — uses `AWAITING_APPROVAL` state |
| Resume node | ✅ via `swarmExecution.resumeAfterApproval()` | swarm-execution.service.ts |
| Verification node | ✅ via `VerifierAgent` | [verifier.agent.ts](../packages/agents/src/roles/verifier.agent.ts) — runs after every worker |
| Final report node | ✅ via `compileFinalOutput()` | swarm-execution.service.ts |

## Graph UI

### What exists today

[apps/web/src/components/graph/WorkflowDAG.tsx](../apps/web/src/components/graph/WorkflowDAG.tsx) renders a Reactflow graph from `WorkflowPlan.tasks`:
- Nodes: one per task
- Edges: from `task.dependsOn` array
- Status colors: derived from `WorkflowTask.status` (live-updated via SSE `step_started/_completed/_failed`)
- Agent assigned: shown on each node from `task.agentRole`
- Errors: red badge from `step_failed` events

### What it does NOT show

- ❌ Per-step input/output payloads (would need to expose via API; today only in trace logs)
- ❌ Per-step tool calls list (visible in cockpit timeline, not on DAG)
- ❌ Per-step model/runtime/cost (visible in cockpit cost ribbon, not on DAG)
- ❌ Approval state on the node (approval cards are separate)

### Honesty assessment

The DAG is **derived from the planning state, not from a separate "graph state" engine**. SwarmGraph runs the workflow as a DAG internally, but the persisted state is the `WorkflowTask[]` list with `dependsOn` arrays. The UI graph is a faithful render of that state — not a fabricated visualization.

There is **no `/workflows/:id/graph` API** that returns a separate graph-state object. The WorkflowDAG reads from `/workflows/:id` (which includes `planJson.tasks`). This is honest but limits cockpit fidelity (e.g. you can't see which conditional branch a router took unless you read the trace logs).

## What it would take to fully match the spec

| Gap | Effort | Notes |
|---|---|---|
| Replace LangGraph shim with real LangGraph node migration | ~2 weeks | Documented as Phase 7-8 of the [openai-first migration plan](../docs/architecture/execution-engines.md). |
| Add `/workflows/:id/graph` API returning structured graph state (nodes, edges, conditional paths, dynamic edges from router decisions) | ~3-5 days | Would unlock richer DAG UI and time-travel debugging |
| Show per-step tool calls + cost on DAG node hover | ~2-3 days | Already in cockpit timeline; just needs UI plumbing |
| Show per-step input/output payloads on click | ~2-3 days | Trace data exists; needs `/traces/:id/payload` API + drawer UI |
| Add `workflow_selected` event when a `WorkflowTemplate` is matched | ~1 day | Requires `WorkflowTemplate` library to exist (deferred — see [conversation-flow-verification.md](conversation-flow-verification.md)) |

## Verdict: PARTIAL_BUT_HONEST

The orchestration is real (`SwarmGraph` runs production workflows). The graph UI is real (renders backend state, not fakes). LangGraph is intentionally a shim and labeled as such — never claimed to orchestrate anything.

What's missing is documented as deferred in the original [docs/architecture/execution-engines.md](../docs/architecture/execution-engines.md) phase plan (Phase 6+ for real LangGraph; Phase 7+ for full DAG state API).
