/**
 * CompanyBrainWorker — durable, lease-claimed Company Brain processing.
 *
 * Replaces the API-local `setImmediate`/`setInterval` + in-memory `running`
 * flag that previously drove Company Brain auto-processing. Work is now a
 * durable row in `company_brain_jobs` (migration 119) consumed with the same
 * lease-claim idiom as `workflow_jobs` (migration 7 + 8): atomic
 * `FOR UPDATE SKIP LOCKED` claim, owner-tagged lease with heartbeat, an
 * expired-lease reclaim sweep, and idempotent enqueue via a
 * `UNIQUE(tenantId, idempotencyKey)` so one logical attempt exists per key.
 *
 * This is deliberately NOT a second queue framework. It reuses the
 * QueueWorker lease idiom as a dedicated table because `workflow_jobs`
 * carries a `UNIQUE(workflowId)` and lacks the richer state machine
 * (REVIEW_REQUIRED / RETRY_WAIT / PERMANENTLY_FAILED / CANCELLED) and the
 * per-key idempotency the Company Brain pipeline requires. The decision is
 * documented in migration 119.
 *
 * State machine (one authoritative owner of processing-state transitions):
 *   PENDING → LEASED → PROCESSING → COMPLETED
 *                                   → RETRY_WAIT → (re-claimed after backoff)
 *                                   → REVIEW_REQUIRED
 *                                   → PERMANENTLY_FAILED
 *   PENDING | LEASED | PROCESSING | RETRY_WAIT → CANCELLED (via API)
 *
 * The worker does NOT scan the latest 200 artifacts. Each job carries an
 * `artifactId`; processing uses a direct tenant-scoped artifact lookup
 * (`getArtifactProcessingStatus`).
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@jak-swarm/db';
import { metrics } from '../../observability/metrics.js';
import type { CompanyBrainV2Service } from './company-brain-v2.service.js';
import type { CompanyOperatingLayerService } from './company-operating-layer.service.js';

export type CompanyBrainJobStatus =
  | 'PENDING'
  | 'LEASED'
  | 'PROCESSING'
  | 'RETRY_WAIT'
  | 'REVIEW_REQUIRED'
  | 'COMPLETED'
  | 'PERMANENTLY_FAILED'
  | 'CANCELLED';

export interface CompanyBrainJobRow {
  id: string;
  tenantId: string;
  artifactId: string;
  userId: string | null;
  idempotencyKey: string;
  jobType: string;
  status: CompanyBrainJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lastError: string | null;
}

/** Thrown by the processor when a job must park for human review. */
export class CompanyBrainReviewRequiredError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'CompanyBrainReviewRequiredError';
  }
}

export interface EnqueueInput {
  tenantId: string;
  artifactId: string;
  userId?: string | null;
  idempotencyKey?: string;
  jobType?: string;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
}

export interface CompanyBrainJobEnqueueResult {
  jobId: string;
  created: boolean;
}

export interface CompanyBrainWorkerOptions {
  maxConcurrent?: number;
  pollIntervalMs?: number;
  leaseTtlMs?: number;
  shutdownGracePeriodMs?: number;
  instanceId?: string;
}

interface Logger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
}

/**
 * Idempotently enqueue a Company Brain processing job. Re-enqueuing the same
 * `(tenantId, idempotencyKey)` is a no-op and returns the existing job id with
 * `created: false` — one logical attempt per key, by DB constraint.
 */
