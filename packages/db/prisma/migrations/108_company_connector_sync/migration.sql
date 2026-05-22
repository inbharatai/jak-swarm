-- Migration 108 — Company connector sync state + run history
--
-- Adds durable persistence for wave-1 Company OS auto-sync providers:
-- GITHUB, GMAIL, GOOGLE_DRIVE.
--
-- This migration is additive only:
--   - company_connector_sync_states (one row per tenant+provider)
--   - company_connector_sync_runs (append-only run history)

CREATE TABLE IF NOT EXISTS "company_connector_sync_states" (
  "id"                  TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "provider"            TEXT NOT NULL,
  "integrationProvider" TEXT,
  "status"              TEXT NOT NULL DEFAULT 'not_connected',
  "cursorJson"          JSONB,
  "lastSyncedAt"        TIMESTAMP(3),
  "lastSuccessAt"       TIMESTAMP(3),
  "lastError"           TEXT,
  "lastErrorAt"         TIMESTAMP(3),
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "company_connector_sync_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_connector_sync_states_tenant_provider_key"
  ON "company_connector_sync_states"("tenantId", "provider");

CREATE INDEX IF NOT EXISTS "company_connector_sync_states_tenant_status_updated_idx"
  ON "company_connector_sync_states"("tenantId", "status", "updatedAt");

ALTER TABLE "company_connector_sync_states"
  ADD CONSTRAINT "company_connector_sync_states_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "company_connector_sync_runs" (
  "id"               TEXT NOT NULL,
  "syncStateId"      TEXT,
  "tenantId"         TEXT NOT NULL,
  "provider"         TEXT NOT NULL,
  "trigger"          TEXT NOT NULL DEFAULT 'scheduled',
  "status"           TEXT NOT NULL DEFAULT 'running',
  "startedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"      TIMESTAMP(3),
  "durationMs"       INTEGER,
  "fetchedCount"     INTEGER NOT NULL DEFAULT 0,
  "ingestedCount"    INTEGER NOT NULL DEFAULT 0,
  "skippedCount"     INTEGER NOT NULL DEFAULT 0,
  "errorMessage"     TEXT,
  "cursorBeforeJson" JSONB,
  "cursorAfterJson"  JSONB,
  "metadata"         JSONB,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "company_connector_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "company_connector_sync_runs_tenant_provider_started_idx"
  ON "company_connector_sync_runs"("tenantId", "provider", "startedAt");

CREATE INDEX IF NOT EXISTS "company_connector_sync_runs_tenant_status_started_idx"
  ON "company_connector_sync_runs"("tenantId", "status", "startedAt");

CREATE INDEX IF NOT EXISTS "company_connector_sync_runs_sync_state_started_idx"
  ON "company_connector_sync_runs"("syncStateId", "startedAt");

ALTER TABLE "company_connector_sync_runs"
  ADD CONSTRAINT "company_connector_sync_runs_syncStateId_fkey"
  FOREIGN KEY ("syncStateId") REFERENCES "company_connector_sync_states"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "company_connector_sync_runs"
  ADD CONSTRAINT "company_connector_sync_runs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
