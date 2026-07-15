import { randomUUID } from 'node:crypto';
/** Canonical entity resolution and artifact synthesis for Company Brain V2. */
import {
  ARTIFACT_WITH_POLICY_SELECT,
  clamp01,
  ENTITY_RESOLVER_ALGORITHM_VERSION,
  excerptForEntity,
  extractProviderExternalId,
  extractStableIdentifiers,
  identifiersConflict,
  inferRelationshipType,
  jsonObject,
  jsonStringArray,
  normalizeEntityLabel,
  predicateFromProperty,
  sourceAuthorityScore,
  tokenSimilarity,
  uniqueStrings,
  type ClaimCandidate,
  type ClaimTransition,
  type CompanyArtifactV2Row,
  type CompanyClaimRow,
  type CompanyEdgeRow,
  type CompanyEntityV2Row,
  type CompanyMemoryReviewRow,
  type EntityResolutionTier,
  type StableIdentifier,
} from './company-brain-v2.core.js';
import { CompanyBrainArtifactStore } from './company-brain-v2.store.js';

/**
 * Tier priority: lower rank = stronger (dispositive) evidence, checked first.
 * See the entity-resolver block in `company-brain-v2.core.ts` for the full
 * rationale. `none` is a sentinel that never wins a comparison.
 */
const TIER_RANK: Record<EntityResolutionTier, number> = {
  provider_external_id: 1,
  verified_stable_identifier: 2,
  exact_alias: 3,
  deterministic_composite: 4,
  probabilistic_review: 5,
  none: 6,
};

const TIER_REASON: Record<Exclude<EntityResolutionTier, 'none' | 'probabilistic_review'>, string> = {
  provider_external_id: 'Same integration source and external record id.',
  verified_stable_identifier: 'Shared verified stable identifier (email/domain/url/handle).',
  exact_alias: 'Exact canonical alias match.',
  deterministic_composite: 'Exact normalized title with no conflicting identifiers.',
};

function sharedStableIdentifier(a: StableIdentifier[], b: StableIdentifier[]): StableIdentifier | null {
  const set = new Set(a.map((id) => `${id.key}:${id.value}`));
  for (const id of b) if (set.has(`${id.key}:${id.value}`)) return id;
  return null;
}

interface CandidateClassification {
  tier: EntityResolutionTier;
  similarity: number;
  evidence: Record<string, unknown>;
}

/**
 * Classify ONE existing candidate against the freshly extracted entity using
 * the 6-tier hierarchy. Pure (no DB, no `this`): the resolver fetches the
 * candidate pool once and runs every candidate through this in-memory.
 */
export function classifyEntityCandidate(
  entity: CompanyEntityV2Row,
  entityIds: StableIdentifier[],
  entityProvExt: ReturnType<typeof extractProviderExternalId>,
  candidate: CompanyEntityV2Row,
): CandidateClassification {
  const candIds = extractStableIdentifiers(candidate.properties);
  const candProvExt = extractProviderExternalId(candidate.properties);

  // Tier 1 — provider + externalId (integration-scoped durable identity).
  if (
    entityProvExt &&
    candProvExt &&
    entityProvExt.provider === candProvExt.provider &&
    entityProvExt.externalId === candProvExt.externalId
  ) {
    return {
      tier: 'provider_external_id',
      similarity: 1,
      evidence: { matchedProvider: entityProvExt.provider, matchedExternalId: entityProvExt.externalId },
    };
  }

  // Tier 2 — a shared, verifiable stable identifier.
  const shared = sharedStableIdentifier(entityIds, candIds);
  if (shared) {
    return {
      tier: 'verified_stable_identifier',
      similarity: 1,
      evidence: { matchedKey: shared.key, matchedValue: shared.value },
    };
  }

  const score = tokenSimilarity(entity.title, candidate.title);
  const exactTitle = score === 1;

  // Tier 4 — exact (or near-exact >=0.94) title with NO conflicting identifier.
  // A conflict (same key, different value, no shared value) is positive
  // evidence the two are different canonical things → block the merge.
  if ((exactTitle || score >= 0.94) && !identifiersConflict(entityIds, candIds)) {
    return {
      tier: 'deterministic_composite',
      similarity: score,
      evidence: exactTitle ? { matchedTitle: entity.title } : { similarity: score, nearExactTitle: true },
    };
  }

  // Tier 5 — plausible duplicate, not dispositive → defer to a human.
  if (score >= 0.72 && score < 0.94) {
    return { tier: 'probabilistic_review', similarity: score, evidence: { similarity: score } };
  }

  return { tier: 'none', similarity: score, evidence: {} };
}

