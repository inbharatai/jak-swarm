# LangGraph Hard Cutover — Architecture Design (Sprint 2.5 / A.1)

**Status:** in-flight on commit `e52a090` baseline.
**Companion:** [parity baseline](../qa/langgraph-cutover-baseline.md).

This document specifies the target architecture for replacing the
custom `SwarmGraph` orchestrator with a real `@langchain/langgraph`
StateGraph + Postgres checkpointer. It is the contract that the
implementation files (`langgraph-runtime.ts`, `postgres-checkpointer.ts`,
the LangGraph builder) must satisfy.

---

## 1. Why LangGraph at all

Until now JAK has shipped a hand-rolled state machine in
`packages/swarm/src/graph/swarm-graph.ts`. It works, has tests, and is
honestly labeled — but every benefit listed below is unavailable today:

- **Native checkpointing** with the standard `BaseCheckpointSaver`
  contract — third parties (auditors, ops tooling) can read the
  checkpoint table directly using LangGraph's documented schema.
- **Native interrupt/resume** primitive — replaces JAK's "set status to
  AWAITING_APPROVAL and break the loop" pattern with the standard
  `interrupt()` + `Command(resume=...)` cycle.
- **Standard graph IR** — `StateGraph` is documented and inspectable;
  every conditional edge becomes a named function in a dependency
  graph, easier for new engineers + observability tooling.
- **Future-proofing** — LangGraph has a maintained ecosystem
  (visualizer, replay, multi-agent libs); SwarmGraph is bespoke.

Sprint 2.5 makes LangGraph the actual orchestrator. SwarmGraph is
deleted in A.6 once parity is proven.

---

## 2. Target architecture

```
                ┌───────────────────────────────────────────────┐
                │ SwarmExecutionService (apps/api/src/services) │
                └─────────────┬─────────────────────────────────┘
                              │
                  WorkflowRuntime (interface)
                              │
                ┌─────────────▼─────────────────────┐
                │  LangGraphRuntime  (rewritten)    │
                │  packages/swarm/src/workflow-     │
                │  runtime/langgraph-runtime.ts     │
                └─────────────┬─────────────────────┘
                              │
                ┌─────────────▼─────────────────────┐
                │  buildLangGraph(...)              │
                │  packages/swarm/src/workflow-     │
                │  runtime/langgraph-graph-         │
                │  builder.ts                       │
                │                                    │
                │  StateGraph(SwarmStateAnnotation) │
                │   + addNode(commander, plannerN…) │
                │   + addConditionalEdges(after*)    │
                │   .compile({ checkpointer })       │
                └─────────────┬─────────────────────┘
                              │
                ┌─────────────▼─────────────────────┐
                │  PostgresCheckpointSaver           │
                │  packages/swarm/src/workflow-     │
                │  runtime/postgres-checkpointer.ts │
                │   - getTuple / list / put / put-   │
                │     Writes / deleteThread          │
                └─────────────┬─────────────────────┘
                              │
                ┌─────────────▼─────────────────────┐
                │  Postgres: workflow_checkpoint    │
                │  packages/db/prisma/migrations/   │
                │  100_workflow_checkpoint           │
                └────────────────────────────────────┘
```

**Reuse, do not rewrite:**

- The 9 node functions in `packages/swarm/src/graph/nodes/` —
  signatures already match LangGraph (`(SwarmState) => Promise<Partial<SwarmState>>`).
- All worker agents (`packages/agents/src/workers/`).
- The `WorkflowRuntime` interface and the `SwarmExecutionService`
  consumer.
- The cockpit + SSE event stream (runtime-agnostic by design).

---

## 3. State schema (LangGraph Annotation)

`SwarmState` becomes an `Annotation.Root({...})`. Per-field reducers:

