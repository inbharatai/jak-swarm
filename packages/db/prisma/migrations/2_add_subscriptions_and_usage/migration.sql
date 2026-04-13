-- Subscription: one per tenant, tracks plan, credits, caps
CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "creditsTotal" INTEGER NOT NULL DEFAULT 200,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "premiumTotal" INTEGER NOT NULL DEFAULT 0,
    "premiumUsed" INTEGER NOT NULL DEFAULT 0,
    "dailyUsed" INTEGER NOT NULL DEFAULT 0,
    "dailyCap" INTEGER NOT NULL DEFAULT 30,
    "perTaskCap" INTEGER NOT NULL DEFAULT 10,
    "concurrentCap" INTEGER NOT NULL DEFAULT 1,
    "maxModelTier" INTEGER NOT NULL DEFAULT 1,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dailyResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paddleSubId" TEXT,
    "paddleCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscriptions_tenantId_key" ON "subscriptions"("tenantId");
CREATE INDEX "subscriptions_paddleSubId_idx" ON "subscriptions"("paddleSubId");

ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Usage ledger: append-only record of every credit transaction
CREATE TABLE IF NOT EXISTS "usage_ledger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT,
    "taskType" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "creditsCost" INTEGER NOT NULL DEFAULT 0,
    "creditsReserved" INTEGER,
    "usdCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "usage_ledger_tenantId_createdAt_idx" ON "usage_ledger"("tenantId", "createdAt");
CREATE INDEX "usage_ledger_userId_createdAt_idx" ON "usage_ledger"("userId", "createdAt");
CREATE INDEX "usage_ledger_workflowId_idx" ON "usage_ledger"("workflowId");

-- Routing log: analytics on model selection decisions
CREATE TABLE IF NOT EXISTS "routing_log" (
    "id" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "selectedModel" TEXT NOT NULL,
    "selectedProvider" TEXT NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT FALSE,
    "score" DOUBLE PRECISION,
    "reason" TEXT,
    "userPlan" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "routing_log_taskType_createdAt_idx" ON "routing_log"("taskType", "createdAt");

-- Create free subscription for all existing tenants
INSERT INTO "subscriptions" ("id", "tenantId", "planId", "creditsTotal", "dailyCap", "perTaskCap", "concurrentCap", "maxModelTier", "periodEnd", "updatedAt")
SELECT
    'sub_' || "id",
    "id",
    'free',
    200,
    30,
    10,
    1,
    1,
    NOW() + INTERVAL '30 days',
    NOW()
FROM "tenants"
ON CONFLICT ("tenantId") DO NOTHING;
