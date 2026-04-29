/**
 * Approval card reviewer-context tests — Item B of OpenClaw-inspired Phase 1.
 *
 * Pins the contract that the approval-node populates the SPECIFIC tool /
 * files / external service / idempotency-key / expected-result fields on
 * the ApprovalRequest it emits, so the cockpit's inline approval card can
 * surface them to the reviewer.
 *
 * The threat model: a reviewer who sees only "approve a high-risk action"
 * is too easily phished into approving the wrong thing. Surfacing the tool
 * name + external service + files affected gives the reviewer the bind
 * they need to make an informed decision.
 *
 * If the approval-node ever stops populating these fields, the inline card
 * silently degrades to the legacy "rationale only" surface. CI must catch
 * that drift.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  WorkflowStatus,
  AgentRole,
  RiskLevel,
  generateId,
  type Task,
} from '@jak-swarm/shared';
import { approvalNode, createInitialSwarmState } from '@jak-swarm/swarm';

// Belt-and-suspenders: the BaseAgent constructor instantiates OpenAI at
// import time and reads OPENAI_API_KEY synchronously, so even with the
// vi.mock below the underlying class import path can fail in fresh
// shells that have no key set. Pin a dummy here so the test never
// depends on developer-machine env.
beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = 'sk-test-approval-card-fields';
  }
});

// Stub the ApprovalAgent so the test doesn't try to instantiate OpenAI.
// The stub mirrors the real agent's behavior of (a) preferring explicit
// reviewer-context fields passed in by the node, (b) falling back to
// task.toolsRequired[0] for toolName when none was supplied, and
// (c) exposing the same shape on the returned ApprovalRequest.
vi.mock('@jak-swarm/agents', async () => {
  const actual = await vi.importActual<typeof import('@jak-swarm/agents')>('@jak-swarm/agents');
  return {
    ...actual,
    ApprovalAgent: class {
      async execute(input: {
        task: Task;
        toolName?: string;
        filesAffected?: string[];
        externalService?: string;
        idempotencyKey?: string;
      }, _ctx: unknown) {
        const toolName = input.toolName ?? input.task.toolsRequired?.[0];
        // Mirror the deriveExternalService heuristic from the real agent
        // so the test exercises the same back-fill logic.
        const externalService = input.externalService ?? (() => {
          const t = (toolName ?? '').toLowerCase();
          if (t.startsWith('gmail')) return 'Gmail';
          if (t.startsWith('slack')) return 'Slack';
          return undefined;
        })();
        return {
          id: generateId('apr_'),
          workflowId: 'wf_test',
          taskId: input.task.id,
          agentRole: input.task.agentRole,
          action: input.task.name,
          rationale: 'Human review required (stubbed)',
          proposedData: {
            taskInput: input.task.description,
            toolsRequired: input.task.toolsRequired,
            riskLevel: input.task.riskLevel,
          },
          riskLevel: input.task.riskLevel,
          status: 'PENDING' as const,
          createdAt: new Date(),
          toolName,
          filesAffected: input.filesAffected ?? [],
          externalService,
          idempotencyKey: input.idempotencyKey,
          expectedResult: 'Action will be executed as described',
        };
      }
    },
  };
});

function buildStateWithTask(opts: {
  toolsRequired: string[];
  taskRisk?: RiskLevel;
  idempotencyKey?: string;
}) {
  const state = createInitialSwarmState({
    goal: 'reviewer-context surface test',
    tenantId: 'tenant_test',
    userId: 'user_test',
    workflowId: 'wf_test',
    autoApproveEnabled: false,
    idempotencyKey: opts.idempotencyKey,
  });

  const task: Task = {
    id: 'task_test',
    agentRole: AgentRole.WORKER_EMAIL,
    name: 'Send campaign email',
    description: 'Test task — fields populated',
    dependencies: [],
    toolsRequired: opts.toolsRequired,
    expectedOutputSchema: {},
    riskLevel: opts.taskRisk ?? RiskLevel.HIGH,
    status: 'PENDING',
  };

  state.plan = {
    goal: state.goal,
    tasks: [task],
    estimatedDurationMs: 1000,
    estimatedCostUsd: 0,
  };
  state.currentTaskIndex = 0;

  return state;
}

describe('Approval card reviewer-context fields', () => {
  it('populates toolName from task.toolsRequired[0]', async () => {
    const state = buildStateWithTask({ toolsRequired: ['gmail_send_email'] });
    const result = await approvalNode(state);
    expect(result.status).toBe(WorkflowStatus.AWAITING_APPROVAL);
    expect(result.pendingApprovals?.[0]?.toolName).toBe('gmail_send_email');
  });

  it('derives externalService from a known tool prefix (gmail → Gmail)', async () => {
    const state = buildStateWithTask({ toolsRequired: ['gmail_send_email'] });
    const result = await approvalNode(state);
    expect(result.pendingApprovals?.[0]?.externalService).toBe('Gmail');
  });

  it('derives externalService for slack tools (slack → Slack)', async () => {
    const state = buildStateWithTask({ toolsRequired: ['slack_post_message'] });
    const result = await approvalNode(state);
    expect(result.pendingApprovals?.[0]?.externalService).toBe('Slack');
  });

  it('leaves externalService undefined for unknown tool names', async () => {
    const state = buildStateWithTask({ toolsRequired: ['custom_internal_tool'] });
    const result = await approvalNode(state);
    expect(result.pendingApprovals?.[0]?.externalService).toBeUndefined();
  });

  it('passes idempotencyKey from state through to the approval', async () => {
    const state = buildStateWithTask({
      toolsRequired: ['gmail_send_email'],
      idempotencyKey: 'idem-abc-123',
    });
    const result = await approvalNode(state);
    expect(result.pendingApprovals?.[0]?.idempotencyKey).toBe('idem-abc-123');
  });

  it('initializes filesAffected to an empty array (never undefined)', async () => {
    const state = buildStateWithTask({ toolsRequired: ['gmail_send_email'] });
    const result = await approvalNode(state);
    expect(result.pendingApprovals?.[0]?.filesAffected).toEqual([]);
  });

  it('always populates expectedResult even when LLM call short-circuits', async () => {
    const state = buildStateWithTask({ toolsRequired: ['gmail_send_email'] });
    const result = await approvalNode(state);
    expect(result.pendingApprovals?.[0]?.expectedResult).toBeTruthy();
  });

  it('handles tasks with empty toolsRequired (no external action — no service)', async () => {
    const state = buildStateWithTask({ toolsRequired: [] });
    const result = await approvalNode(state);
    expect(result.pendingApprovals?.[0]?.toolName).toBeUndefined();
    expect(result.pendingApprovals?.[0]?.externalService).toBeUndefined();
  });
});
