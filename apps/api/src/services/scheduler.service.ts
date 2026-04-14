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
  private pollInterval: ReturnType<typeof setInterval> | null = null;
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
    // Poll for completed scheduled workflows every 30s
    this.pollInterval = setInterval(() => {
      void this.syncRunStatuses();
    }, 30_000);
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
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
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

  /**
   * Sync lastRunStatus for schedules that are still showing RUNNING.
   * Looks up the actual workflow status and updates the schedule record.
   */
  private async syncRunStatuses(): Promise<void> {
    try {
      const leader = await this.isLeader();
      if (!leader) return;

      const running = await this.db.workflowSchedule.findMany({
        where: { lastRunStatus: 'RUNNING', lastRunId: { not: null } },
        select: { id: true, lastRunId: true, name: true, lastRunAt: true },
      });

      if (running.length === 0) return;

      const STUCK_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

      for (const schedule of running) {
        try {
          const workflow = await this.db.workflow.findUnique({
            where: { id: schedule.lastRunId! },
            select: { status: true },
          });

          // Workflow record missing — mark as FAILED
          if (!workflow) {
            await this.db.workflowSchedule.update({
              where: { id: schedule.id },
              data: { lastRunStatus: 'FAILED' },
            });
            logger.warn({ schedule: schedule.name }, 'Workflow record missing — marked schedule run as FAILED');
            continue;
          }

          const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'];
          if (terminal.includes(workflow.status)) {
            await this.db.workflowSchedule.update({
              where: { id: schedule.id },
              data: { lastRunStatus: workflow.status },
            });
            logger.info(
              { schedule: schedule.name, status: workflow.status },
              'Synced schedule run status',
            );
          } else if (
            schedule.lastRunAt &&
            Date.now() - new Date(schedule.lastRunAt).getTime() > STUCK_TIMEOUT_MS
          ) {
            // Workflow stuck in non-terminal state for over 2 hours — mark as FAILED
            await this.db.workflowSchedule.update({
              where: { id: schedule.id },
              data: { lastRunStatus: 'FAILED' },
            });
            logger.warn(
              { schedule: schedule.name, workflowStatus: workflow.status },
              'Workflow stuck for >2h — marked schedule run as FAILED',
            );
          }
        } catch {
          // Non-critical — will retry next cycle
        }
      }
    } catch (err) {
      logger.error({ err }, 'syncRunStatuses error');
    }
  }
}
