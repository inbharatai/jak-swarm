import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryWorkflowSignalBus,
  type WorkflowSignal,
} from '../../../apps/api/src/coordination/workflow-signals.js';
import {
  InMemoryLockProvider,
  withLock,
} from '../../../apps/api/src/coordination/distributed-lock.js';

/**
 * Behavioral test for the unpause signal handler logic that lives in
 * apps/api/src/plugins/swarm.plugin.ts (and mirrored in apps/api/src/worker-entry.ts).
 *
 * The handler shape is reproduced here so we can exercise it without booting Fastify.
 * If the handler in either of those files diverges from this shape, this test will not
 * catch the drift — that's covered by integration tests in Phase 7.
 */
function wireSubscriber(
  bus: InMemoryWorkflowSignalBus,
  locks: InMemoryLockProvider,
  swarmService: {
    pauseWorkflow: (id: string) => void;
    stopWorkflow: (id: string) => void;
    unpauseWorkflow: (id: string) => void;
    resumeWorkflow: (id: string) => Promise<void>;
  },
  onSkippedByOtherInstance?: (workflowId: string) => void,
): void {
  bus.subscribe((signal: WorkflowSignal) => {
    if (signal.type === 'pause') {
      swarmService.pauseWorkflow(signal.workflowId);
    } else if (signal.type === 'stop') {
      swarmService.stopWorkflow(signal.workflowId);
    } else if (signal.type === 'unpause') {
      swarmService.unpauseWorkflow(signal.workflowId);
      void (async () => {
        const acquired = await withLock(locks, `resume:${signal.workflowId}`, 60_000, async () => {
          await swarmService.resumeWorkflow(signal.workflowId);
          return true;
        });
        if (acquired === null) {
          onSkippedByOtherInstance?.(signal.workflowId);
        }
      })();
    }
  });
}

function makeSwarmServiceMock() {
  return {
    pauseWorkflow: vi.fn<(id: string) => void>(),
    stopWorkflow: vi.fn<(id: string) => void>(),
    unpauseWorkflow: vi.fn<(id: string) => void>(),
    resumeWorkflow: vi.fn<(id: string) => Promise<void>>(async () => {}),
  };
}

async function settle(): Promise<void> {
  // Allow `void (async () => …)()` blocks fired inside subscriber to flush.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('unpause signal handler (Phase 1a behavioral)', () => {
  it('on receiving unpause: calls unpauseWorkflow then resumeWorkflow under a lock', async () => {
    const bus = new InMemoryWorkflowSignalBus();
    const locks = new InMemoryLockProvider();
    const swarm = makeSwarmServiceMock();

    wireSubscriber(bus, locks, swarm);

    await bus.publish({
      type: 'unpause',
      workflowId: 'wf-A',
      issuedBy: 'user-1',
      timestamp: new Date().toISOString(),
    });
    await settle();

    expect(swarm.unpauseWorkflow).toHaveBeenCalledTimes(1);
    expect(swarm.unpauseWorkflow).toHaveBeenCalledWith('wf-A');
    expect(swarm.resumeWorkflow).toHaveBeenCalledTimes(1);
    expect(swarm.resumeWorkflow).toHaveBeenCalledWith('wf-A');
  });

  it('with a shared lock provider, only ONE subscriber actually resumes (multi-instance safety)', async () => {
    // Two "instances" sharing one lock provider (simulating Redis-backed lock in prod)
    // but each with its own bus+swarmService (simulating per-process state).
    const bus = new InMemoryWorkflowSignalBus();
    const sharedLocks = new InMemoryLockProvider();

    const swarmA = makeSwarmServiceMock();
    const swarmB = makeSwarmServiceMock();

    let aSkipped = false;
    let bSkipped = false;
    wireSubscriber(bus, sharedLocks, swarmA, () => { aSkipped = true; });
    wireSubscriber(bus, sharedLocks, swarmB, () => { bSkipped = true; });

    await bus.publish({
      type: 'unpause',
      workflowId: 'wf-shared',
      issuedBy: 'user-1',
      timestamp: new Date().toISOString(),
    });
    await settle();

    // unpauseWorkflow is idempotent and called on every instance (Set.delete is safe to repeat).
    expect(swarmA.unpauseWorkflow).toHaveBeenCalledTimes(1);
    expect(swarmB.unpauseWorkflow).toHaveBeenCalledTimes(1);

    // resumeWorkflow must run on EXACTLY ONE instance — the lock winner.
    const totalResumes =
      swarmA.resumeWorkflow.mock.calls.length + swarmB.resumeWorkflow.mock.calls.length;
    expect(totalResumes).toBe(1);

    // The other instance must observe that it was skipped.
    expect([aSkipped, bSkipped].filter(Boolean)).toHaveLength(1);
  });

  it('pause and stop signals do NOT trigger resumeWorkflow', async () => {
    const bus = new InMemoryWorkflowSignalBus();
    const locks = new InMemoryLockProvider();
    const swarm = makeSwarmServiceMock();

    wireSubscriber(bus, locks, swarm);

    await bus.publish({ type: 'pause', workflowId: 'wf-1', issuedBy: 'u', timestamp: new Date().toISOString() });
    await bus.publish({ type: 'stop', workflowId: 'wf-1', issuedBy: 'u', timestamp: new Date().toISOString() });
    await settle();

    expect(swarm.pauseWorkflow).toHaveBeenCalledTimes(1);
    expect(swarm.stopWorkflow).toHaveBeenCalledTimes(1);
    expect(swarm.resumeWorkflow).not.toHaveBeenCalled();
    expect(swarm.unpauseWorkflow).not.toHaveBeenCalled();
  });
});
