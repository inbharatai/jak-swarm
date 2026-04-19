/**
 * Queue worker metrics emission test.
 *
 * Asserts that QueueWorker increments the correct Prometheus counters
 * and sets the correct gauges at each lifecycle transition. We read back
 * from the live prom-client registry, not from a mock, so a regression
 * where the import path moves or the label set changes is caught.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueueWorker } from '../../../apps/api/src/services/queue-worker.ts';
import { metrics } from '../../../apps/api/src/observability/metrics.ts';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/**
 * Minimal mock that records raw-SQL calls AND responds to claim-shape SQL
 * with whatever was last pushed via `pushClaim`. Reclaim + execute default
 * to [].
 */
function makeDb() {
  const nextClaim: unknown[][] = [];
  const nextReclaim: unknown[][] = [];
  const db = {
    $queryRawUnsafe: async (sql: string) => {
      if (
        sql.includes("status = 'QUEUED'") &&
        sql.includes('leaseExpiresAt') &&
        sql.includes('< NOW()')
      ) {
        return nextReclaim.shift() ?? [];
      }
      if (sql.includes('ownerInstanceId') && sql.includes('$1')) {
        return nextClaim.shift() ?? [];
      }
      // Queue-depth sampler — return empty to keep gauges stable in tests.
      return [];
    },
    $executeRawUnsafe: async () => 0,
    workflowJob: {
      findFirst: async () => null,
      update: async () => null,
      updateMany: async () => ({ count: 0 }),
    },
  } as unknown as ConstructorParameters<typeof QueueWorker>[0];
  return {
    db,
    pushClaim: (rows: unknown[]) => nextClaim.push(rows),
    pushReclaim: (rows: unknown[]) => nextReclaim.push(rows),
  };
}

async function getCounterValue(counter: unknown, labels: Record<string, string> = {}): Promise<number> {
  const json = await (counter as { get: () => Promise<{ values: Array<{ labels?: Record<string, string>; value: number }> }> }).get();
  const match = json.values.find((v) => {
    if (!v.labels) return Object.keys(labels).length === 0;
    for (const [k, val] of Object.entries(labels)) {
      if (v.labels[k] !== val) return false;
    }
    return true;
  });
  return match?.value ?? 0;
}

async function getGaugeValue(gauge: unknown, labels: Record<string, string> = {}): Promise<number> {
  return getCounterValue(gauge, labels);
}

