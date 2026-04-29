import { WorkflowStatus, generateId, TOOL_RISK_LEVEL_ORDER } from '@jak-swarm/shared';
import { ApprovalAgent, AgentContext } from '@jak-swarm/agents';
import type { ApprovalInput } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';

/**
 * Numeric ordering for both task-level RiskLevel (LOW/MEDIUM/HIGH/CRITICAL)
 * AND tool-level ToolRiskLevel (READ_ONLY/DRAFT_ONLY/SANDBOX_EDIT/...). The
 * map merges both vocabularies so a single comparison works regardless of
 * which lattice the caller used. Tool-level entries come from
 * TOOL_RISK_LEVEL_ORDER; task-level entries kept inline for the historical
 * 4-tier comparison the approval gate has always used.
 *
 * If a future caller passes an unknown risk label, the lookup returns
 * undefined and the gate falls back to the safest assumption (high risk),
 * preserving the "fail closed" honesty contract.
 */
const RISK_ORDER: Record<string, number> = {
  // Task-level (RiskLevel from workflow.ts)
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
  // Tool-level (ToolRiskLevel from tool.ts) — Item D of OpenClaw-inspired Phase 1
  ...TOOL_RISK_LEVEL_ORDER,
};

export async function approvalNode(state: SwarmState): Promise<Partial<SwarmState>> {
  // Auto-approve only if the tenant has EXPLICITLY opted in via
  // `autoApproveEnabled = true` AND the task risk is strictly below the
  // configured threshold. Default (false) is: every task routed here
  // pauses at AWAITING_APPROVAL until an operator decides. This keeps
  // the landing-page claim ("human approval on high-risk actions")
  // structurally honest instead of being a marketing promise the code
  // silently bypasses.
  if (state.autoApproveEnabled === true && state.approvalThreshold) {
    const autoTask = getCurrentTask(state);
    if (autoTask) {
      const taskRisk = RISK_ORDER[autoTask.riskLevel ?? 'HIGH'] ?? 4;
      const threshold = RISK_ORDER[state.approvalThreshold] ?? 3;
      if (taskRisk < threshold) {
        // Auto-approve: tenant opted in + task risk is below the threshold.
        // Every auto-approval is still recorded (autoApproved: true) so the
        // audit trail shows WHY it skipped human review, not just that it did.
        return {
          pendingApprovals: [{
            id: generateId('apr_'),
            workflowId: state.workflowId,
            taskId: autoTask.id,
            agentRole: autoTask.agentRole,
            action: autoTask.name,
            rationale: `Auto-approved: tenant opt-in + risk level ${autoTask.riskLevel ?? 'UNKNOWN'} is below threshold ${state.approvalThreshold}`,
            proposedData: { autoApproved: true, taskRisk: autoTask.riskLevel, threshold: state.approvalThreshold },
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
    // Item B (OpenClaw-inspired Phase 1) — reviewer-context fields.
    // The approval card needs to show the SPECIFIC tool the reviewer is
    // approving + an idempotency key so a duplicate decide is a no-op
    // rather than a second external action.
    toolName: task.toolsRequired?.[0],
    idempotencyKey: state.idempotencyKey,
  };

  const approvalRequest = await agent.execute(approvalInput, context);
  const traces = context.getTraces();

  return {
    pendingApprovals: [approvalRequest],
    status: WorkflowStatus.AWAITING_APPROVAL,
    traces,
  };
}
