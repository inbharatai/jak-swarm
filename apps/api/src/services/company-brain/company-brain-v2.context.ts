/** Permission-filtered task context engine for Company Brain V2. */
import {
  ARTIFACT_WITH_POLICY_SELECT,
  canAgentAccessArtifact,
  contextTokens,
  jsonStringArray,
  stableJson,
  toIso,
  uniqueStrings,
  type BrainContextPackage,
  type CompanyArtifactV2Row,
  type CompanyClaimRow,
  type CompanyEdgeRow,
  type CompanyEntityV2Row,
} from './company-brain-v2.core.js';
import { CompanyBrainReviewStore } from './company-brain-v2.review.js';

export abstract class CompanyBrainContextStore extends CompanyBrainReviewStore {
  async getContextPackage(input: {
    tenantId: string;
    task: string;
    agentRole: string;
    tokenBudget?: number;
  }): Promise<BrainContextPackage> {
    const task = input.task.trim();
    if (!task) {
      return {
        task: '', agentRole: input.agentRole, generatedAt: new Date().toISOString(),
        entities: [], claims: [], edges: [], conflicts: [], evidence: [], omittedCount: 0, contextText: '',
      };
    }
    const tokens = contextTokens(task);
    const search = tokens.join(' ');
    let entities = await this.query<CompanyEntityV2Row>(
      `SELECT *,
          ts_rank(
            to_tsvector('simple', COALESCE("title", '') || ' ' || COALESCE("summary", '')),
            websearch_to_tsquery('simple', $2)
          ) AS rank
       FROM "company_graph_entities"
       WHERE "tenantId" = $1 AND "deletedAt" IS NULL
         AND to_tsvector('simple', COALESCE("title", '') || ' ' || COALESCE("summary", ''))
             @@ websearch_to_tsquery('simple', $2)
       ORDER BY rank DESC, "updatedAt" DESC
       LIMIT 30`,
      input.tenantId,
      search || task,
    ).catch(async () => this.query<CompanyEntityV2Row>(
      `SELECT * FROM "company_graph_entities"
       WHERE "tenantId" = $1 AND "deletedAt" IS NULL
       ORDER BY "updatedAt" DESC LIMIT 20`,
      input.tenantId,
    ));

    if (entities.length === 0) {
      entities = await this.query<CompanyEntityV2Row>(
        `SELECT * FROM "company_graph_entities"
         WHERE "tenantId" = $1 AND "deletedAt" IS NULL
         ORDER BY "updatedAt" DESC LIMIT 15`,
        input.tenantId,
      );
    }

    const artifactIds = uniqueStrings(entities.flatMap((entity) => jsonStringArray(entity.sourceArtifactIds)));
    const artifacts = artifactIds.length === 0
      ? []
      : await this.query<CompanyArtifactV2Row>(
          `SELECT ${ARTIFACT_WITH_POLICY_SELECT}
           FROM "company_artifacts" a
           LEFT JOIN "company_artifact_policies" p ON p."artifactId" = a."id" AND p."tenantId" = a."tenantId"
           WHERE a."tenantId" = $1 AND a."id" = ANY($2::TEXT[]) AND a."deletedAt" IS NULL`,
          input.tenantId,
          artifactIds,
        );
    const visibleArtifacts = artifacts.filter((artifact) => canAgentAccessArtifact(artifact, input.agentRole));
    const visibleArtifactIds = new Set(visibleArtifacts.map((artifact) => artifact.id));
    const entitiesBeforeAccessFilter = entities.length;
    const accessFilteredEntities = entities.filter((entity) => {
      const sources = jsonStringArray(entity.sourceArtifactIds);
      return sources.length === 0 || sources.some((id) => visibleArtifactIds.has(id));
    });
    const omittedCount = Math.max(0, artifacts.length - visibleArtifacts.length)
      + Math.max(0, entitiesBeforeAccessFilter - accessFilteredEntities.length);
    entities = accessFilteredEntities.slice(0, 20);

    const entityIds = entities.map((entity) => entity.id);
    const [claims, edges] = entityIds.length === 0
      ? [[], []] as [CompanyClaimRow[], CompanyEdgeRow[]]
      : await Promise.all([
          this.query<CompanyClaimRow>(
            `SELECT * FROM "company_claims"
             WHERE "tenantId" = $1 AND "subjectEntityId" = ANY($2::TEXT[])
               AND "status" IN ('active', 'disputed')
             ORDER BY CASE "status" WHEN 'active' THEN 0 ELSE 1 END, "authorityScore" DESC, "updatedAt" DESC
             LIMIT 80`,
            input.tenantId,
            entityIds,
          ),
          this.query<CompanyEdgeRow>(
            `SELECT * FROM "company_edges"
             WHERE "tenantId" = $1 AND "status" IN ('active', 'disputed')
               AND ("sourceEntityId" = ANY($2::TEXT[]) OR "targetEntityId" = ANY($2::TEXT[]))
             ORDER BY "confidence" DESC, "updatedAt" DESC
             LIMIT 80`,
            input.tenantId,
            entityIds,
          ),
        ]);

    const visibleEntityIdSet = new Set(entityIds);
    const visibleClaims = claims.filter((claim) => !claim.objectEntityId || visibleEntityIdSet.has(claim.objectEntityId));
    const visibleEdges = edges.filter((edge) => visibleEntityIdSet.has(edge.sourceEntityId) && visibleEntityIdSet.has(edge.targetEntityId));

    const evidence = visibleArtifacts
      .sort((a, b) => (b.occurredAt ?? b.createdAt).getTime() - (a.occurredAt ?? a.createdAt).getTime())
      .slice(0, 12)
      .map((artifact) => ({
        id: artifact.id,
        sourceType: artifact.sourceType,
        artifactType: artifact.artifactType,
        title: artifact.title,
        excerpt: artifact.body.slice(0, 800),
        occurredAt: toIso(artifact.occurredAt),
      }));
    const conflicts = visibleClaims.filter((claim) => claim.status === 'disputed');

    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    const claimLines = visibleClaims.slice(0, 30).map((claim) => {
      const subject = entityById.get(claim.subjectEntityId)?.title ?? claim.subjectEntityId;
      const value = claim.objectEntityId
        ? entityById.get(claim.objectEntityId)?.title ?? claim.objectEntityId
        : typeof claim.objectValue === 'string' ? claim.objectValue : stableJson(claim.objectValue);
      return `- ${subject} —${claim.predicate}→ ${value} [${claim.status}; authority ${claim.authorityScore.toFixed(2)}; confidence ${claim.confidence.toFixed(2)}]`;
    });
    const edgeLines = visibleEdges.slice(0, 25).map((edge) => {
      const source = entityById.get(edge.sourceEntityId)?.title ?? edge.sourceEntityId;
      const target = entityById.get(edge.targetEntityId)?.title ?? edge.targetEntityId;
      return `- ${source} —${edge.relationshipType}→ ${target} [confidence ${edge.confidence.toFixed(2)}]`;
    });
    const contextText = [
      `Task-specific Company Brain context for ${input.agentRole}:`,
      '',
      'Relevant entities:',
      ...entities.slice(0, 20).map((entity) => `- [${entity.entityType}] ${entity.title}: ${entity.summary}`),
      '',
      'Evidence-backed claims:',
      ...(claimLines.length > 0 ? claimLines : ['- No approved claims matched.']),
      '',
      'Relationships:',
      ...(edgeLines.length > 0 ? edgeLines : ['- No typed relationships matched.']),
      ...(conflicts.length > 0
        ? ['', 'Unresolved conflicts — do not silently choose a side:', ...conflicts.map((claim) => `- Claim ${claim.id}: ${claim.predicate} = ${stableJson(claim.objectValue)}`)]
        : []),
      '',
      'Evidence references:',
      ...evidence.map((item) => `- ${item.id} | ${item.sourceType}/${item.artifactType} | ${item.title}`),
    ].join('\n');
    const maxChars = Math.max(2000, Math.min((input.tokenBudget ?? 2400) * 4, 16000));

    return {
      task,
      agentRole: input.agentRole,
      generatedAt: new Date().toISOString(),
      entities: entities.map((entity) => ({
        id: entity.id,
        entityType: entity.entityType,
        title: entity.title,
        summary: entity.summary,
        status: entity.status,
        ownerName: entity.ownerName,
        priority: entity.priority,
        dueAt: entity.dueAt,
      })),
      claims: visibleClaims,
      edges: visibleEdges,
      conflicts,
      evidence,
      omittedCount,
      contextText: contextText.slice(0, maxChars),
    };
  }

  /**
   * Lightweight boot probe: returns true when the Graph V2 tables exist and
   * are queryable, false when migration 118 has not been deployed (or the DB
   * is unreachable). Used to emit honest availability telemetry at startup —
   * agents continue with the approved CompanyProfile alone when this is false.
   */
  async probeAvailability(): Promise<boolean> {
    try {
      await this.query<{ ok: number }>(`SELECT 1 AS "ok" FROM "company_graph_entities" LIMIT 1`);
      return true;
    } catch {
      return false;
    }
  }

  async markArtifactFailure(input: { tenantId: string; artifactId: string; error: unknown }): Promise<void> {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    this.log?.warn({ tenantId: input.tenantId, artifactId: input.artifactId, err: message }, '[company-brain-v2] artifact processing failed');
    await this.setArtifactProcessingState({
      tenantId: input.tenantId,
      artifactId: input.artifactId,
      state: 'failed',
      error: message,
    }).catch(() => {});
  }
}