export interface EntityResolution {
  autoMergeTarget?: CompanyEntityV2Row;
  reviewTarget?: CompanyEntityV2Row;
  similarity: number;
  reason: string;
  tier: EntityResolutionTier;
  matchingEvidence: Record<string, unknown>;
}

export abstract class CompanyBrainEntityStore extends CompanyBrainArtifactStore {
  protected abstract upsertClaim(candidate: ClaimCandidate): Promise<{ claim: CompanyClaimRow; transition: ClaimTransition }>;
  protected abstract upsertEdge(input: {
    tenantId: string;
    sourceEntityId: string;
    relationshipType: string;
    targetEntityId: string;
    confidence: number;
    evidenceArtifactIds: string[];
    validFrom?: Date | null;
    createdBy?: string | null;
  }): Promise<CompanyEdgeRow>;
  protected abstract createReview(input: {
    tenantId: string;
    reviewType: CompanyMemoryReviewRow['reviewType'];
    resourceId: string;
    reason: string;
    payload: Record<string, unknown>;
    priority: CompanyMemoryReviewRow['priority'];
  }): Promise<CompanyMemoryReviewRow>;

  async processExtractedEntities(input: {
    tenantId: string;
    userId: string;
    artifactId: string;
    entityIds?: string[];
  }): Promise<{
    canonicalEntityIds: string[];
    mergedEntityIds: string[];
    proposedMergeReviewIds: string[];
    claimIds: string[];
    edgeIds: string[];
  }> {
    const artifacts = await this.query<CompanyArtifactV2Row>(
      `SELECT ${ARTIFACT_WITH_POLICY_SELECT}
       FROM "company_artifacts" a
       LEFT JOIN "company_artifact_policies" p ON p."artifactId" = a."id" AND p."tenantId" = a."tenantId"
       WHERE a."id" = $1 AND a."tenantId" = $2 AND a."deletedAt" IS NULL`,
      input.artifactId,
      input.tenantId,
    );
    const artifact = artifacts[0];
    if (!artifact) throw new Error(`Company artifact id=${input.artifactId} not found in this tenant.`);

    const entities = input.entityIds && input.entityIds.length > 0
      ? await this.query<CompanyEntityV2Row>(
          `SELECT * FROM "company_graph_entities"
           WHERE "tenantId" = $1 AND "id" = ANY($2::TEXT[]) AND "deletedAt" IS NULL`,
          input.tenantId,
          input.entityIds,
        )
      : await this.query<CompanyEntityV2Row>(
          `SELECT * FROM "company_graph_entities"
           WHERE "tenantId" = $1 AND "deletedAt" IS NULL
             AND ("primaryArtifactId" = $2 OR "sourceArtifactIds" @> to_jsonb(ARRAY[$2]::TEXT[]))
           ORDER BY "createdAt" ASC`,
          input.tenantId,
          input.artifactId,
        );

    const canonicalEntityIds: string[] = [];
    const mergedEntityIds: string[] = [];
    const proposedMergeReviewIds: string[] = [];
    const claimIds: string[] = [];
    const edgeIds: string[] = [];
    const titleToCanonical = new Map<string, CompanyEntityV2Row>();

    for (const entity of entities) {
      // C2: index this entity's stable identifiers BEFORE resolving.
      await this.upsertEntityIdentifiers(input.tenantId, entity);
      const resolution = await this.resolveEntity(input.tenantId, entity);
      let canonical = entity;
      if (resolution.autoMergeTarget) {
        canonical = await this.mergeEntities({
          tenantId: input.tenantId,
          userId: input.userId,
          sourceEntityId: entity.id,
          targetEntityId: resolution.autoMergeTarget.id,
          reason: resolution.reason,
          similarity: resolution.similarity,
          tier: resolution.tier,
          algorithmVersion: ENTITY_RESOLVER_ALGORITHM_VERSION,
          matchingEvidence: { tier: resolution.tier, ...resolution.matchingEvidence },
        });
        mergedEntityIds.push(entity.id);
      } else if (resolution.reviewTarget) {
        const review = await this.createReview({
          tenantId: input.tenantId,
          reviewType: 'entity_merge',
          resourceId: entity.id,
          reason: resolution.reason,
          priority: 'medium',
          payload: {
            sourceEntityId: entity.id,
            targetEntityId: resolution.reviewTarget.id,
            similarity: resolution.similarity,
            tier: resolution.tier,
            algorithmVersion: ENTITY_RESOLVER_ALGORITHM_VERSION,
            sourceTitle: entity.title,
            targetTitle: resolution.reviewTarget.title,
          },
        });
        proposedMergeReviewIds.push(review.id);
        // Preserve the deferred candidate so the resolver does not re-propose
        // the same probabilistic merge on the next artifact re-extraction.
        await this.recordMergeRejection({
          tenantId: input.tenantId,
          sourceEntityId: entity.id,
          candidateEntityId: resolution.reviewTarget.id,
          decision: 'deferred',
          tier: resolution.tier,
          similarity: resolution.similarity,
          reason: resolution.reason,
          evidence: { tier: resolution.tier, ...resolution.matchingEvidence },
          decidedBy: input.userId,
        });
      }

      await this.ensureAlias({
        tenantId: input.tenantId,
        entityId: canonical.id,
        entityType: canonical.entityType,
        alias: entity.title,
        sourceArtifactId: input.artifactId,
        confidence: resolution.similarity || 1,
        createdBy: input.userId,
      });

      canonicalEntityIds.push(canonical.id);
      titleToCanonical.set(normalizeEntityLabel(entity.title), canonical);
      titleToCanonical.set(normalizeEntityLabel(canonical.title), canonical);

      const claimSource = canonical.id === entity.id
        ? canonical
        : { ...entity, id: canonical.id, tenantId: canonical.tenantId };
      const claims = this.claimCandidatesFromEntity(claimSource, artifact, input.userId);
      for (const candidate of claims) {
        const result = await this.upsertClaim(candidate);
        claimIds.push(result.claim.id);
      }
    }

    for (const original of entities) {
      const source = titleToCanonical.get(normalizeEntityLabel(original.title));
      if (!source) continue;
      const props = jsonObject(original.properties);
      const relatedTitles = jsonStringArray(props['relatedEntityTitles']);
      for (const relatedTitle of relatedTitles) {
        const target = titleToCanonical.get(normalizeEntityLabel(relatedTitle))
          ?? await this.findEntityByAlias(input.tenantId, original.entityType, relatedTitle)
          ?? await this.findAnyEntityByAlias(input.tenantId, relatedTitle);
        if (!target || target.id === source.id) continue;
        const edge = await this.upsertEdge({
          tenantId: input.tenantId,
          sourceEntityId: source.id,
          relationshipType: inferRelationshipType(source.entityType, target.entityType),
          targetEntityId: target.id,
          confidence: Math.min(source.confidence, target.confidence),
          evidenceArtifactIds: [input.artifactId],
          validFrom: artifact.occurredAt,
          createdBy: input.userId,
        });
        edgeIds.push(edge.id);
      }
    }

    await this.setArtifactProcessingState({
      tenantId: input.tenantId,
      artifactId: input.artifactId,
      state: 'ready',
      error: null,
    });

    return {
      canonicalEntityIds: uniqueStrings(canonicalEntityIds),
      mergedEntityIds: uniqueStrings(mergedEntityIds),
      proposedMergeReviewIds: uniqueStrings(proposedMergeReviewIds),
      claimIds: uniqueStrings(claimIds),
      edgeIds: uniqueStrings(edgeIds),
    };
  }

