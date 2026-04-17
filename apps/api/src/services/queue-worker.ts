/**
 * QueueWorker — Dedicated workflow job consumer
 *
 * Extracts the queue polling loop, job claiming, retry/DLQ logic, and job lifecycle
 * transitions from the SwarmExecutionService into an independently deployable module.
 *
 * Deployment modes:
 *   1. Embedded — instantiated inside the API process (current default)
 *   2. Standalone — started via `node --import tsx apps/api/src/worker-entry.ts`
 *      as a separate process that reads from the same DB/Redis
 *
 * The worker owns job lifecycle transitions:
 *   QUEUED → ACTIVE → COMPLETED | FAILED → (re-QUEUED with backoff) | DEAD
 *
 * The API owns job creation (enqueue) and read queries (stats, listing).
 * This boundary is enforced by the QueueWorker not exposing enqueue or stats.
 */
import { EventEmitter } from 'node:events';
import type { PrismaClient } from '@jak-swarm/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowJobStatus = 'QUEUED' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'DEAD';

export interface WorkflowJobRow {
  id: string;
  workflowId: string;
  tenantId: string;
  userId: string;
  status: WorkflowJobStatus;
  payloadJson: unknown;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
}

export interface WorkerHealth {
  status: 'running' | 'stopped' | 'draining';
  runningJobs: number;
  maxConcurrent: number;
  pollIntervalMs: number;
  claimedTotal: number;
  completedTotal: number;
  failedTotal: number;
  deadTotal: number;
  lastPollAt: string | null;
  uptimeMs: number;
}

export interface WorkerOptions {
  maxConcurrent?: number;
  pollIntervalMs?: number;
  shutdownGracePeriodMs?: number;
}

export type JobProcessor = (job: WorkflowJobRow) => Promise<'COMPLETED' | 'FAILED'>;

interface Logger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
}

// ---------------------------------------------------------------------------
// QueueWorker
// ---------------------------------------------------------------------------

export class QueueWorker extends EventEmitter {
  private readonly maxConcurrent: number;
  private readonly pollIntervalMs: number;
  private readonly shutdownGracePeriodMs: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private pollInProgress = false;
  private startedAt: number | null = null;

  // Running state
  private readonly runningJobs = new Map<string, { workflowId: string; startedAt: number }>();

