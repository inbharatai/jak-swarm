import { randomUUID } from 'node:crypto';
/** Canonical entity resolution and artifact synthesis for Company Brain V2. */
import {
  ARTIFACT_WITH_POLICY_SELECT,
  clamp01,
  excerptForEntity,
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
} from './company-brain-v2.core.js';
import { CompanyBrainArtifactStore } from './company-brain-v2.store.js';

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
            sourceTitle: entity.title,
            targetTitle: resolution.reviewTarget.title,
          },
        });
        proposedMergeReviewIds.push(review.id);
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

  protected async resolveEntity(
    tenantId: string,
    entity: CompanyEntityV2Row,
  ): Promise<{
    autoMergeTarget?: CompanyEntityV2Row;
    reviewTarget?: CompanyEntityV2Row;
    similarity: number;
    reason: string;
  }> {
    const normalized = normalizeEntityLabel(entity.title);
    if (!normalized) return { similarity: 0, reason: 'Entity label could not be normalized.' };

    const aliasRows = await this.query<CompanyEntityV2Row>(
      `SELECT e.*
       FROM "company_entity_aliases" a
       JOIN "company_graph_entities" e ON e."id" = a."entityId"
       WHERE a."tenantId" = $1 AND a."entityType" = $2 AND a."normalizedAlias" = $3
         AND e."id" <> $4 AND e."deletedAt" IS NULL
       LIMIT 1`,
      tenantId,
      entity.entityType,
      normalized,
      entity.id,
    );
    if (aliasRows[0]) {
      return {
        autoMergeTarget: aliasRows[0],
        similarity: 1,
        reason: 'Exact canonical alias match.',
      };
    }

    const candidates = await this.query<CompanyEntityV2Row>(
      `SELECT * FROM "company_graph_entities"
       WHERE "tenantId" = $1 AND "entityType" = $2 AND "id" <> $3 AND "deletedAt" IS NULL
       ORDER BY "updatedAt" DESC
       LIMIT 250`,
      tenantId,
      entity.entityType,
      entity.id,
    );

    let best: CompanyEntityV2Row | undefined;
    let bestScore = 0;
    for (const candidate of candidates) {
      const exact = normalizeEntityLabel(candidate.title) === normalized;
      const score = exact ? 1 : tokenSimilarity(entity.title, candidate.title);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (best && bestScore >= 0.94) {
      return {
        autoMergeTarget: best,
        similarity: bestScore,
        reason: `Strong deterministic entity match (${bestScore.toFixed(2)}).`,
      };
    }
    if (best && bestScore >= 0.72) {
      return {
        reviewTarget: best,
        similarity: bestScore,
        reason: `Possible duplicate entity requires review (${bestScore.toFixed(2)} similarity).`,
      };
    }
    return { similarity: bestScore, reason: 'No reliable canonical match found.' };
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
