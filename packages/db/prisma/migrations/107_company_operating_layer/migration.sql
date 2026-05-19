-- Migration 107 — Company Operating Layer / YC closed-loop foundation.
--
-- Adds tenant-scoped primitives for:
--   1. Raw company artifacts from connectors/uploads.
--   2. Normalized graph entities extracted from artifacts.
--   3. Execution drift findings comparing intent/customer signal vs work.
--   4. Agent-executable specs generated from evidence and reviewed by humans.

CREATE TABLE IF NOT EXISTS "company_artifacts" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "sourceType"      TEXT NOT NULL,
  "artifactType"    TEXT NOT NULL,
  "externalId"      TEXT,
  "sourceUrl"       TEXT,
  "title"           TEXT NOT NULL,
  "body"            TEXT NOT NULL,
  "bodyHash"        TEXT NOT NULL,
  "authorName"      TEXT,
  "occurredAt"      TIMESTAMP(3),
  "metadata"        JSONB,
  "ingestionStatus" TEXT NOT NULL DEFAULT 'ingested',
  "extractedAt"     TIMESTAMP(3),
  "createdBy"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"       TIMESTAMP(3),

  CONSTRAINT "company_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_artifacts_tenantId_sourceType_externalId_key"
  ON "company_artifacts"("tenantId", "sourceType", "externalId");

CREATE INDEX IF NOT EXISTS "company_artifacts_tenant_source_type_time_idx"
  ON "company_artifacts"("tenantId", "sourceType", "artifactType", "occurredAt");

CREATE INDEX IF NOT EXISTS "company_artifacts_tenant_deleted_created_idx"
  ON "company_artifacts"("tenantId", "deletedAt", "createdAt");

ALTER TABLE "company_artifacts"
  ADD CONSTRAINT "company_artifacts_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "company_graph_entities" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "primaryArtifactId" TEXT,
  "entityType"        TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "summary"           TEXT NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'active',
  "ownerName"         TEXT,
  "priority"          TEXT,
  "confidence"        DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "occurredAt"        TIMESTAMP(3),
  "dueAt"             TIMESTAMP(3),
  "sourceArtifactIds" JSONB NOT NULL,
  "relatedEntityIds"  JSONB,
  "properties"        JSONB,
  "extractedBy"       TEXT NOT NULL DEFAULT 'openai',
  "createdBy"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"         TIMESTAMP(3),

  CONSTRAINT "company_graph_entities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "company_graph_entities_tenant_type_status_updated_idx"
  ON "company_graph_entities"("tenantId", "entityType", "status", "updatedAt");

CREATE INDEX IF NOT EXISTS "company_graph_entities_tenant_owner_idx"
  ON "company_graph_entities"("tenantId", "ownerName");

CREATE INDEX IF NOT EXISTS "company_graph_entities_tenant_priority_idx"
  ON "company_graph_entities"("tenantId", "priority");

ALTER TABLE "company_graph_entities"
  ADD CONSTRAINT "company_graph_entities_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_graph_entities"
  ADD CONSTRAINT "company_graph_entities_primaryArtifactId_fkey"
  FOREIGN KEY ("primaryArtifactId") REFERENCES "company_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "execution_drift_findings" (
  "id"                  TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "fingerprint"         TEXT NOT NULL,
  "driftType"           TEXT NOT NULL,
  "severity"            TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'open',
  "title"               TEXT NOT NULL,
  "summary"             TEXT NOT NULL,
  "recommendation"      TEXT NOT NULL,
  "evidenceArtifactIds" JSONB NOT NULL,
  "evidenceEntityIds"   JSONB NOT NULL,
  "confidence"          DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  "detectedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"          TIMESTAMP(3),
  "metadata"            JSONB,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "execution_drift_findings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "execution_drift_findings_tenantId_fingerprint_key"
  ON "execution_drift_findings"("tenantId", "fingerprint");

CREATE INDEX IF NOT EXISTS "execution_drift_findings_tenant_status_severity_detected_idx"
  ON "execution_drift_findings"("tenantId", "status", "severity", "detectedAt");

CREATE INDEX IF NOT EXISTS "execution_drift_findings_tenant_drift_type_idx"
  ON "execution_drift_findings"("tenantId", "driftType");

ALTER TABLE "execution_drift_findings"
  ADD CONSTRAINT "execution_drift_findings_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "agent_executable_specs" (
  "id"                  TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "driftFindingId"      TEXT,
  "title"               TEXT NOT NULL,
  "problemStatement"    TEXT NOT NULL,
  "objective"           TEXT NOT NULL,
  "contextSummary"      TEXT NOT NULL,
  "proposedApproach"    TEXT NOT NULL,
  "acceptanceCriteria"  JSONB NOT NULL,
  "testPlan"            JSONB NOT NULL,
  "agentTaskPlan"       JSONB NOT NULL,
  "approvalGates"       JSONB NOT NULL,
  "evidenceArtifactIds" JSONB NOT NULL,
  "evidenceEntityIds"   JSONB NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'draft',
  "generatedBy"         TEXT NOT NULL DEFAULT 'openai',
  "reviewedBy"          TEXT,
  "reviewedAt"          TIMESTAMP(3),
  "reviewComment"       TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"           TIMESTAMP(3),

  CONSTRAINT "agent_executable_specs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_executable_specs_tenant_status_created_idx"
  ON "agent_executable_specs"("tenantId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "agent_executable_specs_tenant_drift_finding_idx"
  ON "agent_executable_specs"("tenantId", "driftFindingId");

ALTER TABLE "agent_executable_specs"
  ADD CONSTRAINT "agent_executable_specs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_executable_specs"
  ADD CONSTRAINT "agent_executable_specs_driftFindingId_fkey"
  FOREIGN KEY ("driftFindingId") REFERENCES "execution_drift_findings"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
