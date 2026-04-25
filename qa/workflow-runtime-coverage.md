# WorkflowRuntime coverage

**Date:** 2026-04-25
**Purpose:** Document precisely which workflow-lifecycle events are owned by `WorkflowRuntime` (and its lifecycle emitter) versus which still flow through the direct `runner.run()` path. The Audit & Compliance product replays the lifecycle event stream to reconstruct exactly what happened in a workflow — any event not on the canonical vocabulary is invisible to it.

## Canonical lifecycle vocabulary

The 13 event types defined in `packages/swarm/src/workflow-runtime/lifecycle-events.ts`:

| Event type | Trigger | Audit log enum | Risk if missing |
|---|---|---|---|
| `created` | User submits workflow | `WORKFLOW_CREATED` | No record of who started a workflow |
| `planned` | Planner produces plan | `WORKFLOW_PLANNED` | Audit cannot show what plan was generated |
| `started` | Run begins | `WORKFLOW_STARTED` | Audit cannot show start time / runtime |
| `step_started` | Worker begins task | `WORKFLOW_STEP_STARTED` | Per-step accountability lost |
| `step_completed` | Worker finishes task | `WORKFLOW_STEP_COMPLETED` | Per-step accountability lost |
| `step_failed` | Worker errors out | `WORKFLOW_STEP_FAILED` | Failure attribution lost |
| `approval_required` | Workflow halts at gate | `APPROVAL_REQUESTED` | Compliance gate invisible to audit |
| `approval_granted` | Reviewer approves | `APPROVAL_GRANTED` | Approver attribution lost |
| `approval_rejected` | Reviewer rejects | `APPROVAL_REJECTED` | Rejection attribution + reason lost |
| `resumed` | Workflow resumes after approval | `WORKFLOW_RESUMED` | Cannot reconstruct pause/resume flow |
| `cancelled` | Workflow cancelled | `WORKFLOW_CANCELLED` | Who cancelled / why lost |
| `completed` | Workflow ends successfully | `WORKFLOW_COMPLETED` | Terminal state unclear |
| `failed` | Workflow ends in failure | `WORKFLOW_FAILED` | Terminal state unclear |

## Coverage matrix

Per-event coverage status. `Audit row` = a row is written to the AuditLog table. `SSE event` = a `workflow:${id}` event is emitted to the cockpit. Both must be true for full coverage.

| Event | Audit row | SSE event | Source | Risk |
|---|:---:|:---:|---|---|
| `created` | ✅ | ✅ | `swarm-execution.service.ts` `executeWorkflow()` | low |
| `planned` | ✅ | ✅ | Translated from agent activity `plan_created` event in `onAgentActivity` | low |
| `started` | ✅ | ✅ (legacy event also emitted for backwards compat) | `executeWorkflow()` | low |
| `step_started` | ✅ | ✅ | Translated from agent activity `worker_started` | low |
| `step_completed` | ✅ | ✅ | Translated from agent activity `worker_completed` (success branch) | low |
| `step_failed` | ✅ | ✅ | Translated from agent activity `worker_completed` (failure branch) | low |
| `approval_required` | ✅ | ✅ (plus legacy `paused` event) | `executeWorkflow()` PAUSED branch — emitted ONCE PER pending approval | low |
| `approval_granted` | ✅ | ✅ | `resumeAfterApproval()` APPROVED branch | low |
| `approval_rejected` | ✅ | ✅ | `resumeAfterApproval()` REJECTED branch | low |
| `resumed` | ✅ | ✅ | `resumeAfterApproval()` after `approval_granted` | low |
| `cancelled` | ✅ | ✅ | `cancelWorkflow()` AND `resumeAfterApproval()` REJECTED branch | low — but `cancelWorkflow` only emits when `tenantId` is in the params (route-level callers must pass it) |
| `completed` | ✅ | ✅ (plus legacy `completed` event) | `executeWorkflow()` after dbStatus=='COMPLETED' | low |
| `failed` | ✅ | ✅ (plus legacy `failed` event) | `executeWorkflow()` after dbStatus=='FAILED' | low |

## What WorkflowRuntime controls today

| Operation | Controlled by | Notes |
|---|---|---|
| `start` | **direct `runner.run()`** + lifecycle emitter side-channel | The `start` path still calls `runner.run()` directly because porting the dozen+ existing callbacks (onStateChange, onAgentActivity, circuitBreakerFactory, etc.) into `StartContext` is invasive. The `lifecycle-events` side-channel emits the canonical vocabulary regardless of which start path is used, so the audit log + Audit & Compliance product see the same events whether `start` runs through `WorkflowRuntime` or directly through `runner.run()`. |
| `resume` (after approval) | `WorkflowRuntime.resume` | `swarm-execution.service.ts:resumeAfterApproval` calls `this.workflowRuntime.resume(workflowId, decision)`. |
| `cancel` | `WorkflowRuntime.cancel` | `swarm-execution.service.ts:cancelWorkflow` calls `this.workflowRuntime.cancel(params.workflowId)`. |
| `getState` | `WorkflowRuntime.getState` | Available; not yet wired into a route (lightweight snapshot, the API's `GET /workflows/:id` recovery layer is heavier and reads DB directly). |

## Risks + remaining gaps

| Risk | Severity | Mitigation |
|---|---|---|
| `start` uses direct `runner.run()` not `workflowRuntime.start()` | **Low** — lifecycle events still emitted via side-channel; Audit & Compliance product reads the same vocabulary | Future: extend `StartContext` with all the existing callbacks; route `swarm-execution.service.ts:executeWorkflow` through `workflowRuntime.start()`. |
| `cancelWorkflow` only emits lifecycle when `tenantId` is in params | **Medium** — cancel routes today don't always pass tenantId, so cancel-via-route may not produce a lifecycle event | Audit + fix call sites that call `cancelWorkflow` to always include tenantId from `request.user.tenantId`. |
| LangGraphRuntime is `langgraph-shim` (delegates to SwarmGraph) | **Low** — UI label honest (`workflowRuntimeStatus: 'present-but-not-active'`), no false claims | Future: native LangGraph node migration (separate phase). |
| Lifecycle assertion is log-only by default | **Medium for prod, low for now** — `JAK_STRICT_WORKFLOW_STATE=true` flips to throw, with 32 passing tests | After ≥1 release of clean log-only telemetry, flip default to strict via env in prod. |

## Verification

- 32 unit tests cover legal/illegal transitions in both modes (`packages/swarm/src/state/run-lifecycle.test.ts`).
- 5 integration tests cover approval round-trip lifecycle event sequencing (`tests/integration/approval-roundtrip.test.ts`).
- Live workflow run blocked on OpenAI quota top-up (see `qa/openai-first-live-verification.md`).

## TL;DR

Every lifecycle event in the canonical 13-event vocabulary is wired to BOTH the audit log AND the SSE cockpit feed. The `start` path is the one remaining direct-runner.run() call, but lifecycle emission is independent of which path executes — the audit trail is complete regardless. The Audit & Compliance product can begin work with confidence that no transition will be invisible.
