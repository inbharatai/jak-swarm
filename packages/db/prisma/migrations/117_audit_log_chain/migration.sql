-- HyperAgent Phase 7 — AuditLog HMAC row-chain hashing (tamper-evidence).
--
-- Adds three columns to `audit_logs` so each row can be cryptographically
-- chained to the prior row in the SAME tenant:
--   prevHash  — the rowHash of the immediately-precediding row (null for the
--               first row in a tenant, or when the chain is inactive — see below);
--   rowHash   — HMAC-SHA256(tenantKey, canonicalJson({...row, prevHash})) where
--               tenantKey = HMAC-SHA256(EVIDENCE_SIGNING_SECRET, tenantId);
--   chainSeq  — per-tenant monotonic counter (0 for the first row / inactive).
--
-- All three are NULLABLE / defaulted so:
--   - existing rows stay valid (prevHash/rowHash null, chainSeq 0 — the chain
--     simply starts at the first row signed AFTER this migration);
--   - the unsigned path stays valid when EVIDENCE_SIGNING_SECRET is unset — the
--     chain runs INACTIVE (rowHash null) and is auditable, not tamper-evident.
--     This is intentional (fail-open-to-auditable, NOT fail-closed): an operator
--     who has not provisioned the secret still gets audit logging, just without
--     the tamper-evidence guarantee. verifyChain surfaces 'signing_unavailable'
--     so a reviewer knows the chain was inactive rather than silently trusting.
--
-- Purely ADDITIVE — no existing column is touched. The new `(tenantId, chainSeq)`
-- index backs the "fetch latest row" + "verify chain in order" queries.

ALTER TABLE "audit_logs"
  ADD COLUMN "prevHash"  TEXT,
  ADD COLUMN "rowHash"   TEXT,
  ADD COLUMN "chainSeq"  INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "audit_logs_tenantId_chainSeq_idx"
  ON "audit_logs" ("tenantId", "chainSeq");