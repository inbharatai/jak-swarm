-- 105_integration_status_enum
--
-- Convert Integration.status from free-form String to a Prisma enum.
--
-- Why: the no-half-measures audit (qa/no-half-measures-gap-audit-2026-04-30.md)
-- flagged this as a real type-safety gap. Today the column accepts ANY
-- string, which means a typo at a write site silently corrupts state.
-- The front-end normalizer (apps/web/src/lib/connection-status.ts) maps
-- bad values to NOT_CONNECTED, but the DB itself has no guarantee.
--
-- Strategy: ADDITIVE migration. We:
--   1. Create the new ConnectionStatus enum.
--   2. Backfill any existing free-form values to the closest enum value.
--   3. ALTER COLUMN to use the enum (Postgres safe — all values mapped).
--
-- Backwards-compatible: the prior known values (CONNECTED, DISCONNECTED,
-- EXPIRED, NEEDS_REAUTH, ERROR, PENDING) all map directly. Any unknown
-- legacy value becomes NOT_CONNECTED (the safest default — user can
-- click "Connect" again to repair).

-- Step 1: create the enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConnectionStatus') THEN
    CREATE TYPE "ConnectionStatus" AS ENUM (
      'CONNECTED',
      'NOT_CONNECTED',
      'NEEDS_REAUTH',
      'EXPIRED',
      'ERROR',
      'PENDING'
    );
  END IF;
END$$;

-- Step 2: backfill rows whose status doesn't match an enum value.
-- DISCONNECTED (a historical value) maps to NOT_CONNECTED.
-- Anything else unrecognised → NOT_CONNECTED (safest; user re-connects).
UPDATE "integrations"
SET "status" = 'NOT_CONNECTED'
WHERE "status" NOT IN (
  'CONNECTED', 'NEEDS_REAUTH', 'EXPIRED', 'ERROR', 'PENDING'
);

-- Step 3: convert the column to the enum.
-- USING clause runs once during ALTER for any remaining rows.
ALTER TABLE "integrations"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ConnectionStatus"
    USING ("status"::"ConnectionStatus"),
  ALTER COLUMN "status" SET DEFAULT 'CONNECTED';
