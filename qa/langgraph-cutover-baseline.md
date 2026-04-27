# LangGraph Hard-Cutover — Parity Baseline (Sprint 2.5 / A.0)

**Captured at commit:** `e52a090` (post-Sprint-2.4, CI green)
**Date:** 2026-04-27
**Author:** Sprint 2.5 prep; Phase 0 honest audit before any destructive change.

This document freezes the **observed behavior of SwarmGraph** so any
LangGraph implementation can be verified against it. It is the contract
that a successful cutover MUST preserve before SwarmGraph is deleted.

No changes to runtime were made while writing this doc. It is a pure
read of the code on commit `e52a090`.

---

## 1. Current orchestration engine

| Layer | Source file | Lines | Role |
|---|---|---|---|
| Engine | `packages/swarm/src/graph/swarm-graph.ts` | 1035 | Imperative state-machine; not a real LangGraph |
| Runner | `packages/swarm/src/runner/swarm-runner.ts` | 457 | Owns per-workflow lifecycle, pause/stop signals, lease persistence |
| Runtime adapter A | `packages/swarm/src/workflow-runtime/swarm-graph-runtime.ts` | 161 | Wraps SwarmGraph behind WorkflowRuntime interface |
| Runtime adapter B | `packages/swarm/src/workflow-runtime/langgraph-runtime.ts` | 125 | **HONEST SHIM** — `isFullyImplemented = false`, `name = 'langgraph-shim'`, delegates real work to SwarmGraphRuntime |
| Factory | `packages/swarm/src/workflow-runtime/index.ts` | 54 | Reads `JAK_WORKFLOW_RUNTIME` env, picks runtime |
| State | `packages/swarm/src/state/swarm-state.ts` | 175 | `SwarmState` interface — single bag of all workflow data |

**Truth:** today's `langgraph-runtime.ts` is structurally honest. It
declares itself `'langgraph-shim'`, `isFullyImplemented: false`,
`status: 'present-but-not-active'`. Its `start()` runs the real workflow
through `SwarmGraphRuntime` and then invokes a 1-node `START → execute → END`
LangGraph proof-of-life graph alongside, purely for observability — no
real orchestration runs through LangGraph today.

**Goal of Sprint 2.5:** delete the shim, make LangGraph the real
orchestrator, delete SwarmGraph after parity is proven.

---

## 2. The 9 graph nodes

All in `packages/swarm/src/graph/nodes/`:

| Node | File | Role | Returns |
|---|---|---|---|
| `commander` | commander-node.ts | Intent classification + clarification gate + direct-answer short-circuit | mission brief + `clarificationNeeded` + `directAnswer?` |
| `planner` | planner-node.ts | Decomposes mission into a `WorkflowPlan` of typed tasks with deps | `plan` |
| `router` | router-node.ts | Maps each task → an agent role; emits `agent_assigned` events | `routeMap` |
| `guardrail` | guardrail-node.ts | Per-task policy + tool-permission check | `guardrailResult`, `blocked?` |
| `worker` | worker-node.ts | Executes a single task by invoking the assigned worker agent; circuit-breaker, summarization, self-correction | `taskResults[id]`, traces, status=VERIFYING |
| `verifier` | verifier-node.ts | LLM + heuristic verification; emits `verification_started`/`completed`; new (Sprint 2.4) citation density check for grounded roles | `verificationResults[id]`, retry counter |
| `approval` | approval-node.ts | Auto-approve or pause workflow at AWAITING_APPROVAL | mutates pendingApprovals + status |
| `validator` | validator-node.ts | Final pass-through validation gate | passes/fails the final state |
| `replanner` | replanner-node.ts | When verifier fails terminally, builds a recovery plan | replacement plan |

**Critical contract:** every node has the signature
`(state: SwarmState) => Promise<Partial<SwarmState>>`.

This is **already** the LangGraph node signature. No structural
rewrite of node bodies is required for the cutover. The cutover work
is the **orchestration shell** that calls these nodes, not the node
internals.

---

## 3. Conditional edges (routing logic)

