-- Item B (OpenClaw-inspired Phase 1): approval payload binding.
--
-- Adds proposedDataHash + reviewer-context fields to approval_requests
-- and a new approval_scopes table that persists the canonical hash of
-- the approved/rejected payload so a caller can never replay the same
-- approvalId for a different proposedData.
--
-- All changes are ADDITIVE — no existing row is mutated; existing
-- approval_requests pre-dating this migration have NULL hash + NULL
-- new fields. The decide route handles those rows by computing the
-- hash from the current proposedDataJson on first decide.

-- ─── approval_requests: add new optional columns ──────────────────────────
ALTER TABLE "approval_requests"
  ADD COLUMN "proposedDataHash" TEXT,
  ADD COLUMN "toolName"         TEXT,
  ADD COLUMN "filesAffected"    TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "externalService"  TEXT,
  ADD COLUMN "idempotencyKey"   TEXT,
  ADD COLUMN "expectedResult"   TEXT;

CREATE INDEX "approval_requests_proposedDataHash_idx"
  ON "approval_requests"("proposedDataHash");

-- ─── approval_scopes: new table ───────────────────────────────────────────
CREATE TABLE "approval_scopes" (
  "id"               TEXT NOT NULL,
  "approvalId"       TEXT NOT NULL,
  "proposedDataHash" TEXT NOT NULL,
  "decidedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decision"         TEXT NOT NULL,
  "approverId"       TEXT,

  CONSTRAINT "approval_scopes_pkey" PRIMARY KEY ("id")
);

-- One row per (approval, hash). Replaying the SAME hash is idempotent
-- (returns the original decision); replaying a DIFFERENT hash is
-- rejected by the route layer with APPROVAL_PAYLOAD_MISMATCH.
CREATE UNIQUE INDEX "approval_scopes_approvalId_proposedDataHash_key"
  ON "approval_scopes"("approvalId", "proposedDataHash");

CREATE INDEX "approval_scopes_approvalId_idx"
  ON "approval_scopes"("approvalId");

ALTER TABLE "approval_scopes"
  ADD CONSTRAINT "approval_scopes_approvalId_fkey"
  FOREIGN KEY ("approvalId") REFERENCES "approval_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
