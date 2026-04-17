# Queue + Durable Workflow Persistence Migration Plan

## Goal
Move workflow execution from fire-and-forget HTTP-triggered runs to a durable, queue-backed execution model with restart recovery and clear observability.

## Current State (After First Slice)
- Execution is now enqueued via `SwarmExecutionService.enqueueExecution(...)`.
- Queue has concurrency limits via `WORKFLOW_QUEUE_CONCURRENCY`.
- Duplicate workflow enqueue is prevented by workflow ID dedupe sets.
- Startup recovery re-enqueues `PENDING` and stale in-flight workflows.
- Intermediate `onStateChange` checkpoints persist `stateJson` and normalized DB status.
- Queue stats endpoint is available at `GET /workflows/queue/stats`.

## Phase Plan

### Phase 1 (Implemented)
1. Replace direct `setImmediate(executeAsync)` calls with queue enqueue API.
2. Add in-process worker pool with bounded concurrency.
3. Add startup queue recovery behavior.
4. Persist execution intent metadata (`roleModes`, `maxCostUsd`) early.
5. Normalize status mapping during checkpoint writes.
6. Add queue observability endpoint.

### Phase 2 (Next)
1. Replace in-memory queue with Redis-backed durable queue (e.g., BullMQ).
2. Add explicit job records (`workflow_jobs`) for retries and dead-letter handling.
3. Add idempotent job claiming with lock renewal and heartbeat.
4. Persist queue attempt metadata (`attempt`, `lastError`, `nextRetryAt`).

### Phase 3
1. Add worker process separation from API process.
2. Add autoscaling policy on queue depth and job latency.
3. Add per-tenant concurrency and fairness controls.
4. Add queue SLOs (p95 start delay, success rate, retries).

### Phase 4
1. Add replay/resume from persisted node boundary checkpoints.
2. Add compensating actions for partial side effects.
3. Add consistency checks between traces, state checkpoints, and final output.

## Operational Controls
- `WORKFLOW_QUEUE_CONCURRENCY` controls in-process queue parallelism.
- `REQUIRE_REDIS_IN_PROD=true` enables strict startup enforcement for Redis.
- `GET /workflows/queue/stats` returns queued/running/maxConcurrent.

## Success Criteria
- Restart does not silently drop execution intent.
- Queue depth and running workers are observable.
- Workflows move through valid API statuses only.
- No duplicate concurrent execution of the same workflow ID.
- Clear path exists to Redis/BullMQ durability without route contract changes.
