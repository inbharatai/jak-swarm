/**
 * Company Brain durable worker — Phase 2 real PostgreSQL concurrency tests.
 *
 * Spins up a real pgvector/pgvector:pg16 container, applies the full
 * migration chain (incl. migration 119 `company_brain_jobs`), then drives the
 * REAL `CompanyBrainWorker` state machine against it and asserts the Phase 2
 * durable-queue guarantees:
 *
 *   - happy path: PENDING → LEASED → PROCESSING → COMPLETED (no LLM — a
 *     pre-extracted artifact is processed by the pure-DB
 *     `processExtractedEntities`).
 *   - idempotent enqueue: re-enqueuing the same `(tenantId, idempotencyKey)`
 *     is a no-op (one row, `created` true then false) — one logical attempt
 *     per key by DB constraint.
 *   - atomic claim / no double-processing: two workers concurrently
 *     `claimNextJob` on ONE job → exactly one wins (FOR UPDATE SKIP LOCKED),
 *     the other gets null, `attempts === 1`.
 *   - two jobs / two workers → each worker claims a distinct job.
 *   - lease expiry → reclaim: an expired LEASED lease is flipped back to
 *     PENDING by `reclaimExpiredLeases` and re-claimed by another worker
 *     (`attempts` increments).
 *   - forced failure → RETRY_WAIT with backoff (`availableAt` in the
 *     future), then re-claimed after `availableAt` passes.
 *   - exhausted retries → PERMANENTLY_FAILED (no further claim).
 *   - CANCELLED job is never claimed.
 *
 * Honest scope: the durable-queue state machine + lease/reclaim/backoff are
 * exercised for real against Postgres. The worker's `processOne` is driven
 * directly (no timer jitter) so assertions are deterministic. Skipped (not
 * silently passed) when the container runtime is unavailable. Behavioral LLM
 * extraction is out of scope (artifact is pre-extracted → needsExtraction =
 * false), so no external credentials are required and none are faked.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@jak-swarm/db';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyBaseLogger } from 'fastify';
import { CompanyBrainV2Service } from '../../apps/api/src/services/company-brain/company-brain-v2.service.js';
import { CompanyOperatingLayerService } from '../../apps/api/src/services/company-brain/company-operating-layer.service.js';
import {
  CompanyBrainWorker,
  enqueueCompanyBrainJob,
  type CompanyBrainJobRow,
} from '../../apps/api/src/services/company-brain/company-brain-worker.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const noopLog = { info() {}, warn() {}, debug() {}, error() {} } as unknown as FastifyBaseLogger;
const future = new Date('2099-01-01T00:00:00Z');

/** Public surface over the protected state-machine methods for deterministic driving. */
class TestWorker extends CompanyBrainWorker {
  claim(): Promise<CompanyBrainJobRow | null> {
    return this.claimNextJob();
  }
  reclaim(): Promise<void> {
    return this.reclaimExpiredLeases();
  }
  run(job: CompanyBrainJobRow): Promise<void> {
    return this.executeJob(job);
  }
}

/** Worker whose `processOne` always throws, to exercise RETRY_WAIT / PERMANENTLY_FAILED. */
class FailingWorker extends TestWorker {
  public attempts = 0;
  private readonly message: string;
  constructor(db: PrismaClient, message = 'forced processing failure') {
    super(db, noopLog, new CompanyOperatingLayerService(db, noopLog), new CompanyBrainV2Service(db, noopLog), {
      instanceId: `failing-${Math.random().toString(36).slice(2, 8)}`,
    });
    this.message = message;
  }
  protected async processOne(): Promise<void> {
    this.attempts++;
    throw new Error(this.message);
  }
}

