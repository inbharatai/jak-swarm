-- Manual migration: add conversation memory tables
-- Applied 2026-05-28 as part of Task #27

-- Add conversationId to Workflow
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
CREATE INDEX IF NOT EXISTS "workflows_conversationId_idx" ON "workflows"("conversationId");

-- Create Conversation table
CREATE TABLE IF NOT EXISTS "conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "conversations_tenantId_userId_updatedAt_idx" ON "conversations"("tenantId", "userId", "updatedAt");

-- Create ConversationMessage table
CREATE TABLE IF NOT EXISTS "conversation_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workflowId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "agentRole" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "conversation_messages_conversationId_createdAt_idx" ON "conversation_messages"("conversationId", "createdAt");

-- Add foreign keys
ALTER TABLE "workflows"
    ADD CONSTRAINT "workflows_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_messages"
    ADD CONSTRAINT "conversation_messages_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_messages"
    ADD CONSTRAINT "conversation_messages_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "workflows"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