  protected claimCandidatesFromEntity(
    entity: CompanyEntityV2Row,
    artifact: CompanyArtifactV2Row,
    userId: string,
  ): ClaimCandidate[] {
    const authorityScore = sourceAuthorityScore(artifact);
    const base = {
      tenantId: entity.tenantId,
      subjectEntityId: entity.id,
      confidence: clamp01(entity.confidence),
      authorityScore,
      validFrom: artifact.occurredAt ?? entity.occurredAt ?? entity.createdAt,
      createdBy: userId,
      artifactId: artifact.id,
      excerpt: excerptForEntity(entity),
      observedAt: artifact.occurredAt ?? artifact.createdAt,
    };
    const claims: ClaimCandidate[] = [];
    if (entity.status) claims.push({ ...base, predicate: 'status', objectValue: entity.status });
    if (entity.ownerName) claims.push({ ...base, predicate: 'owned_by', objectValue: entity.ownerName });
    if (entity.priority) claims.push({ ...base, predicate: 'priority', objectValue: entity.priority });
    if (entity.dueAt) claims.push({ ...base, predicate: 'due_at', objectValue: entity.dueAt.toISOString() });

    for (const [key, value] of Object.entries(jsonObject(entity.properties))) {
      const predicate = predicateFromProperty(key);
      if (!predicate) continue;
      if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
      claims.push({ ...base, predicate, objectValue: value });
    }
    return claims;
  }

