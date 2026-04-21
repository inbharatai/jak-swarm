/**
 * Parallel-dispatch proof — verifies that SwarmGraph.runParallel actually
 * dispatches independent same-layer tasks concurrently, not serially.
 *
 * The existing task-scheduler.test.ts proves that getReadyTasks() returns
 * all dependency-free tasks at once. This file proves the next claim
 * downstream: once those tasks are returned, the graph fires them
 * concurrently via Promise.allSettled. The proof is a timestamp comparison:
 *
 *    If dispatch is truly parallel, N tasks that each sleep(50ms) complete
 *    in ~50ms total. If it's accidentally serial, they take ~N*50ms.
 *
 * We cannot use the real agent pipeline in a unit test (needs LLM keys,
 * DB, etc.), so the test instruments SwarmGraph with a stubbed
 * executeTaskPipeline that records start/end timestamps per task and
 * sleeps a known delay. This tests the dispatch behaviour in isolation
 * without touching real workers.
 */
import { describe, it, expect, vi } from 'vitest';
import { SwarmGraph } from '@jak-swarm/swarm';
import { createInitialSwarmState } from '@jak-swarm/swarm';
import { AgentRole, RiskLevel, WorkflowStatus, TaskStatus, type WorkflowTask, type WorkflowPlan } from '@jak-swarm/shared';

function mkTask(id: string, deps: string[] = []): WorkflowTask {
  return {
    id,
    name: id,
    description: id,
    agentRole: AgentRole.WORKER_RESEARCH,
    tools: [],
    dependsOn: deps,
    riskLevel: RiskLevel.LOW,
    requiresApproval: false,
    status: TaskStatus.PENDING,
  } as WorkflowTask;
}

function mkPlan(tasks: WorkflowTask[]): WorkflowPlan {
  return { goal: 'parallel-test', tasks, estimatedDurationMs: 1000, estimatedCostUsd: 0 };
}

