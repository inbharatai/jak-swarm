-- Phase 6: Hyperagent execution persistence + artifact provenance + drift
-- resolution write-back. (PR C — spec execution closed loop persistence.)
--
-- The audit (§A0 capabilities #1/#2/#4/#5) found the spec-execution closed loop
-- returned a verdict + workflowId but NEVER persisted anything: no row per
-- execution attempt, no idempotency guard on (tenant, spec, attempt), no
-- WorkflowOutcome written by executeSpec, no `executedAt`/`executedWorkflowId`
-- on agent_executable_specs, no drift-resolution write-back (executeSpec
-- computed resolved=MET then only logged to AuditLog), and workflow_artifacts
-- had no provenance FK to the spec execution / trace / approval that produced
-- it. This migration adds the durable storage for all of that.
--
-- Additive only — no existing row is mutated, no existing column is dropped.

-- ─── spec_executions: one row per approved-spec execution ATTEMPT ──────────
-- The UNIQUE(tenantId, specId, attempt) makes re-executing the same spec
-- idempotent per attempt: the service claims the next attempt number and an
-- INSERT ... ON CONFLICT DO NOTHING prevents a duplicate run for the same
-- (tenant, spec, attempt). status transitions:
--   running → awaiting_approval → completed | failed | cancelled
-- `verdict` is NULL until the run finishes (met | unmet | unverifiable).
CREATE TABLE IF NOT EXISTS "spec_executions" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "specId" TEXT NOT NULL REFERENCES "agent_executable_specs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "attempt" INTEGER NOT NULL,
  "workflowId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running'
    CHECK ("status" IN ('running','awaiting_approval','completed','failed','cancelled')),
  "verdict" TEXT
    CHECK ("verdict" IS NULL OR "verdict" IN ('met','unmet','unverifiable')),
  "awaitingApproval" BOOLEAN NOT NULL DEFAULT FALSE,
  "approvalRequestId" TEXT,
  "failureClasses" JSONB,
  "driftFindingId" TEXT REFERENCES "execution_drift_findings"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "driftResolved" BOOLEAN NOT NULL DEFAULT FALSE,
  "accumulatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taskTotal" INTEGER NOT NULL DEFAULT 0,
  "taskPassed" INTEGER NOT NULL DEFAULT 0,
  "taskFailed" INTEGER NOT NULL DEFAULT 0,
  "taskBlocked" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "spec_executions_tenant_spec_attempt_key" UNIQUE ("tenantId", "specId", "attempt")
);

CREATE INDEX IF NOT EXISTS "spec_executions_tenant_spec_idx"
  ON "spec_executions"("tenantId","specId","attempt");
CREATE INDEX IF NOT EXISTS "spec_executions_tenant_status_idx"
  ON "spec_executions"("tenantId","status","createdAt" DESC);
CREATE INDEX IF NOT EXISTS "spec_executions_drift_idx"
  ON "spec_executions"("tenantId","driftFindingId","createdAt" DESC)
  WHERE "driftFindingId" IS NOT NULL;

-- ─── agent_executable_specs: execution link columns ─────────────────────────
ALTER TABLE "agent_executable_specs"
  ADD COLUMN IF NOT EXISTS "executedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "executedWorkflowId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastVerdict" TEXT
    CHECK ("lastVerdict" IS NULL OR "lastVerdict" IN ('met','unmet','unverifiable')),
  ADD COLUMN IF NOT EXISTS "lastExecutionId" TEXT REFERENCES "spec_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- lastExecution is 1:1 (a spec has one "last" execution) — unique on the FK.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_executable_specs_lastExecutionId_key"
  ON "agent_executable_specs"("lastExecutionId")
  WHERE "lastExecutionId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "agent_executable_specs_tenant_executed_idx"
  ON "agent_executable_specs"("tenantId","executedAt" DESC)
  WHERE "executedAt" IS NOT NULL;

-- ─── execution_drift_findings: resolution provenance + contradiction reopen ──
-- `resolvedAt` already exists; add WHO/WHICH-SPEC/WHICH-WORKFLOW resolved it
-- and a contradiction path so a later non-MET execution for the same drift
-- REOPENS it with evidence (status back to 'open' + `contradictedAt`), rather
-- than the prior "still-a-candidate" non-write-back.
ALTER TABLE "execution_drift_findings"
  ADD COLUMN IF NOT EXISTS "resolvedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "resolutionSpecId" TEXT REFERENCES "agent_executable_specs"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS "resolutionWorkflowId" TEXT,
  ADD COLUMN IF NOT EXISTS "resolutionVerdict" TEXT,
  ADD COLUMN IF NOT EXISTS "resolutionExecutionId" TEXT REFERENCES "spec_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS "contradictedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "contradictingExecutionId" TEXT REFERENCES "spec_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS "lastResolutionAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "execution_drift_findings_tenant_resolved_idx"
  ON "execution_drift_findings"("tenantId","status","resolvedAt" DESC);

-- ─── workflow_artifacts: provenance FKs to the spec execution / trace / approval
-- that produced the artifact. All nullable + loose (SET NULL on delete) so an
-- artifact's audit trail survives even if the execution row is pruned.
ALTER TABLE "workflow_artifacts"
  ADD COLUMN IF NOT EXISTS "specExecutionId" TEXT REFERENCES "spec_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS "agentTraceId" TEXT,
  ADD COLUMN IF NOT EXISTS "approvalRequestId" TEXT;

CREATE INDEX IF NOT EXISTS "workflow_artifacts_spec_execution_idx"
  ON "workflow_artifacts"("tenantId","specExecutionId")
  WHERE "specExecutionId" IS NOT NULL;