  /**
   * Phase 3 canonical entity resolution — 6-tier identity hierarchy.
   *
   * Identity is established strictly, strongest evidence first:
   *   1. provider_external_id        — same integration source + external id
   *   2. verified_stable_identifier  — shared email/domain/url/handle/...
   *   3. exact_alias                 — exact canonical alias (aliases table)
   *   4. deterministic_composite     — exact/near-exact title, no conflicting id
   *   5. probabilistic_review        — 0.72–0.94 similarity → human review
   *   6. none                        — separate entities
   *
   * Tiers 1–4 auto-merge (dispositive). Tier 5 defers to a human AND records a
   * `deferred` candidate so the resolver never re-proposes the same probabilistic
   * merge; a human-rejected pair (`rejected`) is never re-proposed at all. The
   * `tier` + `matchingEvidence` are returned so the merge row preserves *why*.
   *
   * The candidate pool is tenant-scoped (`tenantId` + `entityType`), so a
   * same-named entity in a DIFFERENT tenant is never matched (cross-tenant
   * isolation enforced at the SQL boundary, never by post-filtering).
   */
  /**
   * C2: index this entity's stable identifiers (email/github/domain/url/...)
   * into `company_entity_identifiers` so retrieval + resolution can do an
   * EXACT indexed lookup instead of a fuzzy `properties::TEXT ILIKE`. Idempotent
   * (ON CONFLICT DO NOTHING); best-effort (a missing table is non-fatal -- the
   * ILIKE fallback still covers un-indexed entities).
   */
  protected async upsertEntityIdentifiers(tenantId: string, entity: CompanyEntityV2Row): Promise<void> {
    const ids = extractStableIdentifiers(entity.properties);
    if (ids.length === 0) return;
    const placeholders = ids.map((_, i) => '($' + (i * 5 + 1) + ',$' + (i * 5 + 2) + ',$' + (i * 5 + 3) + ',$' + (i * 5 + 4) + ',$' + (i * 5 + 5) + ')').join(',');
    const params: unknown[] = [];
    for (const id of ids) {
      params.push(randomUUID(), tenantId, entity.id, id.key, id.value);
    }
    await this.execute(
      `INSERT INTO "company_entity_identifiers" ("id","tenantId","entityId","kind","normalizedValue")
       VALUES ${placeholders}
       ON CONFLICT ("tenantId","kind","normalizedValue","source") DO NOTHING`,
      ...params,
    ).catch(() => { /* table not migrated yet -- non-fatal */ });
  }

