-- Migration 16 — Company Brain + Intent vocabulary + Workflow templates
--
-- Additive only — no changes to existing tables (memory_items adds 4
-- nullable columns + 1 index; everything else is new tables).
--
-- See packages/db/prisma/schema.prisma `CompanyProfile`,
-- `CompanyKnowledgeSource`, `IntentRecord`, `WorkflowTemplate`,
-- `MemoryItem.status/suggestedBy/reviewedBy/reviewedAt` for full
-- field documentation.

-- ── memory_items: add approval-status fields ──────────────────────────

ALTER TABLE "memory_items"
  ADD COLUMN IF NOT EXISTS "status"      TEXT NOT NULL DEFAULT 'user_approved',
  ADD COLUMN IF NOT EXISTS "suggestedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedBy"  TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt"  TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "memory_items_tenantId_status_idx"
  ON "memory_items"("tenantId", "status");

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
