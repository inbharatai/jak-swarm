-- Phase 1: Approval-gate honesty fix + forensic audit trail.
--
-- WHY THIS MIGRATION EXISTS
-- =========================
-- The landing page promises "human approval on every high-risk action." The
-- prior code only held up that promise if a tenant had left approvalThreshold
-- at its most-strict setting. Any tenant with a lower threshold would silently
-- auto-approve — a code-decided bypass the buyer never consented to.
--
-- Fix: auto-approve now requires an EXPLICIT tenant opt-in via a new boolean
-- column `autoApproveEnabled`. Default is FALSE for every new tenant going
-- forward, so the gate blocks until a human decides.
--
-- BACKWARD-COMPATIBILITY BACK-FILL
-- ================================
-- Existing tenants in production today have historically relied on the auto-
-- approve behavior (even if they never explicitly knew about it). Flipping
-- every row to the strict default overnight would break active workflows in
-- unknown ways. Back-fill strategy: every existing tenant is marked
-- autoApproveEnabled=true so their behavior is preserved exactly. Only tenants
-- created AFTER this migration runs get the new strict default (false).
-- Admins who want the strict default on an existing tenant can flip the
-- column via the tenant settings API.

-- ── Tenant.autoApproveEnabled ─────────────────────────────────────────────
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "autoApproveEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Back-fill: existing rows keep their current behavior (auto-approve on).
-- New tenants inserted after this migration get the strict default (false).
UPDATE "tenants"
  SET "autoApproveEnabled" = true
  WHERE "autoApproveEnabled" = false
    AND "createdAt" < NOW();

-- ── ApprovalAuditLog — append-only forensic trail ─────────────────────────
-- Every decision (auto-approval, human approval, rejection, deferral) is
-- recorded here. Rows are never updated or deleted in application code; only
-- a retention job (out of scope) may prune by tenant policy. This table is
-- the source of truth for "who approved X on date Y" compliance questions.
CREATE TABLE IF NOT EXISTS "approval_audit_logs" (
  "id"              TEXT PRIMARY KEY,
  "approvalId"      TEXT NOT NULL,
  "workflowId"      TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "taskId"          TEXT NOT NULL,
  "agentRole"       TEXT NOT NULL,
  "riskLevel"       TEXT NOT NULL,
  "decision"        TEXT NOT NULL,                     -- APPROVED | REJECTED | DEFERRED | AUTO_APPROVED
  "autoApproved"    BOOLEAN NOT NULL DEFAULT false,
  "approverId"      TEXT,                              -- null for auto-approvals
  "rationale"       TEXT,
  "rawDecisionJson" JSONB,
  "decidedAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

-- Tenant-scoped time-range queries: "show me all decisions in tenant X last month"
CREATE INDEX IF NOT EXISTS "approval_audit_logs_tenantId_decidedAt_idx"
  ON "approval_audit_logs" ("tenantId", "decidedAt");

-- Workflow-scoped lookup: "what approvals happened in this workflow run?"
CREATE INDEX IF NOT EXISTS "approval_audit_logs_workflowId_idx"
  ON "approval_audit_logs" ("workflowId");

-- Approval-scoped lookup: join back to ApprovalRequest row (soft FK — the
-- audit row survives approval_requests cleanup).
CREATE INDEX IF NOT EXISTS "approval_audit_logs_approvalId_idx"
  ON "approval_audit_logs" ("approvalId");
