/** Base database and artifact-policy layer for Company Brain V2. */
import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import {
  ARTIFACT_WITH_POLICY_SELECT,
  uniqueStrings,
  type ArtifactVisibility,
  type CompanyArtifactV2Row,
  type CompanyEntityV2Row,
} from './company-brain-v2.core.js';
import { graphTxStorage } from './company-brain-v2.tx-context.js';

export abstract class CompanyBrainArtifactStore {
  protected abstract mergeEntities(input: {
    tenantId: string;
    userId: string;
    sourceEntityId: string;
    targetEntityId: string;
    reason: string;
    similarity?: number;
    tier?: string;
    algorithmVersion?: string;
    matchingEvidence?: Record<string, unknown>;
  }): Promise<CompanyEntityV2Row>;

  protected readonly embeddingProvider?: import('./company-brain-embeddings.js').EmbeddingProvider;

  constructor(
    protected readonly db: PrismaClient,
    protected readonly log?: FastifyBaseLogger,
    opts?: { embeddingProvider?: import('./company-brain-embeddings.js').EmbeddingProvider },
  ) {
    this.embeddingProvider = opts?.embeddingProvider;
  }

  /**
   * Run a SELECT against the current graph tx runner when one is active
   * (`mergeEntities`' `$transaction`), else against `this.db`. The tx runner is
   * propagated via AsyncLocalStorage — see company-brain-v2.tx-context.ts. This
   * is what makes the multi-statement merge body atomic without threading a
   * `tx` param through every upsert helper.
   */
  protected async query<T>(sql: string, ...values: unknown[]): Promise<T[]> {
    const tx = graphTxStorage.getStore();
    if (tx) return tx.$queryRawUnsafe<T[]>(sql, ...values);
    return this.db.$queryRawUnsafe<T[]>(sql, ...values);
  }

  protected async execute(sql: string, ...values: unknown[]): Promise<number> {
    const tx = graphTxStorage.getStore();
    if (tx) return tx.$executeRawUnsafe(sql, ...values);
    return this.db.$executeRawUnsafe(sql, ...values);
  }

