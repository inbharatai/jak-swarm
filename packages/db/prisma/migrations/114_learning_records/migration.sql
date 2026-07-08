-- HyperAgent Phase 5 — self-learning records.
--
-- One row per extracted learning (candidate or promoted). The deterministic
-- Learning Extractor emits candidates from workflow_outcomes + failure_diagnoses;
-- the information-theoretic gate (innovation #2) decides promotion; the Bayesian
-- evidence-accrual cluster (innovation #5) may produce the winner; the hazard
-- model (innovation #10) governs expiry. Purely ADDITIVE — no existing table is
-- touched. The Tenant back-relation is added below.

CREATE TABLE "learning_records" (
    "id"                 TEXT           NOT NULL,
    "tenantId"           TEXT           NOT NULL,
    "key"                TEXT           NOT NULL,
    "kind"               TEXT           NOT NULL,
    "source"             TEXT           NOT NULL,
    "status"             TEXT           NOT NULL DEFAULT 'CANDIDATE',
    "value"              JSONB          NOT NULL,
    "summary"            TEXT           NOT NULL,
    "tags"               TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "failureClass"       TEXT,
    "outcomeVerdict"     TEXT,
    "taskVerdict"        TEXT,
    "contingency"        JSONB,
    "mutualInformation"  DOUBLE PRECISION,
    "hazard"             JSONB,
    "evidenceClusterId"  TEXT,
    "confidence"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promotedAt"         TIMESTAMP(3),
    "expiredAt"          TIMESTAMP(3),

    CONSTRAINT "learning_records_pkey" PRIMARY KEY ("id")
);

-- One learning per tenant per key — the gate merges new observations into the
-- existing record's contingency table rather than creating duplicates.
CREATE UNIQUE INDEX "learning_records_tenantId_key_unique"
    ON "learning_records"("tenantId", "key");

CREATE INDEX "learning_records_tenantId_status_idx"
    ON "learning_records"("tenantId", "status");
CREATE INDEX "learning_records_tenantId_kind_idx"
    ON "learning_records"("tenantId", "kind");
CREATE INDEX "learning_records_tenantId_source_idx"
    ON "learning_records"("tenantId", "source");

-- Tenant back-relation (cascade on tenant delete).
ALTER TABLE "learning_records"
    ADD CONSTRAINT "learning_records_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;