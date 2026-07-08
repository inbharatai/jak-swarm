-- Migration 113 — PlanVersion (HyperAgent Phase 4: genuine plan repair).
--
-- Spec §13 Phase 4 mandates: "Version every plan and store the complete plan
-- history." Every time the Replanner applies a symbolically-validated revised
-- plan, a new plan_versions row is APPENDED (never updated in place) so the
-- full self-healing trajectory is auditable + replayable. `parent_version`
-- chains the history; `changed_task_ids` / `invalidated_task_ids` record the
-- diff; `triggering_diagnosis_id` links the FailureDiagnosis that caused it.
--
-- Additive only: one new table + FKs + indexes. No existing columns or rows
-- change. No data backfill — rows are created lazily by the replanner node
-- each time it applies a revised plan. Safe to apply on a live DB.
--
-- Relations:
--   plan_versions.tenantId              → tenants.id            (CASCADE)
--   plan_versions.workflowId            → workflows.id          (CASCADE)
--   plan_versions.triggeringDiagnosisId → failure_diagnoses.id  (SET NULL)

CREATE TABLE IF NOT EXISTS "plan_versions" (
  "id"                    TEXT NOT NULL,
  "tenantId"              TEXT NOT NULL,
  "workflowId"            TEXT NOT NULL,
  "version"               INTEGER NOT NULL,
  "planId"                TEXT NOT NULL,
  "plan"                  JSONB NOT NULL,
  "parentVersionId"       INTEGER,
  "changeReason"          TEXT NOT NULL,
  "triggeringDiagnosisId" TEXT,
  "repairType"            TEXT,
  "changedTaskIds"        JSONB NOT NULL,
  "invalidatedTaskIds"    JSONB NOT NULL,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "plan_versions_pkey" PRIMARY KEY ("id")
);

-- One row per (workflow, version); version is monotonic per workflow.
CREATE UNIQUE INDEX IF NOT EXISTS "plan_versions_workflowId_version_key"
  ON "plan_versions" ("workflowId", "version");

CREATE INDEX IF NOT EXISTS "plan_versions_tenantId_workflowId_idx"
  ON "plan_versions" ("tenantId", "workflowId");

CREATE INDEX IF NOT EXISTS "plan_versions_workflowId_version_idx"
  ON "plan_versions" ("workflowId", "version");

ALTER TABLE "plan_versions"
  ADD CONSTRAINT "plan_versions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plan_versions"
  ADD CONSTRAINT "plan_versions_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "workflows" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plan_versions"
  ADD CONSTRAINT "plan_versions_triggeringDiagnosisId_fkey"
  FOREIGN KEY ("triggeringDiagnosisId") REFERENCES "failure_diagnoses" ("id") ON DELETE SET NULL ON UPDATE CASCADE;