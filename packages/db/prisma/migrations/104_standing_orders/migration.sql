-- Item C (OpenClaw-inspired Phase 1): standing-order autonomy boundaries.
--
-- Adds a new `standing_orders` table that bounds the autonomy of a
-- WorkflowSchedule (or applies tenant-globally when workflowScheduleId is
-- NULL). The scheduler service consults the linked StandingOrder at fire
-- time and enforces:
--   - allowedTools (whitelist), blockedActions (denylist)
--   - approvalRequiredFor (forces specific risk levels through approval gate)
--   - budgetUsd (lower-bound override for WorkflowSchedule.maxCostUsd)
--   - expiresAt (hard expiry — schedule stops firing once stale)
--
-- All changes are ADDITIVE — no existing row is mutated; the
-- WorkflowSchedule + Tenant columns are unchanged. Existing tenants
-- continue to operate exactly as before until they create their first
-- standing order.

CREATE TABLE "standing_orders" (
  "id"                  TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "workflowScheduleId"  TEXT,
  "name"                TEXT NOT NULL,
  "description"         TEXT,
  "allowedTools"        TEXT[] DEFAULT ARRAY[]::TEXT[],
  "blockedActions"      TEXT[] DEFAULT ARRAY[]::TEXT[],
  "approvalRequiredFor" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "allowedSources"      TEXT[] DEFAULT ARRAY[]::TEXT[],
  "budgetUsd"           DOUBLE PRECISION,
  "expiresAt"           TIMESTAMP(3),
  "enabled"             BOOLEAN NOT NULL DEFAULT true,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "standing_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "standing_orders_tenantId_enabled_idx"
  ON "standing_orders"("tenantId", "enabled");

CREATE INDEX "standing_orders_workflowScheduleId_idx"
  ON "standing_orders"("workflowScheduleId");

CREATE INDEX "standing_orders_expiresAt_idx"
  ON "standing_orders"("expiresAt");

ALTER TABLE "standing_orders"
  ADD CONSTRAINT "standing_orders_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "standing_orders"
  ADD CONSTRAINT "standing_orders_workflowScheduleId_fkey"
  FOREIGN KEY ("workflowScheduleId") REFERENCES "workflow_schedules"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
