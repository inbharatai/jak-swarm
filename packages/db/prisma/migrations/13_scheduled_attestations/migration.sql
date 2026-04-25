-- Recurring attestation schedules.
-- See packages/db/prisma/schema.prisma `ScheduledAttestation` for full
-- field documentation. Polled by AttestationScheduler in the API
-- service every minute (alongside the existing WorkflowSchedule poll).

CREATE TABLE IF NOT EXISTS "scheduled_attestations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 7,
    "signBundles" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastAttestationId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scheduled_attestations_pkey" PRIMARY KEY ("id")
);

-- Scheduler index — active rows ordered by next firing time.
CREATE INDEX IF NOT EXISTS "scheduled_attestations_active_next_idx"
  ON "scheduled_attestations"("active", "nextRunAt");

CREATE INDEX IF NOT EXISTS "scheduled_attestations_tenant_framework_idx"
  ON "scheduled_attestations"("tenantId", "frameworkId");
