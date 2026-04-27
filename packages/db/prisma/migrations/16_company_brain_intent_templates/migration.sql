-- Migration 16 — Company Brain + Intent vocabulary + Workflow templates
--
-- Additive only — creates 4 new tables (no changes to existing tables).
--
-- ORDERING NOTE: this migration is split from the original combined
-- file because Prisma's sort places `16_*` BEFORE `3_memory_v2`
-- (the lex+numeric-prefix sort applied by `prisma migrate deploy`
-- yields: 0, 1, 10, 10, 10, 11, 12, 13, 14, 15, 16, 2, 3, ..., 9).
-- The `memory_items` ALTERs that originally lived here were moved to
-- migration `99_memory_item_status` so they sort after `3_memory_v2`
-- creates the table. See packages/db/prisma/migrations/99_*.
--
-- See packages/db/prisma/schema.prisma `CompanyProfile`,
-- `CompanyKnowledgeSource`, `IntentRecord`, `WorkflowTemplate` for
-- full field documentation.

-- ── company_profiles ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "company_profiles" (
    "id"                    TEXT NOT NULL,
    "tenantId"              TEXT NOT NULL,
    "name"                  TEXT,
    "industry"              TEXT,
    "description"           TEXT,
    "productsServices"      JSONB,
    "targetCustomers"       TEXT,
    "brandVoice"            TEXT,
    "competitors"           JSONB,
    "pricing"               TEXT,
    "websiteUrl"            TEXT,
    "goals"                 TEXT,
    "constraints"           TEXT,
    "preferredChannels"     JSONB,
    "status"                TEXT NOT NULL DEFAULT 'extracted',
    "extractionConfidence"  DOUBLE PRECISION,
    "sourceDocumentIds"     JSONB,
    "reviewedBy"            TEXT,
    "reviewedAt"            TIMESTAMP(3),
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,
    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_profiles_tenantId_key"
  ON "company_profiles"("tenantId");

ALTER TABLE "company_profiles"
  ADD CONSTRAINT "company_profiles_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── company_knowledge_sources ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "company_knowledge_sources" (
    "id"                TEXT NOT NULL,
    "tenantId"          TEXT NOT NULL,
    "url"               TEXT NOT NULL,
    "kind"              TEXT NOT NULL,
    "title"             TEXT,
    "lastCrawledAt"     TIMESTAMP(3),
    "lastCrawlStatus"   TEXT NOT NULL DEFAULT 'pending',
    "lastCrawlError"    TEXT,
    "vectorDocumentIds" JSONB,
    "createdBy"         TEXT NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    "deletedAt"         TIMESTAMP(3),
    CONSTRAINT "company_knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_knowledge_sources_tenantId_url_key"
  ON "company_knowledge_sources"("tenantId", "url");

CREATE INDEX IF NOT EXISTS "company_knowledge_sources_tenant_kind_deleted_idx"
  ON "company_knowledge_sources"("tenantId", "kind", "deletedAt");

-- ── intent_records ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "intent_records" (
    "id"                    TEXT NOT NULL,
    "tenantId"              TEXT NOT NULL,
    "workflowId"            TEXT,
    "userId"                TEXT NOT NULL,
    "rawInput"              TEXT NOT NULL,
    "intent"                TEXT NOT NULL,
    "intentConfidence"      DOUBLE PRECISION,
    "subFunction"           TEXT,
    "urgency"               INTEGER,
    "riskIndicators"        JSONB,
    "requiredOutputs"       JSONB,
    "workflowTemplateId"    TEXT,
    "clarificationNeeded"   BOOLEAN NOT NULL DEFAULT false,
    "clarificationQuestion" TEXT,
    "directAnswer"          TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intent_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "intent_records_tenant_intent_created_idx"
  ON "intent_records"("tenantId", "intent", "createdAt");

CREATE INDEX IF NOT EXISTS "intent_records_tenant_workflow_idx"
  ON "intent_records"("tenantId", "workflowId");

CREATE INDEX IF NOT EXISTS "intent_records_tenant_user_created_idx"
  ON "intent_records"("tenantId", "userId", "createdAt");

-- ── workflow_templates ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "workflow_templates" (
    "id"                       TEXT NOT NULL,
    "tenantId"                 TEXT,
    "intent"                   TEXT NOT NULL,
    "name"                     TEXT NOT NULL,
    "description"              TEXT NOT NULL,
    "tasksJson"                JSONB NOT NULL,
    "requiredCompanyContext"   JSONB,
    "requiredUserInputs"       JSONB,
    "approvalGates"            JSONB,
    "expectedArtifacts"        JSONB,
    "status"                   TEXT NOT NULL DEFAULT 'active',
    "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- Partial unique index — same intent+name allowed across different tenants
-- (tenant overrides) but unique within (NULL or specific tenant).
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_templates_tenant_intent_name_key"
  ON "workflow_templates"(COALESCE("tenantId", '__system'), "intent", "name");

CREATE INDEX IF NOT EXISTS "workflow_templates_intent_status_idx"
  ON "workflow_templates"("intent", "status");
