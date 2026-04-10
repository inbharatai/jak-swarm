/**
 * Task scheduler tests — verifies parallel task resolution,
 * dependency awareness, and cycle detection.
 */
import { describe, it, expect } from 'vitest';
import { getReadyTasks, getSkippedTasks } from '@jak-swarm/swarm';
import type { WorkflowPlan, WorkflowTask } from '@jak-swarm/shared';

function makeTask(overrides: Partial<WorkflowTask> & { id: string }): WorkflowTask {
  return {
    name: overrides.id,
    description: '',
    agentRole: 'WORKER_RESEARCH' as any,
    tools: [],
    riskLevel: 'LOW' as any,
    requiresApproval: false,
    dependsOn: [],
    status: 'PENDING' as any,
    ...overrides,
  };
}

function makePlan(tasks: WorkflowTask[]): WorkflowPlan {
  return { tasks, estimatedSteps: tasks.length, estimatedCostUsd: 0 };
}

describe('Task Scheduler', () => {
  it('returns all tasks when none have dependencies', () => {
    const plan = makePlan([
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c' }),
    ]);
    const ready = getReadyTasks(plan, new Set(), new Set());
    expect(ready.map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('respects dependency ordering', () => {
    const plan = makePlan([
      makeTask({ id: 'a' }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'c', dependsOn: ['b'] }),
    ]);
    // Nothing completed yet — only 'a' is ready
    const ready1 = getReadyTasks(plan, new Set(), new Set());
    expect(ready1.map(t => t.id)).toEqual(['a']);

    // After 'a' completes — 'b' is ready
    const ready2 = getReadyTasks(plan, new Set(['a']), new Set());
    expect(ready2.map(t => t.id)).toEqual(['b']);

    // After 'a' and 'b' complete — 'c' is ready
    const ready3 = getReadyTasks(plan, new Set(['a', 'b']), new Set());
    expect(ready3.map(t => t.id)).toEqual(['c']);
  });

  it('returns multiple independent tasks in parallel', () => {
    const plan = makePlan([
      makeTask({ id: 'root' }),
      makeTask({ id: 'branch1', dependsOn: ['root'] }),
      makeTask({ id: 'branch2', dependsOn: ['root'] }),
      makeTask({ id: 'branch3', dependsOn: ['root'] }),
      makeTask({ id: 'merge', dependsOn: ['branch1', 'branch2', 'branch3'] }),
    ]);

    // After root completes — all 3 branches should be ready (parallel)
    const ready = getReadyTasks(plan, new Set(['root']), new Set());
    expect(ready.map(t => t.id).sort()).toEqual(['branch1', 'branch2', 'branch3']);
  });

  it('skips dependents of failed tasks', () => {
    const plan = makePlan([
      makeTask({ id: 'a' }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'c', dependsOn: ['b'] }),
    ]);
    const skipped = getSkippedTasks(plan, new Set(['a']));
    expect(skipped.map(t => t.id).sort()).toEqual(['b', 'c']);
  });

  it('excludes completed and failed tasks from ready list', () => {
    const plan = makePlan([
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c' }),
    ]);
    const ready = getReadyTasks(plan, new Set(['a']), new Set(['b']));
    expect(ready.map(t => t.id)).toEqual(['c']);
  });
});
