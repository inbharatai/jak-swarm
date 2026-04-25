/**
 * AttestationScheduler — polls ScheduledAttestation rows every 60s and
 * fires AttestationService.generate() for any whose nextRunAt has passed.
 *
 * Ticks once per minute (matches the existing SchedulerService cadence).
 * On each tick:
 *   1. Find every active row where nextRunAt ≤ now.
 *   2. For each, compute the period (now - windowDays days → now) and
 *      call AttestationService.generate({sign: row.signBundles}).
 *   3. Update lastRunAt + lastRunStatus + lastAttestationId.
 *   4. Compute next nextRunAt from cronExpression and persist.
 *
 * Failure handling:
 *   - One row's failure does NOT block others (per-row try/catch).
 *   - lastRunStatus is set to "failed:<reason>" so the UI can show why.
 *   - A failed fire still advances nextRunAt — we don't infinite-loop on
 *     a permanently broken schedule. Operator must edit + re-save to
 *     retry sooner than the next scheduled occurrence.
 *
 * Leader election:
 *   - Same isLeader pattern as SchedulerService. In multi-instance
 *     deployments, only the leader fires schedules to avoid duplicate
 *     attestations. Default: always leader (single instance).
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { CronExpressionParser } from 'cron-parser';
import { AttestationService } from './attestation.service.js';

const TICK_INTERVAL_MS = 60_000;
const INITIAL_DELAY_MS = 5_000;

export interface AttestationSchedulerOptions {
  isLeader?: () => Promise<boolean>;
}

export class AttestationScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly attestor: AttestationService;
  private readonly isLeader: () => Promise<boolean>;

  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
    opts: AttestationSchedulerOptions = {},
  ) {
    this.attestor = new AttestationService(db, log);
    this.isLeader = opts.isLeader ?? (async () => true);
  }

  start(): void {
    this.log.info('[attestation-scheduler] starting (60s interval)');
    this.timer = setInterval(() => { void this.tick(); }, TICK_INTERVAL_MS);
    // Initial tick after 5 seconds to let the rest of the app boot.
    this.startTimer = setTimeout(() => { void this.tick(); }, INITIAL_DELAY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startTimer) clearTimeout(this.startTimer);
    this.timer = null;
    this.startTimer = null;
  }

  /** Public for tests + manual triggers. Idempotent within a minute. */
  async tick(): Promise<void> {
    try {
      const isLeader = await this.isLeader();
      if (!isLeader) return;

      const now = new Date();
      const dueRows = await this.db.scheduledAttestation.findMany({
        where: { active: true, nextRunAt: { lte: now } },
        take: 50,
      }).catch((err) => {
        const code = (err as { code?: string }).code;
        if (code === 'P2021') {
          // Migration not deployed; silently skip — startup logs already
          // warn about this when the scheduler is enabled.
          return [];
        }
        throw err;
      });

      if (dueRows.length === 0) return;
      this.log.info({ count: dueRows.length }, '[attestation-scheduler] firing due schedules');

      for (const row of dueRows) {
        await this.fireOne(row, now);
      }
    } catch (err) {
      this.log.error({ err: err instanceof Error ? err.message : String(err) }, '[attestation-scheduler] tick failed');
    }
  }

  private async fireOne(row: {
    id: string;
    tenantId: string;
    frameworkId: string;
    cronExpression: string;
    windowDays: number;
    signBundles: boolean;
    metadata: unknown;
    createdBy: string;
  }, now: Date): Promise<void> {
    // Resolve framework slug from id
    const fw = await this.db.complianceFramework.findUnique({
      where: { id: row.frameworkId },
      select: { slug: true },
    });
    if (!fw) {
      this.log.warn({ scheduleId: row.id, frameworkId: row.frameworkId }, '[attestation-scheduler] framework missing — deactivating');
      await this.db.scheduledAttestation.update({
        where: { id: row.id },
        data: { active: false, lastRunStatus: 'failed:framework_deleted' },
      });
      return;
    }

    const periodEnd = now;
    const periodStart = new Date(now.getTime() - row.windowDays * 24 * 60 * 60 * 1000);

    let lastRunStatus = 'success';
    let lastAttestationId: string | undefined;
    try {
      const result = await this.attestor.generate({
        tenantId: row.tenantId,
        frameworkSlug: fw.slug,
        periodStart,
        periodEnd,
        generatedBy: `scheduled:${row.id}`,
        sign: row.signBundles,
        ...(row.metadata && typeof row.metadata === 'object' ? { metadata: row.metadata as Record<string, unknown> } : {}),
      });
      lastAttestationId = result.attestationId;
      this.log.info({ scheduleId: row.id, attestationId: result.attestationId }, '[attestation-scheduler] fired');
    } catch (err) {
      lastRunStatus = `failed:${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`;
      this.log.warn({ scheduleId: row.id, err: err instanceof Error ? err.message : String(err) }, '[attestation-scheduler] generate failed');
    }

    // Compute next run regardless — don't infinite-loop on bad schedules.
    let nextRunAt: Date | null = null;
    try {
      const interval = CronExpressionParser.parse(row.cronExpression, { currentDate: now, tz: 'UTC' });
      nextRunAt = interval.next().toDate();
    } catch (err) {
      this.log.warn({ scheduleId: row.id, cron: row.cronExpression, err: err instanceof Error ? err.message : String(err) }, '[attestation-scheduler] cron parse failed — pausing schedule');
      lastRunStatus = `failed:bad_cron:${err instanceof Error ? err.message.slice(0, 100) : 'unknown'}`;
    }

    await this.db.scheduledAttestation.update({
      where: { id: row.id },
      data: {
        lastRunAt: now,
        lastRunStatus,
        ...(lastAttestationId ? { lastAttestationId } : {}),
        nextRunAt,
        // If cron parse failed, deactivate so we stop hammering it.
        ...(nextRunAt === null ? { active: false } : {}),
      },
    });
  }
}

/**
 * Validate a cron expression at write time + compute the next run.
 * Returns the next firing date or throws an Error with a human message.
 */
export function computeNextRun(cron: string, from: Date = new Date()): Date {
  const interval = CronExpressionParser.parse(cron, { currentDate: from, tz: 'UTC' });
  return interval.next().toDate();
}
