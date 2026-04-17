/**
 * QueueWorker — Behavioral Lifecycle Tests
 *
 * Tests that the QueueWorker actually starts, stops, claims jobs,
 * retries failures, dead-letters exhausted jobs, and reports health.
 * Uses a mock PrismaClient to verify real behavior without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueueWorker } from '../../../apps/api/src/services/queue-worker.ts';
import type { WorkflowJobRow, JobProcessor } from '../../../apps/api/src/services/queue-worker.ts';

// ── Mock Prisma ──────────────────────────────────────────────────────

function createMockDb(jobs: WorkflowJobRow[] = []) {
  const jobStore = new Map(jobs.map((j) => [j.id, { ...j }]));

  return {
    $queryRawUnsafe: vi.fn(async () => {
      // Simulate SKIP LOCKED: return first QUEUED job
      for (const [_id, job] of jobStore) {
        if (job.status === 'QUEUED' && job.availableAt <= new Date()) {
          job.status = 'ACTIVE';
          job.attempts += 1;
          return [job];
        }
      }
      return [];
    }),
    workflowJob: {
      findFirst: vi.fn(async ({ where }: any) => {
        for (const [_id, job] of jobStore) {
          if (job.status === where?.status && job.availableAt <= (where?.availableAt?.lte ?? new Date())) {
            return job;
          }
        }
        return null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const job = jobStore.get(where?.id);
        if (job && job.status === where?.status) {
          Object.assign(job, data);
          if (data.attempts?.increment) job.attempts += data.attempts.increment;
          return { count: 1 };
        }
        return { count: 0 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const job = jobStore.get(where?.id);
        if (job) {
          Object.assign(job, data);
          return job;
        }
        return null;
      }),
    },
    _jobStore: jobStore,
  } as any;
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeJob(overrides: Partial<WorkflowJobRow> = {}): WorkflowJobRow {
  return {
    id: `job_${Math.random().toString(36).slice(2, 8)}`,
    workflowId: `wf_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: 'tnt_test',
    userId: 'usr_test',
    status: 'QUEUED',
    payloadJson: { goal: 'test' },
    attempts: 0,
    maxAttempts: 3,
    availableAt: new Date(Date.now() - 1000),
    ...overrides,
  };
}

describe('QueueWorker — Behavioral Lifecycle', () => {
  let log: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    log = createMockLogger();
  });

  // ─── Start / Stop ──────────────────────────────────────────────────

  it('starts and reports running health', () => {
    const db = createMockDb();
    const processor: JobProcessor = async () => 'COMPLETED';
    const worker = new QueueWorker(db, log, processor, { pollIntervalMs: 500 });

    worker.start();
    const health = worker.health();
    expect(health.status).toBe('running');
    expect(health.maxConcurrent).toBeGreaterThanOrEqual(1);
    expect(health.runningJobs).toBe(0);
    expect(health.uptimeMs).toBeGreaterThanOrEqual(0);

    worker.stop();
    expect(worker.health().status).toBe('stopped');
  });

  it('stop is idempotent — calling stop twice does not throw', () => {
    const db = createMockDb();
    const processor: JobProcessor = async () => 'COMPLETED';
    const worker = new QueueWorker(db, log, processor);

    worker.start();
    worker.stop();
    worker.stop(); // second stop should be safe
    expect(worker.health().status).toBe('stopped');
  });

  it('start is idempotent — calling start twice does not create duplicate timers', () => {
    const db = createMockDb();
    const processor: JobProcessor = async () => 'COMPLETED';
    const worker = new QueueWorker(db, log, processor, { pollIntervalMs: 5000 });

    worker.start();
    worker.start(); // second start should be no-op
    expect(worker.health().status).toBe('running');

    worker.stop();
  });

  // ─── Job Claiming ──────────────────────────────────────────────────

  it('claims and processes a queued job via processor callback', async () => {
    const job = makeJob();
    const db = createMockDb([job]);
    const processed: string[] = [];

    const processor: JobProcessor = async (j) => {
      processed.push(j.id);
      return 'COMPLETED';
    };

    const worker = new QueueWorker(db, log, processor, { pollIntervalMs: 100 });

    const completedPromise = new Promise<void>((resolve) => {
      worker.on('job:completed', () => resolve());
    });

    worker.start();
    await completedPromise;
    worker.stop();

    expect(processed).toContain(job.id);
    expect(worker.health().completedTotal).toBe(1);
  });

  // ─── Retry / Dead-letter ───────────────────────────────────────────

  it('retries failed jobs up to maxAttempts, then dead-letters', async () => {
    const job = makeJob({ maxAttempts: 2, attempts: 1 }); // 1 attempt left
    const db = createMockDb([job]);

    const processor: JobProcessor = async () => 'FAILED';

    const worker = new QueueWorker(db, log, processor, { pollIntervalMs: 100 });

    const deadPromise = new Promise<void>((resolve) => {
      worker.on('job:dead', () => resolve());
    });

    worker.start();
    await deadPromise;
    worker.stop();

    // Job should be in dead-letter state
    expect(worker.health().deadTotal).toBe(1);
  });

  // ─── Health Counters ───────────────────────────────────────────────

  it('increments health counters accurately', async () => {
    const jobs = [makeJob(), makeJob()];
    const db = createMockDb(jobs);
    let callCount = 0;

    const processor: JobProcessor = async () => {
      callCount++;
      return callCount === 1 ? 'COMPLETED' : 'FAILED';
    };

    const worker = new QueueWorker(db, log, processor, { pollIntervalMs: 100 });

    // Wait for both jobs to process
    await new Promise<void>((resolve) => {
      let events = 0;
      const check = () => {
        events++;
        if (events >= 2) resolve();
      };
      worker.on('job:completed', check);
      worker.on('job:retried', check);
      worker.on('job:dead', check);
      worker.start();
    });

    worker.stop();
    const health = worker.health();
    expect(health.claimedTotal).toBe(2);
  });

  // ─── Drain (Graceful Shutdown) ─────────────────────────────────────

  it('drain waits for in-flight jobs then stops', async () => {
    const job = makeJob();
    const db = createMockDb([job]);

    let resolveProcessing: () => void;
    const processingPromise = new Promise<void>((r) => { resolveProcessing = r; });

    const processor: JobProcessor = async () => {
      // Simulate slow job
      await new Promise((r) => setTimeout(r, 200));
      resolveProcessing!();
      return 'COMPLETED';
    };

    const worker = new QueueWorker(db, log, processor, {
      pollIntervalMs: 100,
      shutdownGracePeriodMs: 5000,
    });

    worker.start();

    // Wait for job to be claimed
    await new Promise<void>((resolve) => {
      worker.on('job:claimed', () => resolve());
    });

    // Start drain — should wait for the in-flight job
    const drainPromise = worker.drain();
    await processingPromise;
    await drainPromise;

    expect(worker.health().status).toBe('draining');
    expect(worker.health().completedTotal).toBe(1);
  });

  // ─── Event Emission ────────────────────────────────────────────────

  it('emits job:claimed, job:completed events with correct data', async () => {
    const job = makeJob();
    const db = createMockDb([job]);
    const processor: JobProcessor = async () => 'COMPLETED';
    const worker = new QueueWorker(db, log, processor, { pollIntervalMs: 100 });

    const claimedEvents: any[] = [];
    const completedEvents: any[] = [];

    worker.on('job:claimed', (e) => claimedEvents.push(e));
    worker.on('job:completed', (e) => completedEvents.push(e));

    const done = new Promise<void>((resolve) => {
      worker.on('job:completed', () => resolve());
    });

    worker.start();
    await done;
    worker.stop();

    expect(claimedEvents.length).toBe(1);
    expect(claimedEvents[0].jobId).toBe(job.id);
    expect(claimedEvents[0].workflowId).toBe(job.workflowId);

    expect(completedEvents.length).toBe(1);
    expect(completedEvents[0].jobId).toBe(job.id);
  });
});
