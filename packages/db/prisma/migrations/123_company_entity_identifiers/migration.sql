-- C2: indexed stable-identifier lookup for entity resolution + retrieval.
CREATE TABLE IF NOT EXISTS "company_entity_identifiers" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'none',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_entity_identifiers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "company_entity_identifiers_tenantId_kind_normalizedValue_source_key"
  ON "company_entity_identifiers"("tenantId","kind","normalizedValue","source");
CREATE INDEX IF NOT EXISTS "company_entity_identifiers_tenantId_entityId_idx"
  ON "company_entity_identifiers"("tenantId","entityId");
CREATE INDEX IF NOT EXISTS "company_entity_identifiers_tenantId_kind_normalizedValue_idx"
  ON "company_entity_identifiers"("tenantId","kind","normalizedValue");
ALTER TABLE "company_entity_identifiers"
  ADD CONSTRAINT "company_entity_identifiers_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "company_graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_entity_identifiers"
  ADD CONSTRAINT "company_entity_identifiers_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