  protected async resolveEntity(
    tenantId: string,
    entity: CompanyEntityV2Row,
  ): Promise<EntityResolution> {
    const normalized = normalizeEntityLabel(entity.title);
    if (!normalized) {
      return { tier: 'none', similarity: 0, reason: 'Entity label could not be normalized.', matchingEvidence: {} };
    }

    const entityIds = extractStableIdentifiers(entity.properties);
    const entityProvExt = extractProviderExternalId(entity.properties);

    const candidates = await this.query<CompanyEntityV2Row>(
      `SELECT * FROM "company_graph_entities"
       WHERE "tenantId" = $1 AND "entityType" = $2 AND "id" <> $3 AND "deletedAt" IS NULL
       ORDER BY "updatedAt" DESC
       LIMIT 250`,
      tenantId,
      entity.entityType,
      entity.id,
    );

    // Tier 3 — exact canonical alias (aliases table). Resolved separately
    // because aliases are the canonical authority even when `properties` is
    // empty (pre-Phase-3 entities carry no stable identifiers).
    const aliasRows = await this.query<CompanyEntityV2Row>(
      `SELECT e.*
       FROM "company_entity_aliases" a
       JOIN "company_graph_entities" e ON e."id" = a."entityId"
       WHERE a."tenantId" = $1 AND a."entityType" = $2 AND a."normalizedAlias" = $3
         AND e."id" <> $4 AND e."deletedAt" IS NULL
       LIMIT 5`,
      tenantId,
      entity.entityType,
      normalized,
      entity.id,
    );

    interface Hit {
      row: CompanyEntityV2Row;
      tier: Exclude<EntityResolutionTier, 'none'>;
      similarity: number;
      evidence: Record<string, unknown>;
    }
    const hits: Hit[] = [];
    for (const candidate of candidates) {
      const cl = classifyEntityCandidate(entity, entityIds, entityProvExt, candidate);
      if (cl.tier !== 'none') {
        hits.push({ row: candidate, tier: cl.tier, similarity: cl.similarity, evidence: cl.evidence });
      }
    }
    for (const alias of aliasRows) {
      hits.push({ row: alias, tier: 'exact_alias', similarity: 1, evidence: { matchedAlias: normalized } });
    }

    if (hits.length === 0) {
      return { tier: 'none', similarity: 0, reason: 'No reliable canonical match found.', matchingEvidence: {} };
    }

    // Strongest tier first; ties broken by higher similarity.
    hits.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.similarity - a.similarity);

    // Dispositive tiers (1–4) → auto-merge the single best hit.
    const autoMerge = hits.find((hit) => TIER_RANK[hit.tier] <= TIER_RANK.deterministic_composite);
    if (autoMerge) {
      return {
        autoMergeTarget: autoMerge.row,
        tier: autoMerge.tier,
        similarity: autoMerge.similarity,
        reason: TIER_REASON[autoMerge.tier as Exclude<typeof autoMerge.tier, 'probabilistic_review' | 'none'>] ?? `Strong entity match (${autoMerge.similarity.toFixed(2)}).`,
        matchingEvidence: autoMerge.evidence,
      };
    }

    // Tier 5 — probabilistic. Walk hits in priority order; the first candidate
    // with no prior rejected/deferred decision becomes the review. A previously
    // rejected pair is never re-proposed; a deferred pair is not re-proposed
    // (its review is already open). This bounds review spam to genuinely new
    // candidates only.
    for (const hit of hits) {
      const prior = await this.findMergeRejection(tenantId, entity.id, hit.row.id);
      if (prior?.decision === 'rejected') continue;
      if (prior?.decision === 'deferred') continue;
      return {
        reviewTarget: hit.row,
        tier: 'probabilistic_review',
        similarity: hit.similarity,
        reason: `Possible duplicate entity requires review (${hit.similarity.toFixed(2)} similarity).`,
        matchingEvidence: hit.evidence,
      };
    }

