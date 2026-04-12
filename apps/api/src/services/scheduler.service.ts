/**
 * SchedulerService
 *
 * Polls the WorkflowSchedule table every 60 seconds and fires any schedules
 * whose nextRunAt has passed. After firing, it calculates the next occurrence
 * from the cron expression and updates the record.
 */
import type { PrismaClient } from '@jak-swarm/db';
import { CronExpressionParser } from 'cron-parser';
import { createLogger } from '@jak-swarm/shared';

const logger = createLogger('scheduler');

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
  private isLeader: () => Promise<boolean>;

  constructor(
    db: PrismaClient,
    executeWorkflow: (params: SchedulerExecuteParams) => Promise<string>,
    options?: { isLeader?: () => Promise<boolean> },
  ) {
    this.db = db;
    this.executeWorkflow = executeWorkflow;
    this.isLeader = options?.isLeader ?? (async () => true); // Default: always leader (single instance)
  }

  start(): void {
    logger.info('Starting workflow scheduler (60s interval)');
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
    logger.info('Stopped');
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
        logger.info(
          { count: schedules.length },
          'Initialized nextRunAt for schedules',
        );
      }
    } catch (err) {
        logger.error({ err }, 'Failed to initialize schedules');
    }
  }

  private async tick(): Promise<void> {
    try {
      // Only the leader instance should execute scheduled jobs
      const leader = await this.isLeader();
      if (!leader) return;

      const now = new Date();
      const due = await this.db.workflowSchedule.findMany({
        where: { enabled: true, nextRunAt: { lte: now } },
      });

      if (due.length === 0) return;

      logger.info({ count: due.length }, 'Schedules due for execution');

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

          logger.info(
            { schedule: schedule.name, workflowId },
            'Fired schedule',
          );
        } catch (err) {
          logger.error(
            { schedule: schedule.name, err },
            'Failed to fire schedule',
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
      logger.error({ err }, 'Tick error');
    }
  }
}
