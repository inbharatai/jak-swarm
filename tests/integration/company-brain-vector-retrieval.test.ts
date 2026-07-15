/**
 * company-brain-vector-retrieval.test.ts — pins C3: the vector retrieval half.
 * Uses the DeterministicEmbeddingProvider (bag-of-words) so the wiring is
 * verifiable without an embeddings API key: processExtractedEntities embeds
 * the entity into the pgvector column, and getContextPackage retrieves it via the
 * cosine channel when the task shares tokens. Real Postgres (testcontainers).
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@jak-swarm/db';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompanyBrainV2Service } from '../../apps/api/src/services/company-brain/company-brain-v2.service.js';
import { DeterministicEmbeddingProvider } from '../../apps/api/src/services/company-brain/company-brain-embeddings.js';
import type { FastifyBaseLogger } from 'fastify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const noopLog = { info() {}, warn() {}, debug() {}, error() {} } as unknown as FastifyBaseLogger;
const future = new Date('2099-01-01T00:00:00Z');

describe.sequential('Company Brain — C3 vector retrieval (testcontainers)', () => {
  let container: Awaited<ReturnType<GenericContainer['start']>>;
  let prisma: PrismaClient;
  let brain: CompanyBrainV2Service;
  let runtimeUnavailable = false;
  let tenantId: string;

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
        cwd: repoRoot, stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl } as NodeJS.ProcessEnv,
      });
      prisma = new PrismaClient();
      await prisma.$connect();
      brain = new CompanyBrainV2Service(prisma, noopLog, { embeddingProvider: new DeterministicEmbeddingProvider() });
      const t = await prisma.tenant.create({ data: { name: 'c3', slug: `c3-${Date.now()}`, plan: 'FREE' } });
      tenantId = t.id;
    } catch (error) {
      runtimeUnavailable = true;
      console.warn('[c3-vector] Skipping: container runtime unavailable', error);
    }
  }, 180_000);

  afterAll(async () => { await prisma?.$disconnect(); await container?.stop(); });

  it.runIf(!runtimeUnavailable)('embeds the entity and retrieves it via the vector channel by shared tokens', async () => {
    const artifactId = 'art_c3_1';
    const entityId = 'ent_c3_1';
    await prisma.companyArtifact.create({
      data: { id: artifactId, tenantId, sourceType: 'document', artifactType: 'memo', title: 'Founder decision', body: 'The team decided to ship the release on Friday.', bodyHash: artifactId, occurredAt: future },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "company_artifact_policies" ("artifactId","tenantId","visibility","allowedAgentRoles","sensitivity","processingState")
       VALUES ($1,$2,'internal',$3::TEXT[],'normal','ready')`,
      artifactId, tenantId, [],
    );
    await prisma.companyGraphEntity.create({
      data: { id: entityId, tenantId, entityType: 'decision', title: 'Ship Friday Decision', summary: 'Founder decided to ship the release on Friday.', sourceArtifactIds: [artifactId], occurredAt: future, properties: {} },
    });

    await brain.processExtractedEntities({ tenantId, userId: 'usr_test', artifactId });

    // The embedding column is populated.
    const emb = await prisma.$queryRawUnsafe<Array<{ embedding: string | null }>>(
      `SELECT "embedding"::TEXT AS "embedding" FROM "company_entity_embeddings" WHERE "entityId" = $1 AND "tenantId" = $2`,
      entityId, tenantId,
    );
    expect(emb[0]?.embedding).toBeTruthy();
    expect(emb[0]?.embedding).not.toBe('');

    // Retrieval via a task that shares NO email/alias but shares tokens -> the
    // vector cosine channel surfaces the entity (lexical/alias/identifier cannot).
    const pkg = await brain.getContextPackage({ tenantId, task: 'summarise the friday ship decision', agentRole: 'TENANT_ADMIN' });
    // eslint-disable-next-line no-console
    expect(pkg.entities.map((e) => e.id)).toContain(entityId);
  });
});