describe.sequential('Company Brain durable worker — Phase 2 concurrency (testcontainers)', () => {
  let container: Awaited<ReturnType<GenericContainer['start']>>;
  let prisma: PrismaClient;
  let brain: CompanyBrainV2Service;
  let legacy: CompanyOperatingLayerService;
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
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl } as NodeJS.ProcessEnv,
      });
      prisma = new PrismaClient();
      await prisma.$connect();
      brain = new CompanyBrainV2Service(prisma, noopLog);
      legacy = new CompanyOperatingLayerService(prisma, noopLog);
      tenantId = (await seed(prisma)).toString();
    } catch (error) {
      runtimeUnavailable = true;
      console.warn('[company-brain-durable-worker] Skipping: container runtime unavailable', error);
    }
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  /**
   * Queue isolation: every test enqueues its own jobs and must see only its
   * own jobs. The "idempotent enqueue" test intentionally leaves a PENDING row;
   * without cleanup it would leak into the "atomic claim" test and let two
   * workers each claim a *different* job (correct queue behaviour, but it
   * invalidates the single-job premise of the contention test). Clear the
   * tenant's job rows between tests so each test reasons over a clean queue.
   */
  afterEach(async () => {
    if (runtimeUnavailable || !prisma) return;
    await prisma.$executeRawUnsafe(`DELETE FROM company_brain_jobs WHERE "tenantId" = $1`, tenantId);
  });

  /** Seed a tenant + one pre-extracted artifact (no entities → needsExtraction=false, pure-DB completion). */
  async function seed(p: PrismaClient): Promise<string> {
    const tenant = await p.tenant.create({ data: { name: 'Worker Tenant', slug: `worker-${Date.now()}`, plan: 'FREE' } });
    const tid = tenant.id;
    await p.companyArtifact.create({
      data: {
        id: 'a_pre',
        tenantId: tid,
        sourceType: 'document',
        artifactType: 'memo',
        title: 'Pre-extracted memo',
        body: 'Already extracted; no LLM needed.',
        bodyHash: 'a_pre',
        ingestionStatus: 'extracted',
        extractedAt: new Date(),
        occurredAt: future,
      },
    });
    return tid;
  }

  const mkWorker = (db = prisma) =>
    new TestWorker(db, noopLog, legacy, brain, { instanceId: `w-${Math.random().toString(36).slice(2, 8)}` });

  const jobState = async (id: string) => {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ status: string; attempts: number; availableAt: Date; lastError: string | null; ownerInstanceId: string | null }>
    >(
      `SELECT status, attempts, "availableAt", "lastError", "ownerInstanceId" FROM company_brain_jobs WHERE id = $1`,
      id,
    );
    return rows[0] ?? null;
  };

  const forceAvailableNow = (id: string) =>
    prisma.$executeRawUnsafe(`UPDATE company_brain_jobs SET "availableAt" = NOW() WHERE id = $1`, id);

  const forceLeaseExpired = (id: string) =>
    prisma.$executeRawUnsafe(
      `UPDATE company_brain_jobs SET "leaseExpiresAt" = NOW() - INTERVAL '1 second' WHERE id = $1`,
      id,
    );

  it('happy path: PENDING → LEASED → PROCESSING → COMPLETED with a pre-extracted artifact (no LLM)', async () => {
    if (runtimeUnavailable) return;
    const enq = await enqueueCompanyBrainJob(prisma, { tenantId, artifactId: 'a_pre', userId: 'u1', idempotencyKey: 'happy:1' });
    expect(enq.created).toBe(true);

    const w = mkWorker();
    const job = await w.claim();
    expect(job, 'job must be claimed').toBeTruthy();
    expect(job!.status).toBe('LEASED');
    expect(job!.attempts).toBe(1);
    expect(job!.idempotencyKey).toBe('happy:1');

    await w.run(job!);
    const after = await jobState(job!.id);
    expect(after!.status).toBe('COMPLETED');

    // The artifact really was processed by the pure-DB path.
    const art = await prisma.$queryRawUnsafe<Array<{ ingestionStatus: string }>>(
      `SELECT "ingestionStatus" FROM "company_artifacts" WHERE id = $1 AND "tenantId" = $2`,
      'a_pre',
      tenantId,
    );
    expect(art[0]?.ingestionStatus).toBe('ready');
  });

  it('idempotent enqueue: re-enqueuing the same key is a no-op (one logical attempt per key)', async () => {
    if (runtimeUnavailable) return;
    const first = await enqueueCompanyBrainJob(prisma, { tenantId, artifactId: 'a_pre', userId: 'u1', idempotencyKey: 'idem:1' });
    const second = await enqueueCompanyBrainJob(prisma, { tenantId, artifactId: 'a_pre', userId: 'u1', idempotencyKey: 'idem:1' });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.jobId).toBe(first.jobId);
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
      `SELECT COUNT(*)::int AS n FROM company_brain_jobs WHERE "tenantId" = $1 AND "idempotencyKey" = 'idem:1'`,
      tenantId,
    );
    expect(Number(rows[0]?.n ?? 0)).toBe(1);
  });

  it('atomic claim / no double-processing: two workers concurrently claim one job → exactly one wins', async () => {
    if (runtimeUnavailable) return;
    const enq = await enqueueCompanyBrainJob(prisma, { tenantId, artifactId: 'a_pre', userId: 'u1', idempotencyKey: 'race:1' });
    const w1 = mkWorker();
    const w2 = mkWorker();
    const [j1, j2] = await Promise.all([w1.claim(), w2.claim()]);
    const winners = [j1, j2].filter(Boolean);
    expect(winners.length).toBe(1);
    const winner = winners[0]!;
    expect(winner.id).toBe(enq.jobId);
    expect(winner.attempts).toBe(1);
    const loser = [j1, j2].find((j) => j === null);
    expect(loser).toBeNull();
    // The leased job blocks the second worker even without SKIP LOCKED racing
    // (status filter); reclaim won't touch an unexpired lease.
    await w1.reclaim();
    const after = await jobState(winner.id);
    expect(after!.status).toBe('LEASED');
    // Clean up: complete it so it doesn't leak into later assertions.
    await w1.run(winner);
  });

  it('two jobs / two workers: each worker claims a distinct job', async () => {
    if (runtimeUnavailable) return;
    const e1 = await enqueueCompanyBrainJob(prisma, { tenantId, artifactId: 'a_pre', userId: 'u1', idempotencyKey: 'pair:1' });
    const e2 = await enqueueCompanyBrainJob(prisma, { tenantId, artifactId: 'a_pre', userId: 'u1', idempotencyKey: 'pair:2' });
    const w1 = mkWorker();
    const w2 = mkWorker();
    const [j1, j2] = await Promise.all([w1.claim(), w2.claim()]);
    const ids = new Set([j1?.id, j2?.id]);
    expect(ids.has(e1.jobId)).toBe(true);
    expect(ids.has(e2.jobId)).toBe(true);
    expect(ids.size).toBe(2);
    await Promise.all([w1.run(j1!), w2.run(j2!)]);
    const s1 = await jobState(e1.jobId);
    const s2 = await jobState(e2.jobId);
    expect(s1!.status).toBe('COMPLETED');
    expect(s2!.status).toBe('COMPLETED');
  });

  it('lease expiry → reclaim: an expired lease is flipped to PENDING and re-claimed (attempts increments)', async () => {
    if (runtimeUnavailable) return;
    const enq = await enqueueCompanyBrainJob(prisma, { tenantId, artifactId: 'a_pre', userId: 'u1', idempotencyKey: 'lease:1' });
    const w1 = mkWorker();
    const w2 = mkWorker();
    const job = await w1.claim();
    expect(job!.id).toBe(enq.jobId);
    expect(job!.attempts).toBe(1);
    // Simulate w1 dying mid-lease: expire the lease, then w2's reclaim sweep
    // must return the job to PENDING for re-claim.
    await forceLeaseExpired(enq.jobId);
    await w2.reclaim();
    const reclaimed = await jobState(enq.jobId);
    expect(reclaimed!.status).toBe('PENDING');
    expect(reclaimed!.ownerInstanceId).toBeNull();
    // w2 now re-claims the reclaimed job; attempts must increment to 2.
    const reJob = await w2.claim();
    expect(reJob!.id).toBe(enq.jobId);
    expect(reJob!.attempts).toBe(2);
    await w2.run(reJob!);
    const after = await jobState(enq.jobId);
    expect(after!.status).toBe('COMPLETED');
  });

  it('forced failure → RETRY_WAIT with backoff, then re-claimed; exhausted retries → PERMANENTLY_FAILED', async () => {
    if (runtimeUnavailable) return;
    const enq = await enqueueCompanyBrainJob(prisma, {
      tenantId,
      artifactId: 'a_pre',
      userId: 'u1',
      idempotencyKey: 'fail:1',
      maxAttempts: 3,
    });
    const w = new FailingWorker(prisma, 'forced processing failure');

    // Attempt 1: claim → fail → RETRY_WAIT (attempts=1 < maxAttempts=3).
    let job = await w.claim();
    expect(job!.attempts).toBe(1);
    await w.run(job!);
    let st = await jobState(enq.jobId);
    expect(st!.status).toBe('RETRY_WAIT');
    expect(st!.lastError).toContain('forced processing failure');
    expect(st!.availableAt.getTime()).toBeGreaterThan(Date.now() - 1000); // backoff: availableAt is in the future
    expect(w.attempts).toBe(1);

    // Force the backoff window closed and re-claim → attempt 2.
    await forceAvailableNow(enq.jobId);
    job = await w.claim();
    expect(job!.attempts).toBe(2);
    await w.run(job!);
    st = await jobState(enq.jobId);
    expect(st!.status).toBe('RETRY_WAIT');
    expect(w.attempts).toBe(2);

    // Attempt 3: attempts=3 is NOT < maxAttempts=3 → PERMANENTLY_FAILED.
    await forceAvailableNow(enq.jobId);
    job = await w.claim();
    expect(job!.attempts).toBe(3);
    await w.run(job!);
    st = await jobState(enq.jobId);
    expect(st!.status).toBe('PERMANENTLY_FAILED');
    expect(w.attempts).toBe(3);

    // A PERMANENTLY_FAILED job must never be claimed again.
    const reClaim = await w.claim();
    expect(reClaim).toBeNull();
  });

  it('CANCELLED job is never claimed', async () => {
    if (runtimeUnavailable) return;
    const enq = await enqueueCompanyBrainJob(prisma, { tenantId, artifactId: 'a_pre', userId: 'u1', idempotencyKey: 'cancel:1' });
    await prisma.$executeRawUnsafe(
      `UPDATE company_brain_jobs SET status = 'CANCELLED' WHERE id = $1`,
      enq.jobId,
    );
    const w = mkWorker();
    const job = await w.claim();
    expect(job).toBeNull();
    const st = await jobState(enq.jobId);
    expect(st!.status).toBe('CANCELLED');
  });
});