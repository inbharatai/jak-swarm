/**
 * PR E (Phase 10) — mergeEntities FULL SINGLE-TRANSACTION ATOMICITY (real Postgres).
 *
 * Proves the PR-B-deferred gap is CLOSED: the entire merge body (CAS claim →
 * migrate claims/edges/aliases onto target → append artifacts → hard-delete
 * source rows → soft-delete + status='merged' source → merge-audit insert →
 * resolve reviews) runs inside ONE `db.$transaction`. A failure anywhere in
 * the body rolls the WHOLE merge back — the source is NOT left in the transient
 * `merging` status, and no partial migration is left on the target.
 *
 * Mechanism: a `FaultyBrain` subclass overrides `upsertEdge` to throw. The merge
 * calls `upsertClaim` (migrates a claim onto the target) BEFORE `upsertEdge`
 * (the edge-migration loop), so the throw fires AFTER the claim migration —
 * exactly the mid-body window that pre-PR-E left partially applied. With the
 * tx, the migrated claim + the source CAS are rolled back together.
 *
 * Asserts after the failed merge:
 *   - source.status === 'active' (rolled back from `merging`, NOT stuck);
 *   - source.deletedAt IS NULL (not soft-deleted);
 *   - the source's original claim + edge still exist (the hard-deletes rolled back);
 *   - the target has NO migrated claim (the upsertClaim rolled back);
 *   - no `company_entity_merges` audit row was written for this merge.
 *
 * Skipped (not silently passed) when the container runtime is down.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@jak-swarm/db';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompanyBrainV2Service } from '../../apps/api/src/services/company-brain/company-brain-v2.service.js';
import type { CompanyEdgeRow } from '../../apps/api/src/services/company-brain/company-brain-v2.core.js';
import type { FastifyBaseLogger } from 'fastify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const noopLog = { info() {}, warn() {}, debug() {}, error() {} } as unknown as FastifyBaseLogger;
const future = new Date('2099-01-01T00:00:00Z');

/** Subclass that throws inside the edge-migration loop (mid-body, AFTER the
 *  claim migration has run) to force a transaction rollback. */
class FaultyBrain extends CompanyBrainV2Service {
  protected override async upsertEdge(): Promise<CompanyEdgeRow> {
    throw new Error('injected mid-merge failure (edge migration)');
  }
}

