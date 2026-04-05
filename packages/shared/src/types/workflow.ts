import type { AgentRole, AgentTrace } from './agent.js';

export enum WorkflowStatus {
  PENDING = 'PENDING',
  PLANNING = 'PLANNING',
  ROUTING = 'ROUTING',
  EXECUTING = 'EXECUTING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  VERIFYING = 'VERIFYING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

export interface WorkflowTask {
  id: string;
  name: string;
  description: string;
  agentRole: AgentRole;
  toolsRequired: string[];
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  status: TaskStatus;
  dependsOn: string[];
  retryable: boolean;
  maxRetries: number;
  result?: unknown;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface WorkflowPlan {
  id: string;
  name: string;
  goal: string;
  industry: string;
  tasks: WorkflowTask[];
  estimatedDuration?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Workflow {
  id: string;
  tenantId: string;
  userId: string;
  goal: string;
  industry?: string;
  status: WorkflowStatus;
  plan?: WorkflowPlan;
  currentTaskId?: string;
  approvalRequests: ApprovalRequest[];
  traces: AgentTrace[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface ApprovalRequest {
  id: string;
  workflowId: string;
  taskId: string;
  agentRole: AgentRole;
  action: string;
  rationale: string;
  proposedData: unknown;
  riskLevel: RiskLevel;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DEFERRED';
  reviewedBy?: string;
  reviewedAt?: Date;
  createdAt: Date;
}