| Field | Reducer | Note |
|---|---|---|
| Primitives (goal, tenantId, userId, workflowId, industry, idempotencyKey, status, error) | `(_old, next) => next ?? _old` | Last-writer-wins |
| `roleModes`, `outputs`, `traces`, `pendingApprovals` | append: `(old, next) => [...(old ?? []), ...(next ?? [])]` | Grow-only |
| `taskResults`, `verificationResults` | shallow merge: `(old, next) => ({ ...old, ...next })` | Per-task keyed |
| `taskRetryCount`, `failedTaskIds`, `completedTaskIds` | merge unique: `(old, next) => unique-merge` | De-duplicate |
| `accumulatedCostUsd` | sum: `(old, next) => (old ?? 0) + (next ?? 0)` | Numeric accumulation |
| `currentTaskIndex` | last-writer-wins | Set by replanner / verifier transitions |
| `plan`, `routeMap`, `missionBrief`, `guardrailResult`, `directAnswer`, `clarificationQuestion` | last-writer-wins | Computed once per node visit |

**Why explicit reducers matter:** LangGraph runs each node in
isolation and merges its `Partial<State>` return into the running
state via these reducers. SwarmGraph's `mergeState` was always shallow;
the reducers above preserve identical semantics. The `traces` and
`taskResults` reducers are the most behavior-sensitive: they must NOT
overwrite earlier entries.

---

## 4. Graph topology (LangGraph nodes + edges)

```
START
  ↓
commander  ────────┐
  ↓ (after)        │
  ├─ directAnswer? ──→ END
  ├─ clarification? ─→ END        (clarification node = inline; no separate node)
  └─ default → planner
                    ↓
                  router
                    ↓
                  guardrail ──┐
                    ↓ (after) │
              ┌─────┴─────────┤
              │               │
              ▼               ▼
         approval         worker
              ↓               ↓
            (after)        verifier
              ▼               ↓
            worker         (after)
              ↓               │
              └───────────────┤
                              │
                ┌─────────────┴─────────────┐
                │                           │
              retry?                    no more tasks
                ↓                           ↓
              worker                    validator
                                            ↓
                                          END
```

**Edges (LangGraph syntax sketch):**

```ts
const g = new StateGraph(SwarmStateAnnotation, JakConfigAnnotation)
  .addNode('commander', wrapNode('commander', commanderNode))
  .addNode('planner',   wrapNode('planner',   plannerNode))
  .addNode('router',    wrapNode('router',    routerNode))
  .addNode('guardrail', wrapNode('guardrail', guardrailNode))
  .addNode('worker',    wrapNode('worker',    workerNode))
  .addNode('verifier',  wrapNode('verifier',  verifierNode))
  .addNode('approval',  wrapNode('approval',  approvalNode))
  .addNode('validator', wrapNode('validator', validatorNode))
  .addNode('replanner', wrapNode('replanner', replannerNode))

  .addEdge(START, 'commander')
  .addConditionalEdges('commander', afterCommanderEdge, {
    end: END, planner: 'planner',
  })
  .addEdge('planner',  'router')
  .addEdge('router',   'guardrail')
  .addConditionalEdges('guardrail', afterGuardrailEdge, {
    end: END, approval: 'approval', worker: 'worker',
  })
  .addConditionalEdges('approval', afterApprovalEdge, {
    end: END, worker: 'worker',
  })
  .addEdge('worker',   'verifier')
  .addConditionalEdges('verifier', afterVerifierEdge, {
    worker: 'worker', guardrail: 'guardrail', validator: 'validator',
  })
  .addEdge('validator', END)
  .addEdge('replanner', 'guardrail');

const compiled = g.compile({
  checkpointer: postgresCheckpointer,
});
```

`wrapNode(name, fn)` is a small adapter that:
1. Calls `applySummarizationIfNeeded(state)` (same hook SwarmGraph used).
2. Polls `runner.shouldStop / shouldPause` side channels and short-circuits.
3. Invokes the existing node function.
4. Accumulates `cost` from returned traces into `accumulatedCostUsd`.
5. Surfaces a `step_started` / `step_completed` / `step_failed` lifecycle
   event via the runtime's lifecycle emitter.

This wrapper is the ONLY new node-level logic. It reproduces the
side-effects that `swarm-graph.ts:run()` did imperatively, but in a
shape compatible with LangGraph's per-node execution model.

---

