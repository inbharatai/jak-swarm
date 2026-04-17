import { WorkflowStatus, generateId } from '@jak-swarm/shared';
import { ApprovalAgent, AgentContext } from '@jak-swarm/agents';
import type { ApprovalInput } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';

const RISK_ORDER: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export async function approvalNode(state: SwarmState): Promise<Partial<SwarmState>> {
  // Auto-approve if task risk is below tenant's approval threshold
  if (state.approvalThreshold) {
    const autoTask = getCurrentTask(state);
    if (autoTask) {
      const taskRisk = RISK_ORDER[autoTask.riskLevel ?? 'HIGH'] ?? 4;
      const threshold = RISK_ORDER[state.approvalThreshold] ?? 3;
      if (taskRisk < threshold) {
        // Auto-approve: task risk is below the threshold
        return {
          pendingApprovals: [{
            id: generateId('apr_'),
            workflowId: state.workflowId,
            taskId: autoTask.id,
            agentRole: autoTask.agentRole,
            action: autoTask.name,
            rationale: `Auto-approved: risk level ${autoTask.riskLevel ?? 'UNKNOWN'} is below threshold ${state.approvalThreshold}`,
            proposedData: { autoApproved: true },
            riskLevel: autoTask.riskLevel,
            status: 'APPROVED',
            reviewedAt: new Date(),
            createdAt: new Date(),
          }],
          status: WorkflowStatus.EXECUTING,
        };
      }
    }
  }

  const task = getCurrentTask(state);

  if (!task) {
    return { status: WorkflowStatus.FAILED, error: 'Approval node: no current task' };
  }

  const agent = new ApprovalAgent();

  const context = new AgentContext({
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
    idempotencyKey: state.idempotencyKey,
    allowedDomains: state.allowedDomains,
  });

  const approvalInput: ApprovalInput = {
    task,
    proposedData: {
      taskInput: task.description,
      toolsRequired: task.toolsRequired,
      riskLevel: task.riskLevel,
      previousResults: state.taskResults,
    },
    affectedEntities: task.toolsRequired,
  };

  const approvalRequest = await agent.execute(approvalInput, context);
  const traces = context.getTraces();

  return {
    pendingApprovals: [approvalRequest],
    status: WorkflowStatus.AWAITING_APPROVAL,
    traces,
  };
}
