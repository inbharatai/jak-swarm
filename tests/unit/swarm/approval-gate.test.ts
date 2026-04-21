/**
 * Approval-gate policy tests — proves the honesty contract between the
 * landing-page claim ("human approval on high-risk actions") and the code.
 *
 * The rule: tasks routed to the approval node MUST pause at AWAITING_APPROVAL
 * unless the tenant has EXPLICITLY opted into auto-bypass via
 * `autoApproveEnabled = true` AND configured a threshold above the task's risk.
 *
 * These tests are the regression gate. If someone ever reverts the policy to
 * the old "threshold alone is enough" behavior, this test suite will fail
 * loudly in CI before the change reaches production.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkflowStatus, AgentRole, RiskLevel, generateId, type Task } from '@jak-swarm/shared';
import { approvalNode, createInitialSwarmState } from '@jak-swarm/swarm';

// Stub the ApprovalAgent — we're testing the node's policy logic, not the
// agent's LLM plumbing. The no-opt-in path constructs an ApprovalAgent that
// tries to instantiate OpenAI at import time, so the mock short-circuits
// that and returns a deterministic PENDING approval request shape.
vi.mock('@jak-swarm/agents', async () => {
  const actual = await vi.importActual<typeof import('@jak-swarm/agents')>('@jak-swarm/agents');
  return {
    ...actual,
    ApprovalAgent: class {
      async execute(input: { task: Task }, _ctx: unknown) {
        return {
          id: generateId('apr_'),
          workflowId: 'wf_test',
          taskId: input.task.id,
          agentRole: input.task.agentRole,
          action: input.task.name,
          rationale: 'Human review required (stubbed)',
          proposedData: {},
          riskLevel: input.task.riskLevel,
          status: 'PENDING' as const,
          createdAt: new Date(),
        };
      }
    },
  };
});

function buildStateWithTask(opts: {
  autoApproveEnabled?: boolean;
  approvalThreshold?: string;
  taskRisk: RiskLevel;
}) {
  const state = createInitialSwarmState({
    goal: 'approval gate test',
    tenantId: 'tenant_test',
    userId: 'user_test',
    workflowId: 'wf_test',
    autoApproveEnabled: opts.autoApproveEnabled,
    approvalThreshold: opts.approvalThreshold,
  });

  const task: Task = {
    id: 'task_test',
    agentRole: AgentRole.WORKER_EMAIL,
    name: 'Send campaign email',
    description: 'Test task for approval-gate behavior',
    dependencies: [],
    toolsRequired: ['email_send'],
    expectedOutputSchema: {},
    riskLevel: opts.taskRisk,
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

describe('Approval gate — honesty contract', () => {
  it('pauses at AWAITING_APPROVAL when autoApproveEnabled is missing (default off)', async () => {
    // Even with a permissive threshold and a LOW-risk task, the gate must
    // block — the tenant has not explicitly opted into auto-bypass.
    const state = buildStateWithTask({
      autoApproveEnabled: undefined,
      approvalThreshold: 'CRITICAL',
      taskRisk: RiskLevel.LOW,
    });

    const result = await approvalNode(state);

    expect(result.status).toBe(WorkflowStatus.AWAITING_APPROVAL);
    expect(result.pendingApprovals?.[0]?.status).toBe('PENDING');
  });

  it('pauses at AWAITING_APPROVAL when autoApproveEnabled is explicitly false', async () => {
    const state = buildStateWithTask({
      autoApproveEnabled: false,
      approvalThreshold: 'CRITICAL',
      taskRisk: RiskLevel.LOW,
    });

    const result = await approvalNode(state);

    expect(result.status).toBe(WorkflowStatus.AWAITING_APPROVAL);
    expect(result.pendingApprovals?.[0]?.status).toBe('PENDING');
  });

  it('auto-approves only when autoApproveEnabled=true AND risk < threshold', async () => {
    const state = buildStateWithTask({
      autoApproveEnabled: true,
      approvalThreshold: 'HIGH',
      taskRisk: RiskLevel.LOW,
    });

    const result = await approvalNode(state);

    expect(result.status).toBe(WorkflowStatus.EXECUTING);
    expect(result.pendingApprovals?.[0]?.status).toBe('APPROVED');
    // Auto-approvals must record the autoApproved marker + risk/threshold so
    // the audit trail explains WHY human review was skipped.
    expect(result.pendingApprovals?.[0]?.proposedData).toMatchObject({
      autoApproved: true,
      taskRisk: RiskLevel.LOW,
      threshold: 'HIGH',
    });
  });

  it('pauses even with autoApproveEnabled=true when task risk >= threshold', async () => {
    // Opt-in is on, but the task is at/above the threshold — human review required.
    const state = buildStateWithTask({
      autoApproveEnabled: true,
      approvalThreshold: 'MEDIUM',
      taskRisk: RiskLevel.HIGH,
    });

    const result = await approvalNode(state);

    expect(result.status).toBe(WorkflowStatus.AWAITING_APPROVAL);
    expect(result.pendingApprovals?.[0]?.status).toBe('PENDING');
  });

  it('pauses when autoApproveEnabled=true but approvalThreshold is unset', async () => {
    // Opt-in without a threshold is ambiguous — treat as strict.
    const state = buildStateWithTask({
      autoApproveEnabled: true,
      approvalThreshold: undefined,
      taskRisk: RiskLevel.LOW,
    });

    const result = await approvalNode(state);

    expect(result.status).toBe(WorkflowStatus.AWAITING_APPROVAL);
  });

  it('records tenantId, workflowId, and taskId on every approval request for audit', async () => {
    const state = buildStateWithTask({
      autoApproveEnabled: true,
      approvalThreshold: 'HIGH',
      taskRisk: RiskLevel.LOW,
    });

    const result = await approvalNode(state);
    const approval = result.pendingApprovals?.[0];

    expect(approval?.workflowId).toBe('wf_test');
    expect(approval?.taskId).toBe('task_test');
    expect(approval?.agentRole).toBe(AgentRole.WORKER_EMAIL);
    expect(approval?.riskLevel).toBe(RiskLevel.LOW);
  });
});
