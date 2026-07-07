-- Migration 110 — perf indexes on high-cardinality FK columns
--
-- Honest-audit finding (2026-07-07): several foreign-key columns that are
-- queried independently of their leading composite index had NO standalone
-- index, forcing seq scans on tables that grow fast (workflows,
-- agent_traces, audit_logs). This migration adds the missing indexes so
-- the common lookup patterns are O(log n):
--
--   • workflows.userId        — "list MY workflows" (WHERE userId = ?)
--     The existing @@index([tenantId, status]) and @@index([conversationId])
--     do not cover a tenantId-less / status-less userId lookup.
--   • agent_traces.runId      — per-run trace lookups (WHERE runId = ?);
--     6+ rows per workflow step, only workflowId/traceId/tenantId were indexed.
--   • audit_logs.(tenantId, userId) — user-centric audit queries; the existing
--     (tenantId, action) + (tenantId, createdAt) indexes do not cover a
--     userId-filtered scan within a tenant.
--
-- Additive only — creates non-unique indexes; no columns or rows change.
--
-- CONCURRENTLY note: same as migration 109 — `CREATE INDEX CONCURRENTLY`
-- cannot run inside the transaction Prisma wraps each migration in, so the
-- plain form is used. On a very large live table an operator may prefer to
-- create these manually with CONCURRENTLY during a maintenance window and
-- then mark this migration applied.

CREATE INDEX IF NOT EXISTS "workflows_userId_idx" ON "workflows"("userId");

CREATE INDEX IF NOT EXISTS "agent_traces_runId_idx" ON "agent_traces"("runId");

CREATE INDEX IF NOT EXISTS "audit_logs_tenantId_userId_idx" ON "audit_logs"("tenantId", "userId");