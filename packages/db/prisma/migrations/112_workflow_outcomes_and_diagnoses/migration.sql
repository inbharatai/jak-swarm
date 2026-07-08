-- Migration 112 — WorkflowOutcome + FailureDiagnosis (HyperAgent Phase 2).
--
-- Structured outcome + failure-diagnosis tables for the bounded self-healing
-- layer. The deterministic classifier (failure-classifier.ts) writes
-- FailureDiagnosis rows for security-block classes with deterministicBlock=true;
-- the Phase 4 LLM diagnostician may later add rootCause/evidence for ambiguous
-- (UNKNOWN) cases but MUST NOT mutate a row whose deterministicBlock=true.
--
-- Additive only: two new tables + FKs + indexes. No existing columns or rows
-- change. No data backfill — rows are created lazily per workflow run by the
-- Outcome Evaluator (Phase 3) and failure-classifier (Phase 2 seam).
--
-- Relations:
--   workflow_outcomes.workflowId  → workflows.id  (CASCADE)
--   workflow_outcomes.tenantId    → tenants.id    (CASCADE)
--   failure_diagnoses.workflowId  → workflows.id  (CASCADE)
--   failure_diagnoses.tenantId    → tenants.id    (CASCADE)
--   failure_diagnoses.outcomeId   → workflow_outcomes.id (SET NULL)

CREATE TABLE IF NOT EXISTS "workflow_outcomes" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "workflowId"        TEXT NOT NULL,
  "outcome"           TEXT NOT NULL DEFAULT 'OUTCOME_BLOCKED',
  "taskTotal"         INTEGER NOT NULL DEFAULT 0,
  "taskPassed"        INTEGER NOT NULL DEFAULT 0,
  "taskFailed"        INTEGER NOT NULL DEFAULT 0,
  "taskBlocked"       INTEGER NOT NULL DEFAULT 0,
  "acceptanceResults" JSONB,
  "totalCostUsd"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "durationMs"        INTEGER NOT NULL DEFAULT 0,
  "finalAutonomy"     TEXT,
  "summary"           TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_outcomes_pkey" PRIMARY KEY ("id")
);

-- One outcome per workflow.
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_outcomes_workflowId_key"
  ON "workflow_outcomes" ("workflowId");

CREATE INDEX IF NOT EXISTS "workflow_outcomes_tenantId_outcome_idx"
  ON "workflow_outcomes" ("tenantId", "outcome");

ALTER TABLE "workflow_outcomes"
  ADD CONSTRAINT "workflow_outcomes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_outcomes"
  ADD CONSTRAINT "workflow_outcomes_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "workflows" ("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE IF NOT EXISTS "failure_diagnoses" (
  "id"                     TEXT NOT NULL,
  "tenantId"               TEXT NOT NULL,
  "workflowId"             TEXT NOT NULL,
  "taskId"                 TEXT NOT NULL,
  "failureClass"           TEXT NOT NULL,
  "recommendedRepairLevel" TEXT NOT NULL,
  "deterministicBlock"     BOOLEAN NOT NULL DEFAULT false,
  "rootCause"              TEXT,
  "evidence"               JSONB,
  "confidence"             DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "recommendedChanges"     JSONB,
  "quarantine"             BOOLEAN NOT NULL DEFAULT false,
  "requiresApproval"       BOOLEAN NOT NULL DEFAULT false,
  "outcomeId"              TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "failure_diagnoses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "failure_diagnoses_tenantId_workflowId_idx"
  ON "failure_diagnoses" ("tenantId", "workflowId");

CREATE INDEX IF NOT EXISTS "failure_diagnoses_workflowId_taskId_idx"
  ON "failure_diagnoses" ("workflowId", "taskId");

CREATE INDEX IF NOT EXISTS "failure_diagnoses_failureClass_idx"
  ON "failure_diagnoses" ("failureClass");

ALTER TABLE "failure_diagnoses"
  ADD CONSTRAINT "failure_diagnoses_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "failure_diagnoses"
  ADD CONSTRAINT "failure_diagnoses_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "workflows" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "failure_diagnoses"
  ADD CONSTRAINT "failure_diagnoses_outcomeId_fkey"
  FOREIGN KEY ("outcomeId") REFERENCES "workflow_outcomes" ("id") ON DELETE SET NULL ON UPDATE CASCADE;