/**
 * Cockpit-critical event emission test.
 *
 * Pins the fix for the gap where the engine never emitted plan_created /
 * worker_started / worker_completed, leaving the cockpit's plan render +
 * per-task IN_PROGRESS -> COMPLETED progression dead against the real
 * backend (the e2e mock fabricated them, masking the gap).
 *
 * These tests exercise planner-node and worker-node directly with a fake
 * agent (no LLM) and assert the three events fire through the activity
 * emitter side-channel the SSE bridge already forwards via onAgentActivity.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentActivityEvent } from '@jak-swarm/agents';

const TEST_WF = 'wf_cockpit_events_test';

// Mutable behavior switch so the failure case can flip the fake agent
// without vi.resetModules (which would reset the activity-registry and
// lose the emitter registration). Hoisted so vi.mock can reference it.
const { agentBehavior } = vi.hoisted(() => ({ agentBehavior: { fail: false } }));

vi.mock('../../../packages/swarm/src/graph/nodes/worker/agent-factory.js', () => ({
  createWorkerAgent: () => ({
    execute: async () => {
      if (agentBehavior.fail) throw new Error('boom');
      return { result: 'ok', taskId: 'task_1' };
    },
    reflectAndCorrect: async () => ({ corrected: '', wasChanged: false }),
  }),
}));

vi.mock('@jak-swarm/agents', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    PlannerAgent: class {
      async execute() {
        return {
          plan: {
            goal: 'Test goal',
            tasks: [
              {
                id: 'task_1',
                name: 'First task',
                description: 'do something',
                agentRole: 'WORKER_RESEARCH',
                dependsOn: [] as string[],
                status: 'pending',
                riskLevel: 'LOW',
                requiresApproval: false,
              },
            ],
          },
        };
      }
    },
  };
});

describe('cockpit-critical event emission (plan_created / worker_started / worker_completed)', () => {
  beforeEach(() => {
    agentBehavior.fail = false;
  });
  afterEach(() => {
    agentBehavior.fail = false;
  });

  it('planner-node emits plan_created with the plan payload', async () => {
    const { registerActivityEmitter, clearActivityEmitter } = await import(
      '../../../packages/swarm/src/supervisor/activity-registry.js'
    );
    const events: AgentActivityEvent[] = [];
    registerActivityEmitter(TEST_WF, (ev) => events.push(ev));
    try {
      const { plannerNode } = await import('../../../packages/swarm/src/graph/nodes/planner-node.js');
      await plannerNode({
        workflowId: TEST_WF,
        tenantId: 'tnt_test',
        userId: 'usr_test',
        missionBrief: 'Plan: do something useful',
      } as never);

      const planEvent = events.find((e) => e.type === 'plan_created');
      expect(planEvent, 'planner must emit plan_created').toBeDefined();
      if (planEvent && planEvent.type === 'plan_created') {
        expect(planEvent.planId).toBe(TEST_WF + '-plan');
        expect(planEvent.plan.tasks.length).toBe(1);
        expect(planEvent.plan.tasks[0]).toMatchObject({ id: 'task_1', name: 'First task' });
      }
    } finally {
      clearActivityEmitter(TEST_WF);
    }
  });

  it('worker-node emits worker_started then worker_completed with success + duration', async () => {
    const { registerActivityEmitter, clearActivityEmitter } = await import(
      '../../../packages/swarm/src/supervisor/activity-registry.js'
    );
    const events: AgentActivityEvent[] = [];
    registerActivityEmitter(TEST_WF, (ev) => events.push(ev));
    try {
      const { workerNode } = await import('../../../packages/swarm/src/graph/nodes/worker-node.js');
      await workerNode({
        workflowId: TEST_WF,
        tenantId: 'tnt_test',
        userId: 'usr_test',
        currentTaskIndex: 0,
        taskResults: {},
        plan: {
          goal: 'Test goal',
          tasks: [
            {
              id: 'task_1',
              name: 'First task',
              description: 'do something',
              agentRole: 'WORKER_RESEARCH',
              dependsOn: [],
              status: 'pending',
              riskLevel: 'LOW',
              requiresApproval: false,
            },
          ],
        },
      } as never);

      const started = events.find((e) => e.type === 'worker_started');
      const completed = events.find((e) => e.type === 'worker_completed');
      expect(started, 'worker must emit worker_started').toBeDefined();
      expect(completed, 'worker must emit worker_completed').toBeDefined();
      if (started && started.type === 'worker_started') {
        expect(started.taskId).toBe('task_1');
        expect(started.taskName).toBe('First task');
        expect(started.agentRole).toBe('WORKER_RESEARCH');
      }
      if (completed && completed.type === 'worker_completed') {
        expect(completed.taskId).toBe('task_1');
        expect(completed.agentRole).toBe('WORKER_RESEARCH');
        expect(completed.success).toBe(true);
        expect(completed.durationMs).toBeGreaterThanOrEqual(0);
      }
      expect(events.indexOf(started!)).toBeLessThan(events.indexOf(completed!));
    } finally {
      clearActivityEmitter(TEST_WF);
    }
  });

  it('worker_completed carries success=false + error when the agent fails', async () => {
    const { registerActivityEmitter, clearActivityEmitter } = await import(
      '../../../packages/swarm/src/supervisor/activity-registry.js'
    );
    const events: AgentActivityEvent[] = [];
    registerActivityEmitter(TEST_WF, (ev) => events.push(ev));
    agentBehavior.fail = true;
    try {
      const { workerNode } = await import('../../../packages/swarm/src/graph/nodes/worker-node.js');
      await workerNode({
        workflowId: TEST_WF,
        tenantId: 'tnt_test',
        userId: 'usr_test',
        currentTaskIndex: 0,
        taskResults: {},
        plan: {
          goal: 'g',
          tasks: [
            {
              id: 'task_1',
              name: 'First task',
              description: 'd',
              agentRole: 'WORKER_RESEARCH',
              dependsOn: [],
              status: 'pending',
              riskLevel: 'LOW',
              requiresApproval: false,
            },
          ],
        },
      } as never);

      const completed = events.find((e) => e.type === 'worker_completed');
      expect(completed, 'worker must still emit worker_completed on failure').toBeDefined();
      if (completed && completed.type === 'worker_completed') {
        expect(completed.success).toBe(false);
        expect(completed.error).toBeTruthy();
      }
    } finally {
      agentBehavior.fail = false;
      clearActivityEmitter(TEST_WF);
    }
  });
});