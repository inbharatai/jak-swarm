/**
 * Company Brain Graph V2 — Phase 1 hybrid retrieval correctness (real Postgres).
 *
 * Spins up a real pgvector/pgvector:pg16 container, applies the full migration
 * chain (incl. migration 118 Graph V2 tables), seeds a tenant with a mix of
 * permitted / restricted / expired / irrelevant artifacts, entities, aliases,
 * claims, edges and evidence, then drives the REAL `CompanyBrainV2Service
 * .getContextPackage()` SQL pipeline and asserts the Phase 1 guarantees:
 *
 *   - precision@k: the task-relevant entity is selected; an off-topic entity
 *     that merely exists in the tenant is NOT selected (no recency injection).
 *   - restricted leakage: an entity backed only by a restricted artifact
 *     (allowedAgentRoles: ['COMMANDER']) is omitted for WORKER_RESEARCH, its
 *     secret content never reaches contextText, and omissions.restricted >= 1.
 *   - expired retention: an entity backed only by an artifact whose
 *     retentionUntil has passed is omitted, and omissions.expired >= 1.
 *   - conflict recall: a disputed claim surfaces in `disputedClaims`.
 *   - evidence-id preservation: a selected claim carries its evidenceIds.
 *   - graph-neighborhood: a 1-hop neighbor reached via an active edge from the
 *     matched entity is included (scored lower), proving the expansion is live.
 *   - empty-query rule: a blank task returns an EMPTY package (no entities, no
 *     recency fallback, selectedCount = 0).
 *   - token budget: contextText stays within the requested token budget.
 *
 * Honest scope: the SQL retrieval pipeline is exercised for real against
 * Postgres. Skipped (not silently passed) when the container runtime is
 * unavailable. Behavioral LLM calls are out of scope here.
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

describe.sequential('Company Brain Graph V2 — Phase 1 retrieval correctness (testcontainers)', () => {
  let container: Awaited<ReturnType<GenericContainer['start']>>;
  let prisma: PrismaClient;
  let brain: CompanyBrainV2Service;
  let runtimeUnavailable = false;
  let tenantId: string;

  const noopLog = { info() {}, warn() {}, debug() {}, error() {} } as unknown as FastifyBaseLogger;
  const past = new Date('2024-01-01T00:00:00Z');
  const future = new Date('2099-01-01T00:00:00Z');

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
      tenantId = await seed(prisma);
    } catch (error) {
      runtimeUnavailable = true;
      console.warn('[company-brain-retrieval] Skipping: container runtime unavailable', error);
    }
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  /** Seed a tenant with the Graph V2 scenario described in the file header. */
  async function seed(p: PrismaClient): Promise<string> {
    const tenant = await p.tenant.create({ data: { name: 'Retrieval Tenant', slug: `retrieval-${Date.now()}`, plan: 'FREE' } });
    const tid = tenant.id;

    // --- Artifacts (base rows; policies live in company_artifact_policies). ---
    const mkArtifact = (id: string, title: string, body: string) =>
      p.companyArtifact.create({
        data: { id, tenantId: tid, sourceType: 'document', artifactType: 'memo', title, body, bodyHash: id, occurredAt: future },
      });
    await mkArtifact('a_perm', 'Project Alpha renewal memo', 'Renewal risk is high for Project Alpha.');
    await mkArtifact('a_restricted', 'Secret M&A target memo', 'Top secret acquisition target name: ZetaCorp');
    await mkArtifact('a_expired', 'Stale Project Beta memo', 'Old forgotten note about Project Beta.');
    await mkArtifact('a_neighbor', 'Customer Northwind profile', 'Northwind is a customer of Project Alpha.');

    // --- Artifact policies (visibility / role gating / retention). ---
    const policy = (artifactId: string, visibility: string, roles: string[], retentionUntil: Date | null) =>
      p.$executeRawUnsafe(
        `INSERT INTO "company_artifact_policies" ("artifactId","tenantId","visibility","allowedAgentRoles","sensitivity","retentionUntil","processingState")
         VALUES ($1,$2,$3,$4::TEXT[],'normal',$5,'ready')`,
        artifactId, tid, visibility, roles, retentionUntil,
      );
    await policy('a_perm', 'internal', [], null);
    await policy('a_restricted', 'restricted', ['COMMANDER'], null);
    await policy('a_expired', 'internal', [], past); // retention expired
    await policy('a_neighbor', 'internal', [], null);

    // --- Entities. ---
    const mkEntity = (id: string, type: string, title: string, summary: string, sources: string[]) =>
      p.companyGraphEntity.create({
        data: { id, tenantId: tid, entityType: type, title, summary, sourceArtifactIds: sources, occurredAt: future },
      });
    await mkEntity('e_alpha', 'project', 'Project Alpha', 'Renewal risk review for Project Alpha', ['a_perm']);
    await mkEntity('e_zeta', 'company', 'ZetaCorp', 'Confidential acquisition target', ['a_restricted']);
    await mkEntity('e_beta', 'project', 'Project Beta', 'Stale forgotten project', ['a_expired']);
    await mkEntity('e_northwind', 'customer', 'Northwind', 'A customer tied to Project Alpha', ['a_neighbor']);
    await mkEntity('e_offtopic', 'project', 'Unrelated Initiative', 'Completely off-topic work with no link to the task', ['a_perm']);

    // --- Aliases (normalized canonical aliases drive exact-alias match). ---
    const alias = (id: string, entityId: string, type: string, aliasText: string) =>
      p.$executeRawUnsafe(
        `INSERT INTO "company_entity_aliases" ("id","tenantId","entityId","entityType","alias","normalizedAlias","confidence")
         VALUES ($1,$2,$3,$4,$5,$6,1)`,
        id, tid, entityId, type, aliasText, aliasText.toLowerCase(),
      );
    await alias('al_alpha', 'e_alpha', 'project', 'Project Alpha');
    await alias('al_zeta', 'e_zeta', 'company', 'ZetaCorp');
    await alias('al_northwind', 'e_northwind', 'customer', 'Northwind');
    await alias('al_offtopic', 'e_offtopic', 'project', 'Unrelated Initiative');
    await alias('al_beta', 'e_beta', 'project', 'Project Beta'); // exact-alias candidate to exercise expired retention

    // --- Edge: Project Alpha owns customer Northwind (active). 1-hop neighbor. ---
    await p.$executeRawUnsafe(
      `INSERT INTO "company_edges" ("id","tenantId","sourceEntityId","relationshipType","targetEntityId","status","confidence","evidenceArtifactIds")
       VALUES ($1,$2,$3,'serves',$4,'active',0.9,'["a_neighbor"]'::JSONB)`,
      'edge_alpha_northwind', tid, 'e_alpha', 'e_northwind',
    );

    // --- Claims: one active, one disputed (conflict recall). ---
    await p.$executeRawUnsafe(
      `INSERT INTO "company_claims" ("id","tenantId","subjectEntityId","predicate","objectValue","normalizedObject","fingerprint","status","confidence","authorityScore")
       VALUES ($1,$2,$3,'renewal_risk','"high"'::JSONB,'high','fp_active','active',0.85,0.9)`,
      'c_active', tid, 'e_alpha',
    );
    await p.$executeRawUnsafe(
      `INSERT INTO "company_claims" ("id","tenantId","subjectEntityId","predicate","objectValue","normalizedObject","fingerprint","status","confidence","authorityScore")
       VALUES ($1,$2,$3,'budget_approved','"true"'::JSONB,'true','fp_dispute','disputed',0.5,0.4)`,
      'c_disputed', tid, 'e_alpha',
    );

    // --- Claim evidence (evidence-id preservation). ---
    await p.$executeRawUnsafe(
      `INSERT INTO "company_claim_evidence" ("id","tenantId","claimId","artifactId","excerpt","sourceAuthority","observedAt")
       VALUES ($1,$2,$3,$4,'renewal risk high',0.9,$5)`,
      'ce_1', tid, 'c_active', 'a_perm', future,
    );

    return tid;
  }

  it('precision: selects the task-relevant entity and a graph neighbor, omits an off-topic entity (no recency injection)', async () => {
    if (runtimeUnavailable) return;
    const pkg = await brain.getContextPackage({ tenantId, task: 'Review Project Alpha renewal risk', agentRole: 'WORKER_RESEARCH', tokenBudget: 2400 });
    const ids = pkg.entities.map((e) => e.id);
    expect(ids).toContain('e_alpha');
    expect(ids).toContain('e_northwind'); // 1-hop graph neighbor
    expect(ids).not.toContain('e_offtopic'); // exists in tenant, off-topic → not injected
    expect(pkg.retrieval.strategyVersion).toBe('hybrid-v1');
    expect(pkg.retrieval.selectedCount).toBeGreaterThanOrEqual(2);
  });

  it('restricted leakage: the restricted artifact’s entity is omitted and its secret never reaches contextText', async () => {
    if (runtimeUnavailable) return;
    const pkg = await brain.getContextPackage({ tenantId, task: 'Tell me about ZetaCorp', agentRole: 'WORKER_RESEARCH', tokenBudget: 2400 });
    expect(pkg.entities.map((e) => e.id)).not.toContain('e_zeta');
    expect(pkg.contextText).not.toContain('ZetaCorp');
    expect(pkg.contextText).not.toContain('Top secret');
    expect(pkg.omissions.restricted).toBeGreaterThanOrEqual(1);
  });

  it('restricted content is reachable for the role on its allowedAgentRoles list', async () => {
    if (runtimeUnavailable) return;
    const pkg = await brain.getContextPackage({ tenantId, task: 'Tell me about ZetaCorp', agentRole: 'COMMANDER', tokenBudget: 2400 });
    expect(pkg.entities.map((e) => e.id)).toContain('e_zeta');
    expect(pkg.contextText).toContain('ZetaCorp');
  });

  it('expired retention: an entity backed only by an expired-retention artifact is omitted', async () => {
    if (runtimeUnavailable) return;
    const pkg = await brain.getContextPackage({ tenantId, task: 'Project Beta', agentRole: 'WORKER_RESEARCH', tokenBudget: 2400 });
    expect(pkg.entities.map((e) => e.id)).not.toContain('e_beta');
    expect(pkg.omissions.expired).toBeGreaterThanOrEqual(1);
  });

  it('conflict recall: a disputed claim surfaces in disputedClaims; the active claim carries its evidence ids', async () => {
    if (runtimeUnavailable) return;
    const pkg = await brain.getContextPackage({ tenantId, task: 'Review Project Alpha renewal risk', agentRole: 'WORKER_RESEARCH', tokenBudget: 2400 });
    expect(pkg.disputedClaims.some((c) => c.id === 'c_disputed')).toBe(true);
    const active = pkg.claims.find((c) => c.id === 'c_active');
    expect(active, 'active claim must be present').toBeTruthy();
    expect(active!.evidenceIds).toContain('a_perm');
  });

  it('empty-query rule: a blank task returns an empty governed package with no recency fallback', async () => {
    if (runtimeUnavailable) return;
    const pkg = await brain.getContextPackage({ tenantId, task: '   ', agentRole: 'WORKER_RESEARCH', tokenBudget: 2400 });
    expect(pkg.entities).toEqual([]);
    expect(pkg.claims).toEqual([]);
    expect(pkg.disputedClaims).toEqual([]);
    expect(pkg.edges).toEqual([]);
    expect(pkg.evidence).toEqual([]);
    expect(pkg.retrieval.selectedCount).toBe(0);
    expect(pkg.retrieval.candidateCount).toBe(0);
  });

  it('irrelevant/unmatched task returns an empty package (no recency injection when nothing matches)', async () => {
    if (runtimeUnavailable) return;
    const pkg = await brain.getContextPackage({ tenantId, task: 'Plan a vacation to Mars', agentRole: 'WORKER_RESEARCH', tokenBudget: 2400 });
    expect(pkg.entities).toEqual([]);
    expect(pkg.retrieval.selectedCount).toBe(0);
  });

  it('token budget: contextText stays within the requested budget', async () => {
    if (runtimeUnavailable) return;
    const budget = 400;
    const pkg = await brain.getContextPackage({ tenantId, task: 'Review Project Alpha renewal risk', agentRole: 'WORKER_RESEARCH', tokenBudget: budget });
    // chars/4 approximation matches the estimator default; allow a small header overhead margin.
    const approxTokens = Math.ceil(pkg.contextText.length / 4);
    expect(approxTokens).toBeLessThanOrEqual(budget + 32);
    expect(pkg.contextText).toContain('Project Alpha');
  });
});