All in `swarm-graph.ts` lines 42–85:

| Edge function | After node | Branches |
|---|---|---|
| `afterCommander(state)` | commander | `__end__` (directAnswer) / `__clarification__` (clarificationNeeded) / `planner` (default) |
| `afterGuardrail(state)` | guardrail | `__end__` (blocked or no current task) / `approval` (task.requiresApproval) / `worker` (default) |
| `afterApproval(state)` | approval | `__end__` (last approval REJECTED) / `worker` (default) |
| `afterVerifier(state)` | verifier | `worker` (failed + needsRetry + under MAX_TASK_RETRIES=3) / `guardrail` (more tasks) / `__end__` (done) |

The router-node and worker-node connect linearly: `router → guardrail → worker`.

**The cutover** must reproduce these 4 conditional edges as LangGraph
`addConditionalEdges(...)` calls. The branch logic is pure on the
state — no global state, no side channels.

---

## 4. State management

`SwarmState` is a flat object with ~30 fields:

- **Inputs**: goal, tenantId, userId, workflowId, industry, roleModes, idempotencyKey
- **Commander outputs**: missionBrief, clarificationNeeded, clarificationQuestion
- **Planner outputs**: plan
- **Router outputs**: routeMap
- **Execution state**: currentTaskIndex, taskResults (Record<string, unknown>), pendingApprovals
- **Guardrail state**: guardrailResult, blocked
- **Verifier state**: verificationResults (Record<string, VerificationResult>)
- **Parallel execution**: completedTaskIds, failedTaskIds, taskRetryCount
- **Cost**: accumulatedCostUsd, maxCostUsd
- **Approval policy**: autoApproveEnabled, approvalThreshold
- **Tenant config**: allowedDomains, browserAutomationEnabled, restrictedCategories, disabledToolNames, connectedProviders, subscriptionTier
- **Output**: status, error, outputs, traces, directAnswer

State updates are computed at each node as `Partial<SwarmState>` and
shallow-merged into the running state by `swarm-graph.ts:mergeState`.

**LangGraph mapping:** every field gets an `Annotation<T>()` with
last-writer-wins reducer for primitives + the unique-id-merge pattern
for collections that grow (taskResults, verificationResults,
completedTaskIds, traces). The cutover must preserve the merge
semantics, not just the field shape.

---

## 5. Pause / resume mechanism

**Today's pattern (NOT LangGraph interrupt):**

1. `approval-node.ts` sets `state.status = AWAITING_APPROVAL` + writes
   `state.pendingApprovals` to include the new request.
2. `swarm-graph.ts` line 252-255 detects this and breaks out of the
   while loop.
3. Final state is persisted to `Workflow.stateJson` via
   `DbWorkflowStateStore`.
4. User decides via `POST /approvals/:id/decide`.
5. The decide route enqueues a `resume` job in the durable queue.
6. `QueueWorker` runs `swarm-execution.service.resumeAfterApproval()`,
   which calls `SwarmRunner.resume(workflowId, decision)`.
7. `SwarmRunner.resume()` rehydrates state from DB, applies the
   approval decision, and re-enters the graph at the worker node for
   the current task.

**Cutover requirement:** LangGraph's native `interrupt()` primitive
must replace steps 1-2. Resume uses `Command(resume=...)` per
LangGraph's docs. Persistence moves from `Workflow.stateJson` to a
dedicated `WorkflowCheckpoint` table managed by the LangGraph
checkpointer. The resume route + queue worker contract MUST stay
identical externally.

---

## 6. Side channels (state-resident)

Three runtime side channels exist by `workflowId`, kept out of
`SwarmState` because they carry non-serializable values (Functions,
EventEmitters):

| Side channel | File | Purpose |
|---|---|---|
| `getActivityEmitter(workflowId)` | `supervisor/activity-registry.ts` | Sink for fine-grained agent activity events (tool_called, cost_updated, agent_assigned, verification_started/completed, context_summarized, pii_redacted) |
| `getBreakerFactory(workflowId)` | `supervisor/breaker-registry.ts` | Per-workflow circuit breaker factory for distributed breaker mode |
| `runner.shouldStop(id) / shouldPause(id)` | `runner/swarm-runner.ts` | Cooperative cancel + manual pause flags, polled every node iteration |

