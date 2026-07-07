-- Migration 99 — MemoryItem approval-status fields
--
-- Originally part of `16_company_brain_intent_templates`, split out
-- because Prisma applies migrations in lexicographic directory-name order.
-- The original placement under 16 ran BEFORE `3_memory_v2` created the
-- `memory_items` table, causing CI failure
-- `relation "memory_items" does not exist`.
--
-- Lexicographic order of the legacy numeric prefixes (verified):
--   0, 1, 10_oauth_state, 10_tenant_documents, 10_workflow_artifacts,
--   100..109, 11, 12, 13, 14, 15, 16, 2, 20260528…, 3, 4, 5, 6, 7, 8,
--   99_memory_item_status, 9_approval_audit_log, 99 comes BEFORE 9.
--
-- The key counter-intuitive fact: `99_*` sorts BEFORE `9_*` (not after),
-- because comparison is purely byte-wise on the full directory name and
-- at the second character `'9'` (0x39) < `'_'` (0x5F). Prisma does NOT
-- apply a numeric-prefix-aware sort — it is plain `Array.sort()` on the
-- dir name strings.
--
-- This migration is safe regardless: it only depends on `3_memory_v2`
-- (which creates `memory_items`), and `3_*` sorts before both `99_*` and
-- `9_*` (because `'3'` < `'9'`). The `ALTER TABLE IF EXISTS … ADD COLUMN
-- IF NOT EXISTS` guard below makes it safe to re-run and safe even if a
-- future restructure renames memory_items.
--
-- See packages/db/prisma/schema.prisma `MemoryItem` for field
-- documentation (status / suggestedBy / reviewedBy / reviewedAt).

-- Defensive `IF EXISTS` so this is safe to re-run + safe if a future
-- restructure renames memory_items.
ALTER TABLE IF EXISTS "memory_items"
  ADD COLUMN IF NOT EXISTS "status"      TEXT NOT NULL DEFAULT 'user_approved',
  ADD COLUMN IF NOT EXISTS "suggestedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedBy"  TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt"  TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "memory_items_tenantId_status_idx"
  ON "memory_items"("tenantId", "status");
