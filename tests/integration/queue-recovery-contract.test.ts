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
});
