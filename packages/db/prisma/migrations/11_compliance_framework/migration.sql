-- Audit & Compliance v1 — control framework mapping (e.g. SOC2 Type 2).
--
-- Three new tables + one summary table for attestations. Additive only;
-- no changes to existing models. Existing workflows continue unchanged.
-- See packages/db/prisma/schema.prisma `ComplianceFramework`,
-- `ComplianceControl`, `ControlEvidenceMapping`, `ControlAttestation`
-- for the full field documentation.
--
-- Seed data (frameworks + controls) is loaded by
-- `pnpm seed:compliance` against this schema. The seed is idempotent
-- (uses upsert by framework slug + control code).

-- ── compliance_frameworks ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "compliance_frameworks" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "compliance_frameworks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "compliance_frameworks_slug_key"
  ON "compliance_frameworks"("slug");

-- ── compliance_controls ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "compliance_controls" (
    "id" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "autoRuleKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "compliance_controls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "compliance_controls_frameworkId_code_key"
  ON "compliance_controls"("frameworkId", "code");

CREATE INDEX IF NOT EXISTS "compliance_controls_framework_category_idx"
  ON "compliance_controls"("frameworkId", "category", "sortOrder");

ALTER TABLE "compliance_controls"
  ADD CONSTRAINT "compliance_controls_frameworkId_fkey"
  FOREIGN KEY ("frameworkId") REFERENCES "compliance_frameworks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── control_evidence_mappings ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "control_evidence_mappings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "evidenceAt" TIMESTAMP(3) NOT NULL,
    "mappedBy" TEXT NOT NULL,
    "mappingSource" TEXT NOT NULL DEFAULT 'auto',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "control_evidence_mappings_pkey" PRIMARY KEY ("id")
);

-- Idempotency: re-running auto-mapper should not duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS "control_evidence_mappings_tenant_control_evidence_key"
  ON "control_evidence_mappings"("tenantId", "controlId", "evidenceType", "evidenceId");

CREATE INDEX IF NOT EXISTS "control_evidence_mappings_tenant_control_at_idx"
  ON "control_evidence_mappings"("tenantId", "controlId", "evidenceAt");

CREATE INDEX IF NOT EXISTS "control_evidence_mappings_tenant_at_idx"
  ON "control_evidence_mappings"("tenantId", "evidenceAt");

ALTER TABLE "control_evidence_mappings"
  ADD CONSTRAINT "control_evidence_mappings_controlId_fkey"
  FOREIGN KEY ("controlId") REFERENCES "compliance_controls"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── control_attestations ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "control_attestations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "controlSummary" JSONB NOT NULL,
    "totalEvidence" INTEGER NOT NULL,
    "coveragePercent" DOUBLE PRECISION NOT NULL,
    "artifactId" TEXT,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "control_attestations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "control_attestations_tenant_framework_at_idx"
  ON "control_attestations"("tenantId", "frameworkId", "createdAt");
