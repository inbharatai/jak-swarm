-- HyperAgent Phase 9 — versioned self-modification configs + rollout audit trail.
--
-- ConfigVersion — one row per immutable, versioned config document (autonomy
-- policy, repair budget, learning gate, governance rule, tool policy). A version
-- moves through a bounded lifecycle DRAFT → PROPOSED → SHADOW → CANARY → PROMOTED
-- (or ROLLED_BACK at any gate); promotion supersedes the prior PROMOTED version.
-- The pure lifecycle gate (config-lifecycle.ts) decides legality + evaluates
-- shadow/canary metrics before advancing; the LLM may PROPOSE, only the gate
-- ADVANCES. `spec` is JSONB, typed per kind by the caller.
--
-- ConfigRolloutEvent — the immutable audit trail of every lifecycle transition
-- (one row per transition), so an auditor can replay the exact rollout path a
-- config took. Purely ADDITIVE — no existing table is touched. The Tenant
-- back-relations are added below.

CREATE TABLE "config_versions" (
    "id"                TEXT           NOT NULL,
    "tenantId"          TEXT           NOT NULL,
    "kind"              TEXT           NOT NULL,
    "version"           INTEGER        NOT NULL,
    "spec"              JSONB          NOT NULL,
    "status"            TEXT           NOT NULL DEFAULT 'DRAFT',
    "parentVersionId"   TEXT,
    "supersededById"    TEXT,
    "rolloutPercent"    INTEGER        NOT NULL DEFAULT 0,
    "createdAt"         TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposedAt"        TIMESTAMP(3),
    "shadowStartedAt"   TIMESTAMP(3),
    "canaryStartedAt"   TIMESTAMP(3),
    "promotedAt"        TIMESTAMP(3),
    "rolledBackAt"      TIMESTAMP(3),
    "changeReason"      TEXT,
    "evaluationSummary" TEXT,

    CONSTRAINT "config_versions_pkey" PRIMARY KEY ("id")
);

-- One version per tenant per kind per version number.
CREATE UNIQUE INDEX "config_versions_tenantId_kind_version_unique"
    ON "config_versions"("tenantId", "kind", "version");

CREATE INDEX "config_versions_tenantId_kind_status_idx"
    ON "config_versions"("tenantId", "kind", "status");
CREATE INDEX "config_versions_tenantId_status_idx"
    ON "config_versions"("tenantId", "status");

ALTER TABLE "config_versions"
    ADD CONSTRAINT "config_versions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "config_rollout_events" (
    "id"              TEXT           NOT NULL,
    "configVersionId" TEXT           NOT NULL,
    "tenantId"        TEXT           NOT NULL,
    "fromStatus"      TEXT           NOT NULL,
    "toStatus"        TEXT           NOT NULL,
    "stage"           TEXT,
    "decision"        TEXT,
    "rolloutPercent"  INTEGER        NOT NULL DEFAULT 0,
    "reason"          TEXT           NOT NULL,
    "occurredAt"      TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_rollout_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "config_rollout_events_tenantId_configVersionId_idx"
    ON "config_rollout_events"("tenantId", "configVersionId");
CREATE INDEX "config_rollout_events_configVersionId_occurredAt_idx"
    ON "config_rollout_events"("configVersionId", "occurredAt");

ALTER TABLE "config_rollout_events"
    ADD CONSTRAINT "config_rollout_events_configVersionId_fkey"
    FOREIGN KEY ("configVersionId") REFERENCES "config_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "config_rollout_events"
    ADD CONSTRAINT "config_rollout_events_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;