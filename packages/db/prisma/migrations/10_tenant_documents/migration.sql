-- Track 2: source-of-truth file storage for dashboard uploads.
--
-- Context: the dashboard needs an "upload contract.pdf → ask the agent to
-- review it" round-trip. Before this migration, the only way to get content
-- into the tenant's knowledge base was through the programmatic ingestion
-- path (DocumentIngestor.ingestText / ingestPDF), which had no browser-side
-- upload UI and no binary storage — the text was stored in Postgres as a
-- TEXT column, which does not scale and cannot serve back a preview of the
-- original PDF/DOCX/image.
--
-- This migration adds:
--   1. A dedicated `tenant_documents` table for file-level metadata. One row
--      per uploaded file. Raw bytes live in Supabase Storage keyed by
--      `tenant-documents/<tenantId>/<id>.<ext>`, never in this DB.
--   2. A `documentId` FK on `vector_documents` so chunks can be joined back
--      to the originating upload. Lifecycle: upload creates 1 tenant_document,
--      ingestion creates N vector_documents bound via documentId, delete
--      cascades both + removes the storage object.

-- ─── TenantDocument table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tenant_documents" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL,
  "uploadedBy"     TEXT,
  "fileName"       TEXT NOT NULL,
  "mimeType"       TEXT NOT NULL,
  "sizeBytes"      INTEGER NOT NULL,
  "storageKey"     TEXT NOT NULL UNIQUE,
  "contentHash"    TEXT,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "ingestionError" TEXT,
  "metadata"       JSONB,
  "tags"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "deletedAt"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "tenant_documents_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

-- Most-common lookups: list-by-tenant (sort desc), filter by status during
-- the PENDING → INDEXED transition, exclude soft-deleted rows in the Files tab.
CREATE INDEX IF NOT EXISTS "tenant_documents_tenantId_deletedAt_idx"
  ON "tenant_documents" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "tenant_documents_tenantId_status_idx"
  ON "tenant_documents" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "tenant_documents_tenantId_createdAt_idx"
  ON "tenant_documents" ("tenantId", "createdAt");

-- ─── vector_documents.documentId ───────────────────────────────────────────
-- Soft FK — the column is nullable so existing ingestion paths that predate
-- the upload flow (direct DocumentIngestor.ingestText calls) continue to work
-- without rewriting their callers. New chunks created from a TenantDocument
-- upload MUST populate this; we gate that invariant in the application layer.
ALTER TABLE "vector_documents"
  ADD COLUMN IF NOT EXISTS "documentId" TEXT;

CREATE INDEX IF NOT EXISTS "vector_documents_documentId_idx"
  ON "vector_documents" ("documentId");
