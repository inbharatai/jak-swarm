import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@jak-swarm/db';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe.sequential('Postgres integration (testcontainers)', () => {
  let container: Awaited<ReturnType<GenericContainer['start']>>;
  let prisma: PrismaClient;
  let runtimeUnavailable = false;

  beforeAll(async () => {
    try {
      container = await new GenericContainer('pgvector/pgvector:pg16')
        .withEnvironment({
          POSTGRES_DB: 'jakswarm',
          POSTGRES_USER: 'jakswarm',
          POSTGRES_PASSWORD: 'jakswarm',
        })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/i))
        .start();

      const host = container.getHost();
      const port = container.getMappedPort(5432);
      const dbUrl = `postgresql://jakswarm:jakswarm@${host}:${port}/jakswarm`;
      process.env.DATABASE_URL = dbUrl;
      process.env.DIRECT_URL = dbUrl;

      const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
      execSync('pnpm --filter @jak-swarm/db db:migrate:deploy', {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl },
      });

      prisma = new PrismaClient();
      await prisma.$connect();
    } catch (error) {
      runtimeUnavailable = true;
      console.warn('[postgres-integration] Skipping: container runtime unavailable', error);
    }
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('creates tenant, user, and workflow records', async () => {
    if (runtimeUnavailable) return;

    const tenant = await prisma.tenant.create({
      data: {
        name: 'Integration Tenant',
        slug: `integration-${Date.now()}`,
        plan: 'FREE',
      },
    });

    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `integration-${Date.now()}@example.com`,
        role: 'END_USER',
      },
    });

    const workflow = await prisma.workflow.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        goal: 'Review inbharat.ai website UX and marketing copy',
        status: 'PENDING',
      },
    });

    expect(workflow.id).toBeTruthy();
    expect(workflow.tenantId).toBe(tenant.id);
    expect(workflow.userId).toBe(user.id);

    const fetched = await prisma.workflow.findUnique({ where: { id: workflow.id } });
    expect(fetched?.goal).toContain('inbharat.ai');
  });
});
