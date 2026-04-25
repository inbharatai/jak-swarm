-- Hardening pass — Audit & Compliance foundation.
--
-- Adds the WorkflowArtifact model + supporting indices. Non-destructive,
-- additive only. Existing workflows continue to work unchanged; the new
-- table only fills as agents/exports start producing artefacts.
--
-- The WorkflowArtifact model is documented in detail in
-- packages/db/prisma/schema.prisma (model WorkflowArtifact).
--
-- Approval-gating contract (enforced in artifact.service.ts):
--   approvalState='REQUIRES_APPROVAL' → download blocked
--   approvalState='APPROVED'          → download allowed
--   approvalState='REJECTED'          → download permanently blocked
--   approvalState='NOT_REQUIRED'      → download allowed (default)

-- ── workflow_artifacts table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "workflow_artifacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "taskId" TEXT,
    "producedBy" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "contentHash" TEXT,
    "inlineContent" TEXT,
    "storageKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvalState" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lastDownloadedBy" TEXT,
    "lastDownloadedAt" TIMESTAMP(3),
    "parentId" TEXT,
    "metadata" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "workflow_artifacts_pkey" PRIMARY KEY ("id")
);

-- storageKey is unique when set (NULL allowed for inline-only artefacts).
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_artifacts_storageKey_key"
  ON "workflow_artifacts"("storageKey")
  WHERE "storageKey" IS NOT NULL;

-- Tenant-scoped lookups (list + filter)
CREATE INDEX IF NOT EXISTS "workflow_artifacts_tenant_deleted_idx"
  ON "workflow_artifacts"("tenantId", "deletedAt");

-- Per-workflow listing
CREATE INDEX IF NOT EXISTS "workflow_artifacts_workflow_idx"
  ON "workflow_artifacts"("workflowId");

-- Filter by type within a tenant (Audit & Compliance UI uses this)
CREATE INDEX IF NOT EXISTS "workflow_artifacts_tenant_type_idx"
  ON "workflow_artifacts"("tenantId", "artifactType");

-- Filter by status within a tenant (READY-only listings, etc.)
CREATE INDEX IF NOT EXISTS "workflow_artifacts_tenant_status_idx"
  ON "workflow_artifacts"("tenantId", "status");

-- Foreign keys
ALTER TABLE "workflow_artifacts"
  ADD CONSTRAINT "workflow_artifacts_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "workflows"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_artifacts"
  ADD CONSTRAINT "workflow_artifacts_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "workflow_artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