  // Counters
  private claimedTotal = 0;
  private completedTotal = 0;
  private failedTotal = 0;
  private deadTotal = 0;
  private lastPollAt: Date | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly log: Logger,
    private readonly processor: JobProcessor,
    opts: WorkerOptions = {},
  ) {
    super();
    this.maxConcurrent = Math.max(
      1,
      opts.maxConcurrent ?? (Number.parseInt(process.env['WORKFLOW_QUEUE_CONCURRENCY'] ?? '2', 10) || 2),
    );
    this.pollIntervalMs = Math.max(
      250,
      opts.pollIntervalMs ?? (Number.parseInt(process.env['WORKFLOW_QUEUE_POLL_INTERVAL_MS'] ?? '1000', 10) || 1000),
    );
    this.shutdownGracePeriodMs = opts.shutdownGracePeriodMs ?? 30_000;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  start(): void {
    if (this.timer) return;
    this.draining = false;
    this.startedAt = Date.now();

    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);

    // Kick off an immediate first poll
    setImmediate(() => void this.poll());

    this.log.info(
      { pollIntervalMs: this.pollIntervalMs, maxConcurrent: this.maxConcurrent },
      '[QueueWorker] Started',
    );
    this.emit('started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.log.info('[QueueWorker] Stopped (no graceful drain)');
    this.emit('stopped');
  }

  /**
   * Graceful shutdown: stop accepting new jobs, wait for in-flight jobs to
   * complete (up to shutdownGracePeriodMs), then stop.
   */
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    // Stop polling
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.log.info(
      { runningJobs: this.runningJobs.size, gracePeriodMs: this.shutdownGracePeriodMs },
      '[QueueWorker] Draining — waiting for in-flight jobs',
    );

    const deadline = Date.now() + this.shutdownGracePeriodMs;
    while (this.runningJobs.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (this.runningJobs.size > 0) {
      this.log.warn(
        { remaining: this.runningJobs.size },
        '[QueueWorker] Grace period expired with jobs still running',
      );
    }

    this.log.info('[QueueWorker] Drain complete');
    this.emit('drained');
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  health(): WorkerHealth {
    return {
      status: this.draining ? 'draining' : this.timer ? 'running' : 'stopped',
      runningJobs: this.runningJobs.size,
      maxConcurrent: this.maxConcurrent,
      pollIntervalMs: this.pollIntervalMs,
      claimedTotal: this.claimedTotal,
      completedTotal: this.completedTotal,
      failedTotal: this.failedTotal,
      deadTotal: this.deadTotal,
      lastPollAt: this.lastPollAt?.toISOString() ?? null,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
    };
  }

  /** Return the set of currently-running workflow IDs (for API compatibility). */
  get runningWorkflowIds(): Set<string> {
    return new Set(Array.from(this.runningJobs.values()).map((j) => j.workflowId));
  }

  // -----------------------------------------------------------------------
  // Poll loop
  // -----------------------------------------------------------------------

  private async poll(): Promise<void> {
    if (this.pollInProgress || this.draining) return;
    this.pollInProgress = true;
    this.lastPollAt = new Date();

    try {
      while (this.runningJobs.size < this.maxConcurrent) {
        const job = await this.claimNextJob();
        if (!job) break;

        this.claimedTotal++;
        const claimTime = Date.now();
        this.runningJobs.set(job.id, { workflowId: job.workflowId, startedAt: claimTime });
        this.log.info(
          { jobId: job.id, workflowId: job.workflowId, tenantId: job.tenantId, attempt: job.attempts, maxAttempts: job.maxAttempts },
          '[QueueWorker] Job claimed',
        );
        this.emit('job:claimed', { jobId: job.id, workflowId: job.workflowId });

        // Process in background (non-blocking)
        void this.executeJob(job)
          .catch((err) => {
            this.log.error(
              { jobId: job.id, workflowId: job.workflowId, err: err instanceof Error ? err.message : String(err) },
              '[QueueWorker] Job processor threw',
            );
          })
          .finally(() => {
            this.runningJobs.delete(job.id);
          });
      }
    } finally {
      this.pollInProgress = false;
    }
  }

  // -----------------------------------------------------------------------
  // Claim (atomic)
  // -----------------------------------------------------------------------

  private async claimNextJob(): Promise<WorkflowJobRow | null> {
    const jobModel = (this.db as any).workflowJob;
    if (!jobModel) return null;

    try {
      const claimedRows = await this.db.$queryRawUnsafe<Array<{
        id: string;
        workflowId: string;
        tenantId: string;
        userId: string;
        payloadJson: unknown;
        attempts: number;
        maxAttempts: number;
        availableAt: Date;
      }>>(
        `
        WITH candidate AS (
          SELECT id
          FROM workflow_jobs
          WHERE status = 'QUEUED'
            AND "availableAt" <= NOW()
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE workflow_jobs w
        SET
          status = 'ACTIVE',
          attempts = w.attempts + 1,
          "startedAt" = NOW(),
          "updatedAt" = NOW()
        FROM candidate
        WHERE w.id = candidate.id
        RETURNING
          w.id,
          w."workflowId" AS "workflowId",
          w."tenantId" AS "tenantId",
          w."userId" AS "userId",
          w."payloadJson" AS "payloadJson",
          w.attempts,
          w."maxAttempts" AS "maxAttempts",
          w."availableAt" AS "availableAt"
        `,
      );

      const row = claimedRows[0];
      if (!row) return null;

      return {
        id: row.id,
        workflowId: row.workflowId,
        tenantId: row.tenantId,
        userId: row.userId,
        status: 'ACTIVE',
        payloadJson: row.payloadJson,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        availableAt: row.availableAt,
      };
    } catch (claimErr) {
      this.log.debug(
        { err: claimErr instanceof Error ? claimErr.message : String(claimErr) },
        '[QueueWorker] Falling back to non-atomic claim path',
      );

      const now = new Date();
      const candidate = await jobModel.findFirst({
        where: { status: 'QUEUED', availableAt: { lte: now } },
        orderBy: { createdAt: 'asc' },
      });
      if (!candidate) return null;

      const claimed = await jobModel.updateMany({
        where: { id: candidate.id, status: 'QUEUED' },
        data: { status: 'ACTIVE', attempts: { increment: 1 }, startedAt: now },
      });
      if (!claimed?.count) return null;

      return {
        id: candidate.id,
        workflowId: candidate.workflowId,
        tenantId: candidate.tenantId ?? '',
        userId: candidate.userId ?? '',
        status: 'ACTIVE',
        payloadJson: candidate.payloadJson,
        attempts: (candidate.attempts ?? 0) + 1,
        maxAttempts: candidate.maxAttempts ?? 5,
        availableAt: candidate.availableAt,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Execute → complete/fail/retry/dead-letter
  // -----------------------------------------------------------------------

  private async executeJob(job: WorkflowJobRow): Promise<void> {
    const jobModel = (this.db as any).workflowJob;
    if (!jobModel) return;

    try {
      const outcome = await this.processor(job);

      if (outcome === 'COMPLETED') {
        await jobModel.update({
          where: { id: job.id },
          data: { status: 'COMPLETED', completedAt: new Date(), lastError: null },
        });
        this.completedTotal++;
        const running = this.runningJobs.get(job.id);
        const durationMs = running ? Date.now() - running.startedAt : undefined;
        this.log.info(
          { jobId: job.id, workflowId: job.workflowId, durationMs },
          '[QueueWorker] Job completed',
        );
        this.emit('job:completed', { jobId: job.id, workflowId: job.workflowId, durationMs });
      } else {
        await this.markFailure(job, 'Processor returned FAILED');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.markFailure(job, message);
    }
  }

  private async markFailure(job: WorkflowJobRow, errorMessage: string): Promise<void> {
    const jobModel = (this.db as any).workflowJob;
    if (!jobModel) return;

    const shouldRetry = job.attempts < job.maxAttempts;
    if (shouldRetry) {
      const backoffMs = Math.min(60_000, 1000 * Math.pow(2, Math.max(0, job.attempts - 1)));
      await jobModel.update({
        where: { id: job.id },
        data: {
          status: 'QUEUED',
          lastError: errorMessage,
          availableAt: new Date(Date.now() + backoffMs),
        },
      });
      this.failedTotal++;
      this.log.warn(
        { jobId: job.id, workflowId: job.workflowId, attempts: job.attempts, maxAttempts: job.maxAttempts, backoffMs },
        '[QueueWorker] Job failed; re-queued with backoff',
      );
      this.emit('job:retried', { jobId: job.id, workflowId: job.workflowId, attempts: job.attempts });
      return;
    }

    await jobModel.update({
      where: { id: job.id },
      data: { status: 'DEAD', completedAt: new Date(), lastError: errorMessage },
    });
    this.deadTotal++;
    this.log.error(
      { jobId: job.id, workflowId: job.workflowId, attempts: job.attempts },
      '[QueueWorker] Job moved to dead-letter state',
    );
    this.emit('job:dead', { jobId: job.id, workflowId: job.workflowId, error: errorMessage });
  }
}