describe('QueueWorker metrics emission', () => {
  // Reset the claim counter before each test so expectations are isolated.
  beforeEach(async () => {
    await metrics.workflowJobsClaimedTotal.reset();
    await metrics.workflowJobsReclaimedTotal.reset();
    await metrics.workflowJobsCompletedTotal.reset();
    await metrics.workflowJobsFailedTotal.reset();
    await metrics.workflowJobsDeadTotal.reset();
    await metrics.workerHeartbeatFailuresTotal.reset();
    await metrics.workerRunningJobs.reset();
    await metrics.workerLastPollTimestamp.reset();
  });

  it('increments jak_workflow_jobs_claimed_total on successful claim', async () => {
    const h = makeDb();
    h.pushClaim([
      {
        id: 'j1',
        workflowId: 'w1',
        tenantId: 't1',
        userId: 'u1',
        payloadJson: {},
        attempts: 1,
        maxAttempts: 5,
        availableAt: new Date(),
      },
    ]);
    const worker = new QueueWorker(h.db, silentLogger() as any, async () => 'COMPLETED', {
      instanceId: 'metrics-test-alpha',
      leaseTtlMs: 60_000,
      maxConcurrent: 1,
    });
    try {
      await (worker as any).poll();
    } finally {
      worker.stop();
    }
    const claimed = await getCounterValue(metrics.workflowJobsClaimedTotal, { instance_id: 'metrics-test-alpha' });
    expect(claimed).toBe(1);
  });

  it('increments jak_workflow_jobs_reclaimed_total with the reclaimer_instance label', async () => {
    const h = makeDb();
    h.pushReclaim([
      { id: 'j1', ownerInstanceId: 'dead-worker' },
      { id: 'j2', ownerInstanceId: 'dead-worker' },
      { id: 'j3', ownerInstanceId: 'dead-worker' },
    ]);
    const worker = new QueueWorker(h.db, silentLogger() as any, async () => 'COMPLETED', {
      instanceId: 'metrics-test-beta',
    });
    try {
      await (worker as any).reclaimExpiredLeases();
    } finally {
      worker.stop();
    }
    const reclaimed = await getCounterValue(metrics.workflowJobsReclaimedTotal, { reclaimer_instance: 'metrics-test-beta' });
    expect(reclaimed).toBe(3);
  });

  it('sets jak_worker_last_poll_timestamp_seconds on every poll', async () => {
    const h = makeDb();
    const worker = new QueueWorker(h.db, silentLogger() as any, async () => 'COMPLETED', {
      instanceId: 'metrics-test-gamma',
    });
    const before = Date.now() / 1000;
    try {
      await (worker as any).poll();
    } finally {
      worker.stop();
    }
    const after = Date.now() / 1000;
    const ts = await getGaugeValue(metrics.workerLastPollTimestamp, { instance_id: 'metrics-test-gamma' });
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });

  it('increments jak_worker_heartbeat_failures_total when heartbeat SQL throws', async () => {
    const db = {
      $queryRawUnsafe: async () => [],
      $executeRawUnsafe: async () => {
        throw new Error('simulated DB failure');
      },
      workflowJob: { findFirst: async () => null, update: async () => null, updateMany: async () => ({ count: 0 }) },
    } as unknown as ConstructorParameters<typeof QueueWorker>[0];
    const worker = new QueueWorker(db, silentLogger() as any, async () => 'COMPLETED', {
      instanceId: 'metrics-test-delta',
    });
    try {
      // Inject a running job so heartbeat actually fires.
      const running = (worker as any).runningJobs as Map<string, unknown>;
      running.set('fake-job', { workflowId: 'wf', startedAt: Date.now() });
      await (worker as any).heartbeatRunningJobs();
    } finally {
      worker.stop();
    }
    const failures = await getCounterValue(metrics.workerHeartbeatFailuresTotal, { instance_id: 'metrics-test-delta' });
    expect(failures).toBe(1);
  });

  it('sets jak_worker_running_jobs gauge as jobs enter + exit', async () => {
    const h = makeDb();
    h.pushClaim([
      {
        id: 'j1',
        workflowId: 'w1',
        tenantId: 't1',
        userId: 'u1',
        payloadJson: {},
        attempts: 1,
        maxAttempts: 5,
        availableAt: new Date(),
      },
    ]);
    // Processor blocks so we can observe the gauge MID-RUN.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const worker = new QueueWorker(
      h.db,
      silentLogger() as any,
      async () => {
        await gate;
        return 'COMPLETED';
      },
      {
        instanceId: 'metrics-test-eps',
        leaseTtlMs: 60_000,
        maxConcurrent: 1,
      },
    );
    try {
      await (worker as any).poll();
      // Gauge is set during poll after the claim; read before releasing the gate
      const midRun = await getGaugeValue(metrics.workerRunningJobs, { instance_id: 'metrics-test-eps' });
      expect(midRun).toBe(1);
      release?.();
      // Give the micro-tasks a chance to drain
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      const afterDrain = await getGaugeValue(metrics.workerRunningJobs, { instance_id: 'metrics-test-eps' });
      expect(afterDrain).toBe(0);
    } finally {
      release?.();
      worker.stop();
    }
  });
});

describe('Metrics registry surface (prom-client names stay stable)', () => {
  it('exposes the operator-critical metric names a dashboard/alert would query', async () => {
    // If a future refactor renames these, CI catches it here before the
    // Grafana dashboard and alert rules break.
    const register = metrics.registry;
    const all = await register.getMetricsAsJSON();
    const names = new Set(all.map((m) => m.name));

    const required = [
      'jak_workflow_jobs_queued',
      'jak_workflow_jobs_active',
      'jak_workflow_jobs_completed_total',
      'jak_workflow_jobs_failed_total',
      'jak_workflow_jobs_dead_total',
      'jak_workflow_jobs_reclaimed_total',
      'jak_workflow_jobs_claimed_total',
      'jak_worker_running_jobs',
      'jak_worker_heartbeat_failures_total',
      'jak_worker_last_poll_timestamp_seconds',
      'jak_workflow_signal_total',
      'jak_sse_connections_active',
      'jak_vibe_coder_runs_total',
      'jak_vibe_coder_debug_retries_total',
      'jak_vibe_coder_build_check_failures_total',
      'jak_integration_provider_errors_total',
      'jak_redis_connectivity_status',
      'jak_postgres_connectivity_status',
    ];
    const missing = required.filter((n) => !names.has(n));
    expect(missing).toEqual([]);
  });
});