  async claimArtifactForProcessing(input: {
    tenantId: string;
    artifactId: string;
    force?: boolean;
    maxAttempts?: number;
  }): Promise<boolean> {
    const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 3, 10));
    const rows = await this.query<{ artifactId: string }>(
      `INSERT INTO "company_artifact_policies"
        ("artifactId", "tenantId", "processingState", "processingAttempts", "processingError")
       SELECT a."id", a."tenantId", 'processing', 1, NULL
       FROM "company_artifacts" a
       WHERE a."id" = $1 AND a."tenantId" = $2 AND a."deletedAt" IS NULL
       ON CONFLICT ("artifactId") DO UPDATE
       SET "processingState" = 'processing',
           "processingAttempts" = "company_artifact_policies"."processingAttempts" + 1,
           "processingError" = NULL,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE $3::BOOLEAN
          OR (
            "company_artifact_policies"."processingAttempts" < $4
            AND (
              "company_artifact_policies"."processingState" IN ('ingested', 'failed')
              OR (
                "company_artifact_policies"."processingState" = 'processing'
                AND "company_artifact_policies"."updatedAt" < CURRENT_TIMESTAMP - INTERVAL '30 minutes'
              )
            )
          )
       RETURNING "artifactId"`,
      input.artifactId,
      input.tenantId,
      input.force === true,
      maxAttempts,
    );
    if (rows.length === 0) return false;
    await this.execute(
      `UPDATE "company_artifacts"
       SET "ingestionStatus" = 'processing', "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL`,
      input.artifactId,
      input.tenantId,
    );
    return true;
  }

  async listPendingArtifacts(input: { limit?: number }): Promise<Array<{
    id: string;
    tenantId: string;
    userId: string;
    needsExtraction: boolean;
  }>> {
    const limit = Math.max(1, Math.min(input.limit ?? 3, 25));
    const rows = await this.query<{
      id: string;
      tenantId: string;
      createdBy: string | null;
      ingestionStatus: string;
      extractedAt: Date | null;
    }>(
      `SELECT a."id", a."tenantId", a."createdBy", a."ingestionStatus", a."extractedAt"
       FROM "company_artifacts" a
       LEFT JOIN "company_artifact_policies" p
         ON p."artifactId" = a."id" AND p."tenantId" = a."tenantId"
       WHERE a."deletedAt" IS NULL
         AND (
           p."artifactId" IS NULL
           OR p."processingState" IN ('ingested', 'failed')
           OR (p."processingState" = 'processing' AND p."updatedAt" < CURRENT_TIMESTAMP - INTERVAL '30 minutes')
         )
         AND COALESCE(p."processingAttempts", 0) < 3
       ORDER BY a."createdAt" ASC
       LIMIT $1`,
      limit,
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      userId: row.createdBy ?? 'system',
      needsExtraction: row.extractedAt === null && !['extracted', 'ready'].includes(row.ingestionStatus),
    }));
  }

  /**
   * Direct tenant-scoped artifact processing status (replaces the prior
   * scan-and-find over the latest 200 artifacts). Returns whether the
   * artifact exists in the tenant and whether entity extraction is still
   * needed (no extractedAt, not already extracted/ready).
   */
  async getArtifactProcessingStatus(input: {
    tenantId: string;
    artifactId: string;
  }): Promise<{ found: boolean; needsExtraction: boolean; ingestionStatus: string | null; extractedAt: Date | null }> {
    const rows = await this.query<{ extractedAt: Date | null; ingestionStatus: string }>(
      `SELECT "extractedAt", "ingestionStatus" FROM "company_artifacts"
       WHERE "id" = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
      input.artifactId,
      input.tenantId,
    ).catch(() => [] as Array<{ extractedAt: Date | null; ingestionStatus: string }>);
    const row = rows[0];
    if (!row) return { found: false, needsExtraction: false, ingestionStatus: null, extractedAt: null };
    const needsExtraction = row.extractedAt === null && !['extracted', 'ready'].includes(row.ingestionStatus);
    return { found: true, needsExtraction, ingestionStatus: row.ingestionStatus, extractedAt: row.extractedAt };
  }

  async setArtifactProcessingState(input: {
    tenantId: string;
    artifactId: string;
    state: 'processing' | 'ready' | 'failed';
    error?: string | null;
  }): Promise<void> {
    const artifactExists = await this.query<{ id: string }>(
      `SELECT "id" FROM "company_artifacts"
       WHERE "id" = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
      input.artifactId,
      input.tenantId,
    );
    if (!artifactExists[0]) throw new Error(`Company artifact id=${input.artifactId} not found in this tenant.`);

    await this.execute(
      `INSERT INTO "company_artifact_policies"
        ("artifactId", "tenantId", "processingState", "processingAttempts", "processingError")
       VALUES ($1, $2, $3, CASE WHEN $3 = 'processing' THEN 1 ELSE 0 END, $4)
       ON CONFLICT ("artifactId") DO UPDATE
       SET "processingState" = EXCLUDED."processingState",
           "processingAttempts" = CASE WHEN EXCLUDED."processingState" = 'processing'
             THEN "company_artifact_policies"."processingAttempts" + 1
             ELSE "company_artifact_policies"."processingAttempts"
           END,
           "processingError" = EXCLUDED."processingError",
           "updatedAt" = CURRENT_TIMESTAMP`,
      input.artifactId,
      input.tenantId,
      input.state,
      input.error?.slice(0, 4000) ?? null,
    );
    await this.execute(
      `UPDATE "company_artifacts"
       SET "ingestionStatus" = $3, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL`,
      input.artifactId,
      input.tenantId,
      input.state,
    );
  }

  async setArtifactPolicy(input: {
    tenantId: string;
    artifactId: string;
    visibility: ArtifactVisibility;
    allowedAgentRoles?: string[];
    sensitivity?: 'normal' | 'confidential' | 'highly_confidential';
    retentionUntil?: Date | null;
  }): Promise<CompanyArtifactV2Row> {
    const roles = uniqueStrings((input.allowedAgentRoles ?? []).map((role) => role.toUpperCase()));
    const upserted = await this.query<{ artifactId: string }>(
      `INSERT INTO "company_artifact_policies"
        ("artifactId", "tenantId", "visibility", "allowedAgentRoles", "sensitivity", "retentionUntil")
       SELECT a."id", a."tenantId", $3, $4::TEXT[], $5, $6
       FROM "company_artifacts" a
       WHERE a."id" = $1 AND a."tenantId" = $2 AND a."deletedAt" IS NULL
       ON CONFLICT ("artifactId") DO UPDATE
       SET "visibility" = EXCLUDED."visibility",
           "allowedAgentRoles" = EXCLUDED."allowedAgentRoles",
           "sensitivity" = EXCLUDED."sensitivity",
           "retentionUntil" = EXCLUDED."retentionUntil",
           "updatedAt" = CURRENT_TIMESTAMP
       RETURNING "artifactId"`,
      input.artifactId,
      input.tenantId,
      input.visibility,
      roles,
      input.sensitivity ?? 'normal',
      input.retentionUntil ?? null,
    );
    if (!upserted[0]) throw new Error(`Company artifact id=${input.artifactId} not found in this tenant.`);
    const rows = await this.query<CompanyArtifactV2Row>(
      `SELECT ${ARTIFACT_WITH_POLICY_SELECT}
       FROM "company_artifacts" a
       LEFT JOIN "company_artifact_policies" p ON p."artifactId" = a."id" AND p."tenantId" = a."tenantId"
       WHERE a."id" = $1 AND a."tenantId" = $2 AND a."deletedAt" IS NULL
       LIMIT 1`,
      input.artifactId,
      input.tenantId,
    );
    if (!rows[0]) throw new Error(`Company artifact id=${input.artifactId} not found in this tenant.`);
    return rows[0];
  }

}
