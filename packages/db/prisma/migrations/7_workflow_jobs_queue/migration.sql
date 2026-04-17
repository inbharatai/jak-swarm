-- Durable workflow execution queue
CREATE TABLE IF NOT EXISTS "workflow_jobs" (
  "id" TEXT PRIMARY KEY,
  "workflowId" TEXT NOT NULL UNIQUE,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "payloadJson" JSONB NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "workflow_jobs_status_availableAt_idx"
  ON "workflow_jobs" ("status", "availableAt");

CREATE INDEX IF NOT EXISTS "workflow_jobs_tenantId_status_idx"
  ON "workflow_jobs" ("tenantId", "status");

CREATE INDEX IF NOT EXISTS "workflow_jobs_updatedAt_idx"
  ON "workflow_jobs" ("updatedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'workflow_jobs_workflowId_fkey'
      AND table_name = 'workflow_jobs'
  ) THEN
    ALTER TABLE "workflow_jobs"
      ADD CONSTRAINT "workflow_jobs_workflowId_fkey"
      FOREIGN KEY ("workflowId") REFERENCES "workflows"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'workflow_jobs_tenantId_fkey'
      AND table_name = 'workflow_jobs'
  ) THEN
    ALTER TABLE "workflow_jobs"
      ADD CONSTRAINT "workflow_jobs_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'workflow_jobs_userId_fkey'
      AND table_name = 'workflow_jobs'
  ) THEN
    ALTER TABLE "workflow_jobs"
      ADD CONSTRAINT "workflow_jobs_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
