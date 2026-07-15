-- C3: vector retrieval half. Embeddings live in a SEPARATE table so
-- `SELECT *` on company_graph_entities is unaffected (Prisma cannot deserialize
-- the pgvector `vector` type, so it must never be in a SELECT * on the main
-- table). One row per entity (PK entityId), hnsw cosine index. Populated by
-- maybeEmbedEntity when an embedding provider is configured; the retrieval
-- cosine channel joins this table. When embeddings are off the table is empty
-- and retrieval degrades to lexical+graph (unchanged behaviour).
CREATE TABLE IF NOT EXISTS "company_entity_embeddings" (
  "entityId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_entity_embeddings_pkey" PRIMARY KEY ("entityId"),
  CONSTRAINT "company_entity_embeddings_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "company_graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "company_entity_embeddings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "company_entity_embeddings_embedding_idx"
  ON "company_entity_embeddings" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "company_entity_embeddings_tenantId_idx"
  ON "company_entity_embeddings"("tenantId");
