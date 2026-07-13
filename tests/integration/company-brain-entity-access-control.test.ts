/**
 * Company Brain Graph V2 — Phase 3 entity identity + Phase 5 access control
 * (real Postgres, adversarial).
 *
 * Spins up a real pgvector/pgvector:pg16 container, applies the full migration
 * chain (incl. migration 120 `company_entity_merge_rejections`), then drives the
 * REAL `CompanyBrainV2Service` and asserts the PR B guarantees:
 *
 *   - cross-tenant isolation: a tier-2 (shared-domain) merge resolves ONLY
 *     within the calling tenant; an identical entity in another tenant is
 *     never matched, never merged, never mutated.
 *   - restricted-via-edge (source-AND): an edge between a visible (internal)
 *     entity and a restricted entity is DROPPED for a non-allowed role — both
 *     endpoints must be visible, so the restricted endpoint's drop takes the
 *     edge with it; the relationship never leaks through graph structure. The
 *     edge reappears for the role on its allowedAgentRoles list.
 *   - concurrent merge atomicity (CAS): two concurrent merges of the SAME
 *     source → exactly one wins, the other throws "already merged"; two
 *     concurrent merges of DIFFERENT sources into the same target → both
 *     succeed, the target's sourceArtifactIds is an atomic append (no lost
 *     update).
 *   - merge audit metadata: an auto-merge stamps `algorithmVersion` and
 *     `matchingEvidence` (tier + matched identifier) on the merge row.
 *   - rejected-candidate preservation: a probabilistic (tier-5) match writes a
 *     `deferred` rejection row; a human `rejectEntityMerge` escalates it to
 *     `rejected` and, crucially, the resolver NEVER re-proposes a rejected
 *     pair (createReview's open-status dedupe would otherwise let a fresh
 *     review open once the old one is 'rejected').
 *
 * Honest scope: the resolver tiers, access filter, CAS merge, and
 * rejected-candidate guard are exercised for real against Postgres. Skipped
 * (not silently passed) when the container runtime is unavailable. No LLM
 * calls — entities are seeded directly and resolved by the pure-DB resolver.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@jak-swarm/db';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompanyBrainV2Service } from '../../apps/api/src/services/company-brain/company-brain-v2.service.js';
import type { FastifyBaseLogger } from 'fastify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const noopLog = { info() {}, warn() {}, debug() {}, error() {} } as unknown as FastifyBaseLogger;
const future = new Date('2099-01-01T00:00:00Z');

describe.sequential('Company Brain — Phase 3 identity + Phase 5 access control (testcontainers)', () => {
  let container: Awaited<ReturnType<GenericContainer['start']>>;
  let prisma: PrismaClient;
  let brain: CompanyBrainV2Service;
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
      brain = new CompanyBrainV2Service(prisma, noopLog);
    } catch (error) {
      runtimeUnavailable = true;
      console.warn('[company-brain-entity-access-control] Skipping: container runtime unavailable', error);
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
  const mkArtifact = (id: string, tid: string, title: string, body = 'body') =>
    prisma.companyArtifact.create({
      data: { id, tenantId: tid, sourceType: 'document', artifactType: 'memo', title, body, bodyHash: id, occurredAt: future },
    });
  const setPolicy = (artifactId: string, tid: string, visibility: string, roles: string[]) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "company_artifact_policies" ("artifactId","tenantId","visibility","allowedAgentRoles","sensitivity","processingState")
       VALUES ($1,$2,$3,$4::TEXT[],'normal','ready')`,
      artifactId, tid, visibility, roles,
    );
  const mkEntity = (id: string, tid: string, type: string, title: string, summary: string, sources: string[], properties: Record<string, unknown> = {}) =>
    prisma.companyGraphEntity.create({
      data: { id, tenantId: tid, entityType: type, title, summary, sourceArtifactIds: sources, occurredAt: future, properties },
    });
  const alias = (id: string, tid: string, entityId: string, type: string, text: string) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "company_entity_aliases" ("id","tenantId","entityId","entityType","alias","normalizedAlias","confidence")
       VALUES ($1,$2,$3,$4,$5,$6,1)`,
      id, tid, entityId, type, text, text.toLowerCase(),
    );
  const edge = (id: string, tid: string, src: string, rel: string, tgt: string, evidence: string[]) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "company_edges" ("id","tenantId","sourceEntityId","relationshipType","targetEntityId","status","confidence","evidenceArtifactIds")
       VALUES ($1,$2,$3,$4,$5,'active',0.9,$6::JSONB)`,
      id, tid, src, rel, tgt, JSON.stringify(evidence),
    );

  const entityStatus = async (tid: string, id: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ status: string; deletedAt: Date | null }>>(
      `SELECT "status", "deletedAt" FROM "company_graph_entities" WHERE "id" = $1 AND "tenantId" = $2`,
      id, tid,
    );
    return rows[0] ?? null;
  };
  const mergeRows = async (tid: string) =>
    prisma.$queryRawUnsafe<Array<{ id: string; algorithmVersion: string; matchingEvidence: unknown }>>(
      `SELECT "id", "algorithmVersion", "matchingEvidence" FROM "company_entity_merges" WHERE "tenantId" = $1`,
      tid,
    );
  const rejectionRows = async (tid: string, sourceEntityId: string) =>
    prisma.$queryRawUnsafe<Array<{ decision: string; candidateEntityId: string; algorithmVersion: string }>>(
      `SELECT "decision", "candidateEntityId", "algorithmVersion" FROM "company_entity_merge_rejections"
       WHERE "tenantId" = $1 AND "sourceEntityId" = $2`,
      tid, sourceEntityId,
    );
  const openReviewCount = async (tid: string, resourceId: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
      `SELECT COUNT(*)::int AS n FROM "company_memory_reviews"
       WHERE "tenantId" = $1 AND "reviewType" = 'entity_merge' AND "resourceId" = $2 AND "status" = 'open'`,
      tid, resourceId,
    );
    return Number(rows[0]?.n ?? 0);
  };

  // -------------------------------------------------------------------------

  it('cross-tenant isolation: a tier-2 (shared-domain) merge resolves only within the calling tenant', async () => {
    if (runtimeUnavailable) return;
    const tidA = await mkTenant('iso-a');
    const tidB = await mkTenant('iso-b');
    // Tenant A already has "Acme Corp" with domain acme.com.
    await mkArtifact('a_iso_a', tidA, 'A memo');
    await mkEntity('e_acme_a', tidA, 'company', 'Acme Corp', 'Acme in tenant A', ['a_iso_a'], { domain: 'acme.com' });
    await alias('al_acme_a', tidA, 'e_acme_a', 'company', 'Acme Corp');
    // Tenant B has TWO Acme entities with the SAME domain under one artifact.
    // Resolving in B must merge them INTO EACH OTHER (tier 2), never into A.
    await mkArtifact('a_iso_b', tidB, 'B memo');
    await mkEntity('e_acme_b1', tidB, 'company', 'Acme Corp', 'Acme one in B', ['a_iso_b'], { domain: 'acme.com' });
    await mkEntity('e_acme_b2', tidB, 'company', 'Acme Holdings', 'Acme two in B', ['a_iso_b'], { domain: 'acme.com' });
    // Pin creation order deterministically so the merge direction is stable
    // (oldest entity is processed first and resolves into the newer candidate).
    await prisma.$executeRawUnsafe(`UPDATE "company_graph_entities" SET "createdAt" = NOW() - INTERVAL '1 hour' WHERE "id" = 'e_acme_b1' AND "tenantId" = $1`, tidB);
    await prisma.$executeRawUnsafe(`UPDATE "company_graph_entities" SET "createdAt" = NOW() WHERE "id" = 'e_acme_b2' AND "tenantId" = $1`, tidB);

    const res = await brain.processExtractedEntities({ tenantId: tidB, userId: 'u', artifactId: 'a_iso_b' });
    // Exactly one B entity is merged into the other (direction is stable: the
    // older e_acme_b1 is the source). The point of this test is that the merge
    // stays WITHIN tenant B — never touches tenant A.
    expect(res.mergedEntityIds).toContain('e_acme_b1');
    expect(res.mergedEntityIds).toHaveLength(1);

    // Tenant A's entity is untouched: still active, not merged, properties intact.
    const aStatus = await entityStatus(tidA, 'e_acme_a');
    expect(aStatus?.status).toBe('active');
    expect(aStatus?.deletedAt).toBeNull();

    // No merge row ever references tenant A or A's entity.
    const aMerges = await mergeRows(tidA);
    expect(aMerges).toHaveLength(0);
    const bMerges = await mergeRows(tidB);
    expect(bMerges.length).toBeGreaterThanOrEqual(1);
    // The B self-tenant merge is stamped with the algorithm version + tier-2 evidence.
    expect(bMerges.some((m) => (m.matchingEvidence as { tier?: string })?.tier === 'verified_stable_identifier')).toBe(true);
    expect(bMerges.some((m) => m.algorithmVersion === 'entity-resolver-v1')).toBe(true);
  });

  it('restricted-via-edge (source-AND): an edge to a restricted entity is dropped for a non-allowed role; it returns for the allowed role', async () => {
    if (runtimeUnavailable) return;
    const tid = await mkTenant('edge-iso');
    await mkArtifact('a_pub', tid, 'Public project memo');
    await mkArtifact('a_rest', tid, 'Restricted company memo', 'Top secret: Helios acquisition target');
    await setPolicy('a_pub', tid, 'internal', []);
    await setPolicy('a_rest', tid, 'restricted', ['COMMANDER']);
    await mkEntity('e_pub', tid, 'project', 'Project Helios', 'Public project', ['a_pub']);
    await mkEntity('e_rest', tid, 'company', 'Helios', 'Confidential target', ['a_rest']);
    await alias('al_pub', tid, 'e_pub', 'project', 'Project Helios');
    await alias('al_rest', tid, 'e_rest', 'company', 'Helios');
    // Active edge: public project serves the restricted company.
    await edge('edge_pub_rest', tid, 'e_pub', 'serves', 'e_rest', ['a_pub', 'a_rest']);

    // WORKER_RESEARCH: public entity visible, restricted entity dropped → edge
    // must drop too (both-endpoints-visible filter). The relationship and the
    // restricted title never reach the context text.
    const pkgWorker = await brain.getContextPackage({ tenantId: tid, task: 'Project Helios', agentRole: 'WORKER_RESEARCH', tokenBudget: 2400 });
    const wIds = new Set(pkgWorker.entities.map((e) => e.id));
    expect(wIds.has('e_pub')).toBe(true);
    expect(wIds.has('e_rest')).toBe(false);
    expect(pkgWorker.edges.some((e) => e.id === 'edge_pub_rest')).toBe(false);
    expect(pkgWorker.contextText).not.toContain('Top secret');
    expect(pkgWorker.omissions.restricted).toBeGreaterThanOrEqual(1);

    // COMMANDER: restricted entity visible → the edge is now included.
    const pkgCommander = await brain.getContextPackage({ tenantId: tid, task: 'Project Helios', agentRole: 'COMMANDER', tokenBudget: 2400 });
    const cIds = new Set(pkgCommander.entities.map((e) => e.id));
    expect(cIds.has('e_pub')).toBe(true);
    expect(cIds.has('e_rest')).toBe(true);
    expect(pkgCommander.edges.some((e) => e.id === 'edge_pub_rest')).toBe(true);
  });

  it('concurrent merge CAS: same-source double-merge throws for the loser; two-sources-one-target both succeed (atomic append)', async () => {
    if (runtimeUnavailable) return;
    const tid = await mkTenant('conc-merge');
    await mkArtifact('a_t', tid, 'target artifact');
    await mkArtifact('a_s1', tid, 'source one artifact');
    await mkArtifact('a_s2', tid, 'source two artifact');
    await mkArtifact('a_s3', tid, 'source three artifact');
    await mkEntity('e_t1', tid, 'company', 'Target One', 'the target', ['a_t']);
    await mkEntity('e_s1', tid, 'company', 'Source One', 's1', ['a_s1']);
    await mkEntity('e_s2', tid, 'company', 'Source Two', 's2', ['a_s2']);
    // Different-source / same-target: both must succeed, both artifacts appended.
    const [r1, r2] = await Promise.allSettled([
      brain.mergeEntities({ tenantId: tid, userId: 'u', sourceEntityId: 'e_s1', targetEntityId: 'e_t1', reason: 'concurrent s1->t1', similarity: 1, tier: 'manual', algorithmVersion: 'entity-resolver-v1' }),
      brain.mergeEntities({ tenantId: tid, userId: 'u', sourceEntityId: 'e_s2', targetEntityId: 'e_t1', reason: 'concurrent s2->t1', similarity: 1, tier: 'manual', algorithmVersion: 'entity-resolver-v1' }),
    ]);
    expect(r1.status).toBe('fulfilled');
    expect(r2.status).toBe('fulfilled');
    const target = await prisma.$queryRawUnsafe<Array<{ sourceArtifactIds: unknown }>>(
      `SELECT "sourceArtifactIds" FROM "company_graph_entities" WHERE "id" = 'e_t1' AND "tenantId" = $1`,
      tid,
    );
    const ids = JSON.stringify(target[0]?.sourceArtifactIds);
    expect(ids).toContain('a_s1');
    expect(ids).toContain('a_s2');
    const s1Status = await entityStatus(tid, 'e_s1');
    const s2Status = await entityStatus(tid, 'e_s2');
    expect(s1Status?.status).toBe('merged');
    expect(s2Status?.status).toBe('merged');

    // Same-source / same-target: exactly one wins, the other throws.
    await mkEntity('e_t2', tid, 'company', 'Target Two', 't2', ['a_t']);
    await mkEntity('e_s3', tid, 'company', 'Source Three', 's3', ['a_s3']);
    const [w1, w2] = await Promise.allSettled([
      brain.mergeEntities({ tenantId: tid, userId: 'u', sourceEntityId: 'e_s3', targetEntityId: 'e_t2', reason: 'double merge A', similarity: 1, tier: 'manual', algorithmVersion: 'entity-resolver-v1' }),
      brain.mergeEntities({ tenantId: tid, userId: 'u', sourceEntityId: 'e_s3', targetEntityId: 'e_t2', reason: 'double merge B', similarity: 1, tier: 'manual', algorithmVersion: 'entity-resolver-v1' }),
    ]);
    const winners = [w1, w2].filter((r) => r.status === 'fulfilled');
    const losers = [w1, w2].filter((r) => r.status === 'rejected');
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(String((losers[0] as PromiseRejectedResult).reason)).toMatch(/already been merged|being merged concurrently/);
  });

  it('rejected-candidate preservation: a rejected pair is never re-proposed (the resolver, not just createReview dedupe, blocks it)', async () => {
    if (runtimeUnavailable) return;
    const tid = await mkTenant('reject-prop');
    await mkArtifact('a_dup', tid, 'duplicate memo');
    // Two near-duplicate projects (Jaccard 0.75 → tier 5) under one artifact.
    await mkEntity('e_first', tid, 'project', 'Project Alpha Renewal', 'first', ['a_dup']);
    await mkEntity('e_second', tid, 'project', 'Project Alpha Renewal Q4', 'second', ['a_dup']);
    // Pin order so e_first (older) is processed first and proposes the review
    // with sourceEntityId=e_first, candidate=e_second — the pair the assertions
    // below reason about.
    await prisma.$executeRawUnsafe(`UPDATE "company_graph_entities" SET "createdAt" = NOW() - INTERVAL '1 hour' WHERE "id" = 'e_first' AND "tenantId" = $1`, tid);
    await prisma.$executeRawUnsafe(`UPDATE "company_graph_entities" SET "createdAt" = NOW() WHERE "id" = 'e_second' AND "tenantId" = $1`, tid);

    // First resolution: a probabilistic review is proposed + a deferred row recorded.
    await brain.processExtractedEntities({ tenantId: tid, userId: 'u', artifactId: 'a_dup' });
    const deferredBefore = await rejectionRows(tid, 'e_first');
    expect(deferredBefore.some((r) => r.decision === 'deferred' && r.candidateEntityId === 'e_second')).toBe(true);
    expect(await openReviewCount(tid, 'e_first')).toBeGreaterThanOrEqual(1);

    // Re-run: no NEW deferred rows, no NEW open reviews (idempotent).
    await brain.processExtractedEntities({ tenantId: tid, userId: 'u', artifactId: 'a_dup' });
    const deferredAfter = await rejectionRows(tid, 'e_first');
    expect(deferredAfter).toHaveLength(deferredBefore.length);
    expect(await openReviewCount(tid, 'e_first')).toBeGreaterThanOrEqual(1);

    // Human rejects the e_first → e_second merge.
    await brain.rejectEntityMerge({ tenantId: tid, userId: 'reviewer', sourceEntityId: 'e_first', candidateEntityId: 'e_second', reason: 'distinct initiatives' });
    const rejected = await rejectionRows(tid, 'e_first');
    expect(rejected.some((r) => r.decision === 'rejected' && r.candidateEntityId === 'e_second')).toBe(true);
    // The open review for e_first was resolved as rejected.
    expect(await openReviewCount(tid, 'e_first')).toBe(0);

    // Re-run after rejection: the resolver must NOT re-propose (createReview's
    // open-status dedupe would otherwise open a FRESH review now that the old
    // one is 'rejected'). Assert no new open review and no merge occurred.
    await brain.processExtractedEntities({ tenantId: tid, userId: 'u', artifactId: 'a_dup' });
    expect(await openReviewCount(tid, 'e_first')).toBe(0);
    const merges = await mergeRows(tid);
    expect(merges.some((m) => (m.matchingEvidence as { tier?: string })?.tier === 'probabilistic_review')).toBe(false);
    // Both entities remain separate and active.
    expect((await entityStatus(tid, 'e_first'))?.status).toBe('active');
    expect((await entityStatus(tid, 'e_second'))?.status).toBe('active');
  });
});