**Cutover requirement:** keep these registries unchanged. They live
outside `SwarmState`, so they survive any LangGraph migration intact.
Each LangGraph node continues to look them up by workflowId from the
in-memory registry.

---

## 7. Cost accumulation

`swarm-graph.ts` lines 170-186 sums `costUsd` from every new trace
returned by a node, accumulates into `state.accumulatedCostUsd`,
and breaks the loop with status=FAILED when budget exceeded.

**Cutover requirement:** identical math, identical break behavior.
Implemented as a wrapper around each LangGraph node OR as a
post-node hook.

---

## 8. Lifecycle event emission

`swarm-graph-runtime.ts` calls `safeEmitLifecycle(ctx.onLifecycle, …)`
to emit canonical workflow lifecycle events:
`created`, `started`, `step_started`, `step_completed`, `step_failed`,
`approval_required`, `approval_granted`, `approval_rejected`, `resumed`,
`cancelled`, `completed`, `failed`, plus the Sprint 2.4 events
`agent_assigned`, `verification_started`, `verification_completed`,
`context_summarized`.

These are persisted into `AuditLog` and emitted to the cockpit SSE
stream by `swarm-execution.service.ts:onAgentActivity`.

**Cutover requirement:** identical event names, identical payloads,
same emission boundaries. The cockpit cannot tell which runtime is
underneath.

---

## 9. Tests currently passing

Test files exercising the swarm graph:

- `packages/swarm/src/graph/__tests__/swarm-graph.test.ts` (when
  present)
- `packages/swarm/src/graph/nodes/__tests__/*.test.ts` (per-node)
- `packages/swarm/src/runner/__tests__/swarm-runner.test.ts`
- `tests/integration/audit-run-e2e.test.ts` (full DAG with approval)
- `tests/integration/company-os-foundation.test.ts` (Migration 16
  intent + parser + sanitizer)
- `tests/unit/agents/verifier-grounding.test.ts` (Sprint 2.4 / Item F)
- `tests/unit/security/runtime-pii-redactor.test.ts` (Sprint 2.4 / Item G)
- `tests/unit/services/document-parsers.test.ts` (Sprint 2.2 / Item D)
- `tests/unit/services/crawler.test.ts` (Sprint 2.3 / Item C)

**Cutover requirement:** every test that passed on `e52a090` must
continue to pass on the LangGraph branch BEFORE SwarmGraph is deleted.
The `graph` tests tell us when the new orchestrator is wired
correctly; the `*-foundation`, `*-grounding`, `*-redactor` tests
tell us no cross-cutting feature regressed.

---

## 10. Failure / cancellation behavior

- **Node throws**: `swarm-graph.ts` line 187-244 marks the failing
  task as FAILED, computes skipped tasks (those whose deps now can't
  complete), advances to the next viable task. If no viable tasks
  remain, fails the workflow.
- **shouldStop**: interrupts the loop at any node boundary; sets
  status=CANCELLED.
- **shouldPause**: same, but sets status=AWAITING_APPROVAL (used for
  manual pause from the UI).
- **maxSteps exceeded**: fails the workflow with a clear error
  message.
- **Budget exceeded**: same pattern; status=FAILED with budget message.

**Cutover requirement:** every one of these terminal paths must
produce identical lifecycle events + identical SwarmResult shape so
external callers (cockpit, audit log, queue worker) see no behavior
change.

---

## 11. Async worker behavior

`QueueWorker` in `apps/api/src/services/queue-worker.ts` polls
`workflow_jobs` table for `execute` and `resume` job kinds. Each
`execute` job calls `swarm-execution.service.startWorkflow`; each
`resume` calls `resumeAfterApproval`. The runtime is selected per-call
inside the service via the `getWorkflowRuntime()` factory.

**Cutover requirement:** zero changes to the queue worker contract.
Switching runtimes happens behind the factory.

