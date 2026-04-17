/**
 * Worker lifecycle contract tests
 *
 * Verifies the QueueWorker module provides a clean execution boundary
 * with explicit lifecycle transitions, observability, and fault handling.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('QueueWorker lifecycle contracts', () => {
  const queueWorker = readRepoFile('apps/api/src/services/queue-worker.ts');
  const execService = readRepoFile('apps/api/src/services/swarm-execution.service.ts');
  const swarmPlugin = readRepoFile('apps/api/src/plugins/swarm.plugin.ts');
  const workflowRoutes = readRepoFile('apps/api/src/routes/workflows.routes.ts');
  const workerEntry = readRepoFile('apps/api/src/worker-entry.ts');

  it('provides a standalone QueueWorker class with explicit lifecycle methods', () => {
    expect(queueWorker).toContain('export class QueueWorker');
    expect(queueWorker).toContain('start(): void');
    expect(queueWorker).toContain('stop(): void');
    expect(queueWorker).toContain('async drain(): Promise<void>');
    expect(queueWorker).toContain('health(): WorkerHealth');
  });

  it('claims jobs atomically with SKIP LOCKED', () => {
    expect(queueWorker).toContain('FOR UPDATE SKIP LOCKED');
    expect(queueWorker).toContain("status = 'ACTIVE'");
    expect(queueWorker).toContain('w.attempts + 1');
  });

  it('implements explicit job state transitions: claim → complete/retry/dead', () => {
    // Complete transition
    expect(queueWorker).toContain("status: 'COMPLETED'");
    expect(queueWorker).toContain('completedAt: new Date()');

    // Retry with backoff
    expect(queueWorker).toContain("status: 'QUEUED'");
    expect(queueWorker).toContain('Math.min(60_000, 1000 * Math.pow(2');
    expect(queueWorker).toContain('job.attempts < job.maxAttempts');

    // Dead-letter
    expect(queueWorker).toContain("status: 'DEAD'");
    expect(queueWorker).toContain("'[QueueWorker] Job moved to dead-letter state'");
  });

  it('emits structured lifecycle events for observability', () => {
    expect(queueWorker).toContain("this.emit('job:claimed'");
    expect(queueWorker).toContain("this.emit('job:completed'");
    expect(queueWorker).toContain("this.emit('job:retried'");
    expect(queueWorker).toContain("this.emit('job:dead'");
    expect(queueWorker).toContain("this.emit('started')");
    expect(queueWorker).toContain("this.emit('drained')");
  });

  it('provides health reporting with counters and uptime', () => {
    expect(queueWorker).toContain('claimedTotal');
    expect(queueWorker).toContain('completedTotal');
    expect(queueWorker).toContain('failedTotal');
    expect(queueWorker).toContain('deadTotal');
    expect(queueWorker).toContain('uptimeMs');
    expect(queueWorker).toContain('lastPollAt');

    // WorkerHealth interface is exported
    expect(queueWorker).toContain('export interface WorkerHealth');
  });

  it('delegates from SwarmExecutionService to QueueWorker', () => {
    expect(execService).toContain("import { QueueWorker } from './queue-worker.js'");
    expect(execService).toContain('this.queueWorker = new QueueWorker(');
    expect(execService).toContain('this.queueWorker.start()');
    expect(execService).toContain('this.queueWorker.stop()');
    expect(execService).toContain('this.queueWorker.drain()');
    expect(execService).toContain('this.queueWorker.health()');
  });

  it('supports graceful shutdown via drain in swarm plugin', () => {
    expect(swarmPlugin).toContain('drainQueueWorker');
    expect(swarmPlugin).toContain('stopQueueWorker');
    expect(swarmPlugin).toContain('Graceful shutdown');
  });

  it('exposes worker health endpoint for operators', () => {
    expect(workflowRoutes).toContain("'/queue/health'");
    expect(workflowRoutes).toContain('getWorkerHealth()');
    expect(workflowRoutes).toContain("fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')");
  });

  it('supports configurable concurrency and poll interval', () => {
    expect(queueWorker).toContain('WORKFLOW_QUEUE_CONCURRENCY');
    expect(queueWorker).toContain('WORKFLOW_QUEUE_POLL_INTERVAL_MS');
    expect(queueWorker).toContain('shutdownGracePeriodMs');
  });

  it('supports standalone worker mode with dedicated entrypoint', () => {
    expect(workerEntry).toContain('Queue worker started');
    expect(workerEntry).toContain('SwarmExecutionService');
    expect(swarmPlugin).toContain('workflowWorkerMode');
    expect(swarmPlugin).toContain('Queue worker disabled in API process');
  });
});
