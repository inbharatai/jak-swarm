-- Phase 3: entity-merge metadata + rejected/deferred-candidate preservation.
--
-- `company_entity_merges` gains two audit columns so a reviewer can reconstruct
-- *why* two entities were considered the same canonical thing:
--   algorithmVersion  — the resolver tier-system version that produced the merge
--                       (e.g. 'entity-resolver-v1'); bumped only when the tier
--                       order, identifier keys or thresholds change.
--   matchingEvidence  — JSONB describing the dispositive evidence: tier, the
--                       matched identifier/alias, similarity, etc.
--
-- A NEW table `company_entity_merge_rejections` preserves merge candidates
-- that were considered but NOT auto-merged, so:
--   (a) a deferred probabilistic-match (tier 5) is not re-proposed as a fresh
--       review on every artifact re-extraction (idempotency), and
--   (b) a human-rejected merge is never re-proposed by the resolver
--       (no re-litigating settled identity decisions — "never overwrite company
--       truth without evidence and policy").
--
-- The UNIQUE(tenantId, sourceEntityId, candidateEntityId) constraint makes the
-- record idempotent per entity pair: an INSERT ... ON CONFLICT DO NOTHING keeps
-- the EARLIEST decision (first deferred, or escalates to rejected). Source/
-- candidate entities cascade-delete from company_graph_entities, so a completed
-- merge (source soft-deleted) cleans up its own rejection rows.

ALTER TABLE "company_entity_merges"
  ADD COLUMN IF NOT EXISTS "algorithmVersion" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "matchingEvidence" JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS "company_entity_merges_tenant_target_idx"
  ON "company_entity_merges"("tenantId","targetEntityId","createdAt" DESC);

CREATE TABLE IF NOT EXISTS "company_entity_merge_rejections" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceEntityId" TEXT NOT NULL REFERENCES "company_graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "candidateEntityId" TEXT NOT NULL REFERENCES "company_graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "decision" TEXT NOT NULL CHECK ("decision" IN ('deferred', 'rejected')),
  "algorithmVersion" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "similarity" DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK ("similarity" BETWEEN 0 AND 1),
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "decidedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_entity_merge_rejections_pair_key" UNIQUE ("tenantId", "sourceEntityId", "candidateEntityId")
);

CREATE INDEX IF NOT EXISTS "company_entity_merge_rejections_source_idx"
  ON "company_entity_merge_rejections"("tenantId","sourceEntityId","createdAt" DESC);
CREATE INDEX IF NOT EXISTS "company_entity_merge_rejections_decision_idx"
  ON "company_entity_merge_rejections"("tenantId","sourceEntityId","candidateEntityId","decision");