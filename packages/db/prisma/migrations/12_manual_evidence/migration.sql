-- Manual evidence — human-curated control evidence rows.
--
-- Additive only. Used by the Compliance UI tab "Add manual evidence"
-- form to attach organisational policy documents, signed BAAs,
-- vendor SOC reports, training records, etc. — anything no audit log
-- can demonstrate.
--
-- See packages/db/prisma/schema.prisma `ManualEvidence` for full field
-- documentation.

CREATE TABLE IF NOT EXISTS "manual_evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "attachedArtifactId" TEXT,
    "createdBy" TEXT NOT NULL,
    "evidenceAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "manual_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "manual_evidence_tenant_control_deleted_idx"
  ON "manual_evidence"("tenantId", "controlId", "deletedAt");

CREATE INDEX IF NOT EXISTS "manual_evidence_tenant_at_idx"
  ON "manual_evidence"("tenantId", "evidenceAt");
