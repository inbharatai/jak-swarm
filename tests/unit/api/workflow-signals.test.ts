import { describe, expect, it } from 'vitest';
import {
  InMemoryWorkflowSignalBus,
  type WorkflowSignal,
} from '../../../apps/api/src/coordination/workflow-signals.js';

describe('WorkflowSignalBus', () => {
  it('delivers pause/unpause/stop signals to subscribers', async () => {
    const bus = new InMemoryWorkflowSignalBus();
    const received: WorkflowSignal[] = [];
    bus.subscribe((s) => { received.push(s); });

    await bus.publish({ type: 'pause', workflowId: 'wf1', issuedBy: 'u1', timestamp: new Date().toISOString() });
    await bus.publish({ type: 'unpause', workflowId: 'wf1', issuedBy: 'u1', timestamp: new Date().toISOString() });
    await bus.publish({ type: 'stop', workflowId: 'wf1', issuedBy: 'u1', timestamp: new Date().toISOString() });

    expect(received.map((s) => s.type)).toEqual(['pause', 'unpause', 'stop']);
  });

  it('accepts "unpause" as a valid signal type (regression: was missing before Phase 1a)', async () => {
    const bus = new InMemoryWorkflowSignalBus();
    let heard: WorkflowSignal | null = null;
    bus.subscribe((s) => { heard = s; });

    const unpauseSignal: WorkflowSignal = {
      type: 'unpause',
      workflowId: 'wf1',
      issuedBy: 'user-a',
      timestamp: new Date().toISOString(),
    };
    await bus.publish(unpauseSignal);

    expect(heard).toEqual(unpauseSignal);
  });

  it('delivers to every subscribed handler (multi-instance fan-out)', async () => {
    const bus = new InMemoryWorkflowSignalBus();
    const instanceA: WorkflowSignal[] = [];
    const instanceB: WorkflowSignal[] = [];
    bus.subscribe((s) => { instanceA.push(s); });
    bus.subscribe((s) => { instanceB.push(s); });

    await bus.publish({ type: 'unpause', workflowId: 'wf1', issuedBy: 'u1', timestamp: new Date().toISOString() });

    expect(instanceA).toHaveLength(1);
    expect(instanceB).toHaveLength(1);
    expect(instanceA[0]?.type).toBe('unpause');
    expect(instanceB[0]?.type).toBe('unpause');
  });
});
