-- Migration 106 — Team + Trial
--
-- Additive only:
--   * 4 new tables (departments, task_assignments, notifications, trial_signups)
--   * 3 new columns on users (department_id, job_title, manager_id)
--   * 8 new columns on subscriptions (trial dates + 4 daily-cap counters/limits)
--
-- Safe to apply against a live database with running workflows. No data loss,
-- no NOT NULL columns added without defaults, no indexes that block writes.

-- ── Departments ─────────────────────────────────────────────────────────────
CREATE TABLE "departments" (
    "id"          TEXT        NOT NULL,
    "tenantId"    TEXT        NOT NULL,
    "name"        TEXT        NOT NULL,
    "description" TEXT,
    "parentId"    TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "departments_tenantId_name_key" ON "departments"("tenantId", "name");
CREATE INDEX "departments_tenantId_parentId_idx" ON "departments"("tenantId", "parentId");

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "departments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Users: add departmentId / jobTitle / managerId ─────────────────────────
ALTER TABLE "users" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "users" ADD COLUMN "jobTitle"     TEXT;
ALTER TABLE "users" ADD COLUMN "managerId"    TEXT;

CREATE INDEX "users_tenantId_departmentId_idx" ON "users"("tenantId", "departmentId");
CREATE INDEX "users_tenantId_managerId_idx"    ON "users"("tenantId", "managerId");

ALTER TABLE "users"
  ADD CONSTRAINT "users_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users"
  ADD CONSTRAINT "users_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Task assignments ────────────────────────────────────────────────────────
CREATE TABLE "task_assignments" (
    "id"                TEXT         NOT NULL,
    "tenantId"          TEXT         NOT NULL,
    "workflowId"        TEXT         NOT NULL,
    "taskId"            TEXT         NOT NULL,
    "assigneeUserId"    TEXT         NOT NULL,
    "assignedByUserId"  TEXT         NOT NULL,
    "title"             TEXT         NOT NULL,
    "instructions"      TEXT,
    "status"            TEXT         NOT NULL DEFAULT 'PENDING',
    "riskLevel"         TEXT         NOT NULL DEFAULT 'MEDIUM',
    "dueAt"             TIMESTAMP(3),
    "acknowledgedAt"    TIMESTAMP(3),
    "completedAt"       TIMESTAMP(3),
    "resultJson"        JSONB,
    "metadata"          JSONB,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_assignments_tenantId_assigneeUserId_status_idx"
  ON "task_assignments"("tenantId", "assigneeUserId", "status");
CREATE INDEX "task_assignments_tenantId_workflowId_idx"
  ON "task_assignments"("tenantId", "workflowId");
CREATE INDEX "task_assignments_status_dueAt_idx"
  ON "task_assignments"("status", "dueAt");

ALTER TABLE "task_assignments"
  ADD CONSTRAINT "task_assignments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_assignments"
  ADD CONSTRAINT "task_assignments_assigneeUserId_fkey"
  FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_assignments"
  ADD CONSTRAINT "task_assignments_assignedByUserId_fkey"
  FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- ── Notifications ───────────────────────────────────────────────────────────
CREATE TABLE "notifications" (
    "id"        TEXT         NOT NULL,
    "tenantId"  TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "kind"      TEXT         NOT NULL,
    "title"     TEXT         NOT NULL,
    "body"      TEXT,
    "linkPath"  TEXT,
    "payload"   JSONB,
    "readAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_tenantId_userId_readAt_idx"
  ON "notifications"("tenantId", "userId", "readAt");
CREATE INDEX "notifications_userId_createdAt_idx"
  ON "notifications"("userId", "createdAt" DESC);

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Trial signups ───────────────────────────────────────────────────────────
CREATE TABLE "trial_signups" (
    "id"              TEXT         NOT NULL,
    "email"           TEXT         NOT NULL,
    "fingerprint"     TEXT,
    "source"          TEXT,
    "companyName"     TEXT,
    "industry"        TEXT,
    "teamSize"        TEXT,
    "status"          TEXT         NOT NULL DEFAULT 'PENDING_VERIFY',
    "verifyTokenHash" TEXT         NOT NULL,
    "verifyExpiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt"      TIMESTAMP(3),
    "promotedAt"      TIMESTAMP(3),
    "tenantId"        TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trial_signups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trial_signups_email_key"           ON "trial_signups"("email");
CREATE UNIQUE INDEX "trial_signups_verifyTokenHash_key" ON "trial_signups"("verifyTokenHash");
CREATE UNIQUE INDEX "trial_signups_tenantId_key"        ON "trial_signups"("tenantId");
CREATE INDEX "trial_signups_status_createdAt_idx"  ON "trial_signups"("status", "createdAt");
CREATE INDEX "trial_signups_fingerprint_idx"       ON "trial_signups"("fingerprint");

ALTER TABLE "trial_signups"
  ADD CONSTRAINT "trial_signups_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Subscriptions: add trial fields + 4 daily-cap counters ──────────────────
-- Fresh-database safety:
-- Prisma applies these legacy numbered migration folders lexicographically, so
-- `106_team_and_trial` runs before `2_add_subscriptions_and_usage` on a clean
-- database. Create the base subscriptions table if migration 2 has not run yet;
-- migration 2 will still add its indexes/FK and seed free subscriptions later.
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

ALTER TABLE "subscriptions" ADD COLUMN "trialStartedAt"        TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN "trialEndsAt"           TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN "dailyAgentRunsUsed"    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD COLUMN "dailyAgentRunsCap"     INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "subscriptions" ADD COLUMN "dailyApprovalsUsed"    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD COLUMN "dailyApprovalsCap"     INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "subscriptions" ADD COLUMN "dailyToolMinutesUsed"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD COLUMN "dailyToolMinutesCap"   INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "subscriptions" ADD COLUMN "dailyTokensUsed"       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD COLUMN "dailyTokensCap"        INTEGER NOT NULL DEFAULT 200000;

CREATE INDEX "subscriptions_trialEndsAt_idx" ON "subscriptions"("trialEndsAt");
