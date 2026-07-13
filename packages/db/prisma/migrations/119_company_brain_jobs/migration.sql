-- Company Brain durable processing jobs (migration 119)
--
-- Replaces the API-local setImmediate/setInterval + in-memory "running" flag
-- in the Company Brain auto-processing trigger with a durable, lease-claimed
-- job table. This is NOT a second queue framework: it reuses the exact
-- lease-claim idiom of workflow_jobs (migration 7 + 8: ownerInstanceId,
-- leaseExpiresAt, lastHeartbeatAt, FOR UPDATE SKIP LOCKED, reclaim sweep),
-- but as a dedicated table because workflow_jobs has a UNIQUE(workflowId)
-- constraint and lacks the richer state machine + idempotency key the
-- Company Brain pipeline requires (one logical attempt per idempotency key,
-- REVIEW_REQUIRED / RETRY_WAIT / PERMANENTLY_FAILED / CANCELLED).
--
-- State machine:
--   PENDING → LEASED → PROCESSING → COMPLETED
--                                   → RETRY_WAIT → (back to PENDING after backoff)
--                                   → REVIEW_REQUIRED
--                                   → PERMANENTLY_FAILED
--   any of (PENDING, LEASED, PROCESSING, RETRY_WAIT) → CANCELLED  (via API)
--
-- "LEASED" = lease acquired by a worker (ownerInstanceId + leaseExpiresAt set)
-- but extraction/processing not yet started. "PROCESSING" = the worker has
-- begun the extract+process work. The distinction gives operators a clear
-- "claimed but not yet working" vs "actively working" signal.
CREATE TABLE IF NOT EXISTS "company_brain_jobs" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "artifactId" TEXT NOT NULL REFERENCES "company_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "jobType" TEXT NOT NULL DEFAULT 'extract_and_process',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "maxAttempts" INTEGER NOT NULL DEFAULT 5 CHECK ("maxAttempts" >= 1),
  "payloadJson" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ownerInstanceId" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastError" TEXT,
  "reviewReason" TEXT,
  "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_brain_jobs_status_check" CHECK (
    "status" IN ('PENDING','LEASED','PROCESSING','RETRY_WAIT','REVIEW_REQUIRED','COMPLETED','PERMANENTLY_FAILED','CANCELLED')
  ),
  CONSTRAINT "company_brain_jobs_not_self_completed_pending" CHECK (
    "status" <> 'COMPLETED' OR "completedAt" IS NOT NULL
  )
);
-- One logical attempt per idempotency key within a tenant. Re-enqueuing the
-- same (tenantId, idempotencyKey) is an idempotent no-op, not a duplicate job.
CREATE UNIQUE INDEX IF NOT EXISTS "company_brain_jobs_tenant_idem_key" ON "company_brain_jobs"("tenantId","idempotencyKey");
-- Claim path: PENDING + availableAt <= now, ordered oldest-first.
CREATE INDEX IF NOT EXISTS "company_brain_jobs_claim_idx" ON "company_brain_jobs"("status","availableAt","createdAt");
-- Reclaim path: active leases whose expiry has passed.
CREATE INDEX IF NOT EXISTS "company_brain_jobs_lease_idx" ON "company_brain_jobs"("status","leaseExpiresAt") WHERE "status" IN ('LEASED','PROCESSING');
-- Tenant status listing.
CREATE INDEX IF NOT EXISTS "company_brain_jobs_tenant_status_idx" ON "company_brain_jobs"("tenantId","status","updatedAt" DESC);