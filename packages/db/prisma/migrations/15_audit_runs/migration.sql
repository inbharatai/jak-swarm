-- Audit Run product — adds 4 new tables for full audit-engagement
-- workflow. Additive only; no changes to existing models. Existing
-- compliance + workflow flows continue unchanged.
--
-- See packages/db/prisma/schema.prisma `AuditRun`, `ControlTest`,
-- `AuditException`, `AuditWorkpaper` for full field documentation.
--
-- Honesty: all status fields are String (not Postgres ENUM) because the
-- state-machine vocabulary is defined in code and may evolve faster
-- than migrations are safe to ship. assertTransition()-style validation
-- happens at the service layer.

-- ── audit_runs ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "audit_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "frameworkSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "riskSummary" TEXT,
    "coveragePercent" DOUBLE PRECISION,
    "finalPackArtifactId" TEXT,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "audit_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_runs_tenant_status_deleted_idx"
  ON "audit_runs"("tenantId", "status", "deletedAt");

CREATE INDEX IF NOT EXISTS "audit_runs_tenant_framework_idx"
  ON "audit_runs"("tenantId", "frameworkSlug");

CREATE INDEX IF NOT EXISTS "audit_runs_tenant_created_idx"
  ON "audit_runs"("tenantId", "createdAt");

-- ── control_tests ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "control_tests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "controlCode" TEXT NOT NULL,
    "controlTitle" TEXT NOT NULL,
    "testProcedure" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "result" TEXT,
    "rationale" TEXT,
    "confidence" DOUBLE PRECISION,
    "evidenceConsidered" JSONB,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "exceptionId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "control_tests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "control_tests_audit_control_key"
  ON "control_tests"("auditRunId", "controlId");

CREATE INDEX IF NOT EXISTS "control_tests_tenant_audit_status_idx"
  ON "control_tests"("tenantId", "auditRunId", "status");

CREATE INDEX IF NOT EXISTS "control_tests_tenant_control_idx"
  ON "control_tests"("tenantId", "controlId");

ALTER TABLE "control_tests"
  ADD CONSTRAINT "control_tests_auditRunId_fkey"
  FOREIGN KEY ("auditRunId") REFERENCES "audit_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── audit_exceptions ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "audit_exceptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "controlTestId" TEXT,
    "controlId" TEXT NOT NULL,
    "controlCode" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "description" TEXT NOT NULL,
    "cause" TEXT,
    "impact" TEXT,
    "remediationPlan" TEXT,
    "remediationOwner" TEXT,
    "remediationDueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "reviewerStatus" TEXT,
    "reviewerComment" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "audit_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_exceptions_tenant_audit_status_idx"
  ON "audit_exceptions"("tenantId", "auditRunId", "status");

CREATE INDEX IF NOT EXISTS "audit_exceptions_tenant_severity_status_idx"
  ON "audit_exceptions"("tenantId", "severity", "status");

ALTER TABLE "audit_exceptions"
  ADD CONSTRAINT "audit_exceptions_auditRunId_fkey"
  FOREIGN KEY ("auditRunId") REFERENCES "audit_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── audit_workpapers ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "audit_workpapers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auditRunId" TEXT NOT NULL,
    "controlTestId" TEXT,
    "controlId" TEXT NOT NULL,
    "controlCode" TEXT NOT NULL,
    "controlTitle" TEXT NOT NULL,
    "artifactId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reviewerNotes" TEXT,
    "generatedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "audit_workpapers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "audit_workpapers_audit_control_key"
  ON "audit_workpapers"("auditRunId", "controlId");

CREATE INDEX IF NOT EXISTS "audit_workpapers_tenant_audit_status_idx"
  ON "audit_workpapers"("tenantId", "auditRunId", "status");

ALTER TABLE "audit_workpapers"
  ADD CONSTRAINT "audit_workpapers_auditRunId_fkey"
  FOREIGN KEY ("auditRunId") REFERENCES "audit_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
