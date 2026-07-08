-- HyperAgent Phase 12 — bounded code self-repair (R5) proposals.
--
-- CodeRepairProposal — one row per R5 code-repair proposal. The agent PROPOSES a
-- patch from a failure_diagnosis; the pure policy gate (code-repair.ts in swarm)
-- classifies it SAFE / NEEDS_REVIEW / FORBIDDEN and refuses to create a branch
-- for any FORBIDDEN proposal (branch protection / CI / secrets / Shield /
-- approval controls / governance / migrations / CRITICAL risk). The repair moves
-- through a bounded lifecycle DRAFT → BRANCH_CREATED → PR_OPENED → PR_DRAFT
-- (terminal, human-owned — the agent NEVER merges its own PR and NEVER deploys).
--
-- Purely ADDITIVE — no existing table is touched. The Tenant + FailureDiagnosis
-- back-relations are added below.

CREATE TABLE "code_repair_proposals" (
    "id"                  TEXT           NOT NULL,
    "tenantId"            TEXT           NOT NULL,
    "failureDiagnosisId"  TEXT,
    "kind"                TEXT           NOT NULL,
    "status"              TEXT           NOT NULL DEFAULT 'DRAFT',
    "targetFiles"         TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "targetSymbol"        TEXT,
    "description"         TEXT           NOT NULL,
    "patchDiff"           TEXT           NOT NULL,
    "rationale"           TEXT           NOT NULL,
    "risk"                TEXT           NOT NULL,
    "safetyClass"         TEXT           NOT NULL,
    "branchName"          TEXT           NOT NULL,
    "prUrl"               TEXT,
    "prNumber"            INTEGER,
    "createdBy"           TEXT           NOT NULL,
    "createdAt"           TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3)   NOT NULL,

    CONSTRAINT "code_repair_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "code_repair_proposals_tenantId_status_idx"
    ON "code_repair_proposals"("tenantId", "status");
CREATE INDEX "code_repair_proposals_tenantId_kind_idx"
    ON "code_repair_proposals"("tenantId", "kind");
CREATE INDEX "code_repair_proposals_failureDiagnosisId_idx"
    ON "code_repair_proposals"("failureDiagnosisId");

ALTER TABLE "code_repair_proposals"
    ADD CONSTRAINT "code_repair_proposals_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "code_repair_proposals"
    ADD CONSTRAINT "code_repair_proposals_failureDiagnosisId_fkey"
    FOREIGN KEY ("failureDiagnosisId") REFERENCES "failure_diagnoses"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;