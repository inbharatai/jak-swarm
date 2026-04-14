-- Memory v2: scoped memory items + event log
CREATE TABLE IF NOT EXISTS "memory_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "memoryType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "source" TEXT,
    "sourceRunId" TEXT,
    "idempotencyKey" TEXT,
    "contentHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),

    CONSTRAINT "memory_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "memory_items_tenant_scope_key"
    ON "memory_items" ("tenantId", "scopeType", "scopeId", "key");

CREATE INDEX IF NOT EXISTS "memory_items_tenant_scope_idx"
    ON "memory_items" ("tenantId", "scopeType", "scopeId");

CREATE INDEX IF NOT EXISTS "memory_items_tenant_type_idx"
    ON "memory_items" ("tenantId", "memoryType");

CREATE INDEX IF NOT EXISTS "memory_items_tenant_updated_idx"
    ON "memory_items" ("tenantId", "updatedAt");

CREATE INDEX IF NOT EXISTS "memory_items_tenant_deleted_idx"
    ON "memory_items" ("tenantId", "deletedAt");

ALTER TABLE "memory_items"
    ADD CONSTRAINT "memory_items_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "memory_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "memoryItemId" TEXT,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "runId" TEXT,
    "idempotencyKey" TEXT,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "memory_events_tenant_idempotency_key"
    ON "memory_events" ("tenantId", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "memory_events_tenant_created_idx"
    ON "memory_events" ("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "memory_events_tenant_action_idx"
    ON "memory_events" ("tenantId", "action");

ALTER TABLE "memory_events"
    ADD CONSTRAINT "memory_events_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "memory_events"
    ADD CONSTRAINT "memory_events_memoryItemId_fkey"
    FOREIGN KEY ("memoryItemId") REFERENCES "memory_items"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Vector document scoping for multi-tenant memory segmentation
ALTER TABLE "vector_documents" ADD COLUMN IF NOT EXISTS "scopeType" TEXT;
ALTER TABLE "vector_documents" ADD COLUMN IF NOT EXISTS "scopeId" TEXT;
ALTER TABLE "vector_documents" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;

CREATE INDEX IF NOT EXISTS "vector_documents_tenant_scope_idx"
    ON "vector_documents" ("tenantId", "scopeType", "scopeId");

CREATE INDEX IF NOT EXISTS "vector_documents_tenant_sourceKey_idx"
    ON "vector_documents" ("tenantId", "sourceKey");

CREATE UNIQUE INDEX IF NOT EXISTS "vector_documents_source_chunk_key"
    ON "vector_documents" ("tenantId", "scopeType", "scopeId", "sourceKey", "chunkIndex");

UPDATE "vector_documents"
SET "scopeType" = 'TENANT',
    "scopeId" = "tenantId"
WHERE "scopeType" IS NULL OR "scopeId" IS NULL;

-- Backfill tenant_memory into memory_items (tenant scope)
INSERT INTO "memory_items" (
  "id",
  "tenantId",
  "scopeType",
  "scopeId",
  "key",
  "value",
  "memoryType",
  "confidence",
  "source",
  "sourceRunId",
  "idempotencyKey",
  "contentHash",
  "version",
  "expiresAt",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "lastAccessedAt"
)
SELECT
  "id",
  "tenantId",
  'TENANT',
  "tenantId",
  "key",
  "value",
  "memoryType",
  NULL,
  "source",
  NULL,
  'migration:' || "tenantId" || ':' || "key",
  md5(COALESCE("value"::text, '')),
  1,
  "expiresAt",
  "createdAt",
  "updatedAt",
  NULL,
  NULL
FROM "tenant_memory"
ON CONFLICT ("tenantId", "scopeType", "scopeId", "key") DO NOTHING;