describe('SwarmGraph — parallel dispatch', () => {
  it('dispatches 3 independent tasks concurrently (wall-clock < sum of individual delays)', async () => {
    const graph = new SwarmGraph();

    const DELAY_PER_TASK_MS = 60;
    const startTimes: Record<string, number> = {};
    const endTimes: Record<string, number> = {};

    // Stub executeTaskPipeline so we don't need real agents/LLM.
    // Critical: the stub awaits its delay WITHOUT yielding a synchronous
    // result, so parallelism can be observed via start-time clustering.
    vi.spyOn(graph as unknown as { executeTaskPipeline: (...args: unknown[]) => unknown }, 'executeTaskPipeline').mockImplementation(
      async (_state: unknown, task: WorkflowTask) => {
        startTimes[task.id] = Date.now();
        await new Promise((r) => setTimeout(r, DELAY_PER_TASK_MS));
        endTimes[task.id] = Date.now();
        return {
          taskId: task.id,
          updates: { taskResults: { [task.id]: { ok: true } } },
          success: true,
        };
      },
    );

    // Build a state that skips the commander/planner phase and jumps
    // straight into parallel execution. We do this by pre-setting the plan.
    const state = createInitialSwarmState({
      goal: 'parallel test',
      tenantId: 'test',
      userId: 'test',
      workflowId: 'wf_parallel',
    });
    state.plan = mkPlan([
      mkTask('a'),
      mkTask('b'),
      mkTask('c'),
    ]);
    // Simulate that planning is already done.
    // runParallel still runs commander/planner/router — we stub those nodes too.
    const noOp = async () => ({});
    const graphUnsafe = graph as unknown as {
      nodes: Map<string, (state: unknown) => Promise<unknown>>;
    };
    graphUnsafe.nodes.set('commander', noOp);
    graphUnsafe.nodes.set('planner', noOp);
    graphUnsafe.nodes.set('router', noOp);

    const wallClockStart = Date.now();
    const result = await graph.runParallel(state);
    const wallClockTotal = Date.now() - wallClockStart;

    // All three tasks should have run
    expect(Object.keys(startTimes).sort()).toEqual(['a', 'b', 'c']);

    // Invariant: wall-clock total < sum of individual delays (proves parallel)
    // We allow 2x margin for scheduler jitter / setTimeout granularity.
    expect(wallClockTotal).toBeLessThan(DELAY_PER_TASK_MS * 2.5);

    // Invariant: the 3 start timestamps are clustered within a few ms of each
    // other — they were all fired in the same event-loop turn.
    const starts = [startTimes.a, startTimes.b, startTimes.c];
    const startSpread = Math.max(...starts) - Math.min(...starts);
    expect(startSpread).toBeLessThan(30); // all started within ~30ms of each other

    // Sanity: the workflow didn't fail
    expect(result.status).not.toBe(WorkflowStatus.FAILED);
  }, 5000);

  it('emits parallel:dispatch event with readyTaskCount + parallelizationFactor', async () => {
    const graph = new SwarmGraph();
    const events: Array<Record<string, unknown>> = [];
    graph.on('parallel:dispatch', (event: Record<string, unknown>) => {
      events.push(event);
    });

    vi.spyOn(graph as unknown as { executeTaskPipeline: (...args: unknown[]) => unknown }, 'executeTaskPipeline').mockImplementation(
      async (_state: unknown, task: WorkflowTask) => {
        await new Promise((r) => setTimeout(r, 5));
        return {
          taskId: task.id,
          updates: { taskResults: { [task.id]: { ok: true } } },
          success: true,
        };
      },
    );

    const state = createInitialSwarmState({
      goal: 'event test',
      tenantId: 'test',
      userId: 'test',
      workflowId: 'wf_event',
    });
    state.plan = mkPlan([
      mkTask('a'),
      mkTask('b'),
      mkTask('c'),
      mkTask('d'),
    ]);
    const noOp = async () => ({});
    const gu = graph as unknown as { nodes: Map<string, unknown> };
    gu.nodes.set('commander', noOp);
    gu.nodes.set('planner', noOp);
    gu.nodes.set('router', noOp);

    await graph.runParallel(state);

    // Exactly one parallel:dispatch event should fire (4 ready tasks, all fired in one wave).
    expect(events.length).toBe(1);
    expect(events[0]?.readyTaskCount).toBe(4);
    expect(events[0]?.batchCount).toBe(1);
    expect(events[0]?.maxConcurrent).toBe(5);
    expect(events[0]?.parallelizationFactor).toBe(4);
    expect(events[0]?.workflowId).toBe('wf_event');
  });

  it('does NOT emit parallel:dispatch when only a single task is ready (no parallelism to report)', async () => {
    const graph = new SwarmGraph();
    const events: unknown[] = [];
    graph.on('parallel:dispatch', (e: unknown) => events.push(e));

    vi.spyOn(graph as unknown as { executeTaskPipeline: (...args: unknown[]) => unknown }, 'executeTaskPipeline').mockImplementation(
      async (_state: unknown, task: WorkflowTask) => {
        await new Promise((r) => setTimeout(r, 5));
        return {
          taskId: task.id,
          updates: { taskResults: { [task.id]: { ok: true } } },
          success: true,
        };
      },
    );

    const state = createInitialSwarmState({
      goal: 'solo test',
      tenantId: 'test',
      userId: 'test',
      workflowId: 'wf_solo',
    });
    // Chain of tasks — each depends on the previous, so only 1 ready at a time.
    state.plan = mkPlan([
      mkTask('a'),
      mkTask('b', ['a']),
      mkTask('c', ['b']),
    ]);
    const noOp = async () => ({});
    const gu = graph as unknown as { nodes: Map<string, unknown> };
    gu.nodes.set('commander', noOp);
    gu.nodes.set('planner', noOp);
    gu.nodes.set('router', noOp);

    await graph.runParallel(state);

    expect(events.length).toBe(0);
  });
});