    return {
      tier: 'none',
      similarity: hits[0]!.similarity,
      reason: 'All plausible matches were previously rejected or deferred.',
      matchingEvidence: hits[0]!.evidence,
    };
  }

  /**
   * Read the prior resolver decision (if any) for an (entity, candidate) pair.
   * Returns the earliest decision: `rejected` (human said no — never re-propose)
   * or `deferred` (a probabilistic review is already open — do not re-propose).
   * Absent when the pair has never been considered by a probabilistic tier.
   */
  protected async findMergeRejection(
    tenantId: string,
    sourceEntityId: string,
    candidateEntityId: string,
  ): Promise<{ decision: 'deferred' | 'rejected' } | null> {
    const rows = await this.query<{ decision: string }>(
      `SELECT "decision" FROM "company_entity_merge_rejections"
       WHERE "tenantId" = $1 AND "sourceEntityId" = $2 AND "candidateEntityId" = $3
       LIMIT 1`,
      tenantId,
      sourceEntityId,
      candidateEntityId,
    );
    return rows[0] ? { decision: rows[0].decision as 'deferred' | 'rejected' } : null;
  }

  /**
   * Preserve a merge candidate that was considered but not auto-merged.
   * Idempotent per pair (UNIQUE constraint, ON CONFLICT DO NOTHING keeps the
   * earliest record). The human-reject path escalates a `deferred` row to
   * `rejected` via `rejectEntityMerge` (an explicit UPDATE, not this insert).
   */
  protected async recordMergeRejection(input: {
    tenantId: string;
    sourceEntityId: string;
    candidateEntityId: string;
    decision: 'deferred' | 'rejected';
    tier: EntityResolutionTier;
    similarity: number;
    reason: string;
    evidence?: Record<string, unknown>;
    decidedBy?: string | null;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO "company_entity_merge_rejections"
         ("id", "tenantId", "sourceEntityId", "candidateEntityId", "decision",
          "algorithmVersion", "tier", "similarity", "reason", "evidence", "decidedBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::JSONB, $11)
       ON CONFLICT ("tenantId", "sourceEntityId", "candidateEntityId") DO NOTHING`,
      randomUUID(),
      input.tenantId,
      input.sourceEntityId,
      input.candidateEntityId,
      input.decision,
      ENTITY_RESOLVER_ALGORITHM_VERSION,
      input.tier,
      clamp01(input.similarity),
      input.reason.slice(0, 2000),
      JSON.stringify(input.evidence ?? {}),
      input.decidedBy ?? null,
    );
  }

  protected async ensureAlias(input: {
    tenantId: string;
    entityId: string;
    entityType: string;
    alias: string;
    sourceArtifactId?: string | null;
    confidence?: number;
    createdBy?: string | null;
  }): Promise<void> {
    const normalized = normalizeEntityLabel(input.alias);
    if (!normalized) return;
    await this.execute(
      `INSERT INTO "company_entity_aliases"
        ("id", "tenantId", "entityId", "entityType", "alias", "normalizedAlias", "sourceArtifactId", "confidence", "createdBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT ("tenantId", "entityType", "normalizedAlias") DO UPDATE
       SET "entityId" = EXCLUDED."entityId",
           "alias" = EXCLUDED."alias",
           "sourceArtifactId" = COALESCE(EXCLUDED."sourceArtifactId", "company_entity_aliases"."sourceArtifactId"),
           "confidence" = GREATEST("company_entity_aliases"."confidence", EXCLUDED."confidence")`,
      randomUUID(),
      input.tenantId,
      input.entityId,
      input.entityType,
      input.alias.trim(),
      normalized,
      input.sourceArtifactId ?? null,
      clamp01(input.confidence ?? 1),
      input.createdBy ?? null,
    );
  }

  protected async findEntityByAlias(tenantId: string, entityType: string, alias: string): Promise<CompanyEntityV2Row | null> {
    const rows = await this.query<CompanyEntityV2Row>(
      `SELECT e.*
       FROM "company_entity_aliases" a
       JOIN "company_graph_entities" e ON e."id" = a."entityId"
       WHERE a."tenantId" = $1 AND a."entityType" = $2 AND a."normalizedAlias" = $3
         AND e."deletedAt" IS NULL
       LIMIT 1`,
      tenantId,
      entityType,
      normalizeEntityLabel(alias),
    );
    return rows[0] ?? null;
  }

  protected async findAnyEntityByAlias(tenantId: string, alias: string): Promise<CompanyEntityV2Row | null> {
    const rows = await this.query<CompanyEntityV2Row>(
      `SELECT e.*
       FROM "company_entity_aliases" a
       JOIN "company_graph_entities" e ON e."id" = a."entityId"
       WHERE a."tenantId" = $1 AND a."normalizedAlias" = $2 AND e."deletedAt" IS NULL
       ORDER BY a."confidence" DESC
       LIMIT 1`,
      tenantId,
      normalizeEntityLabel(alias),
    );
    return rows[0] ?? null;
  }

}
