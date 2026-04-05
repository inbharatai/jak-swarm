/**
 * SchedulerService
 *
 * Polls the WorkflowSchedule table every 60 seconds and fires any schedules
 * whose nextRunAt has passed. After firing, it calculates the next occurrence
 * from the cron expression and updates the record.
 */
import type { PrismaClient } from '@jak-swarm/db';
import { CronExpressionParser } from 'cron-parser';

export interface SchedulerExecuteParams {
  goal: string;
  tenantId: string;
  userId: string;
  industry?: string;
  maxCostUsd?: number;
}

export class SchedulerService {
  private interval: ReturnType<typeof setInterval> | null = null;
  private db: PrismaClient;
  private executeWorkflow: (params: SchedulerExecuteParams) => Promise<string>;

  constructor(
    db: PrismaClient,
    executeWorkflow: (params: SchedulerExecuteParams) => Promise<string>,
  ) {
    this.db = db;
    this.executeWorkflow = executeWorkflow;
  }

  start(): void {
    console.log('[scheduler] Starting workflow scheduler (60s interval)');
    this.interval = setInterval(() => {
      void this.tick();
    }, 60_000);
    // Initial tick after 5 seconds (let everything boot first)
    setTimeout(() => {
      void this.tick();
    }, 5_000);
    // Calculate nextRunAt for all enabled schedules missing it
    void this.initializeNextRuns();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('[scheduler] Stopped');
  }

  private async initializeNextRuns(): Promise<void> {
    try {
      const schedules = await this.db.workflowSchedule.findMany({
        where: { enabled: true, nextRunAt: null },
      });
      for (const schedule of schedules) {
        try {
          const expr = CronExpressionParser.parse(schedule.cronExpression);
          const nextRun = expr.next().toDate();
          await this.db.workflowSchedule.update({
            where: { id: schedule.id },
            data: { nextRunAt: nextRun },
          });
        } catch {
          /* invalid cron expression */
        }
      }
      if (schedules.length > 0) {
        console.log(
          `[scheduler] Initialized nextRunAt for ${schedules.length} schedules`,
        );
      }
    } catch (err) {
      console.error('[scheduler] Failed to initialize schedules:', err);
    }
  }

  private async tick(): Promise<void> {
    try {
      const now = new Date();
      const due = await this.db.workflowSchedule.findMany({
        where: { enabled: true, nextRunAt: { lte: now } },
      });

      if (due.length === 0) return;

      console.log(`[scheduler] ${due.length} schedule(s) due for execution`);

      for (const schedule of due) {
        try {
          const workflowId = await this.executeWorkflow({
            goal: schedule.goal,
            tenantId: schedule.tenantId,
            userId: schedule.userId,
            industry: schedule.industry ?? undefined,
            maxCostUsd: schedule.maxCostUsd ?? undefined,
          });

          // Calculate next run
          const expr = CronExpressionParser.parse(schedule.cronExpression);
          const nextRun = expr.next().toDate();

          await this.db.workflowSchedule.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              nextRunAt: nextRun,
              lastRunStatus: 'RUNNING',
              lastRunId: workflowId,
              runCount: { increment: 1 },
            },
          });

          console.log(
            `[scheduler] Fired schedule "${schedule.name}" -> workflow ${workflowId}`,
          );
        } catch (err) {
          console.error(
            `[scheduler] Failed to fire schedule "${schedule.name}":`,
            err,
          );
          await this.db.workflowSchedule
            .update({
              where: { id: schedule.id },
              data: { lastRunStatus: 'FAILED', lastRunAt: now },
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      console.error('[scheduler] Tick error:', err);
    }
  }
}
