# Async worker visibility — verification (commit 769e358 baseline)

## Verdict: REAL_WITH_VISIBILITY_GAP

The durable queue worker exists and runs real workflow jobs. State transitions (queued → active → completed/failed/dead) are persisted and observable via the API. The gap: per-step lifecycle events emitted by the in-process runtime are NOT bridged into the workflow's SSE stream when the workflow is running on the worker — so live progress is invisible to the cockpit during async execution. Documented honestly below.

## What works

### Queue worker code

[apps/api/src/services/queue-worker.ts](../apps/api/src/services/queue-worker.ts):
- Owns the `WorkflowJob` lifecycle (QUEUED → ACTIVE → COMPLETED | FAILED | DEAD)
- Atomic claim via Postgres row-level lock
- Worker-lease reclaim (dead workers' jobs are auto-recovered after `lease_ttl/2`, default 30s)
- Heartbeat every 10s
- Distributed circuit breakers (when Redis is configured)
- Cross-instance signal bus for pause/resume/stop signals

### Standalone worker entry

[apps/api/src/worker-entry.ts](../apps/api/src/worker-entry.ts):
- Production deploy mode: separate Render service `jak-swarm-worker` (see `render.yaml`)
- Validates env at boot
- Exposes HTTP server with `/healthz` (line 223), `/metrics` (line 209), `/ready` (line 239) on `WORKER_METRICS_PORT` (default 9464)
- Uses **same `getRuntime()` factory** as the API — OpenAI-first applies equally

### State observable via API

| Spec state | Backed by | API surface |
|---|---|---|
| `queued` | `WorkflowJob.status='QUEUED'` | `GET /workflows/:id` returns `status='PENDING'` (workflow level) + the job exists in `WorkflowJob` table |
| `worker picked up` | `WorkflowJob.status='ACTIVE'` + `ownerInstanceId` set | Same |
| `running` | `Workflow.status='RUNNING'` | Same |
| `current agent` | `Workflow.currentTaskId` + lookup task `agentRole` | Same |
| `current step` | `Workflow.currentTaskId` | Same |
| `retrying` | `WorkflowJob.retryCount > 0` | Same |
| `failed` | `WorkflowJob.status='FAILED'` + `WorkflowJob.errorMessage` | Same |
| `waiting for approval` | `Workflow.status='AWAITING_APPROVAL'` + `ApprovalRequest` row | Same + `GET /approvals` |
| `resumed` | `WorkflowJob.status='ACTIVE'` after pause | Same + lifecycle event `resumed` |
| `completed` | `WorkflowJob.status='COMPLETED'` + `Workflow.status='COMPLETED'` | Same |

All states are queryable. Polling works. The cockpit polls every 5s when SSE is unavailable (e.g. Render free tier without sticky sessions).

### Worker emits SOME events

The worker EventEmitter emits:
- `job:claimed` (when a job goes ACTIVE)
- `job:completed`
- `job:retried`
- `job:dead`

These are RELAYED via Redis to the API process when `enableRedisRelay` is configured. The API forwards to the workflow's SSE channel.

## The visibility gap (honest)

When a workflow runs in the **embedded** mode (default for local dev: `WORKFLOW_WORKER_MODE=embedded`), the API process runs the worker in-process. The same `swarmExecution.emit()` calls fire on the local EventEmitter, which is what the SSE stream consumes. Live `step_started` / `tool_called` / `cost_updated` events stream to the cockpit in real time. ✅ Works.

When a workflow runs in the **standalone** mode (production: `WORKFLOW_WORKER_MODE=standalone`, separate `jak-swarm-worker` service):
- The worker emits `job:claimed`, `job:completed`, etc. to its OWN local EventEmitter.
- These are relayed to the API via Redis (when configured).
- BUT the per-step lifecycle events (`step_started`, `step_completed`, `tool_called`, `cost_updated`) emitted by the worker's `swarmExecution` instance are NOT relayed to the API's SSE channel — the Redis relay only forwards a subset of events.
- Result: cockpit sees `created` → `started` → (long silence) → `completed`. No live tool calls, no live cost ribbon.

**Severity:** Medium. The user's data is correct (DB is updated, final output is correct). But the live execution feel disappears for production deploys.

**Fix:** Extend the Redis relay to forward ALL events on the `workflow:{id}` channel from worker → API. Estimated ~2-3 days. Documented as Phase 2 work in `apps/api/src/plugins/swarm.plugin.ts:152-166` (the existing Redis relay setup mentions cross-instance SSE but currently only relays a subset).

## Test coverage

| Test | Verifies | Status |
|---|---|---|
| [tests/integration/queue-recovery-contract.test.ts](../tests/integration/queue-recovery-contract.test.ts) | Worker-lease reclaim — dead worker's jobs recovered after 30s | ✅ Passes |
| [tests/integration/replay-idempotency.test.ts](../tests/integration/replay-idempotency.test.ts) | Replay safety — same idempotency key produces same workflow | ✅ Passes |
| `recoverStaleWorkflows` on API boot | Crashes mid-run leave `Workflow.status='RUNNING'` orphans; recovery on boot scans + reclaims/fails | ✅ Real, documented in API boot logs |

## Verdict: REAL with one named gap

Worker is real. State is observable. The remaining gap is the SSE-relay-fidelity for standalone-mode deploys (~2-3 days to close). Until then, the cockpit shows correct data on the start + end of async runs in production, but doesn't stream the per-step execution feel. Acceptable for v1 (everything is correct in the DB, the runtime is honest); should be closed before production scaling.
