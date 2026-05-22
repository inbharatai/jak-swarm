import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import {
  CompanyConnectorSyncService,
  type CompanyConnectorScheduledTickResult,
} from './company-connector-sync.service.js';
import { CompanyBrainSchemaUnavailableError } from './company-profile.service.js';

const DEFAULT_TICK_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 12_000;
const DEFAULT_STALE_RUNNING_MS = 45 * 60 * 1000;
const DEFAULT_MAX_RUNS_PER_TICK = 12;

export interface CompanyConnectorSyncSchedulerOptions {
  intervalMs?: number;
  staleRunningMs?: number;
  maxRunsPerTick?: number;
  initialDelayMs?: number;
  isLeader?: () => Promise<boolean>;
}

export class CompanyConnectorSyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private readonly syncService: CompanyConnectorSyncService;
  private readonly intervalMs: number;
  private readonly staleRunningMs: number;
  private readonly maxRunsPerTick: number;
  private readonly initialDelayMs: number;
  private readonly isLeader: () => Promise<boolean>;

  constructor(
    db: PrismaClient,
    private readonly log: FastifyBaseLogger,
    opts: CompanyConnectorSyncSchedulerOptions = {},
  ) {
    this.syncService = new CompanyConnectorSyncService(db, log);
    this.intervalMs = Math.max(30_000, Math.trunc(opts.intervalMs ?? DEFAULT_TICK_INTERVAL_MS));
    this.staleRunningMs = Math.max(this.intervalMs, Math.trunc(opts.staleRunningMs ?? DEFAULT_STALE_RUNNING_MS));
    this.maxRunsPerTick = Math.max(1, Math.trunc(opts.maxRunsPerTick ?? DEFAULT_MAX_RUNS_PER_TICK));
    this.initialDelayMs = Math.max(1_000, Math.trunc(opts.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS));
    this.isLeader = opts.isLeader ?? (async () => true);
  }

  start(): void {
    if (this.timer || this.startTimer) return;

    this.log.info(
      {
        intervalMs: this.intervalMs,
        staleRunningMs: this.staleRunningMs,
        maxRunsPerTick: this.maxRunsPerTick,
      },
      '[company-sync-scheduler] starting',
    );

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);

    this.startTimer = setTimeout(() => {
      void this.tick();
    }, this.initialDelayMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startTimer) clearTimeout(this.startTimer);
    this.timer = null;
    this.startTimer = null;
    this.inFlight = false;
  }

  async tick(): Promise<CompanyConnectorScheduledTickResult | null> {
    if (this.inFlight) return null;

    this.inFlight = true;
    try {
      const leader = await this.isLeader();
      if (!leader) return null;

      const summary = await this.syncService.runScheduledTick({
        intervalMs: this.intervalMs,
        staleRunningMs: this.staleRunningMs,
        maxRuns: this.maxRunsPerTick,
      });

      if (summary.triggered > 0 || summary.failed > 0) {
        this.log.info({ summary }, '[company-sync-scheduler] tick completed');
      }

      return summary;
    } catch (err) {
      if (err instanceof CompanyBrainSchemaUnavailableError) {
        this.log.warn({ err: err.message }, '[company-sync-scheduler] schema unavailable; scheduler idle');
        return null;
      }

      this.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        '[company-sync-scheduler] tick failed',
      );
      return null;
    } finally {
      this.inFlight = false;
    }
  }
}