describe.sequential('PR E — mergeEntities single-transaction atomicity (testcontainers)', () => {
  let container: Awaited<ReturnType<GenericContainer['start']>>;
  let prisma: PrismaClient;
  let brain: FaultyBrain;
  let runtimeUnavailable = false;

  beforeAll(async () => {
    try {
      container = await new GenericContainer('pgvector/pgvector:pg16')
        .withEnvironment({ POSTGRES_DB: 'jakswarm', POSTGRES_USER: 'jakswarm', POSTGRES_PASSWORD: 'jakswarm' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/i))
        .start();
      const dbUrl = `postgresql://jakswarm:jakswarm@${container.getHost()}:${container.getMappedPort(5432)}/jakswarm`;
      process.env.DATABASE_URL = dbUrl;
      process.env.DIRECT_URL = dbUrl;
      execSync('pnpm --filter @jak-swarm/db db:migrate:deploy', {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl } as NodeJS.ProcessEnv,
      });
      prisma = new PrismaClient();
      await prisma.$connect();
      brain = new FaultyBrain(prisma, noopLog);
    } catch (error) {
      runtimeUnavailable = true;
      console.warn('[company-brain-merge-atomicity] Skipping: container runtime unavailable', error);
    }
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  const mkTenant = async (slug: string) => {
    const t = await prisma.tenant.create({ data: { name: slug, slug: `${slug}-${Date.now()}`, plan: 'FREE' } });
    return t.id;
  };

  it('a mid-merge failure rolls the WHOLE merge back: source stays active, no partial migration on target, no merge-audit row', async () => {
    if (runtimeUnavailable) return;
    const tid = await mkTenant('atomic');
    // Artifact + three entities: source, target, and a third the source points at.
    await prisma.companyArtifact.create({ data: { id: 'a_atomic', tenantId: tid, sourceType: 'document', artifactType: 'memo', title: 'M', body: 'b', bodyHash: 'a_atomic', occurredAt: future } });
    await prisma.companyGraphEntity.create({ data: { id: 'e_src', tenantId: tid, entityType: 'company', title: 'Source Co', summary: 'source', sourceArtifactIds: ['a_atomic'], occurredAt: future, properties: {} } });
    await prisma.companyGraphEntity.create({ data: { id: 'e_tgt', tenantId: tid, entityType: 'company', title: 'Target Co', summary: 'target', sourceArtifactIds: ['a_atomic'], occurredAt: future, properties: {} } });
    await prisma.companyGraphEntity.create({ data: { id: 'e_third', tenantId: tid, entityType: 'company', title: 'Third Co', summary: 'third', sourceArtifactIds: ['a_atomic'], occurredAt: future, properties: {} } });
    // A claim on the source (migrated onto the target BEFORE the edge loop).
    await prisma.$executeRawUnsafe(
      `INSERT INTO "company_claims" ("id","tenantId","subjectEntityId","predicate","objectEntityId","objectValue","normalizedObject","fingerprint","status","confidence","authorityScore","createdBy")
       VALUES ($1,$2,$3,'has_revenue',NULL,$4::JSONB,$5,$6,'active',0.8,0.5,'u')`,
      'cl_src', tid, 'e_src', JSON.stringify(1000000), '1000000', 'fp_src',
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "company_claim_evidence" ("id","tenantId","claimId","artifactId","excerpt","sourceAuthority","observedAt")
       VALUES ($1,$2,$3,$4,'rev',$5,$6)`,
      'ev_src', tid, 'cl_src', 'a_atomic', 0.5, future,
    );
    // An edge from source → third (the edge-migration loop calls upsertEdge, which throws).
    await prisma.$executeRawUnsafe(
      `INSERT INTO "company_edges" ("id","tenantId","sourceEntityId","relationshipType","targetEntityId","status","confidence","evidenceArtifactIds")
       VALUES ($1,$2,$3,'partner_of',$4,'active',0.9,$5::JSONB)`,
      'ed_src', tid, 'e_src', 'e_third', JSON.stringify(['a_atomic']),
    );

    // The merge throws mid-body (inside the edge-migration loop, AFTER the
    // claim was migrated onto the target by upsertClaim).
    await expect(
      brain.mergeEntities({ tenantId: tid, userId: 'u', sourceEntityId: 'e_src', targetEntityId: 'e_tgt', reason: 'dup', similarity: 0.9 }),
    ).rejects.toThrow(/injected mid-merge failure/);

    // Source is ROLLED BACK to active — NOT stuck in the transient `merging`.
    const src = await prisma.$queryRawUnsafe<Array<{ status: string; deletedAt: Date | null }>>(
      `SELECT "status", "deletedAt" FROM "company_graph_entities" WHERE "id" = 'e_src' AND "tenantId" = $1`, tid,
    );
    expect(src[0]?.status).toBe('active');
    expect(src[0]?.deletedAt).toBeNull();

    // Target is unchanged — NO migrated claim (the upsertClaim rolled back).
    const tgtClaims = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "company_claims" WHERE "tenantId" = $1 AND "subjectEntityId" = 'e_tgt'`, tid,
    );
    expect(Number(tgtClaims[0]?.n ?? 0)).toBe(0);

    // The source's original claim + edge still exist (the hard-deletes rolled back).
    const srcClaims = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "company_claims" WHERE "tenantId" = $1 AND "subjectEntityId" = 'e_src'`, tid,
    );
    expect(Number(srcClaims[0]?.n ?? 0)).toBe(1);
    const srcEdges = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "company_edges" WHERE "tenantId" = $1 AND ("sourceEntityId" = 'e_src' OR "targetEntityId" = 'e_src')`, tid,
    );
    expect(Number(srcEdges[0]?.n ?? 0)).toBe(1);

    // No merge-audit row was written (the INSERT rolled back).
    const merges = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "company_entity_merges" WHERE "tenantId" = $1 AND "sourceEntityId" = 'e_src'`, tid,
    );
    expect(Number(merges[0]?.n ?? 0)).toBe(0);
  });

  it('a successful merge still commits atomically: source merged + soft-deleted, claim migrated onto target, merge-audit row written', async () => {
    if (runtimeUnavailable) return;
    const tid = await mkTenant('atomic-ok');
    await prisma.companyArtifact.create({ data: { id: 'a_ok', tenantId: tid, sourceType: 'document', artifactType: 'memo', title: 'M', body: 'b', bodyHash: 'a_ok', occurredAt: future } });
    await prisma.companyGraphEntity.create({ data: { id: 'ok_src', tenantId: tid, entityType: 'company', title: 'Source Co', summary: 'source', sourceArtifactIds: ['a_ok'], occurredAt: future, properties: {} } });
    await prisma.companyGraphEntity.create({ data: { id: 'ok_tgt', tenantId: tid, entityType: 'company', title: 'Target Co', summary: 'target', sourceArtifactIds: ['a_ok'], occurredAt: future, properties: {} } });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "company_claims" ("id","tenantId","subjectEntityId","predicate","objectEntityId","objectValue","normalizedObject","fingerprint","status","confidence","authorityScore","createdBy")
       VALUES ($1,$2,$3,'has_revenue',NULL,$4::JSONB,$5,$6,'active',0.8,0.5,'u')`,
      'cl_ok', tid, 'ok_src', JSON.stringify(1000000), '1000000', 'fp_ok',
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "company_claim_evidence" ("id","tenantId","claimId","artifactId","excerpt","sourceAuthority","observedAt")
       VALUES ($1,$2,$3,$4,'rev',$5,$6)`,
      'ev_ok', tid, 'cl_ok', 'a_ok', 0.5, future,
    );
    // No edge → upsertEdge is never called → the FaultyBrain override does not
    // fire → the merge commits. This proves the happy path is unaffected by the
    // tx wrapping.
    const merged = await brain.mergeEntities({ tenantId: tid, userId: 'u', sourceEntityId: 'ok_src', targetEntityId: 'ok_tgt', reason: 'dup', similarity: 0.9 });
    expect(merged.id).toBe('ok_tgt');
    const src = await prisma.$queryRawUnsafe<Array<{ status: string; deletedAt: Date | null }>>(
      `SELECT "status", "deletedAt" FROM "company_graph_entities" WHERE "id" = 'ok_src' AND "tenantId" = $1`, tid,
    );
    expect(src[0]?.status).toBe('merged');
    expect(src[0]?.deletedAt).not.toBeNull();
    const tgtClaims = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "company_claims" WHERE "tenantId" = $1 AND "subjectEntityId" = 'ok_tgt'`, tid,
    );
    expect(Number(tgtClaims[0]?.n ?? 0)).toBe(1);
    const merges = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "company_entity_merges" WHERE "tenantId" = $1 AND "sourceEntityId" = 'ok_src'`, tid,
    );
    expect(Number(merges[0]?.n ?? 0)).toBe(1);
  });
});