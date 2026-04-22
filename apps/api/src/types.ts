/**
 * Core domain types for the JAK Swarm API.
 * These mirror the @jak-swarm/shared package types used throughout the platform.
 */

export type UserRole =
  | 'SYSTEM_ADMIN'
  | 'TENANT_ADMIN'
  | 'OPERATOR'
  | 'REVIEWER'
  | 'VIEWER';

export type WorkflowStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type ApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'DEFERRED'
  | 'EXPIRED';

export type ApprovalDecision = 'APPROVED' | 'REJECTED' | 'DEFERRED';

export type SkillStatus =
  | 'PROPOSED'
  | 'SANDBOX_RUNNING'
  | 'SANDBOX_PASSED'
  | 'SANDBOX_FAILED'
  | 'APPROVED'
  | 'REJECTED'
  | 'DEPRECATED';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type SkillTier = 'BUILTIN' | 'COMMUNITY' | 'TENANT';

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'BANNED';

export type MemoryType = 'FACT' | 'PREFERENCE' | 'CONTEXT' | 'SKILL_RESULT';

/** Payload stored inside the JWT and attached to every authenticated request */
export interface AuthSession {
  sub: string;        // userId
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  jobFunction?: string | null;
  iat?: number;
  exp?: number;
}

/** Tenant domain object */
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** User domain object */
export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Workflow domain object */
export interface Workflow {
  id: string;
  tenantId: string;
  createdBy: string;
  goal: string;
  industry: string | null;
  status: WorkflowStatus;
  result: Record<string, unknown> | null;
  finalOutput: string | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Count of agent traces persisted against this workflow.
   *  Optional because only list/detail queries populate it. */
  traceCount?: number;
}

/** Agent trace step */
export interface TraceStep {
  id: string;
  traceId: string;
  seq: number;
  agentRole: string;
  action: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  durationMs: number | null;
  error: string | null;
  createdAt: Date;
}

/** Agent trace */
export interface AgentTrace {
  id: string;
  workflowId: string;
  tenantId: string;
  agentRole: string;
  status: string;
  steps: TraceStep[];
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}

/** Approval request */
export interface ApprovalRequest {
  id: string;
  workflowId: string;
  tenantId: string;
  // Task-scope fields from the underlying ApprovalRequest row. Exposed so
  // the audit-log writer in approvals.routes.ts can persist a structured
  // record without re-querying the DB.
  taskId: string;
  agentRole: string;
  requestedBy: string;
  reviewedBy: string | null;
  action: string;
  context: Record<string, unknown>;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  decision: ApprovalDecision | null;
  comment: string | null;
  expiresAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Skill domain object */
export interface Skill {
  id: string;
  tenantId: string | null;
  name: string;
  slug: string;
  description: string;
  tier: SkillTier;
  status: SkillStatus;
  riskLevel: RiskLevel;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  permissions: string[];
  testCases: Record<string, unknown>[];
  proposedBy: string | null;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Memory entry */
export interface MemoryEntry {
  id: string;
  tenantId: string;
  key: string;
  value: unknown;
  type: MemoryType;
  ttl: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Audit log entry */
export interface AuditLog {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

/** Paginated response wrapper */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/** Standard API success response */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/** Standard API error response */
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/** Helper to create a success response */
export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

/** Helper to create an error response */
export function err(code: string, message: string, details?: unknown): ApiError {
  return { success: false, error: { code, message, details } };
}
