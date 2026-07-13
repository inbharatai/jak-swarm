-- Company Brain Graph V2 (additive)
CREATE TABLE IF NOT EXISTS "company_artifact_policies" (
  "artifactId" TEXT PRIMARY KEY REFERENCES "company_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "visibility" TEXT NOT NULL DEFAULT 'internal',
  "allowedAgentRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sensitivity" TEXT NOT NULL DEFAULT 'normal',
  "retentionUntil" TIMESTAMP(3),
  "processingState" TEXT NOT NULL DEFAULT 'ingested',
  "processingAttempts" INTEGER NOT NULL DEFAULT 0,
  "processingError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_artifact_policies_visibility_check" CHECK ("visibility" IN ('public','internal','restricted')),
  CONSTRAINT "company_artifact_policies_sensitivity_check" CHECK ("sensitivity" IN ('normal','confidential','highly_confidential')),
  CONSTRAINT "company_artifact_policies_state_check" CHECK ("processingState" IN ('ingested','processing','ready','failed')),
  CONSTRAINT "company_artifact_policies_attempts_check" CHECK ("processingAttempts" >= 0)
);
CREATE INDEX IF NOT EXISTS "company_artifact_policies_tenant_visibility_idx" ON "company_artifact_policies"("tenantId","visibility");
CREATE INDEX IF NOT EXISTS "company_artifact_policies_tenant_retention_idx" ON "company_artifact_policies"("tenantId","retentionUntil");
CREATE INDEX IF NOT EXISTS "company_artifact_policies_tenant_state_idx" ON "company_artifact_policies"("tenantId","processingState");

CREATE TABLE IF NOT EXISTS "company_entity_aliases" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "entityId" TEXT NOT NULL REFERENCES "company_graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "entityType" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  "normalizedAlias" TEXT NOT NULL,
  "sourceArtifactId" TEXT REFERENCES "company_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK ("confidence" BETWEEN 0 AND 1),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "company_entity_aliases_tenant_type_normalized_key" ON "company_entity_aliases"("tenantId","entityType","normalizedAlias");
CREATE INDEX IF NOT EXISTS "company_entity_aliases_entityId_idx" ON "company_entity_aliases"("entityId");

CREATE TABLE IF NOT EXISTS "company_claims" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "subjectEntityId" TEXT NOT NULL REFERENCES "company_graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "predicate" TEXT NOT NULL,
  "objectEntityId" TEXT REFERENCES "company_graph_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "objectValue" JSONB,
  "normalizedObject" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK ("confidence" BETWEEN 0 AND 1),
  "authorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK ("authorityScore" BETWEEN 0 AND 1),
  "validFrom" TIMESTAMP(3), "validTo" TIMESTAMP(3),
  "supersedesClaimId" TEXT REFERENCES "company_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdBy" TEXT, "reviewedBy" TEXT, "reviewedAt" TIMESTAMP(3), "reviewComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_claims_status_check" CHECK ("status" IN ('proposed','active','disputed','superseded','rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "company_claims_tenant_fingerprint_key" ON "company_claims"("tenantId","fingerprint");
CREATE INDEX IF NOT EXISTS "company_claims_subject_predicate_status_idx" ON "company_claims"("tenantId","subjectEntityId","predicate","status");
CREATE INDEX IF NOT EXISTS "company_claims_objectEntityId_idx" ON "company_claims"("objectEntityId");
CREATE INDEX IF NOT EXISTS "company_claims_updatedAt_idx" ON "company_claims"("tenantId","updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "company_claim_evidence" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "claimId" TEXT NOT NULL REFERENCES "company_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "artifactId" TEXT NOT NULL REFERENCES "company_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "excerpt" TEXT,
  "sourceAuthority" DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK ("sourceAuthority" BETWEEN 0 AND 1),
  "observedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "company_claim_evidence_claim_artifact_key" ON "company_claim_evidence"("claimId","artifactId");
CREATE INDEX IF NOT EXISTS "company_claim_evidence_tenant_artifact_idx" ON "company_claim_evidence"("tenantId","artifactId");

CREATE TABLE IF NOT EXISTS "company_edges" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceEntityId" TEXT NOT NULL REFERENCES "company_graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "relationshipType" TEXT NOT NULL,
  "targetEntityId" TEXT NOT NULL REFERENCES "company_graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'active',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK ("confidence" BETWEEN 0 AND 1),
  "evidenceArtifactIds" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "validFrom" TIMESTAMP(3), "validTo" TIMESTAMP(3),
  "supersedesEdgeId" TEXT REFERENCES "company_edges"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_edges_status_check" CHECK ("status" IN ('proposed','active','disputed','superseded','rejected')),
  CONSTRAINT "company_edges_not_self_check" CHECK ("sourceEntityId" <> "targetEntityId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "company_edges_active_key" ON "company_edges"("tenantId","sourceEntityId","relationshipType","targetEntityId") WHERE "status"='active';
CREATE INDEX IF NOT EXISTS "company_edges_source_idx" ON "company_edges"("tenantId","sourceEntityId","status");
CREATE INDEX IF NOT EXISTS "company_edges_target_idx" ON "company_edges"("tenantId","targetEntityId","status");

CREATE TABLE IF NOT EXISTS "company_entity_merges" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceEntityId" TEXT NOT NULL REFERENCES "company_graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "targetEntityId" TEXT NOT NULL REFERENCES "company_graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "reason" TEXT NOT NULL,
  "similarity" DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK ("similarity" BETWEEN 0 AND 1),
  "mergedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "company_entity_merges_tenant_createdAt_idx" ON "company_entity_merges"("tenantId","createdAt" DESC);

CREATE TABLE IF NOT EXISTS "company_memory_reviews" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "reviewType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "reason" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "reviewedBy" TEXT, "reviewedAt" TIMESTAMP(3), "reviewComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_memory_reviews_type_check" CHECK ("reviewType" IN ('claim','entity_merge','edge','retention','access')),
  CONSTRAINT "company_memory_reviews_status_check" CHECK ("status" IN ('open','approved','rejected','resolved')),
  CONSTRAINT "company_memory_reviews_priority_check" CHECK ("priority" IN ('low','medium','high','critical'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "company_memory_reviews_open_resource_key" ON "company_memory_reviews"("tenantId","reviewType","resourceId") WHERE "status"='open';
CREATE INDEX IF NOT EXISTS "company_memory_reviews_tenant_status_priority_idx" ON "company_memory_reviews"("tenantId","status","priority","createdAt" DESC);
