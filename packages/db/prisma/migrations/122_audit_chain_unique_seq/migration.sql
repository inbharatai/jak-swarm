-- PR E (Phase 10) — AuditLog row-chain TOCTOU fix: per-tenant atomic sequence.
--
-- The Phase 7 chain (migration 117) assigned `chainSeq` with a read-then-write
-- `findFirst(orderBy createdAt desc) → JS prevSeq+1 → create` sequence with NO
-- transaction, NO lock, and NO unique constraint. Two concurrent writers for
-- the same tenant could both read the same latest row, both compute the same
-- `chainSeq`, and both insert — branching the chain (duplicate `chainSeq`,
-- duplicate `prevHash`). `verifyChain` would surface `broken_chain_link` for
-- the loser, but the corruption was already on disk.
--
-- This migration adds the DB-side BACKSTOP for the durable fix: a PARTIAL
-- UNIQUE index on `(tenantId, chainSeq)` that applies ONLY to SIGNED rows
-- (`rowHash IS NOT NULL`). The live write path (`appendChainedAuditRow` in
-- packages/security/src/audit/audit-chain.ts) now wraps the fetch+compute+insert
-- in one `pg_advisory_xact_lock(hashtext(tenantId))`-guarded transaction, so
-- concurrent same-tenant writers serialize. This index is the defense-in-depth
-- backstop: if anything ever slips the lock, the second insert hits a unique
-- violation, the transaction aborts, and the caller fail-opens to an unsigned
-- row (auditable, `verifyChain` reports `signing_unavailable`) — never silent.
--
-- Why PARTIAL (WHERE "rowHash" IS NOT NULL):
--   - The INACTIVE path (EVIDENCE_SIGNING_SECRET unset) writes `rowHash=NULL`
--     and `chainSeq=0` for EVERY row. A non-partial unique constraint would
--     reject the second unsigned row in a tenant — breaking fail-open-to-
--     auditable. The partial predicate excludes those rows entirely, so the
--     unsigned path is unaffected.
--   - Only SIGNED rows (the ones that form the tamper-evident chain) are
--     constrained to be unique per (tenantId, chainSeq).
--
-- PRECONDITION for production apply: if the database already contains
-- duplicate `(tenantId, chainSeq)` pairs among signed rows (the exact
-- corruption this fix prevents going forward), `CREATE UNIQUE INDEX` will
-- fail. The operator MUST reconcile those duplicates before applying this
-- migration (they are prior chain branches — treat as tamper evidence and
-- investigate, do NOT silently delete). On a clean / test DB there are none.
-- This is honest: the fix does not paper over pre-existing corruption.

CREATE UNIQUE INDEX "audit_logs_tenant_chainSeq_unique"
  ON "audit_logs" ("tenantId", "chainSeq")
  WHERE "rowHash" IS NOT NULL;