## 5. Conditional-edge functions

The existing `afterCommander`, `afterGuardrail`, `afterApproval`,
`afterVerifier` from `swarm-graph.ts` are reused **verbatim**. They are
already pure functions of state. Their return strings are mapped to
LangGraph node names via the destination map in `addConditionalEdges`.

The only adaptation: SwarmGraph's `__end__` and `__clarification__`
sentinels both map to LangGraph's `END`. Clarification is handled by
the runtime layer reading `state.clarificationNeeded` after the graph
returns, not by routing to a separate node.

---

## 6. Approval interrupts

**Current pattern (SwarmGraph):** approval node sets
`state.status = AWAITING_APPROVAL`, while-loop breaks, runner
persists state, route returns paused.

**Target pattern (LangGraph):** approval node calls LangGraph's
`interrupt({ approvalRequest })` primitive. The compiled graph's
`invoke()` throws a `GraphInterrupt`. The runtime catches it, wraps
as `WorkflowPausedError`, returns up the stack.

**Resume:** `runtime.resume(workflowId, decision)` calls
`compiled.invoke(new Command({ resume: decision, update: {…} }), { configurable: { thread_id: workflowId } })`.
LangGraph rehydrates from the checkpointer, applies the resume value
inside the approval node, and continues to the next node.

**Migration safety:** during the transition window
(`JAK_WORKFLOW_RUNTIME=swarmgraph` still selectable), workflows
started under SwarmGraph cannot be resumed by LangGraph and vice
versa, because their checkpoint storage differs (`Workflow.stateJson`
vs `workflow_checkpoint`). Document this clearly in deployment notes.
After A.6, only LangGraph runs and only the new table is used.

---

## 7. Postgres checkpointer

Implements `BaseCheckpointSaver` from `@langchain/langgraph-checkpoint`.
Required methods:

| Method | Behavior |
|---|---|
| `getTuple(config)` | Latest checkpoint for `thread_id` (= `workflowId`); returns `{ config, checkpoint, metadata, parentConfig?, pendingWrites? }` or undefined |
| `list(config, options)` | AsyncGenerator over historic checkpoints for thread, newest first |
| `put(config, checkpoint, metadata, newVersions)` | Insert a checkpoint row; return updated config with `checkpoint_id` |
| `putWrites(config, writes, taskId)` | Insert pending-writes for a task that hasn't yet committed its checkpoint |
| `deleteThread(threadId)` | Hard-delete all checkpoints + writes for a thread (used by tests + tenant erasure) |

**Schema (Prisma):**

```prisma
model WorkflowCheckpoint {
  id                  String   @id @default(cuid())
  // LangGraph identifiers
  threadId            String   // == Workflow.id
  checkpointNs        String   @default("")
  checkpointId        String   // LangGraph checkpoint UUID v6
  parentCheckpointId  String?
  // Tenant scoping (REQUIRED — checkpoint contents are tenant data)
  tenantId            String
  // Payload — JSON-serialized Checkpoint + metadata + channel versions
  type                String   // 'checkpoint' | 'write'
  checkpointJson      Json     // serialized Checkpoint
  metadataJson        Json     // serialized CheckpointMetadata
  channelVersionsJson Json     // ChannelVersions map
  // For write rows (putWrites)
  taskId              String?
  writesJson          Json?
  createdAt           DateTime @default(now())

  @@unique([threadId, checkpointNs, checkpointId])
  @@index([tenantId, threadId, createdAt])  // tenant isolation + latest-first reads
  @@index([threadId, parentCheckpointId])
  @@map("workflow_checkpoints")
}
```

**Why a single table for both checkpoints and writes:**
Simpler migrations, single index for tenant isolation, and matches
the JSON-payload pattern used by the existing reference implementations
(Postgres saver in the LangGraph repo). The `type` discriminator is
explicit so query plans stay sargable.

**Tenant isolation requirement:**
Every checkpointer call carries `configurable.tenantId`. The Postgres
adapter uses it in WHERE clauses on every read AND every write. Tests
must verify cross-tenant isolation by trying to read a checkpoint
from a different tenant's `thread_id` and asserting `undefined`.

