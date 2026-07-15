/** Permission-filtered, measured-hybrid task context engine for Company Brain V2. */
import {
  ARTIFACT_WITH_POLICY_SELECT,
  buildContextText,
  canAgentAccessArtifact,
  clamp01,
  entityRecencyScore,
  hasEntityProvenance,
  type RelevanceSignal,
  compositeEntityScore,
  contextPackageId,
  COMPANY_BRAIN_RETRIEVAL_STRATEGY_VERSION,
  extractTaskIdentifiers,
  jsonStringArray,
  normalizeEntityLabel,
  toIso,
  uniqueStrings,
  type CompanyArtifactV2Row,
  type CompanyBrainContextPackage,
  type CompanyClaimRow,
  type CompanyEdgeRow,
  type CompanyEntityV2Row,
  type ContextClaim,
  type ContextEdge,
  type ContextEntity,
  type ContextEvidence,
  type ContextOmissions,
} from './company-brain-v2.core.js';
import { CompanyBrainReviewStore } from './company-brain-v2.review.js';

interface CandidateEntity {
  row: CompanyEntityV2Row;
  signal: RelevanceSignal;
}

export abstract class CompanyBrainContextStore extends CompanyBrainReviewStore {
  /**
   * Phase 1 hybrid retrieval:
   *   exact canonical alias + stable-identifier match + PostgreSQL keyword
   *   search (ts_rank) + 1-hop graph-neighborhood expansion, scored into a
   *   composite, then permission-filtered (taint-safe source-AND) and
   *   budget-allocated by COMPLETE items only.
   *
   * Rule: **No relevant result → empty governed context.** The previous
   * "inject the 15 most-recent entities" recency fallback is removed.
   *
   * Error contract: an empty *result* returns an empty package (no recency
   * fallback); a retrieval *error* (missing Graph V2 tables, DB failure)
   * PROPAGATES — the provider factory catches it, logs a warn, and returns
   * null so the agent degrades to the approved CompanyProfile alone. Per-query
   * `.catch(() => [])` swallows are intentionally absent: silently turning a
   * hard failure into an empty-but-quiet package would hide the failure
   * ("never silently catch important failures"). The boot probe
   * `probeAvailability` is the only deliberate catch (boolean → telemetry).
   */
  async getContextPackage(input: {
    tenantId: string;
    task: string;
    agentRole: string;
    tokenBudget?: number;
    userId?: string;
    workflowId?: string;
    estimator?: (text: string) => number;
  }): Promise<CompanyBrainContextPackage> {
    const started = Date.now();
    const task = input.task.trim();
    const actor = { userId: input.userId, agentRole: input.agentRole, workflowId: input.workflowId };
    const empty = (omissions: ContextOmissions = { restricted: 0, expired: 0, irrelevant: 0 }): CompanyBrainContextPackage => ({
      id: contextPackageId({ tenantId: input.tenantId, task, agentRole: input.agentRole, generatedAt: new Date().toISOString() }),
      tenantId: input.tenantId,
      task,
      actor,
      scope: { projectIds: [], customerIds: [], entityIds: [] },
      entities: [],
      claims: [],
      disputedClaims: [],
      edges: [],
      evidence: [],
      omissions,
      retrieval: { strategyVersion: COMPANY_BRAIN_RETRIEVAL_STRATEGY_VERSION, candidateCount: 0, selectedCount: 0, latencyMs: Date.now() - started },
      generatedAt: new Date().toISOString(),
      contextText: '',
      omittedCount: 0,
    });
    if (!task) return empty();

    const ids = extractTaskIdentifiers(task);
    const aliasTokens = uniqueStrings([
      ...ids.tokens.map(normalizeEntityLabel),
      ...ids.emails.map((e) => normalizeEntityLabel(e)),
      ...ids.emails,
      ...ids.urls.map((u) => u.toLowerCase()),
      ...ids.ids.map((s) => s.toLowerCase()),
    ].filter((s) => s && s.length >= 2));

    // --- Candidate gathering (union, tagged with signal). -------------------
    const byId = new Map<string, CandidateEntity>();
    const addCandidates = (rows: CompanyEntityV2Row[], signal: Partial<CandidateEntity['signal']>) => {
      for (const row of rows) {
        const existing = byId.get(row.id);
        if (existing) {
          existing.signal.exactAlias ||= signal.exactAlias ?? false;
          existing.signal.identifier ||= signal.identifier ?? false;
          existing.signal.keywordRank = Math.max(existing.signal.keywordRank, signal.keywordRank ?? 0);
          existing.signal.graphNeighbor ||= signal.graphNeighbor ?? false;
          existing.signal.recency = Math.max(existing.signal.recency ?? 0, entityRecencyScore(row));
          existing.signal.confidence = Math.max(existing.signal.confidence ?? 0, clamp01(row.confidence ?? 0.5));
        } else {
          byId.set(row.id, {
            row,
            signal: {
              exactAlias: signal.exactAlias ?? false,
              identifier: signal.identifier ?? false,
              keywordRank: signal.keywordRank ?? 0,
              graphNeighbor: signal.graphNeighbor ?? false,
              recency: entityRecencyScore(row),
              confidence: clamp01(row.confidence ?? 0.5),
            },
          });
        }
      }
    };

    // (a) exact canonical alias match
    if (aliasTokens.length > 0) {
      const aliasRows = await this.query<CompanyEntityV2Row>(
        `SELECT e.*
           FROM "company_entity_aliases" a
           JOIN "company_graph_entities" e ON e."id" = a."entityId" AND e."tenantId" = a."tenantId"
          WHERE a."tenantId" = $1 AND e."deletedAt" IS NULL
            AND a."normalizedAlias" = ANY($2::TEXT[])`,
        input.tenantId,
        aliasTokens,
      );
      addCandidates(aliasRows, { exactAlias: true });
    }

    // (b1) C2: EXACT indexed email lookup -- an email matches the entity that
    // owns it, not any entity whose properties merely contain the email as a
    // substring. Additive to the ILIKE fallback below; best-effort (missing
    // table -> ILIKE still covers it).
    if (ids.emails.length > 0) {
      try {
        const exactEmailRows = await this.query<CompanyEntityV2Row>(
          `SELECT e.* FROM "company_graph_entities" e
             JOIN "company_entity_identifiers" i ON i."entityId" = e."id" AND i."tenantId" = e."tenantId"
            WHERE e."tenantId" = $1 AND e."deletedAt" IS NULL
              AND i."kind" = 'email' AND i."normalizedValue" = ANY($2::TEXT[])
            LIMIT 50`,
          input.tenantId,
          ids.emails,
        );
        addCandidates(exactEmailRows, { identifier: true });
      } catch { /* company_entity_identifiers not migrated -> ILIKE fallback */ }
    }

    // (b2) fuzzy identifier substring match (emails / urls / ids) -- ILIKE
    // safety net so un-indexed entities are still retrievable.
    if (ids.emails.length > 0 || ids.urls.length > 0 || ids.ids.length > 0) {
      const patterns = uniqueStrings([
        ...ids.emails.map((e) => `%${e}%`),
        ...ids.urls.map((u) => `%${u}%`),
        ...ids.ids.map((s) => `%${s}%`),
      ]);
      const idRows = await this.query<CompanyEntityV2Row>(
        `SELECT * FROM "company_graph_entities"` +
          ` WHERE "tenantId" = $1 AND "deletedAt" IS NULL` +
          `   AND "properties"::TEXT ILIKE ANY($2::TEXT[])` +
          ` LIMIT 50`,
        input.tenantId,
        patterns,
      );
      addCandidates(idRows, { identifier: true });
    }

    // (c) PostgreSQL keyword search (ts_rank). No recency fallback on empty/throw.
    const search = ids.tokens.join(' ');
    if (search.length > 0) {
      const ftsRows = await this.query<{ id: string; rank: number } & CompanyEntityV2Row>(
        `SELECT *, ts_rank(
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
        search,
      );
      addCandidates(ftsRows.map((r) => ({ ...r })) as CompanyEntityV2Row[], { keywordRank: 1 });
      // Re-apply the actual rank magnitude (ts_rank is tiny; normalize to [0,1]).
      for (const r of ftsRows) {
        const c = byId.get(r.id);
        if (c) c.signal.keywordRank = Math.min(1, Math.max(c.signal.keywordRank, r.rank > 0 ? Math.min(1, r.rank * 16) : 0));
      }
    }

    if (byId.size === 0) {
      // No relevant result → empty governed context. Never inject recency.
      return empty({ restricted: 0, expired: 0, irrelevant: 0 });
    }

    // --- Score + relevance top-N. ------------------------------------------
    // Keep only direct candidates with a positive relevance signal
    // (exact alias / stable identifier / keyword rank). Graph neighbors are
    // selected separately after expansion so they are never miscounted as
    // irrelevant and never used as expansion seeds themselves.
    const directSelected = [...byId.values()]
      .filter((c) => c.signal.exactAlias || c.signal.identifier || c.signal.keywordRank > 0)
      .sort((a, b) => compositeEntityScore(b.signal) - compositeEntityScore(a.signal))
      .slice(0, 20);

    // --- 1-hop graph-neighborhood expansion (scored lower). -----------------
    const seedIds = directSelected.map((c) => c.row.id);
    if (seedIds.length > 0) {
      const neighborRows = await this.query<{ sourceEntityId: string; targetEntityId: string }>(
        `SELECT "sourceEntityId", "targetEntityId" FROM "company_edges"
          WHERE "tenantId" = $1 AND "status" IN ('active','disputed')
            AND ("sourceEntityId" = ANY($2::TEXT[]) OR "targetEntityId" = ANY($2::TEXT[]))
          LIMIT 60`,
        input.tenantId,
        seedIds,
      );
      // Collect the "other" endpoint for every edge touching a seed.
      const seedSet = new Set(seedIds);
      const neighborIds = new Set<string>();
      for (const e of neighborRows) {
        if (seedSet.has(e.sourceEntityId) && !seedSet.has(e.targetEntityId)) neighborIds.add(e.targetEntityId);
        else if (seedSet.has(e.targetEntityId) && !seedSet.has(e.sourceEntityId)) neighborIds.add(e.sourceEntityId);
      }
      if (neighborIds.size > 0) {
        const neighborEntities = await this.query<CompanyEntityV2Row>(
          `SELECT * FROM "company_graph_entities"
            WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND "id" = ANY($2::TEXT[])
            LIMIT 10`,
          input.tenantId,
          [...neighborIds],
        );
        addCandidates(neighborEntities, { graphNeighbor: true });
      }
    }

    // Neighbors were added to byId AFTER direct selection; pick them up now as
    // their own (lower-scored) tier, capped so direct matches always dominate.
    const directIds = new Set(directSelected.map((c) => c.row.id));
    const neighborSelected = [...byId.values()]
      .filter((c) => !directIds.has(c.row.id) && c.signal.graphNeighbor)
      .sort((a, b) => compositeEntityScore(b.signal) - compositeEntityScore(a.signal))
      .slice(0, Math.max(0, 30 - directSelected.length));
    const selectedRaw = [...directSelected, ...neighborSelected];
    // C1 provenance gate: drop source-less orphans before access filtering so no
    // claim with no evidence can influence a workflow (truth-doc C1).
    const selected = selectedRaw.filter((c) => hasEntityProvenance(c.row));
    const provenanceDrops = selectedRaw.length - selected.length;

    const candidateCount = byId.size;
    const irrelevantCount = Math.max(0, candidateCount - selected.length);

    // --- Access filter (taint-safe: source-AND on visibility). -------------
    const candidateRows = selected.map((c) => c.row);
    const artifactIds = uniqueStrings(candidateRows.flatMap((entity) => jsonStringArray(entity.sourceArtifactIds)));
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
    const visibleArtifactIds = new Set<string>();
    let restrictedDrops = 0;
    let expiredDrops = 0;
    for (const a of artifacts) {
      const retained = !(a.retentionUntil && a.retentionUntil.getTime() < Date.now());
      if (!retained) { expiredDrops += 1; continue; }
      if (canAgentAccessArtifact(a, input.agentRole)) visibleArtifactIds.add(a.id);
      else restrictedDrops += 1;
    }

    const visibleEntities: ContextEntity[] = [];
    for (const c of selected) {
      const sources = jsonStringArray(c.row.sourceArtifactIds);
      // No sources → no restriction → keep. Any source restricted/expired → drop (taint-safe).
      if (sources.length === 0 || sources.every((id) => visibleArtifactIds.has(id))) {
        const e = c.row;
        visibleEntities.push({
          id: e.id, entityType: e.entityType, title: e.title, summary: e.summary,
          status: e.status, ownerName: e.ownerName, priority: e.priority, dueAt: toIso(e.dueAt),
          score: compositeEntityScore(c.signal), sourceArtifactIds: sources,
        });
      }
    }
    const visibleEntityIdSet = new Set(visibleEntities.map((e) => e.id));
    const selectedCount = visibleEntities.length;

    // --- Claims (with preserved evidence ids) + edges. ---------------------
    let claims: ContextClaim[] = [];
    let edges: ContextEdge[] = [];
    if (visibleEntityIdSet.size > 0) {
      const visibleIds = [...visibleEntityIdSet];
      const [claimRows, edgeRows, evidenceRows] = await Promise.all([
        this.query<CompanyClaimRow>(
          `SELECT * FROM "company_claims"
            WHERE "tenantId" = $1 AND "subjectEntityId" = ANY($2::TEXT[])
              AND "status" IN ('active','disputed')
            ORDER BY CASE "status" WHEN 'active' THEN 0 ELSE 1 END, "authorityScore" DESC, "updatedAt" DESC
            LIMIT 80`,
          input.tenantId, visibleIds,
        ),
        this.query<CompanyEdgeRow>(
          `SELECT * FROM "company_edges"
            WHERE "tenantId" = $1 AND "status" IN ('active','disputed')
              AND ("sourceEntityId" = ANY($2::TEXT[]) OR "targetEntityId" = ANY($2::TEXT[]))
            ORDER BY "confidence" DESC, "updatedAt" DESC
            LIMIT 80`,
          input.tenantId, visibleIds,
        ),
        this.query<{ claimId: string; artifactId: string }>(
          `SELECT "claimId", "artifactId" FROM "company_claim_evidence"
            WHERE "tenantId" = $1 AND "claimId" IN (
              SELECT "id" FROM "company_claims" WHERE "tenantId" = $1 AND "subjectEntityId" = ANY($2::TEXT[]) AND "status" IN ('active','disputed')
            )`,
          input.tenantId, visibleIds,
        ),
      ]);

      const evidenceByClaim = new Map<string, string[]>();
      for (const ev of evidenceRows) {
        const arr = evidenceByClaim.get(ev.claimId) ?? [];
        arr.push(ev.artifactId);
        evidenceByClaim.set(ev.claimId, arr);
      }

      claims = claimRows
        .filter((c) => visibleEntityIdSet.has(c.subjectEntityId) && (!c.objectEntityId || visibleEntityIdSet.has(c.objectEntityId)))
        .map((c) => ({
          id: c.id, subjectEntityId: c.subjectEntityId, predicate: c.predicate,
          objectEntityId: c.objectEntityId, objectValue: c.objectValue, normalizedObject: c.normalizedObject,
          status: c.status, confidence: c.confidence, authorityScore: c.authorityScore,
          validFrom: toIso(c.validFrom), validTo: toIso(c.validTo),
          evidenceIds: evidenceByClaim.get(c.id) ?? [],
        }));
      edges = edgeRows
        .filter((e) => visibleEntityIdSet.has(e.sourceEntityId) && visibleEntityIdSet.has(e.targetEntityId))
        .map((e) => ({
          id: e.id, sourceEntityId: e.sourceEntityId, relationshipType: e.relationshipType,
          targetEntityId: e.targetEntityId, status: e.status, confidence: e.confidence,
          evidenceArtifactIds: jsonStringArray(e.evidenceArtifactIds),
        }));
    }
    const disputedClaims = claims.filter((c) => c.status === 'disputed');

    // --- Evidence drawer (only visible artifacts). -------------------------
    const evidence: ContextEvidence[] = artifacts
      .filter((a) => visibleArtifactIds.has(a.id))
      .sort((a, b) => (b.occurredAt ?? b.createdAt).getTime() - (a.occurredAt ?? a.createdAt).getTime())
      .slice(0, 12)
      .map((a) => ({
        id: a.id, sourceType: a.sourceType, artifactType: a.artifactType, title: a.title,
        excerpt: a.body.slice(0, 800), occurredAt: toIso(a.occurredAt),
      }));

    // --- Scope derivation. -------------------------------------------------
    const projectEntityTypes = new Set(['project', 'product']);
    const customerEntityTypes = new Set(['customer', 'customer_signal']);
    const scope = {
      projectIds: visibleEntities.filter((e) => projectEntityTypes.has(e.entityType)).map((e) => e.id),
      customerIds: visibleEntities.filter((e) => customerEntityTypes.has(e.entityType)).map((e) => e.id),
      entityIds: visibleEntities.map((e) => e.id),
    };

    const omissions: ContextOmissions = { restricted: restrictedDrops, expired: expiredDrops, irrelevant: irrelevantCount };
    const tokenBudget = input.tokenBudget ?? 2400;
    const contextText = buildContextText({
      entities: visibleEntities, claims, disputedClaims, edges, evidence,
      agentRole: input.agentRole, tokenBudget, estimator: input.estimator,
    });
    const generatedAt = new Date().toISOString();

    return {
      id: contextPackageId({ tenantId: input.tenantId, task, agentRole: input.agentRole, generatedAt }),
      tenantId: input.tenantId,
      task,
      actor,
      scope,
      entities: visibleEntities,
      claims,
      disputedClaims,
      edges,
      evidence,
      omissions,
      retrieval: { strategyVersion: COMPANY_BRAIN_RETRIEVAL_STRATEGY_VERSION, candidateCount, selectedCount, provenanceDrops, latencyMs: Date.now() - started },
      generatedAt,
      contextText,
      omittedCount: omissions.restricted + omissions.expired + omissions.irrelevant,
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