export async function enqueueCompanyBrainJob(
  db: PrismaClient,
  input: EnqueueInput,
): Promise<CompanyBrainJobEnqueueResult> {
  const id = randomUUID();
  const idempotencyKey = input.idempotencyKey ?? `artifact:${input.artifactId}`;
  const jobType = input.jobType ?? 'extract_and_process';
  const maxAttempts = Math.max(1, input.maxAttempts ?? 5);
  try {
    const inserted = await db.$queryRawUnsafe<Array<{ id: string; created: boolean }>>(
      `
      INSERT INTO "company_brain_jobs"
        ("id","tenantId","artifactId","userId","idempotencyKey","jobType","status","maxAttempts","payloadJson")
      VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8::JSONB)
      ON CONFLICT ("tenantId","idempotencyKey") DO UPDATE
        SET "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "id", (xmax = 0) AS "created"
      `,
      id,
      input.tenantId,
      input.artifactId,
      input.userId ?? null,
      idempotencyKey,
      jobType,
      maxAttempts,
      JSON.stringify(input.payload ?? {}),
    );
    const row = inserted[0];
    if (!row) return { jobId: id, created: true };
    return { jobId: row.id, created: row.created };
  } catch {
    // The jobs table may not be migrated yet (migration 119 pending). Fail
    // honestly — do NOT silently pretend the job was enqueued. Callers wrap
    // this so the artifact is still ingested; auto-processing resumes once
    // the migration is deployed.
    throw new Error('company_brain_jobs table unavailable — migration 119 not deployed');
  }
}

