-- Migration 111 — HyperAgent tenant configuration (Phase 1).
--
-- Bounded self-healing + self-learning layer. One row per tenant; nullable
-- relation on Tenant so existing tenants are UNAFFECTED (no row = defaults:
-- hyperAgentEnabled=false, mode=OFF, autonomyLevel=L0, zero budget — i.e. the
-- current Swarm behaviour). The central, deterministic autonomy-policy
-- evaluator lives in packages/security/src/governance/autonomy-policy.ts and
-- reads these fields via evaluateForConfig(); this table is pure config.
--
-- Additive only: creates one new table + FK + unique index. No existing
-- columns or rows change. No data backfill — rows are created lazily when a
-- tenant opts into the HyperAgent feature.

CREATE TABLE IF NOT EXISTS "hyper_agent_configs" (
  "id"                                  TEXT NOT NULL,
  "tenantId"                            TEXT NOT NULL,
  "hyperAgentEnabled"                   BOOLEAN NOT NULL DEFAULT false,
  "hyperAgentMode"                      TEXT NOT NULL DEFAULT 'OFF',
  "autonomyLevel"                       TEXT NOT NULL DEFAULT 'L0',
  "maxHyperAgentIterations"             INTEGER NOT NULL DEFAULT 0,
  "maxExecutionRetries"                 INTEGER NOT NULL DEFAULT 2,
  "maxOutputRepairs"                    INTEGER NOT NULL DEFAULT 2,
  "maxPlanRepairs"                      INTEGER NOT NULL DEFAULT 1,
  "maxCapabilityRepairs"                INTEGER NOT NULL DEFAULT 1,
  "maxTotalCostUsd"                     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxDurationMs"                       INTEGER NOT NULL DEFAULT 0,
  "allowShadowOptimization"             BOOLEAN NOT NULL DEFAULT false,
  "allowCanaryOptimization"             BOOLEAN NOT NULL DEFAULT false,
  "allowCodePatchProposal"              BOOLEAN NOT NULL DEFAULT false,
  "requireApprovalForPromptPromotion"   BOOLEAN NOT NULL DEFAULT true,
  "requireApprovalForWorkflowPromotion" BOOLEAN NOT NULL DEFAULT true,
  "createdAt"                           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hyper_agent_configs_pkey" PRIMARY KEY ("id")
);

-- One config row per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS "hyper_agent_configs_tenantId_key"
  ON "hyper_agent_configs" ("tenantId");

-- FK to tenants; cascade on tenant delete so config dies with its tenant.
ALTER TABLE "hyper_agent_configs"
  ADD CONSTRAINT "hyper_agent_configs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;