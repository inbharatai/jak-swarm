/**
 * Item 10 — per-tool approval gate actually pauses the workflow.
 *
 * Pre-fix: the tool-execution loop emitted a `tool_approval_required`
 * activity (which persists an ApprovalRequest row) but then CONTINUED the
 * LLM tool loop — handing the model a fake "wait for the user" message and
 * letting it burn iterations on a tool that would never run until a human
 * decided. The workflow then completed with a degraded answer while the
 * approval sat in the inbox. The task was marked COMPLETED (or FAILED),
 * never an honest "blocked on approval" state.
 *
 * Post-fix: the loop throws ToolApprovalRequiredError, which propagates up
 * through the circuit breaker to the worker node. The worker node catches
 * it SPECIFICALLY (before the generic repair-service failure path) and:
 *   1. Does NOT call RepairService.evaluate (approval is not retryable).
 *   2. Marks the plan task TaskStatus.AWAITING_APPROVAL (not FAILED).
 *   3. Returns workflow status WorkflowStatus.AWAITING_APPROVAL.
 *   4. Emits worker_completed with awaitingApproval:true + the tool name.
 *
 * This test mocks the agent factory so the worker agent's execute() throws
 * a real ToolApprovalRequiredError, then asserts the full honest-state
 * contract above. No LLM, no DB — pure orchestration behavior.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentActivityEvent } from '@jak-swarm/agents';
import { WorkflowStatus, TaskStatus } from '@jak-swarm/shared';

const TEST_WF = 'wf_approval_gate_test';

// Hoisted behavior switch + captured approval payload so the mock agent
// factory can throw a real ToolApprovalRequiredError without resetting
// modules (which would drop the activity-registry emitter registration).
const { gate } = vi.hoisted(() => ({
  gate: { throwApproval: true, toolName: 'gmail_send_email', category: 'EXTERNAL_POST', reason: 'Sending email requires approval.', inputSummary: '{"to":"a@b.c"}' },
}));

vi.mock('../../../packages/swarm/src/graph/nodes/worker/agent-factory.js', () => ({
  createWorkerAgent: () => ({
    execute: async () => {
      if (gate.throwApproval) {
        // Lazy import keeps the class identity identical to the one the
        // worker node imports from '@jak-swarm/agents' (vitest aliases the
        // package to source). Constructed at call time, not hoist time.
        const { ToolApprovalRequiredError } = await import('@jak-swarm/agents');
        throw new ToolApprovalRequiredError({
          toolName: gate.toolName,
          category: gate.category,
          reason: gate.reason,
          inputSummary: gate.inputSummary,
        });
      }
      return { result: 'ok', taskId: 'task_gate' };
    },
    reflectAndCorrect: async () => ({ corrected: '', wasChanged: false }),
  }),
}));

describe('worker-node per-tool approval gate (Item 10)', () => {
  beforeEach(() => {
    gate.throwApproval = true;
  });
  afterEach(() => {
    gate.throwApproval = true;
  });

  it('marks the task AWAITING_APPROVAL + workflow AWAITING_APPROVAL when the agent throws ToolApprovalRequiredError', async () => {
    const { registerActivityEmitter, clearActivityEmitter } = await import(
      '../../../packages/swarm/src/supervisor/activity-registry.js'
    );
    const events: AgentActivityEvent[] = [];
    registerActivityEmitter(TEST_WF, (ev) => events.push(ev));
    try {
      const { workerNode } = await import('../../../packages/swarm/src/graph/nodes/worker-node.js');
      const out = await workerNode({
        workflowId: TEST_WF,
        tenantId: 'tnt_test',
        userId: 'usr_test',
        currentTaskIndex: 0,
        taskResults: {},
        plan: {
          goal: 'Send a launch email',
          tasks: [
            {
              id: 'task_gate',
              name: 'Send launch email',
              description: 'Send the launch announcement email',
              agentRole: 'WORKER_EMAIL',
              dependsOn: [],
              status: 'pending',
              riskLevel: 'HIGH',
              requiresApproval: true,
            },
          ],
        },
      } as never);

      // Honest workflow state — paused on human approval, not VERIFYING.
      expect(out.status).toBe(WorkflowStatus.AWAITING_APPROVAL);
      // Honest error surfaces the approval reason.
      expect(out.error).toContain('approval required');
      // The plan task is AWAITING_APPROVAL, NOT FAILED.
      const task = out.plan?.tasks.find((t) => t.id === 'task_gate');
      expect(task?.status).toBe(TaskStatus.AWAITING_APPROVAL);
      // The task output carries the structured approval context for the
      // verifier / API / cockpit to surface what was blocked and why.
      const taskResult = (out.taskResults as Record<string, Record<string, unknown>>)['task_gate'];
      expect(taskResult?.['awaitingApproval']).toBe(true);
      expect(taskResult?.['toolName']).toBe('gmail_send_email');
      expect(taskResult?.['category']).toBe('EXTERNAL_POST');
      expect(taskResult?.['reason']).toContain('Sending email');
    } finally {
      clearActivityEmitter(TEST_WF);
    }
  });

  it('emits worker_completed with awaitingApproval + the blocked tool name (not success)', async () => {
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
          goal: 'g',
          tasks: [
            {
              id: 'task_gate',
              name: 'Send launch email',
              description: 'd',
              agentRole: 'WORKER_EMAIL',
              dependsOn: [],
              status: 'pending',
              riskLevel: 'HIGH',
              requiresApproval: true,
            },
          ],
        },
      } as never);

      const completed = events.find((e) => e.type === 'worker_completed');
      expect(completed, 'worker_completed must still fire so the cockpit renders the blocked state').toBeDefined();
      if (completed && completed.type === 'worker_completed') {
        // Not a successful completion — honestly blocked.
        expect(completed.success).toBe(false);
        expect((completed as Record<string, unknown>)['awaitingApproval']).toBe(true);
        expect((completed as Record<string, unknown>)['toolName']).toBe('gmail_send_email');
      }
    } finally {
      clearActivityEmitter(TEST_WF);
    }
  });

  it('does NOT invoke RepairService (approval is not a retryable failure)', async () => {
    const { registerLifecycleEmitter, clearLifecycleEmitter } = await import(
      '../../../packages/swarm/src/workflow-runtime/lifecycle-registry.js'
    );
    const { registerActivityEmitter, clearActivityEmitter } = await import(
      '../../../packages/swarm/src/supervisor/activity-registry.js'
    );
    type AnyEvent = { type: string };
    const lifeEvents: AnyEvent[] = [];
    registerLifecycleEmitter(TEST_WF, (e: unknown) => lifeEvents.push(e as AnyEvent));
    const acts: AgentActivityEvent[] = [];
    registerActivityEmitter(TEST_WF, (ev) => acts.push(ev));
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
              id: 'task_gate',
              name: 'Send launch email',
              description: 'd',
              agentRole: 'WORKER_EMAIL',
              dependsOn: [],
              status: 'pending',
              riskLevel: 'HIGH',
              requiresApproval: true,
            },
          ],
        },
      } as never);

      // No repair_* lifecycle events — the gate is not a transient/
      // tool_unavailable/missing_input/parse error and must not be
      // retried or escalated as if it were.
      const repairEvents = lifeEvents.filter((e) => e.type.startsWith('repair_'));
      expect(repairEvents, 'approval gate must not trigger the repair-service path').toEqual([]);
    } finally {
      clearLifecycleEmitter(TEST_WF);
      clearActivityEmitter(TEST_WF);
    }
  });

  it('sanity: when the agent succeeds, the workflow proceeds to VERIFYING (no false approval state)', async () => {
    gate.throwApproval = false;
    const { registerActivityEmitter, clearActivityEmitter } = await import(
      '../../../packages/swarm/src/supervisor/activity-registry.js'
    );
    const events: AgentActivityEvent[] = [];
    registerActivityEmitter(TEST_WF, (ev) => events.push(ev));
    try {
      const { workerNode } = await import('../../../packages/swarm/src/graph/nodes/worker-node.js');
      const out = await workerNode({
        workflowId: TEST_WF,
        tenantId: 'tnt_test',
        userId: 'usr_test',
        currentTaskIndex: 0,
        taskResults: {},
        plan: {
          goal: 'g',
          tasks: [
            {
              id: 'task_gate',
              name: 'Research',
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

      expect(out.status).toBe(WorkflowStatus.VERIFYING);
      const task = out.plan?.tasks.find((t) => t.id === 'task_gate');
      expect(task?.status).toBe(TaskStatus.COMPLETED);
    } finally {
      clearActivityEmitter(TEST_WF);
    }
  });
});