export class CompanyBrainWorker {
  private readonly maxConcurrent: number;
  private readonly pollIntervalMs: number;
  private readonly leaseTtlMs: number;
  private readonly shutdownGracePeriodMs: number;
  public readonly instanceId: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private gaugeTimer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private pollInProgress = false;
  private reclaimInProgress = false;
  private startedAt: number | null = null;
  private readonly runningJobs = new Map<string, { tenantId: string; artifactId: string; startedAt: number }>();
  private claimedTotal = 0;
  private completedTotal = 0;
  private retryWaitTotal = 0;
  private reviewRequiredTotal = 0;
  private permanentlyFailedTotal = 0;
  private reclaimedTotal = 0;
  private lastPollAt: Date | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly log: Logger,
    private readonly legacy: CompanyOperatingLayerService,
    private readonly brain: CompanyBrainV2Service,
    opts: CompanyBrainWorkerOptions = {},
  ) {
    this.maxConcurrent = Math.max(
      1,
      opts.maxConcurrent ?? (Number.parseInt(process.env['COMPANY_BRAIN_WORKER_CONCURRENCY'] ?? '2', 10) || 2),
    );
    this.pollIntervalMs = Math.max(
      1_000,
      opts.pollIntervalMs ?? (Number.parseInt(process.env['COMPANY_BRAIN_WORKER_POLL_MS'] ?? '5000', 10) || 5_000),
    );
    this.leaseTtlMs = Math.max(
      10_000,
      opts.leaseTtlMs ?? (Number.parseInt(process.env['COMPANY_BRAIN_WORKER_LEASE_MS'] ?? '120000', 10) || 120_000),
    );
    this.shutdownGracePeriodMs = opts.shutdownGracePeriodMs ?? 30_000;
    this.instanceId =
      opts.instanceId ??
      process.env['COMPANY_BRAIN_WORKER_INSTANCE_ID'] ??
      process.env['HOSTNAME'] ??
      `brain-worker-${randomUUID().slice(0, 8)}`;
  }

  start(): void {
    if (this.timer) return;
    this.draining = false;
    this.startedAt = Date.now();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    const heartbeatMs = Math.max(2_000, Math.floor(this.leaseTtlMs / 2));
    this.heartbeatTimer = setInterval(() => void this.heartbeatRunningJobs(), heartbeatMs);
    this.gaugeTimer = setInterval(() => void this.sampleDepth(), 5_000);
    setImmediate(() => void this.poll());
    this.log.info(
      { pollIntervalMs: this.pollIntervalMs, maxConcurrent: this.maxConcurrent, instanceId: this.instanceId, leaseTtlMs: this.leaseTtlMs },
      '[CompanyBrainWorker] Started',
    );
  }

  stop(): void {
    this.clearTimers();
    this.log.info('[CompanyBrainWorker] Stopped');
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    this.clearTimers();
    const deadline = Date.now() + this.shutdownGracePeriodMs;
    while (this.runningJobs.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (this.runningJobs.size > 0) {
      this.log.warn(
        { remaining: this.runningJobs.size, instanceId: this.instanceId },
        '[CompanyBrainWorker] Grace period expired with jobs running — another instance will reclaim on lease expiry',
      );
    }
    this.log.info('[CompanyBrainWorker] Drain complete');
  }

  health() {
    return {
      status: this.draining ? 'draining' : this.timer ? 'running' : 'stopped',
      runningJobs: this.runningJobs.size,
      maxConcurrent: this.maxConcurrent,
      pollIntervalMs: this.pollIntervalMs,
      claimedTotal: this.claimedTotal,
      completedTotal: this.completedTotal,
      retryWaitTotal: this.retryWaitTotal,
      reviewRequiredTotal: this.reviewRequiredTotal,
      permanentlyFailedTotal: this.permanentlyFailedTotal,
      reclaimedTotal: this.reclaimedTotal,
      instanceId: this.instanceId,
      leaseTtlMs: this.leaseTtlMs,
      lastPollAt: this.lastPollAt?.toISOString() ?? null,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
    };
  }

  private clearTimers(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.gaugeTimer) { clearInterval(this.gaugeTimer); this.gaugeTimer = null; }
  }

  // --- Poll + claim --------------------------------------------------------

  private async poll(): Promise<void> {
    if (this.pollInProgress || this.draining) return;
    this.pollInProgress = true;
    this.lastPollAt = new Date();
    try {
      await this.reclaimExpiredLeases();
      while (this.runningJobs.size < this.maxConcurrent) {
        const job = await this.claimNextJob();
        if (!job) break;
        this.claimedTotal++;
        this.runningJobs.set(job.id, { tenantId: job.tenantId, artifactId: job.artifactId, startedAt: Date.now() });
        this.log.info(
          { jobId: job.id, tenantId: job.tenantId, artifactId: job.artifactId, attempt: job.attempts, maxAttempts: job.maxAttempts },
          '[CompanyBrainWorker] Job claimed',
        );
        void this.executeJob(job).catch((err) => {
          this.log.error({ jobId: job.id, err: err instanceof Error ? err.message : String(err) }, '[CompanyBrainWorker] executeJob threw');
        }).finally(() => {
          this.runningJobs.delete(job.id);
        });
      }
    } catch (err) {
      this.log.error({ err: err instanceof Error ? err.message : String(err) }, '[CompanyBrainWorker] Poll failed');
    } finally {
      this.pollInProgress = false;
    }
  }

  /**
   * Atomic claim via `FOR UPDATE SKIP LOCKED`. Transitions PENDING|RETRY_WAIT
   * (whose availableAt has passed) → LEASED, tagging the row with this
   * worker's instance id + lease expiry, and bumping attempts. This is the
   * single authoritative transition into the leased/active states; no other
   * code path flips a row to LEASED or PROCESSING.
   */
  protected async claimNextJob(): Promise<CompanyBrainJobRow | null> {
    const leaseSeconds = Math.max(10, Math.floor(this.leaseTtlMs / 1000));
    try {
      const rows = await this.db.$queryRawUnsafe<Array<{
        id: string; tenantId: string; artifactId: string; userId: string | null;
        idempotencyKey: string; jobType: string; status: string; attempts: number;
        maxAttempts: number; availableAt: Date; lastError: string | null;
      }>>(
        `
        WITH candidate AS (
          SELECT id
          FROM company_brain_jobs
          WHERE status IN ('PENDING','RETRY_WAIT')
            AND "availableAt" <= NOW()
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE company_brain_jobs j
        SET
          status = 'LEASED',
          attempts = j.attempts + 1,
          "ownerInstanceId" = $1,
          "leaseExpiresAt" = NOW() + ($2 || ' seconds')::interval,
          "lastHeartbeatAt" = NOW(),
          "startedAt" = COALESCE(j."startedAt", NOW()),
          "updatedAt" = NOW()
        FROM candidate
        WHERE j.id = candidate.id
        RETURNING j.id, j."tenantId", j."artifactId", j."userId", j."idempotencyKey",
                  j."jobType", j.status, j.attempts, j."maxAttempts", j."availableAt", j."lastError"
        `,
        this.instanceId,
        String(leaseSeconds),
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id, tenantId: row.tenantId, artifactId: row.artifactId, userId: row.userId,
        idempotencyKey: row.idempotencyKey, jobType: row.jobType,
        status: row.status as CompanyBrainJobStatus, attempts: row.attempts,
        maxAttempts: row.maxAttempts, availableAt: row.availableAt, lastError: row.lastError,
      };
    } catch (err) {
      this.log.debug({ err: err instanceof Error ? err.message : String(err) }, '[CompanyBrainWorker] Claim failed (table unavailable?)');
      return null;
    }
  }

  protected async reclaimExpiredLeases(): Promise<void> {
    if (this.reclaimInProgress) return;
    this.reclaimInProgress = true;
    try {
      const result = await this.db.$queryRawUnsafe<Array<{ id: string; ownerInstanceId: string | null }>>(
        `
        UPDATE company_brain_jobs
        SET status = 'PENDING', "ownerInstanceId" = NULL, "leaseExpiresAt" = NULL,
            "availableAt" = NOW(), "updatedAt" = NOW()
        WHERE status IN ('LEASED','PROCESSING')
          AND "leaseExpiresAt" IS NOT NULL AND "leaseExpiresAt" < NOW()
        RETURNING id, "ownerInstanceId"
        `,
      );
      if (result.length > 0) {
        this.reclaimedTotal += result.length;
        try { metrics.companyBrainJobsReclaimedTotal.inc({ reclaimer_instance: this.instanceId }, result.length); } catch { /* swallow */ }
        this.log.warn(
          { count: result.length, reclaimedFrom: [...new Set(result.map((r) => r.ownerInstanceId).filter(Boolean))], reclaimer: this.instanceId },
          '[CompanyBrainWorker] Reclaimed expired leases',
        );
      }
    } catch (err) {
      this.log.debug({ err: err instanceof Error ? err.message : String(err) }, '[CompanyBrainWorker] Reclaim sweep failed (non-fatal)');
    } finally {
      this.reclaimInProgress = false;
    }
  }

  private async heartbeatRunningJobs(): Promise<void> {
    if (this.runningJobs.size === 0) return;
    const ids = [...this.runningJobs.keys()];
    const leaseSeconds = Math.max(10, Math.floor(this.leaseTtlMs / 1000));
    try {
      await this.db.$executeRawUnsafe(
        `
        UPDATE company_brain_jobs
        SET "leaseExpiresAt" = NOW() + ($1 || ' seconds')::interval, "lastHeartbeatAt" = NOW()
        WHERE id = ANY($2::text[]) AND "ownerInstanceId" = $3 AND status IN ('LEASED','PROCESSING')
        `,
        String(leaseSeconds), ids, this.instanceId,
      );
    } catch (err) {
      this.log.debug({ err: err instanceof Error ? err.message : String(err) }, '[CompanyBrainWorker] Heartbeat failed (will be reclaimed)');
    }
  }

  private async sampleDepth(): Promise<void> {
    try {
      const rows = await this.db.$queryRawUnsafe<Array<{ status: string; n: bigint | number }>>(
        `SELECT status, COUNT(*)::int AS n FROM company_brain_jobs WHERE status IN ('PENDING','RETRY_WAIT','LEASED','PROCESSING') GROUP BY status`,
      );
      let pending = 0; let processing = 0;
      for (const r of rows) {
        const n = typeof r.n === 'bigint' ? Number(r.n) : r.n;
        if (r.status === 'PENDING' || r.status === 'RETRY_WAIT') pending += n;
        if (r.status === 'LEASED' || r.status === 'PROCESSING') processing += n;
      }
      try { metrics.companyBrainJobsPending.set(pending); metrics.companyBrainJobsProcessing.set(processing); } catch { /* swallow */ }
    } catch { /* non-fatal */ }
  }

  // --- Execute → state-terminal transitions --------------------------------

  protected async executeJob(job: CompanyBrainJobRow): Promise<void> {
    // LEASED → PROCESSING (authoritative start-of-work transition).
    try {
      await this.db.$executeRawUnsafe(
        `UPDATE company_brain_jobs SET status = 'PROCESSING', "updatedAt" = NOW() WHERE id = $1 AND "ownerInstanceId" = $2 AND status = 'LEASED'`,
        job.id, this.instanceId,
      );
    } catch (err) {
      this.log.debug({ err: err instanceof Error ? err.message : String(err) }, '[CompanyBrainWorker] LEASED→PROCESSING transition failed');
    }

    try {
      await this.processOne(job);
      await this.db.$executeRawUnsafe(
        `UPDATE company_brain_jobs SET status = 'COMPLETED', "completedAt" = NOW(), "lastError" = NULL, "updatedAt" = NOW() WHERE id = $1`,
        job.id,
      );
      this.completedTotal++;
      try { metrics.companyBrainJobsCompletedTotal.inc(); } catch { /* swallow */ }
      this.log.info({ jobId: job.id, artifactId: job.artifactId, attempts: job.attempts }, '[CompanyBrainWorker] Job completed');
    } catch (err) {
      if (err instanceof CompanyBrainReviewRequiredError) {
        await this.db.$executeRawUnsafe(
          `UPDATE company_brain_jobs SET status = 'REVIEW_REQUIRED', "reviewReason" = $2, "lastError" = $3, "updatedAt" = NOW() WHERE id = $1`,
          job.id, err.reason.slice(0, 4000), err.message.slice(0, 4000),
        ).catch(() => {});
        this.reviewRequiredTotal++;
        try { metrics.companyBrainJobsReviewRequiredTotal.inc(); } catch { /* swallow */ }
        this.log.warn({ jobId: job.id, artifactId: job.artifactId, reason: err.reason }, '[CompanyBrainWorker] Job parked for review');
        return;
      }
      await this.markFailure(job, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * The actual work: direct tenant-scoped artifact lookup (no scan-200),
   * optional entity extraction, then entity processing. Idempotent —
   * re-running a completed artifact is a safe no-op (extraction skipped when
   * extractedAt is set; processExtractedEntities is upsert-based).
   */
  protected async processOne(job: CompanyBrainJobRow): Promise<void> {
    const status = await this.brain.getArtifactProcessingStatus({ tenantId: job.tenantId, artifactId: job.artifactId });
    if (!status.found) {
      // Artifact deleted between enqueue and processing — treat as completed.
      return;
    }
    const userId = job.userId ?? 'system';
    await this.brain.setArtifactProcessingState({ tenantId: job.tenantId, artifactId: job.artifactId, state: 'processing' });
    let entityIds: string[] | undefined;
    if (status.needsExtraction) {
      const extracted = await this.legacy.extractEntitiesFromArtifact({ tenantId: job.tenantId, userId, artifactId: job.artifactId });
      entityIds = extracted.entities.map((e: { id: string }) => e.id);
    }
    await this.brain.processExtractedEntities({ tenantId: job.tenantId, userId, artifactId: job.artifactId, entityIds });
    await this.brain.setArtifactProcessingState({ tenantId: job.tenantId, artifactId: job.artifactId, state: 'ready' });
  }

  protected async markFailure(job: CompanyBrainJobRow, errorMessage: string): Promise<void> {
    await this.brain.markArtifactFailure({ tenantId: job.tenantId, artifactId: job.artifactId, error: errorMessage }).catch(() => {});
    const shouldRetry = job.attempts < job.maxAttempts;
    if (shouldRetry) {
      const backoffMs = Math.min(300_000, 2_000 * Math.pow(2, Math.max(0, job.attempts - 1)));
      await this.db.$executeRawUnsafe(
        `UPDATE company_brain_jobs SET status = 'RETRY_WAIT', "lastError" = $2,
                "availableAt" = NOW() + ($3 || ' milliseconds')::interval,
                "ownerInstanceId" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = NOW()
         WHERE id = $1`,
        job.id, errorMessage.slice(0, 4000), String(backoffMs),
      ).catch(() => {});
      this.retryWaitTotal++;
      try { metrics.companyBrainJobsRetryWaitTotal.inc(); } catch { /* swallow */ }
      this.log.warn({ jobId: job.id, artifactId: job.artifactId, attempts: job.attempts, maxAttempts: job.maxAttempts, backoffMs }, '[CompanyBrainWorker] Job failed → RETRY_WAIT');
      return;
    }
    await this.db.$executeRawUnsafe(
      `UPDATE company_brain_jobs SET status = 'PERMANENTLY_FAILED', "completedAt" = NOW(), "lastError" = $2, "updatedAt" = NOW() WHERE id = $1`,
      job.id, errorMessage.slice(0, 4000),
    ).catch(() => {});
    this.permanentlyFailedTotal++;
    try { metrics.companyBrainJobsPermanentlyFailedTotal.inc(); } catch { /* swallow */ }
    this.log.error({ jobId: job.id, artifactId: job.artifactId, attempts: job.attempts }, '[CompanyBrainWorker] Job PERMANENTLY_FAILED');
  }
}

/**
 * One-time backfill at boot: enqueue a job for every artifact whose policy is
 * still 'ingested'/'failed' (or has no policy) and which has no live job.
 * Bounded + idempotent via the UNIQUE(tenantId, idempotencyKey) constraint
 * (idempotencyKey = `artifact:<artifactId>`). This is NOT the steady-state
 * scan-and-find over the latest 200; it is a migration-time reconciliation so
 * artifacts ingested before the durable worker existed are not stranded.
 */
export async function backfillCompanyBrainJobs(
  db: PrismaClient,
  log: Logger,
  limit = 500,
): Promise<number> {
  try {
    const rows = await db.$queryRawUnsafe<Array<{ id: string; tenantId: string; createdBy: string | null }>>(
      `
      SELECT a."id", a."tenantId", a."createdBy"
      FROM "company_artifacts" a
      LEFT JOIN "company_artifact_policies" p
        ON p."artifactId" = a."id" AND p."tenantId" = a."tenantId"
      WHERE a."deletedAt" IS NULL
        AND (
          p."artifactId" IS NULL
          OR p."processingState" IN ('ingested','failed')
        )
        AND NOT EXISTS (
          SELECT 1 FROM "company_brain_jobs" j
          WHERE j."artifactId" = a."id" AND j."tenantId" = a."tenantId"
            AND j.status IN ('PENDING','LEASED','PROCESSING','RETRY_WAIT','REVIEW_REQUIRED')
        )
      ORDER BY a."createdAt" ASC
      LIMIT $1
      `,
      limit,
    );
    let enqueued = 0;
    for (const r of rows) {
      try {
        const res = await enqueueCompanyBrainJob(db, { tenantId: r.tenantId, artifactId: r.id, userId: r.createdBy });
        if (res.created) enqueued++;
      } catch {
        // table unavailable — stop backfill
        return enqueued;
      }
    }
    if (enqueued > 0) log.info({ enqueued, scanned: rows.length }, '[CompanyBrainWorker] Backfill enqueued stranded artifacts');
    return enqueued;
  } catch (err) {
    log.debug({ err: err instanceof Error ? err.message : String(err) }, '[CompanyBrainWorker] Backfill skipped (table unavailable)');
    return 0;
  }
}