/** Review, merge and graph-query layer for Company Brain V2. */
import { randomUUID } from 'node:crypto';
import { CompanyBrainMemoryStore } from './company-brain-v2.memory.js';
import {
  clamp01,
  ENTITY_RESOLVER_ALGORITHM_VERSION,
  jsonStringArray,
  type ClaimStatus,
  type CompanyArtifactV2Row,
  type CompanyClaimRow,
  type CompanyEdgeRow,
  type CompanyEntityV2Row,
  type CompanyMemoryReviewRow,
  type ReviewStatus,
} from './company-brain-v2.core.js';

export abstract class CompanyBrainReviewStore extends CompanyBrainMemoryStore {
  async listReviews(input: {
    tenantId: string;
    status?: ReviewStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ items: CompanyMemoryReviewRow[]; total: number }> {
    const status = input.status ?? 'open';
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const offset = Math.max(0, input.offset ?? 0);
    const [items, counts] = await Promise.all([
      this.query<CompanyMemoryReviewRow>(
        `SELECT * FROM "company_memory_reviews"
         WHERE "tenantId" = $1 AND "status" = $2
         ORDER BY CASE "priority" WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
                  "createdAt" ASC
         LIMIT $3 OFFSET $4`,
        input.tenantId,
        status,
        limit,
        offset,
      ),
      this.query<{ count: bigint }>(
        `SELECT COUNT(*)::BIGINT AS count FROM "company_memory_reviews"
         WHERE "tenantId" = $1 AND "status" = $2`,
        input.tenantId,
        status,
      ),
    ]);
    return { items, total: Number(counts[0]?.count ?? 0) };
  }

  async decideClaim(input: {
    tenantId: string;
    userId: string;
    claimId: string;
    decision: 'APPROVED' | 'REJECTED';
    comment?: string;
  }): Promise<CompanyClaimRow> {
    const claims = await this.query<CompanyClaimRow>(
      `SELECT * FROM "company_claims" WHERE "tenantId" = $1 AND "id" = $2 LIMIT 1`,
      input.tenantId,
      input.claimId,
    );
    const claim = claims[0];
    if (!claim) throw new Error(`Company claim id=${input.claimId} not found in this tenant.`);
    if (!['proposed', 'disputed'].includes(claim.status)) {
      throw new Error(`Company claim id=${input.claimId} cannot be reviewed from status=${claim.status}.`);
    }

    let supersededClaimId: string | null = null;
    if (input.decision === 'APPROVED') {
      const active = await this.query<CompanyClaimRow>(
        `SELECT * FROM "company_claims"
         WHERE "tenantId" = $1 AND "subjectEntityId" = $2 AND "predicate" = $3 AND "status" = 'active'
         ORDER BY "authorityScore" DESC, "updatedAt" DESC LIMIT 1`,
        input.tenantId,
        claim.subjectEntityId,
        claim.predicate,
      );
      if (active[0] && active[0].id !== claim.id) {
        supersededClaimId = active[0].id;
        await this.execute(
          `UPDATE "company_claims"
           SET "status" = 'superseded', "validTo" = COALESCE($3, CURRENT_TIMESTAMP), "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = $1 AND "tenantId" = $2`,
          supersededClaimId,
          input.tenantId,
          claim.validFrom,
        );
      }
    }

    const newStatus: ClaimStatus = input.decision === 'APPROVED' ? 'active' : 'rejected';
    const rows = await this.query<CompanyClaimRow>(
      `UPDATE "company_claims"
       SET "status" = $3,
           "supersedesClaimId" = CASE WHEN $3 = 'active' THEN $6 ELSE "supersedesClaimId" END,
           "reviewedBy" = $4,
           "reviewedAt" = CURRENT_TIMESTAMP,
           "reviewComment" = $5,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "tenantId" = $2
       RETURNING *`,
      input.claimId,
      input.tenantId,
      newStatus,
      input.userId,
      input.comment?.slice(0, 4000) ?? null,
      supersededClaimId,
    );
    await this.execute(
      `UPDATE "company_memory_reviews"
       SET "status" = $3, "reviewedBy" = $4, "reviewedAt" = CURRENT_TIMESTAMP,
           "reviewComment" = $5, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "tenantId" = $1 AND "reviewType" = 'claim' AND "resourceId" = $2 AND "status" = 'open'`,
      input.tenantId,
      input.claimId,
      input.decision === 'APPROVED' ? 'approved' : 'rejected',
      input.userId,
      input.comment?.slice(0, 4000) ?? null,
    );
    if (!rows[0]) throw new Error('Company claim decision did not return a row.');
    return rows[0];
  }

  async mergeEntities(input: {
    tenantId: string;
    userId: string;
    sourceEntityId: string;
    targetEntityId: string;
    reason: string;
    similarity?: number;
    tier?: string;
    algorithmVersion?: string;
    matchingEvidence?: Record<string, unknown>;
  }): Promise<CompanyEntityV2Row> {
    if (input.sourceEntityId === input.targetEntityId) throw new Error('Cannot merge an entity into itself.');
    // Read source/target for data (types, current artifact ids, summary). Our
    // `query`/`execute` helpers run each statement in its own autocommit, so a
    // per-statement `SELECT ... FOR UPDATE` would release its row lock the
    // instant the SELECT returns — useless for serializing the multi-statement
    // body. Instead we serialize with an atomic compare-and-swap UPDATE on the
    // SOURCE row (below) and an atomic jsonb append on the TARGET row (later).
    // `company_graph_entities.status` is free TEXT, so `merging` is a transient
    // sentinel owned by the winning merge. This is the one authoritative owner
    // of the merge mutation — no second queue framework, no in-memory running
    // flag (the Phase 2 durable-queue rule applied to the merge path).
    // Limitation: a crash between the CAS and the final soft-delete leaves the
    // source in the transient `merging` status; full statement-transaction
    // atomicity (wrapping the body + upsertClaim/upsertEdge in one tx) is the
    // dedicated PR E audit-chain TOCTOU work and is out of scope here.
    const entities = await this.query<CompanyEntityV2Row>(
      `SELECT * FROM "company_graph_entities"
       WHERE "tenantId" = $1 AND "id" = ANY($2::TEXT[]) AND "deletedAt" IS NULL`,
      input.tenantId,
      [input.sourceEntityId, input.targetEntityId],
    );
    const source = entities.find((entity) => entity.id === input.sourceEntityId);
    const target = entities.find((entity) => entity.id === input.targetEntityId);
    if (!source || !target) throw new Error('Source or target company entity not found in this tenant.');
    if (source.entityType !== target.entityType) {
      throw new Error(`Cannot merge entity types ${source.entityType} and ${target.entityType}.`);
    }
    // Atomic claim of the source: exactly one concurrent merge can transition
    // it out of active/merging-able state. A concurrent merge that already
    // won leaves status='merging'/'merged' → this UPDATE affects 0 rows → throw.
    const claimed = await this.query<{ id: string }>(
      `UPDATE "company_graph_entities"
       SET "status" = 'merging', "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "tenantId" = $2
         AND "status" NOT IN ('merged', 'merging') AND "deletedAt" IS NULL
       RETURNING "id"`,
      source.id,
      input.tenantId,
    );
    if (claimed.length === 0) {
      throw new Error('Source company entity has already been merged or is being merged concurrently.');
    }

    const mergedSummary = target.summary.includes(source.summary)
      ? target.summary
      : `${target.summary}\n\nMerged evidence: ${source.summary}`.slice(0, 8000);

    const sourceClaims = await this.query<CompanyClaimRow>(
      `SELECT * FROM "company_claims" WHERE "tenantId" = $1 AND "subjectEntityId" = $2`,
      input.tenantId,
      source.id,
    );
    for (const claim of sourceClaims) {
      const evidence = await this.query<{ artifactId: string; excerpt: string | null; sourceAuthority: number; observedAt: Date | null }>(
        `SELECT "artifactId", "excerpt", "sourceAuthority", "observedAt"
         FROM "company_claim_evidence" WHERE "tenantId" = $1 AND "claimId" = $2`,
        input.tenantId,
        claim.id,
      );
      if (evidence.length > 0) {
        for (const item of evidence) {
          await this.upsertClaim({
            tenantId: input.tenantId,
            subjectEntityId: target.id,
            predicate: claim.predicate,
            objectEntityId: claim.objectEntityId === source.id ? null : claim.objectEntityId,
            objectValue: claim.objectValue,
            confidence: claim.confidence,
            authorityScore: claim.authorityScore,
            validFrom: claim.validFrom,
            createdBy: input.userId,
            artifactId: item.artifactId,
            excerpt: item.excerpt,
            observedAt: item.observedAt,
          });
        }
      }
    }

    const sourceEdges = await this.query<CompanyEdgeRow>(
      `SELECT * FROM "company_edges"
       WHERE "tenantId" = $1 AND ("sourceEntityId" = $2 OR "targetEntityId" = $2)`,
      input.tenantId,
      source.id,
    );
    for (const edge of sourceEdges) {
      const nextSource = edge.sourceEntityId === source.id ? target.id : edge.sourceEntityId;
      const nextTarget = edge.targetEntityId === source.id ? target.id : edge.targetEntityId;
      if (nextSource === nextTarget) continue;
      await this.upsertEdge({
        tenantId: input.tenantId,
        sourceEntityId: nextSource,
        relationshipType: edge.relationshipType,
        targetEntityId: nextTarget,
        confidence: edge.confidence,
        evidenceArtifactIds: jsonStringArray(edge.evidenceArtifactIds),
        validFrom: edge.validFrom,
        createdBy: input.userId,
      });
    }

    // Atomic append of the source's artifacts onto the target, conditional on
    // the target still being active (a concurrent merge could have merged the
    // TARGET into something else — in which case we abort this merge rather
    // than mutate a now-stale target). `||` concatenates jsonb arrays in the
    // CURRENT row value, so two concurrent merges of DIFFERENT sources into the
    // same target both append without a lost update (duplicate ids are
    // harmless — the access filter uses a Set).
    const sourceArtifacts = jsonStringArray(source.sourceArtifactIds);
    const updatedTarget = await this.query<{ id: string }>(
      `UPDATE "company_graph_entities"
       SET "summary" = $3,
           "sourceArtifactIds" = "sourceArtifactIds" || $4::JSONB,
           "confidence" = GREATEST("confidence", $5),
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "tenantId" = $2 AND "status" = 'active'
       RETURNING "id"`,
      target.id,
      input.tenantId,
      mergedSummary,
      JSON.stringify(sourceArtifacts),
      Math.max(source.confidence, target.confidence),
    );
    if (updatedTarget.length === 0) {
      throw new Error('Target company entity was merged concurrently; this merge was aborted.');
    }

    const aliases = await this.query<{ alias: string; sourceArtifactId: string | null; confidence: number }>(
      `SELECT "alias", "sourceArtifactId", "confidence" FROM "company_entity_aliases"
       WHERE "tenantId" = $1 AND "entityId" = $2`,
      input.tenantId,
      source.id,
    );
    await this.ensureAlias({
      tenantId: input.tenantId,
      entityId: target.id,
      entityType: target.entityType,
      alias: source.title,
      sourceArtifactId: source.primaryArtifactId,
      confidence: input.similarity ?? 1,
      createdBy: input.userId,
    });
    for (const alias of aliases) {
      await this.ensureAlias({
        tenantId: input.tenantId,
        entityId: target.id,
        entityType: target.entityType,
        alias: alias.alias,
        sourceArtifactId: alias.sourceArtifactId,
        confidence: alias.confidence,
        createdBy: input.userId,
      });
    }

    await this.execute(`DELETE FROM "company_edges" WHERE "tenantId" = $1 AND ("sourceEntityId" = $2 OR "targetEntityId" = $2)`, input.tenantId, source.id);
    await this.execute(`DELETE FROM "company_claims" WHERE "tenantId" = $1 AND "subjectEntityId" = $2`, input.tenantId, source.id);
    await this.execute(`DELETE FROM "company_entity_aliases" WHERE "tenantId" = $1 AND "entityId" = $2`, input.tenantId, source.id);
    await this.execute(
      `UPDATE "company_graph_entities"
       SET "deletedAt" = CURRENT_TIMESTAMP,
           "status" = 'merged',
           "properties" = COALESCE("properties", '{}'::JSONB) || jsonb_build_object('mergedIntoEntityId', $3),
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "tenantId" = $2`,
      source.id,
      input.tenantId,
      target.id,
    );
    await this.execute(
      `INSERT INTO "company_entity_merges"
        ("id", "tenantId", "sourceEntityId", "targetEntityId", "reason", "similarity", "mergedBy",
         "algorithmVersion", "matchingEvidence")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::JSONB)`,
      randomUUID(),
      input.tenantId,
      source.id,
      target.id,
      input.reason.slice(0, 2000),
      clamp01(input.similarity ?? 1),
      input.userId,
      input.algorithmVersion ?? 'unknown',
      JSON.stringify(input.matchingEvidence ?? {}),
    );
    await this.execute(
      `UPDATE "company_memory_reviews"
       SET "status" = 'resolved', "reviewedBy" = $3, "reviewedAt" = CURRENT_TIMESTAMP,
           "reviewComment" = $4, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "tenantId" = $1 AND "reviewType" = 'entity_merge'
         AND "resourceId" = $2 AND "status" = 'open'`,
      input.tenantId,
      source.id,
      input.userId,
      input.reason.slice(0, 4000),
    );

    const rows = await this.query<CompanyEntityV2Row>(
      `SELECT * FROM "company_graph_entities" WHERE "tenantId" = $1 AND "id" = $2 LIMIT 1`,
      input.tenantId,
      target.id,
    );
    if (!rows[0]) throw new Error('Merged target entity could not be reloaded.');
    return rows[0];
  }

  /**
   * Human rejection of a proposed probabilistic merge (Phase 5). Records a
   * `rejected` decision for the (source, candidate) pair — the resolver will
   * never re-propose it ("never re-litigate settled identity") — and resolves
   * the open `entity_merge` review for that exact candidate as `rejected`.
   * Idempotent: a prior `deferred` row is escalated to `rejected`; a repeat
   * call updates the reason/decider.
   */
  async rejectEntityMerge(input: {
    tenantId: string;
    userId: string;
    sourceEntityId: string;
    candidateEntityId: string;
    reason?: string;
  }): Promise<{ sourceEntityId: string; candidateEntityId: string; decision: 'rejected' }> {
    if (input.sourceEntityId === input.candidateEntityId) {
      throw new Error('Cannot reject a merge of an entity with itself.');
    }
    const rows = await this.query<{ id: string }>(
      `SELECT "id" FROM "company_graph_entities"
       WHERE "tenantId" = $1 AND "id" = ANY($2::TEXT[]) AND "deletedAt" IS NULL`,
      input.tenantId,
      [input.sourceEntityId, input.candidateEntityId],
    );
    if (rows.length !== 2) {
      throw new Error('Source or candidate company entity not found in this tenant.');
    }
    const reason = (input.reason ?? 'Reviewer rejected the proposed merge.').slice(0, 2000);
    await this.execute(
      `INSERT INTO "company_entity_merge_rejections"
         ("id", "tenantId", "sourceEntityId", "candidateEntityId", "decision",
          "algorithmVersion", "tier", "similarity", "reason", "evidence", "decidedBy")
       VALUES ($1, $2, $3, $4, 'rejected', $5, 'probabilistic_review', 0, $6, $7::JSONB, $8)
       ON CONFLICT ("tenantId", "sourceEntityId", "candidateEntityId")
       DO UPDATE SET "decision" = 'rejected',
                     "reason" = EXCLUDED."reason",
                     "decidedBy" = EXCLUDED."decidedBy",
                     "algorithmVersion" = EXCLUDED."algorithmVersion"`,
      randomUUID(),
      input.tenantId,
      input.sourceEntityId,
      input.candidateEntityId,
      ENTITY_RESOLVER_ALGORITHM_VERSION,
      reason,
      JSON.stringify({ reviewer: input.userId }),
      input.userId,
    );
    // Resolve only the open review for THIS candidate (payload->>targetEntityId),
    // so other open reviews for the same source are left untouched.
    await this.execute(
      `UPDATE "company_memory_reviews"
       SET "status" = 'rejected', "reviewedBy" = $3, "reviewedAt" = CURRENT_TIMESTAMP,
           "reviewComment" = $4, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "tenantId" = $1 AND "reviewType" = 'entity_merge' AND "resourceId" = $2
         AND "status" = 'open' AND ("payload"->>'targetEntityId') = $5`,
      input.tenantId,
      input.sourceEntityId,
      input.userId,
      reason.slice(0, 4000),
      input.candidateEntityId,
    );
    return { sourceEntityId: input.sourceEntityId, candidateEntityId: input.candidateEntityId, decision: 'rejected' };
  }

  async getGraph(input: {
    tenantId: string;
    query?: string;
    entityType?: string;
    limit?: number;
  }): Promise<{
    entities: CompanyEntityV2Row[];
    edges: CompanyEdgeRow[];
    claims: CompanyClaimRow[];
    openReviewCount: number;
  }> {
    const limit = Math.max(1, Math.min(input.limit ?? 150, 500));
    const search = input.query?.trim() ?? '';
    const entities = await this.query<CompanyEntityV2Row>(
      `SELECT * FROM "company_graph_entities"
       WHERE "tenantId" = $1 AND "deletedAt" IS NULL
         AND ($2 = '' OR "title" ILIKE '%' || $2 || '%' OR "summary" ILIKE '%' || $2 || '%')
         AND ($3 = '' OR "entityType" = $3)
       ORDER BY "updatedAt" DESC
       LIMIT $4`,
      input.tenantId,
      search,
      input.entityType ?? '',
      limit,
    );
    const entityIds = entities.map((entity) => entity.id);
    if (entityIds.length === 0) return { entities: [], edges: [], claims: [], openReviewCount: 0 };
    const [edges, claims, reviewCounts] = await Promise.all([
      this.query<CompanyEdgeRow>(
        `SELECT * FROM "company_edges"
         WHERE "tenantId" = $1 AND "status" IN ('active', 'disputed')
           AND "sourceEntityId" = ANY($2::TEXT[]) AND "targetEntityId" = ANY($2::TEXT[])
         ORDER BY "updatedAt" DESC`,
        input.tenantId,
        entityIds,
      ),
      this.query<CompanyClaimRow>(
        `SELECT * FROM "company_claims"
         WHERE "tenantId" = $1 AND "subjectEntityId" = ANY($2::TEXT[])
           AND "status" IN ('active', 'proposed', 'disputed')
         ORDER BY "updatedAt" DESC`,
        input.tenantId,
        entityIds,
      ),
      this.query<{ count: bigint }>(
        `SELECT COUNT(*)::BIGINT AS count FROM "company_memory_reviews"
         WHERE "tenantId" = $1 AND "status" = 'open'`,
        input.tenantId,
      ),
    ]);
    return { entities, edges, claims, openReviewCount: Number(reviewCounts[0]?.count ?? 0) };
  }

  async getEntityDetail(input: { tenantId: string; entityId: string }): Promise<{
    entity: CompanyEntityV2Row;
    aliases: Array<{ id: string; alias: string; normalizedAlias: string; confidence: number }>;
    claims: CompanyClaimRow[];
    edges: CompanyEdgeRow[];
    evidence: Array<Pick<CompanyArtifactV2Row, 'id' | 'sourceType' | 'artifactType' | 'title' | 'occurredAt' | 'visibility' | 'sensitivity'>>;
  }> {
    const entities = await this.query<CompanyEntityV2Row>(
      `SELECT * FROM "company_graph_entities"
       WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL LIMIT 1`,
      input.tenantId,
      input.entityId,
    );
    const entity = entities[0];
    if (!entity) throw new Error(`Company entity id=${input.entityId} not found in this tenant.`);
    const sourceArtifactIds = jsonStringArray(entity.sourceArtifactIds);
    const [aliases, claims, edges, evidence] = await Promise.all([
      this.query<{ id: string; alias: string; normalizedAlias: string; confidence: number }>(
        `SELECT "id", "alias", "normalizedAlias", "confidence" FROM "company_entity_aliases"
         WHERE "tenantId" = $1 AND "entityId" = $2 ORDER BY "confidence" DESC, "createdAt" ASC`,
        input.tenantId,
        entity.id,
      ),
      this.query<CompanyClaimRow>(
        `SELECT * FROM "company_claims" WHERE "tenantId" = $1 AND "subjectEntityId" = $2 ORDER BY "updatedAt" DESC`,
        input.tenantId,
        entity.id,
      ),
      this.query<CompanyEdgeRow>(
        `SELECT * FROM "company_edges"
         WHERE "tenantId" = $1 AND ("sourceEntityId" = $2 OR "targetEntityId" = $2)
         ORDER BY "updatedAt" DESC`,
        input.tenantId,
        entity.id,
      ),
      sourceArtifactIds.length === 0
        ? Promise.resolve([])
        : this.query<Pick<CompanyArtifactV2Row, 'id' | 'sourceType' | 'artifactType' | 'title' | 'occurredAt' | 'visibility' | 'sensitivity'>>(
            `SELECT a."id", a."sourceType", a."artifactType", a."title", a."occurredAt",
                    COALESCE(p."visibility", 'internal') AS "visibility",
                    COALESCE(p."sensitivity", 'normal') AS "sensitivity"
             FROM "company_artifacts" a
             LEFT JOIN "company_artifact_policies" p ON p."artifactId" = a."id" AND p."tenantId" = a."tenantId"
             WHERE a."tenantId" = $1 AND a."id" = ANY($2::TEXT[]) AND a."deletedAt" IS NULL
             ORDER BY COALESCE(a."occurredAt", a."createdAt") DESC`,
            input.tenantId,
            sourceArtifactIds,
          ),
    ]);
    return { entity, aliases, claims, edges, evidence };
  }
}
