-- Migration 99 — MemoryItem approval-status fields
--
-- Originally part of `16_company_brain_intent_templates`, split out
-- because Prisma's lex+numeric-prefix sort applies migrations in the
-- order: 0, 1, 10, 10, 10, 11, 12, 13, 14, 15, 16, 2, 3, ..., 9
-- (and any `99_*` AFTER `9_*`). The original placement under 16 ran
-- BEFORE `3_memory_v2` created the table, causing CI failure
-- `relation "memory_items" does not exist`.
--
-- The `99_*` prefix sorts last because Prisma's sort:
--   compare-by-leading-digit-run; if both are digits, compare numerically;
--   the shorter run wins. So "9_*" < "99_*" because "9_*"'s digit run
--   ends at position 1 (with "_") while "99_*"'s ends at position 2.
--   Both share the leading "9", but "9_*" terminates the digit run first.
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
