import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('Durable queue and recovery contracts', () => {
  it('uses workflow_jobs durable queue model and worker lifecycle hooks', () => {
    const schema = readRepoFile('packages/db/prisma/schema.prisma');
    const swarmService = readRepoFile('apps/api/src/services/swarm-execution.service.ts');
    const queueWorker = readRepoFile('apps/api/src/services/queue-worker.ts');
    const swarmPlugin = readRepoFile('apps/api/src/plugins/swarm.plugin.ts');

    expect(schema).toContain('model WorkflowJob');
    expect(schema).toContain('@@map("workflow_jobs")');

    // Worker lifecycle delegated to QueueWorker
    expect(swarmService).toContain('startQueueWorker()');
    expect(swarmService).toContain('stopQueueWorker()');
    expect(queueWorker).toContain("status: 'DEAD'");
    expect(queueWorker).toContain('markFailure');
    expect(queueWorker).toContain('FOR UPDATE SKIP LOCKED');

    expect(swarmPlugin).toContain('swarmService.startQueueWorker()');
    expect(swarmPlugin).toContain('swarmService.stopQueueWorker()');
  });

  it('persists replay-safety checkpoint metadata and gates unsafe auto-replay', () => {
    const swarmService = readRepoFile('apps/api/src/services/swarm-execution.service.ts');

    expect(swarmService).toContain('classifyReplaySafety');
    expect(swarmService).toContain('__checkpoint');
    expect(swarmService).toContain('MANUAL_INTERVENTION_REQUIRED');
    expect(swarmService).toContain('Recovery paused for manual intervention');
  });

  // ─── P1b worker-lease reclaim contract ─────────────────────────────────
  // When a worker dies mid-run, its leaseExpiresAt passes in the future
  // without being renewed. Another worker's poll tick runs reclaimExpiredLeases,
  // which MUST: (a) find ACTIVE rows with lease_expired < NOW, (b) flip them
  // back to QUEUED, (c) null out ownerInstanceId + leaseExpiresAt, (d) set
  // availableAt to NOW so claim picks them up next tick, (e) emit a metric +
  // log so operators see reclaim storms. This contract test pins the SQL shape
  // + the wiring so the behavior can't silently regress.
  //
  // The real behavioral test requires Postgres + testcontainers (see
  // postgres-integration.test.ts pattern). Contract test here covers the
  // "I didn't accidentally delete the reclaim code" class of regression.

  it('P1b: reclaim sweep updates expired ACTIVE leases back to QUEUED with correct shape', () => {
    const queueWorker = readRepoFile('apps/api/src/services/queue-worker.ts');

    // The reclaim function exists
    expect(queueWorker).toMatch(/reclaimExpiredLeases\s*\(/);

    // The SQL shape is correct
    expect(queueWorker).toContain('UPDATE workflow_jobs');
    expect(queueWorker).toContain("status = 'QUEUED'");
    expect(queueWorker).toContain('"ownerInstanceId" = NULL');
    expect(queueWorker).toContain('"leaseExpiresAt" = NULL');
    expect(queueWorker).toContain('"availableAt" = NOW()');
    expect(queueWorker).toContain("WHERE status = 'ACTIVE'");
    expect(queueWorker).toContain('"leaseExpiresAt" < NOW()');

    // Reclaim runs on every poll tick (not lazily, not only at startup)
    expect(queueWorker).toMatch(/await\s+this\.reclaimExpiredLeases/);

    // In-flight guard prevents duplicate sweeps on slow DBs
    expect(queueWorker).toContain('reclaimInProgress');

    // Metric incremented so Grafana alerts can fire
    expect(queueWorker).toContain('workflowJobsReclaimedTotal');
    expect(queueWorker).toContain('reclaimer_instance');

    // Operator log when reclaim fires — so you know when it happens in prod
    expect(queueWorker).toMatch(/Reclaimed expired leases/);
  });

  it('P1b: claim path tags rows with ownerInstanceId + leaseExpiresAt + lastHeartbeatAt', () => {
    const queueWorker = readRepoFile('apps/api/src/services/queue-worker.ts');

    // Claim SQL sets all three ownership fields in one atomic update
    expect(queueWorker).toContain('"ownerInstanceId" = $1');
    expect(queueWorker).toContain('"leaseExpiresAt" = NOW() + ($2 || \' seconds\')::interval');
    // Heartbeat is renewed on claim AND periodically thereafter
    expect(queueWorker).toMatch(/lastHeartbeatAt/);

    // FOR UPDATE SKIP LOCKED means two instances polling simultaneously
    // can't both claim the same row — the foundation of the safety story
    expect(queueWorker).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('P1b: worker publishes its instance identity via WORKFLOW_WORKER_INSTANCE_ID', () => {
    const workerEntry = readRepoFile('apps/api/src/worker-entry.ts');

    // worker-entry reads the env var so reclaim logs + metrics correlate
    // with specific Render instances
    expect(workerEntry).toContain('WORKFLOW_WORKER_INSTANCE_ID');
    // Falls back to HOSTNAME or synthesized worker-$pid (safe default)
    expect(workerEntry).toMatch(/HOSTNAME|worker-\$/);
  });
});
