-- P1b: worker-lease ownership for workflow_jobs
--
-- Adds three columns so a worker instance can claim a job, heartbeat while
-- running it, and expose its lease to other instances for reclaim when it dies.
--
--   ownerInstanceId   — which instance currently owns the job (null = unclaimed)
--   leaseExpiresAt    — when the claim expires if the worker stops heartbeating
--   lastHeartbeatAt   — most recent heartbeat timestamp (advisory / observability)
--
-- Reclaim semantics (implemented in apps/api/src/services/queue-worker.ts):
--   - On each poll, workers look for jobs where
--     status='ACTIVE' AND leaseExpiresAt < NOW() AND ownerInstanceId != self.
--   - That worker releases the lease (ownerInstanceId=NULL, status='QUEUED',
--     availableAt=NOW()), lets the normal FOR UPDATE SKIP LOCKED loop claim
--     it, and the job resumes. This is idempotent by design — the workflow
--     node handlers were already built to be replay-safe.
--
-- Backward compatibility:
--   - Existing rows get ownerInstanceId=NULL and no lease (leaseExpiresAt=NULL).
--   - Workers treat NULL lease as "instantly reclaimable" (matches pre-migration behavior).
--   - Indexes support both the happy-path claim query and the reclaim sweep.

ALTER TABLE "workflow_jobs"
  ADD COLUMN IF NOT EXISTS "ownerInstanceId" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastHeartbeatAt" TIMESTAMP(3);

-- Fast lookup for the reclaim sweep: find ACTIVE jobs whose lease has expired.
CREATE INDEX IF NOT EXISTS "workflow_jobs_status_leaseExpiresAt_idx"
  ON "workflow_jobs" ("status", "leaseExpiresAt");

-- Diagnostic: list everything a specific instance owns (for shutdown cleanup).
CREATE INDEX IF NOT EXISTS "workflow_jobs_ownerInstanceId_idx"
  ON "workflow_jobs" ("ownerInstanceId");
