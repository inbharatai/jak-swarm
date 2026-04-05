import type { AgentRole } from '../types/agent.js';

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly context?: unknown;

  constructor(message: string, code: string, statusCode: number, context?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    // Restore prototype chain (needed when transpiling to ES5)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TenantIsolationError extends AppError {
  constructor(message = 'Tenant isolation violation detected', context?: unknown) {
    super(message, 'TENANT_ISOLATION_VIOLATION', 403, context);
  }
}

export class ApprovalRequiredError extends AppError {
  readonly approvalRequestId: string;

  constructor(approvalRequestId: string, message = 'Approval required before proceeding') {
    super(message, 'APPROVAL_REQUIRED', 202, { approvalRequestId });
    this.approvalRequestId = approvalRequestId;
  }
}

export class PolicyViolationError extends AppError {
  readonly policy: string;

  constructor(policy: string, message?: string) {
    super(
      message ?? `Policy violation: ${policy}`,
      'POLICY_VIOLATION',
      422,
      { policy },
    );
    this.policy = policy;
  }
}

export class ToolNotFoundError extends AppError {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`, 'TOOL_NOT_FOUND', 404, { toolName });
  }
}

export class AgentError extends AppError {
  readonly agentRole: AgentRole;

  constructor(agentRole: AgentRole, message: string, context?: unknown) {
    super(message, 'AGENT_ERROR', 500, context);
    this.agentRole = agentRole;
  }
}
