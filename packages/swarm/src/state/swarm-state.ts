import type {
  AgentTrace,
  ApprovalRequest,
  WorkflowStatus,
} from '@jak-swarm/shared';
import { WorkflowStatus as WS } from '@jak-swarm/shared';
import type { MissionBrief } from '@jak-swarm/agents';
import type { WorkflowPlan } from '@jak-swarm/shared';
import type { RouteMap } from '@jak-swarm/agents';
import type { GuardrailResult } from '@jak-swarm/agents';
import type { VerificationResult } from '@jak-swarm/agents';

export interface SwarmState {
  // Input
  goal: string;
  tenantId: string;
  userId: string;
  workflowId: string;
  industry: string | undefined;

  // Commander output
  missionBrief: MissionBrief | undefined;
  clarificationNeeded: boolean;
  clarificationQuestion: string | undefined;

  // Planner output
  plan: WorkflowPlan | undefined;

  // Router output
  routeMap: RouteMap | undefined;

  // Execution state
  currentTaskIndex: number;
  taskResults: Record<string, unknown>;
  pendingApprovals: ApprovalRequest[];

  // Guardrail state
  guardrailResult: GuardrailResult | undefined;
  blocked: boolean;

  // Verifier state
  verificationResults: Record<string, VerificationResult>;

  // Parallel execution state
  completedTaskIds?: string[];
  failedTaskIds?: string[];

  // Cost tracking
  accumulatedCostUsd: number;
  maxCostUsd?: number;

  // Auto-approval threshold
  approvalThreshold?: string;

  // Final state
  status: WorkflowStatus;
  error: string | undefined;
  outputs: unknown[];
  traces: AgentTrace[];
}

export function createInitialSwarmState(params: {
  goal: string;
  tenantId: string;
  userId: string;
  workflowId: string;
  industry?: string;
  maxCostUsd?: number;
  approvalThreshold?: string;
}): SwarmState {
  return {
    goal: params.goal,
    tenantId: params.tenantId,
    userId: params.userId,
    workflowId: params.workflowId,
    industry: params.industry,
    missionBrief: undefined,
    clarificationNeeded: false,
    clarificationQuestion: undefined,
    plan: undefined,
    routeMap: undefined,
    currentTaskIndex: 0,
    taskResults: {},
    pendingApprovals: [],
    guardrailResult: undefined,
    blocked: false,
    verificationResults: {},
    completedTaskIds: [],
    failedTaskIds: [],
    accumulatedCostUsd: 0,
    maxCostUsd: params.maxCostUsd,
    approvalThreshold: params.approvalThreshold,
    status: WS.PENDING,
    error: undefined,
    outputs: [],
    traces: [],
  };
}

/** Get current task from state */
export function getCurrentTask(state: SwarmState) {
  if (!state.plan) return undefined;
  return state.plan.tasks[state.currentTaskIndex];
}

/** Check if there are more tasks to process */
export function hasMoreTasks(state: SwarmState): boolean {
  if (!state.plan) return false;
  return state.currentTaskIndex + 1 < state.plan.tasks.length;
}

/** Get current verification result for the current task */
export function getCurrentVerificationResult(state: SwarmState): VerificationResult | undefined {
  const task = getCurrentTask(state);
  if (!task) return undefined;
  return state.verificationResults[task.id];
}
