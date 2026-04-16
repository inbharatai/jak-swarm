CREATE TABLE IF NOT EXISTS "whatsapp_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_links_phoneNumber_key"
    ON "whatsapp_links" ("phoneNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_links_tenant_user_key"
    ON "whatsapp_links" ("tenantId", "userId");

CREATE INDEX IF NOT EXISTS "whatsapp_links_tenant_idx"
    ON "whatsapp_links" ("tenantId");

ALTER TABLE "whatsapp_links"
    ADD CONSTRAINT "whatsapp_links_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_links"
    ADD CONSTRAINT "whatsapp_links_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
