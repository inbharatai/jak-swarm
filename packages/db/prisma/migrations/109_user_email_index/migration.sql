-- Migration 109 — standalone email index on users
--
-- A.2 (perf): the login path (auth.service.ts:login) and Supabase identity
-- resolution (resolveSupabaseIdentity) query `WHERE email = ?` with no
-- tenantId. The existing @@unique([tenantId, email]) index has tenantId as
-- its leading column, so it cannot serve a tenantId-less email lookup
-- efficiently — those queries seq-scan the users table. This standalone
-- index makes them O(log n).
--
-- Additive only — creates a non-unique index; no columns or rows change.
--
-- Note on CONCURRENTLY: `CREATE INDEX CONCURRENTLY` cannot run inside the
-- transaction Prisma wraps each migration in, so we use the plain form
-- here so `prisma migrate deploy` succeeds reliably. On a very large live
-- users table an operator may prefer to create this index manually with
-- CONCURRENTLY during a maintenance window and then mark this migration
-- applied — but for typical sizes the plain-form lock duration is brief.

CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"("email");