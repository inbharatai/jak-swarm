/**
 * Standing Orders integration tests — Item C of the OpenClaw-inspired
 * Phase 1.
 *
 * Pins the contract that the scheduler:
 *   1. Resolves the linked StandingOrder at fire time and applies its
 *      blockedActions to the workflow's disabledToolNames.
 *   2. Stops firing a schedule when its SCOPED standing order has
 *      expired (expiresAt <= now), regardless of whether the order was
 *      manually disabled.
 *   3. Honors `budgetUsd` only as a LOWER bound — never raises the
 *      schedule's existing maxCostUsd.
 *   4. Surfaces `triggeredBy: 'standing_order'` for boundary-applied
 *      fires (vs `'schedule'` for un-bounded fires).
 *   5. Tenant-global orders (workflowScheduleId = null) apply to every
 *      schedule of the tenant.
 *
 * The test uses an in-memory stub of the bits of Prisma the scheduler
 * touches. We don't spin up a real Postgres; the goal is to pin the
 * scheduler's BOUNDARY-MERGE LOGIC (which is the easy place for
 * regressions to slip in). DB-level constraint enforcement is the
 * migration's job.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchedulerService, type SchedulerExecuteParams } from '../../apps/api/src/services/scheduler.service.js';

interface ScheduleRow {
  id: string;
  tenantId: string;
  userId: string;
  goal: string;
  industry: string | null;
  cronExpression: string;
  enabled: boolean;
  maxCostUsd: number | null;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastRunStatus: string | null;
  lastRunId: string | null;
  runCount: number;
  name: string;
}

interface StandingOrderRow {
  id: string;
  tenantId: string;
  userId: string;
  workflowScheduleId: string | null;
  name: string;
  description: string | null;
  allowedTools: string[];
  blockedActions: string[];
  approvalRequiredFor: string[];
  allowedSources: string[];
  budgetUsd: number | null;
  expiresAt: Date | null;
  enabled: boolean;
}

function makeStubDb(opts: {
  schedules: ScheduleRow[];
  standingOrders?: StandingOrderRow[];
}) {
  const schedules = [...opts.schedules];
  const standingOrders = [...(opts.standingOrders ?? [])];

  return {
    workflowSchedule: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        // Honor enabled + nextRunAt.lte filters used by the tick.
        return schedules.filter((s) => {
          if (where['enabled'] !== undefined && s.enabled !== where['enabled']) return false;
          const nra = where['nextRunAt'] as { lte?: Date } | undefined;
          if (nra?.lte && (s.nextRunAt === null || s.nextRunAt > nra.lte)) return false;
          return true;
        });
      },
      update: async ({
        where,
        data,
      }: { where: { id: string }; data: Partial<ScheduleRow> | Record<string, unknown> }) => {
        const idx = schedules.findIndex((s) => s.id === where.id);
        if (idx < 0) throw new Error('schedule not found');
        const dataRec = data as Record<string, unknown>;
        const inc = dataRec['runCount'] as { increment?: number } | undefined;
        const merged: ScheduleRow = {
          ...schedules[idx]!,
          ...(dataRec as Partial<ScheduleRow>),
          runCount: inc?.increment
            ? (schedules[idx]!.runCount + inc.increment)
            : schedules[idx]!.runCount,
        };
        schedules[idx] = merged;
        return merged;
      },
    },
    standingOrder: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const tenantId = where['tenantId'];
        const enabled = where['enabled'];
        const orFilter = where['OR'] as Array<{ workflowScheduleId?: string | null }> | undefined;
        return standingOrders.filter((o) => {
          if (tenantId && o.tenantId !== tenantId) return false;
          if (enabled !== undefined && o.enabled !== enabled) return false;
          if (orFilter && orFilter.length > 0) {
            const ok = orFilter.some((cond) => {
              if ('workflowScheduleId' in cond) {
                return o.workflowScheduleId === cond.workflowScheduleId;
              }
              return false;
            });
            if (!ok) return false;
          }
          return true;
        });
      },
    },
  };
}

function makeSchedule(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: 'sched_1',
    tenantId: 'tenant_1',
    userId: 'user_1',
    goal: 'Daily digest',
    industry: null,
    cronExpression: '0 9 * * *',
    enabled: true,
    maxCostUsd: 5,
    lastRunAt: null,
    nextRunAt: new Date(Date.now() - 1000), // due
    lastRunStatus: null,
    lastRunId: null,
    runCount: 0,
    name: 'Daily digest schedule',
    ...overrides,
  };
}

function makeOrder(overrides: Partial<StandingOrderRow> = {}): StandingOrderRow {
  return {
    id: 'order_1',
    tenantId: 'tenant_1',
    userId: 'user_1',
    workflowScheduleId: 'sched_1',
    name: 'Block external publish',
    description: null,
    allowedTools: [],
    blockedActions: [],
    approvalRequiredFor: [],
    allowedSources: [],
    budgetUsd: null,
    expiresAt: null,
    enabled: true,
    ...overrides,
  };
}

function newScheduler(
  db: ReturnType<typeof makeStubDb>,
  executeWorkflow: (p: SchedulerExecuteParams) => Promise<string>,
) {
  // The leader hook can be sync — set it permissive for the test.
  return new SchedulerService(db as never, executeWorkflow, { isLeader: async () => true });
}

describe('Standing Orders — scheduler boundary application', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('applies blockedActions to disabledToolNames at fire time', async () => {
    const db = makeStubDb({
      schedules: [makeSchedule()],
      standingOrders: [
        makeOrder({ blockedActions: ['gmail_send_email', 'slack_post_message'] }),
      ],
    });
    const calls: SchedulerExecuteParams[] = [];
    const scheduler = newScheduler(db, async (p) => {
      calls.push(p);
      return 'wf_test';
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.disabledToolNames).toEqual(['gmail_send_email', 'slack_post_message']);
    expect(calls[0]?.triggeredBy).toBe('standing_order');
    expect(calls[0]?.standingOrderId).toBe('order_1');
  });

  it('stops firing a schedule whose SCOPED order has expired', async () => {
    const db = makeStubDb({
      schedules: [makeSchedule()],
      standingOrders: [
        makeOrder({
          blockedActions: ['gmail_send_email'],
          expiresAt: new Date(Date.now() - 10_000), // expired 10s ago
        }),
      ],
    });
    const calls: SchedulerExecuteParams[] = [];
    const scheduler = newScheduler(db, async (p) => {
      calls.push(p);
      return 'wf_test';
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    // Schedule must NOT have fired
    expect(calls).toHaveLength(0);
  });

  it('overrides schedule.maxCostUsd ONLY when order.budgetUsd is lower', async () => {
    const db = makeStubDb({
      schedules: [makeSchedule({ maxCostUsd: 10 })],
      standingOrders: [makeOrder({ budgetUsd: 3 })], // lower → wins
    });
    const calls: SchedulerExecuteParams[] = [];
    const scheduler = newScheduler(db, async (p) => {
      calls.push(p);
      return 'wf_test';
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    expect(calls[0]?.maxCostUsd).toBe(3);
  });

  it('does NOT raise schedule.maxCostUsd when order.budgetUsd is higher', async () => {
    const db = makeStubDb({
      schedules: [makeSchedule({ maxCostUsd: 5 })],
      standingOrders: [makeOrder({ budgetUsd: 50 })], // higher → ignored, schedule cap wins
    });
    const calls: SchedulerExecuteParams[] = [];
    const scheduler = newScheduler(db, async (p) => {
      calls.push(p);
      return 'wf_test';
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    expect(calls[0]?.maxCostUsd).toBe(5);
  });

  it('passes triggeredBy=schedule when no standing order is attached', async () => {
    const db = makeStubDb({ schedules: [makeSchedule()], standingOrders: [] });
    const calls: SchedulerExecuteParams[] = [];
    const scheduler = newScheduler(db, async (p) => {
      calls.push(p);
      return 'wf_test';
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    expect(calls[0]?.triggeredBy).toBe('schedule');
    expect(calls[0]?.disabledToolNames).toBeUndefined();
    expect(calls[0]?.standingOrderId).toBeUndefined();
  });

  it('applies tenant-global orders (workflowScheduleId=null) to every schedule of the tenant', async () => {
    const db = makeStubDb({
      schedules: [
        makeSchedule({ id: 'sched_1', name: 'Schedule 1' }),
        makeSchedule({ id: 'sched_2', name: 'Schedule 2' }),
      ],
      standingOrders: [
        makeOrder({
          workflowScheduleId: null, // tenant-global
          blockedActions: ['paddle_charge', 'stripe_charge'],
        }),
      ],
    });
    const calls: SchedulerExecuteParams[] = [];
    const scheduler = newScheduler(db, async (p) => {
      calls.push(p);
      return `wf_${calls.length}`;
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.disabledToolNames).toEqual(['paddle_charge', 'stripe_charge']);
      // Tenant-global orders trigger as 'schedule' — the SCOPED-order
      // attribution requires a per-schedule order. Tenant-globals add
      // the boundary but don't relabel the trigger.
      expect(c.triggeredBy).toBe('schedule');
    }
  });

  it('UNIONs blockedActions across multiple active orders', async () => {
    const db = makeStubDb({
      schedules: [makeSchedule()],
      standingOrders: [
        makeOrder({ id: 'order_a', blockedActions: ['gmail_send_email'] }),
        makeOrder({
          id: 'order_b',
          workflowScheduleId: null,
          blockedActions: ['slack_post_message', 'gmail_send_email'],
        }),
      ],
    });
    const calls: SchedulerExecuteParams[] = [];
    const scheduler = newScheduler(db, async (p) => {
      calls.push(p);
      return 'wf_test';
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    // De-duplicated union of both orders' blockedActions.
    expect(calls[0]?.disabledToolNames?.sort()).toEqual(
      ['gmail_send_email', 'slack_post_message'].sort(),
    );
  });

  it('ignores DISABLED standing orders even when not expired', async () => {
    const db = makeStubDb({
      schedules: [makeSchedule()],
      standingOrders: [
        makeOrder({ blockedActions: ['gmail_send_email'], enabled: false }),
      ],
    });
    const calls: SchedulerExecuteParams[] = [];
    const scheduler = newScheduler(db, async (p) => {
      calls.push(p);
      return 'wf_test';
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.disabledToolNames).toBeUndefined();
    expect(calls[0]?.triggeredBy).toBe('schedule');
  });

  it('passes approvalRequiredFor through to the workflow execution', async () => {
    const db = makeStubDb({
      schedules: [makeSchedule()],
      standingOrders: [
        makeOrder({ approvalRequiredFor: ['EXTERNAL_ACTION_APPROVAL', 'CRITICAL_MANUAL_ONLY'] }),
      ],
    });
    const calls: SchedulerExecuteParams[] = [];
    const scheduler = newScheduler(db, async (p) => {
      calls.push(p);
      return 'wf_test';
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    expect(calls[0]?.approvalRequiredFor).toEqual([
      'EXTERNAL_ACTION_APPROVAL',
      'CRITICAL_MANUAL_ONLY',
    ]);
  });
});