---

## 8. Activity & lifecycle events

The wrapper `wrapNode(name, fn)` calls the existing
`safeEmitLifecycle` helper for `step_started` and `step_completed`
events. The 9 nodes themselves keep emitting fine-grained events
(`agent_assigned`, `verification_started`, `tool_called`,
`cost_updated`, `context_summarized`, `pii_redacted`) via the existing
side-channel registry — **no change to that code**.

The `LangGraphRuntime` constructor still accepts the lifecycle emitter
through `StartContext`, exactly as `SwarmGraphRuntime` does today.

The cockpit cannot tell which engine emitted the events. That is the
point of the cutover.

---

## 9. Async worker contract

`QueueWorker` continues to call `swarm-execution.service.startWorkflow`
and `resumeAfterApproval`. Both methods route through
`getWorkflowRuntime()`. The factory's default flips from
`'swarmgraph'` to `'langgraph'` after parity is proven (A.5).

Resume jobs work because LangGraph's `Command(resume=...)` can be
invoked from a fresh process — the checkpointer reconstructs the
workflow state from Postgres. There is no in-memory "resumable graph"
that needs to live across processes.

---

## 10. Side channels (unchanged)

`getActivityEmitter`, `getBreakerFactory`, and runner pause/stop flags
all live in module-level singletons keyed by `workflowId`. They are
NOT serialized into checkpoints (correctly — they hold function
values). The wrapper looks them up at the start of each node by
`workflowId` from `state`. Same code today as tomorrow.

---

## 11. Rollback strategy

If anything is wrong after the cutover:

1. Set `JAK_WORKFLOW_RUNTIME=swarmgraph` in production env.
2. Restart processes.
3. New workflows route to SwarmGraph; in-flight LangGraph workflows
   continue on the old runtime in their existing process and finish
   from `workflow_checkpoint`.
4. After all in-flight workflows drain, the operator can decide to
   abort the cutover entirely (revert the deployment).

This rollback path holds as long as A.6 (deletion) has NOT shipped.
A.6 is the point-of-no-return and only happens after at least one
production release at parity.

---

## 12. Parity checklist

Identical to baseline §13. Reproduced here for convenience:

- [ ] All graph + integration tests pass with no edits.
- [ ] 5-task workflow with 1 approval produces identical lifecycle
      event sequence (compared against a recorded fixture).
- [ ] Pause / resume round-trip produces identical state transitions.
- [ ] Node-failure scenario produces identical task-skip behavior.
- [ ] Cost accumulation matches within $0.0001.
- [ ] Cockpit (no changes) renders the same event stream.
- [ ] `JAK_WORKFLOW_RUNTIME=langgraph` is the default.
- [ ] After ≥1 release at parity, A.6 deletes SwarmGraph + the env
      flag handling.

---

## 13. Honest limits of Sprint 2.5

What this sprint **does**:
- Implement the Postgres checkpointer with full tests.
- Implement the native LangGraph builder reusing existing nodes.
- Replace the `langgraph-runtime` shim with the real implementation.
- Run all existing tests against the new runtime.
- Capture the parity verification doc.

What this sprint **does not do** (deferred, named honestly):
- Delete SwarmGraph (A.6) — requires ≥1 production release at parity.
  In this branch, `JAK_WORKFLOW_RUNTIME=swarmgraph` remains a working
  fallback during the transition window.
- Migrate in-flight workflows from `Workflow.stateJson` to
  `workflow_checkpoint`. Operators should drain in-flight workflows
  before flipping the default. The cutover branch documents this.
- Subgraph / parallel-branch optimizations beyond what SwarmGraph
  already supports. Today's `getReadyTasks` parallelism remains the
  same; LangGraph's `Send` API can replace it later.
- LangGraph `streamMode` integration with the SSE stream — current
  emit pattern via the activity-registry continues to work and is
  what the cockpit reads. Streaming via LangGraph's native channels
  is a separate, smaller follow-up.

These deferrals are explicit so future work has a clean boundary.