---

## 12. Cockpit (Agent Run Cockpit) wiring

`apps/web/src/components/chat/ChatWorkspace.tsx` subscribes to the
SSE stream `/workflows/:id/events` and renders 13+ canonical lifecycle
event types. It is **runtime-agnostic** by design — it never imports
anything from `@langchain/langgraph` or `@jak-swarm/swarm`; it only
consumes the lifecycle event stream.

**Cutover requirement:** zero changes to the cockpit. If lifecycle
events keep their shape, the cockpit shows correct state regardless
of which engine is running underneath.

---

## 13. Definition of parity (the test the cutover must pass)

A LangGraph implementation is at parity if and only if **all of the
following are true**:

1. ✅ All existing `graph/` and integration tests pass with no
   modifications other than swapping the orchestrator import.
2. ✅ A representative 5-task workflow run (with one approval task)
   produces an identical sequence of lifecycle events as on
   `e52a090`.
3. ✅ Pause-by-approval and resume produce identical state transitions
   (AWAITING_APPROVAL → resumed → COMPLETED).
4. ✅ A node-failure scenario produces identical task-skip behavior
   and final SwarmResult.
5. ✅ Cost accumulation and budget enforcement match within $0.0001.
6. ✅ Cockpit (no changes) renders the same event stream.
7. ✅ The factory `getWorkflowRuntime()` returns the LangGraph
   runtime by default with `JAK_WORKFLOW_RUNTIME` unset, AND with
   the env explicitly set to `'langgraph'`. SwarmGraph is only
   reachable via `JAK_WORKFLOW_RUNTIME=swarmgraph` for one transition
   release.
8. ✅ After ≥1 release of the side-by-side flag and zero observed
   regressions, SwarmGraph + swarm-graph.ts + swarm-graph-runtime.ts
   are deleted; the env flag handling is removed.

Items 1–7 are achievable and verifiable in the cutover branch. Item
8 requires a transition window in production and is the LAST step,
not the first.

---

## 14. Files that will change in Sprint 2.5

**New files:**
- `packages/db/prisma/migrations/100_workflow_checkpoint/migration.sql`
- `packages/swarm/src/workflow-runtime/postgres-checkpointer.ts`
- `packages/swarm/src/workflow-runtime/langgraph-graph-builder.ts`
- `packages/swarm/src/workflow-runtime/__tests__/postgres-checkpointer.test.ts`
- `packages/swarm/src/workflow-runtime/__tests__/langgraph-runtime-parity.test.ts`
- `qa/langgraph-cutover-baseline.md` (this file)
- `qa/langgraph-parity-verification.md` (Sprint 2.5 / A.5)
- `docs/langgraph-hard-cutover.md` (Sprint 2.5 / A.1)

**Files to edit:**
- `packages/swarm/src/workflow-runtime/langgraph-runtime.ts` —
  replace the shim with the real native LangGraph orchestrator.
- `packages/swarm/src/workflow-runtime/index.ts` — flip default
  runtime to `'langgraph'`.
- `packages/db/prisma/schema.prisma` — add `WorkflowCheckpoint` model.
- `apps/api/src/config.ts` — keep env flag for one release; flip
  default value to 'langgraph'.

**Files to DELETE (only after parity proven, A.6):**
- `packages/swarm/src/graph/swarm-graph.ts`
- `packages/swarm/src/workflow-runtime/swarm-graph-runtime.ts`
- The lazy-import branch in `getWorkflowRuntime()`.

**Files NOT in scope (intentionally untouched):**
- All 9 node files in `packages/swarm/src/graph/nodes/` — these are
  reused as-is by the LangGraph builder.
- All worker agents in `packages/agents/src/workers/`.
- `swarm-execution.service.ts` — only the runtime-name string in logs
  changes; the WorkflowRuntime interface is identical.
- `ChatWorkspace.tsx` and the SSE stream — runtime-agnostic.
- Approval routes / queue worker contract.

---

This baseline is the contract. Anything that drifts in the cutover
without being recorded here is a regression and blocks A.6 (deletion).
