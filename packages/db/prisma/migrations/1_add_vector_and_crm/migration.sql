-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- VectorDocument: stores chunked document embeddings for RAG
CREATE TABLE IF NOT EXISTS "vector_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB,
    "sourceKey" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vector_documents_pkey" PRIMARY KEY ("id")
);

-- HNSW index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS "vector_documents_embedding_idx"
    ON "vector_documents" USING hnsw ("embedding" vector_cosine_ops);

-- Tenant + source type index for filtered queries
CREATE INDEX IF NOT EXISTS "vector_documents_tenantId_sourceType_idx"
    ON "vector_documents" ("tenantId", "sourceType");

-- Foreign key to tenants
ALTER TABLE "vector_documents"
    ADD CONSTRAINT "vector_documents_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CRM Contact
CREATE TABLE IF NOT EXISTS "crm_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT,
    "company" TEXT,
    "title" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'LEAD',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "crm_contacts_tenantId_idx"
    ON "crm_contacts" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_contacts_tenantId_email_key"
    ON "crm_contacts" ("tenantId", "email");

ALTER TABLE "crm_contacts"
    ADD CONSTRAINT "crm_contacts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CRM Note
CREATE TABLE IF NOT EXISTS "crm_notes" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_notes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "crm_notes"
    ADD CONSTRAINT "crm_notes_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CRM Deal
CREATE TABLE IF NOT EXISTS "crm_deals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "stage" TEXT NOT NULL DEFAULT 'PROSPECT',
    "probability" INTEGER NOT NULL DEFAULT 0,
    "expectedCloseDate" TIMESTAMP(3),
    "assignedTo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "crm_deals_tenantId_idx"
    ON "crm_deals" ("tenantId");

ALTER TABLE "crm_deals"
    ADD CONSTRAINT "crm_deals_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_deals"
    ADD CONSTRAINT "crm_deals_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
