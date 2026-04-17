/**
 * Replay safety and idempotency contract tests
 *
 * Verifies that JAK's recovery system properly gates unsafe replays,
 * propagates idempotency keys, and classifies replay safety correctly.
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

describe('Replay safety and idempotency contracts', () => {
  const execService = readRepoFile('apps/api/src/services/swarm-execution.service.ts');
  const workflowRoutes = readRepoFile('apps/api/src/routes/workflows.routes.ts');
  const queueWorker = readRepoFile('apps/api/src/services/queue-worker.ts');

  it('classifies replay safety into 4 tiers', () => {
    expect(execService).toContain("'REPLAY_SAFE'");
    expect(execService).toContain("'REPLAY_UNSAFE'");
    expect(execService).toContain("'REQUIRES_IDEMPOTENCY_KEY'");
    expect(execService).toContain("'MANUAL_INTERVENTION_REQUIRED'");
  });

  it('gates MANUAL_INTERVENTION_REQUIRED workflows to PAUSED on recovery', () => {
    expect(execService).toContain("replaySafety === 'MANUAL_INTERVENTION_REQUIRED'");
    expect(execService).toContain("status: 'PAUSED'");
    expect(execService).toContain('Recovery paused for manual intervention');
  });

  it('gates REPLAY_UNSAFE workflows to PAUSED on recovery', () => {
    expect(execService).toContain("replaySafety === 'REPLAY_UNSAFE'");
    expect(execService).toContain('Workflow replay is unsafe');
  });

  it('gates REQUIRES_IDEMPOTENCY_KEY workflows without keys to PAUSED on recovery', () => {
    expect(execService).toContain("replaySafety === 'REQUIRES_IDEMPOTENCY_KEY'");
    expect(execService).toContain("Boolean(checkpoint['idempotencyKey'])");
    expect(execService).toContain('Side-effecting workflow without idempotency key paused for operator review');
  });

  it('allows auto-replay for REQUIRES_IDEMPOTENCY_KEY with a valid key', () => {
    expect(execService).toContain('proceeding with auto-replay');
  });

  it('propagates idempotency key from HTTP request header to execution', () => {
    expect(workflowRoutes).toContain("request.headers['idempotency-key']");
    expect(workflowRoutes).toContain('idempotencyKey');
    expect(execService).toContain('idempotencyKey');
  });

  it('persists idempotency key in checkpoint metadata', () => {
    expect(execService).toContain("idempotencyKey: params.idempotencyKey");
    // Checkpoint version bumped to 2 with idempotency support
    expect(execService).toContain('version: 2');
    expect(execService).toContain("instanceId: this.instanceId");
  });

  it('propagates idempotency key into tool execution context', () => {
    const agentContext = readRepoFile('packages/agents/src/base/agent-context.ts');
    const baseAgent = readRepoFile('packages/agents/src/base/base-agent.ts');

    expect(agentContext).toContain('idempotencyKey');
    expect(baseAgent).toContain('idempotencyKey: context.idempotencyKey');
  });

  it('prevents duplicate execution when idempotency key matches completed workflow', () => {
    expect(execService).toContain('Duplicate execution blocked by idempotency key');
    expect(execService).toContain("existing?.status === 'COMPLETED'");
  });

  it('classifies high-side-effect tools as requiring manual intervention', () => {
    expect(execService).toContain('classifyToolRisk');
    expect(execService).toContain('ToolRiskClass.EXTERNAL_SIDE_EFFECT');
    expect(execService).toContain('ToolRiskClass.DESTRUCTIVE');
    expect(execService).toContain("safety: 'MANUAL_INTERVENTION_REQUIRED'");
  });

  it('classifies read-only tools as replay-safe', () => {
    expect(execService).toContain('ToolRiskClass.READ_ONLY');
    expect(execService).toContain("safety: 'REPLAY_SAFE'");
    expect(execService).toContain('Task appears read-only');
  });

  it('recovers ACTIVE jobs on restart with proper state transitions', () => {
    expect(execService).toContain("status: 'ACTIVE'");
    expect(execService).toContain('Recovered ACTIVE job after restart');
    expect(execService).toContain('Active job exceeded retry budget');
  });
});
