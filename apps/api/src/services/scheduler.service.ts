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
  // Item C (OpenClaw-inspired Phase 1) — per-fire boundary fields. The
  // scheduler resolves these from a linked StandingOrder before firing
  // the workflow; the workflow service applies them to the run's tool
  // policy + audit metadata.
  disabledToolNames?: string[];
  approvalRequiredFor?: string[];
  triggeredBy?: 'schedule' | 'standing_order' | 'manual';
  standingOrderId?: string;
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
          // Item C (OpenClaw-inspired Phase 1) — resolve the standing-order
          // boundary BEFORE firing. We accept a per-schedule order (by
          // workflowScheduleId) OR a tenant-global order (workflowScheduleId
          // is null + tenantId matches + enabled). If a stale-but-undisabled
          // order has expired, we drop it and the schedule fires with no
          // boundary — but we ALSO log the expiry so an operator can clean
          // up the row. We never fire UNDER an expired order.
          const orders = await this.db.standingOrder.findMany({
            where: {
              tenantId: schedule.tenantId,
              enabled: true,
              OR: [
                { workflowScheduleId: schedule.id },
                { workflowScheduleId: null },
              ],
            },
          });
          const activeOrders = orders.filter(
            (o) => !o.expiresAt || o.expiresAt > now,
          );
          const expiredOrders = orders.filter(
            (o) => o.expiresAt && o.expiresAt <= now,
          );
          for (const expired of expiredOrders) {
            logger.warn(
              { schedule: schedule.name, standingOrderId: expired.id, expiresAt: expired.expiresAt },
              'Standing order expired — boundary not applied (consider disabling)',
            );
          }

          // If ANY active order has expired-already-but-attached-to-this-
          // schedule, do NOT fire. This honors the contract that a
          // schedule with an expired SCOPED standing order stops firing
          // entirely. (A tenant-global order's expiry never blocks the
          // schedule itself — tenant-global expiries just remove the
          // boundary and re-enable default tenant behavior.)
          const scopedExpired = expiredOrders.some(
            (o) => o.workflowScheduleId === schedule.id,
          );
          if (scopedExpired) {
            logger.info(
              { schedule: schedule.name },
              'Scoped standing order has expired — skipping this fire (cleanup expected)',
            );
            await this.db.workflowSchedule
              .update({
                where: { id: schedule.id },
                data: { lastRunStatus: 'SKIPPED_EXPIRED_BOUNDARY', lastRunAt: now },
              })
              .catch(() => {});
            const expr = CronExpressionParser.parse(schedule.cronExpression);
            await this.db.workflowSchedule
              .update({
                where: { id: schedule.id },
                data: { nextRunAt: expr.next().toDate() },
              })
              .catch(() => {});
            continue;
          }

          // Merge active orders into a single boundary view. Hard rules
          // (per the model docstring):
          //   - blockedActions UNIONS across all orders (anything blocked
          //     anywhere stays blocked)
          //   - allowedTools INTERSECTS when ALL orders specify a list
          //     (most restrictive wins); if any order leaves the list
          //     empty, no whitelist is applied (default: tenant policy)
          //   - approvalRequiredFor UNIONS across all orders
          //   - budgetUsd takes the LOWEST non-null value (never raises)
          //   - The first scoped order's id is recorded as the trigger
          //     for the audit metadata; tenant-global orders are still
          //     applied but the trigger labels the schedule itself.
          const blockedActions = Array.from(
            new Set(activeOrders.flatMap((o) => o.blockedActions ?? [])),
          );
          const approvalRequiredFor = Array.from(
            new Set(activeOrders.flatMap((o) => o.approvalRequiredFor ?? [])),
          );
          const allowedToolsLists = activeOrders
            .map((o) => o.allowedTools ?? [])
            .filter((list) => list.length > 0);
          const allowedTools = allowedToolsLists.length === activeOrders.length && allowedToolsLists.length > 0
            ? allowedToolsLists.reduce<string[]>((acc, list, idx) => {
                if (idx === 0) return [...list];
                const setB = new Set(list);
                return acc.filter((t) => setB.has(t));
              }, [])
            : [];
          const orderBudgets = activeOrders
            .map((o) => o.budgetUsd)
            .filter((b): b is number => typeof b === 'number');
          const orderBudget = orderBudgets.length > 0 ? Math.min(...orderBudgets) : undefined;
          const effectiveMaxCostUsd =
            orderBudget !== undefined && schedule.maxCostUsd !== null
              ? Math.min(orderBudget, schedule.maxCostUsd)
              : orderBudget ?? schedule.maxCostUsd ?? undefined;

          // disabledToolNames combines the explicit blocklist with the
          // inverse of the whitelist. We compute a "permit list" the
          // workflow service can use, but for now we surface only the
          // blocklist (the workflow service already understands
          // disabledToolNames; allowedTools as an inversion would need
          // a richer policy hook, so for Phase 1 the whitelist is
          // recorded in audit metadata + applied in a follow-up pass).
          const disabledToolNames = blockedActions;

          const scopedOrder = activeOrders.find(
            (o) => o.workflowScheduleId === schedule.id,
          );
          const triggeredBy: 'schedule' | 'standing_order' = scopedOrder
            ? 'standing_order'
            : 'schedule';

          const workflowId = await this.executeWorkflow({
            goal: schedule.goal,
            tenantId: schedule.tenantId,
            userId: schedule.userId,
            industry: schedule.industry ?? undefined,
            maxCostUsd: effectiveMaxCostUsd,
            disabledToolNames: disabledToolNames.length > 0 ? disabledToolNames : undefined,
            approvalRequiredFor: approvalRequiredFor.length > 0 ? approvalRequiredFor : undefined,
            triggeredBy,
            ...(scopedOrder ? { standingOrderId: scopedOrder.id } : {}),
          });

          if (activeOrders.length > 0) {
            logger.info(
              {
                schedule: schedule.name,
                workflowId,
                triggeredBy,
                standingOrderCount: activeOrders.length,
                scopedOrderId: scopedOrder?.id ?? null,
                blockedActions: blockedActions.length,
                allowedTools: allowedTools.length,
                approvalRequiredFor: approvalRequiredFor.length,
                budgetUsd: effectiveMaxCostUsd ?? null,
              },
              'STANDING_ORDER_FIRED — boundary applied to schedule fire',
            );
          }

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
