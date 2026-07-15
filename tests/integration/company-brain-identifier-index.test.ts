/**
 * company-brain-identifier-index.test.ts — pins C2: stable identifiers are
 * indexed into company_entity_identifiers and retrieval finds an entity by an
 * EXACT indexed email lookup (replacing the fuzzy properties::TEXT ILIKE).
 * Real Postgres (testcontainers), full migration chain (incl. 123). No LLM.
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
const EMAIL = 'reetu@inbharat.ai';

describe.sequential('Company Brain — C2 identifier index (testcontainers)', () => {
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
      brain = new CompanyBrainV2Service(prisma, noopLog);
      const t = await prisma.tenant.create({ data: { name: 'c2', slug: `c2-${Date.now()}`, plan: 'FREE' } });
      tenantId = t.id;
    } catch (error) {
      runtimeUnavailable = true;
      console.warn('[c2-identifier-index] Skipping: container runtime unavailable', error);
    }
  }, 180_000);

  afterAll(async () => { await prisma?.$disconnect(); await container?.stop(); });

  it.runIf(!runtimeUnavailable)('indexes an entity email and retrieves it by exact email lookup', async () => {
    const artifactId = 'art_c2_1';
    const entityId = 'ent_c2_1';
    await prisma.companyArtifact.create({
      data: { id: artifactId, tenantId, sourceType: 'document', artifactType: 'memo', title: 'Founder decision', body: 'Decision: ship Friday. Owner reetu@inbharat.ai.', bodyHash: artifactId, occurredAt: future },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "company_artifact_policies" ("artifactId","tenantId","visibility","allowedAgentRoles","sensitivity","processingState")
       VALUES ($1,$2,'internal',$3::TEXT[],'normal','ready')`,
      artifactId, tenantId, [],
    );
    await prisma.companyGraphEntity.create({
      data: { id: entityId, tenantId, entityType: 'decision', title: 'Ship Friday', summary: 'Founder decision to ship Friday.', sourceArtifactIds: [artifactId], occurredAt: future, properties: { email: EMAIL } },
    });

    // processExtractedEntities indexes the entity's stable identifiers (C2).
    await brain.processExtractedEntities({ tenantId, userId: 'usr_test', artifactId });

    const idRows = await prisma.$queryRawUnsafe<Array<{ kind: string; normalizedvalue: string; entityid: string }>>(
      `SELECT "kind", "normalizedValue" as "normalizedvalue", "entityId" as "entityid" FROM "company_entity_identifiers" WHERE "tenantId" = $1 AND "entityId" = $2`,
      tenantId, entityId,
    );
    expect(idRows.length).toBeGreaterThan(0);
    expect(idRows.some((r) => r.kind === 'email' && r.normalizedvalue === EMAIL && r.entityid === entityId)).toBe(true);

    // Retrieval finds the entity by the email in the task (exact indexed lookup).
    const pkg = await brain.getContextPackage({ tenantId, task: `Summarise the decision by ${EMAIL}`, agentRole: 'TENANT_ADMIN' });
    expect(pkg.entities.map((e) => e.id)).toContain(entityId);
  });
});
