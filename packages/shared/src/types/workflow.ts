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
  /** Phase 5 — terminal state for workflows that ran a compensation/undo flow. */
  ROLLED_BACK = 'ROLLED_BACK',
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
  /**
   * OpenClaw-inspired Phase 1, Item B — reviewer-context fields.
   * Surface the SPECIFIC tool / files / external service / expected result
   * the approver is binding their decision to, so the inline approval card
   * can show "Send email via Gmail to alice@…, attaches /reports/q1.pdf"
   * instead of just "Send email". All optional — older approvals (and
   * approvals for tasks that don't bind to a single tool) leave these
   * unset and the UI falls back to `action` + `rationale`.
   */
  toolName?: string;
  filesAffected?: string[];
  externalService?: string;
  idempotencyKey?: string;
  expectedResult?: string;
  /**
   * Canonical sha256 of `proposedData` at the moment the approval was
   * created. The decide endpoint re-hashes the stored proposedData and
   * compares; if it differs, the route returns 409
   * `APPROVAL_PAYLOAD_MISMATCH` and refuses to apply the decision.
   * Legacy approvals predating Item B leave this undefined; the route
   * computes + persists it on first decide.
   */
  proposedDataHash?: string;
}
