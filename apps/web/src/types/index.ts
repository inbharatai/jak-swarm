// ─── API Response Wrappers ────────────────────────────────────────────────────
// These match the shape returned by the Fastify API:
//   success:  { success: true, data: T }
//   failure:  { success: false, error: { code, message, details? } }

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

// Paginated results come as { success: true, data: { items, total, page, limit, hasMore } }
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// Legacy alias — some pages still use this shape
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  message: string;
  code: string;
  status: number;
  details?: Record<string, string[]>;
}

// ─── Auth Types ───────────────────────────────────────────────────────────────
// Must match apps/api/src/types.ts UserRole exactly.

export type UserRole = 'SYSTEM_ADMIN' | 'TENANT_ADMIN' | 'OPERATOR' | 'REVIEWER' | 'VIEWER';
export type JobFunction = 'CEO' | 'CTO' | 'CMO' | 'ENGINEER' | 'HR' | 'FINANCE' | 'SALES' | 'OPERATIONS' | 'OTHER';
export type Industry =
  | 'FINANCE'
  | 'HEALTHCARE'
  | 'LEGAL'
  | 'RETAIL'
  | 'LOGISTICS'
  | 'MANUFACTURING'
  | 'TECHNOLOGY'
  | 'REAL_ESTATE'
  | 'EDUCATION'
  | 'HOSPITALITY';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  tenantName: string;
  industry: Industry;
  avatarUrl?: string;
  jobFunction?: JobFunction;
}

export type IntegrationProvider = 'GMAIL' | 'GCAL' | 'SLACK' | 'GITHUB' | 'NOTION' | 'HUBSPOT' | 'DRIVE';
export type IntegrationStatus = 'CONNECTED' | 'DISCONNECTED' | 'NEEDS_REAUTH' | 'ERROR';
export type IntegrationMaturity = 'production-ready' | 'beta' | 'partial' | 'placeholder';

export interface Integration {
  id: string;
  tenantId: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  displayName?: string;
  scopes: string[];
  metadata?: Record<string, unknown>;
  maturity?: IntegrationMaturity;
  note?: string;
  lastUsedAt?: string;
  connectedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  user: AuthUser;
  token: string;
  expiresAt: number;
}

export interface LoginFormData {
  email: string;
  password: string;
}

export interface RegisterFormData {
  email: string;
  password: string;
  name: string;
  tenantName: string;
  industry: Industry;
}

// ─── Workflow Types ───────────────────────────────────────────────────────────
// WorkflowStatus must match the DB-persisted values returned by the API.
// The API maps internal swarm states to these 6 canonical values.

export type WorkflowStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'PAUSED'      // awaiting human approval
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

// TaskStatus mirrors @jak-swarm/shared TaskStatus enum
export type TaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED';

// AgentRole mirrors @jak-swarm/shared AgentRole enum
export type AgentRole =
  | 'COMMANDER'
  | 'PLANNER'
  | 'ROUTER'
  | 'VERIFIER'
  | 'GUARDRAIL'
  | 'APPROVAL'
  | 'WORKER_EMAIL'
  | 'WORKER_CALENDAR'
  | 'WORKER_CRM'
  | 'WORKER_DOCUMENT'
  | 'WORKER_SPREADSHEET'
  | 'WORKER_BROWSER'
  | 'WORKER_RESEARCH'
  | 'WORKER_KNOWLEDGE'
  | 'WORKER_SUPPORT'
  | 'WORKER_OPS'
  | 'WORKER_VOICE'
  | 'WORKER_CODER'
  | 'WORKER_DESIGNER'
  | 'WORKER_STRATEGIST'
  | 'WORKER_MARKETING'
  | 'WORKER_TECHNICAL'
  | 'WORKER_FINANCE'
  | 'WORKER_HR'
  | 'WORKER_GROWTH';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface WorkflowPlanStep {
  id: string;
  stepNumber: number;
  taskName: string;
  description: string;
  agentRole: AgentRole;
  riskLevel: RiskLevel;
  status: TaskStatus;
  dependsOn: string[];
  estimatedDuration?: number;
  actualDuration?: number;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  toolCalls?: ToolCall[];
  inputSummary?: string;
  outputSummary?: string;
}

export interface WorkflowPlan {
  id: string;
  workflowId: string;
  steps: WorkflowPlanStep[];
  createdAt: string;
  estimatedTotalDuration?: number;
}

export interface Workflow {
  id: string;
  tenantId: string;
  createdBy: string;   // userId
  goal: string;        // the natural-language goal submitted by the user
  industry: string | null;
  status: WorkflowStatus;
  /** Workflow result — may be a plain string summary or a structured JSON object */
  result: string | Record<string, unknown> | null;
  /** Compiled final output from all agent traces */
  finalOutput: string | null;
  error: string | null;
  /** Alias for error — some API responses use this field name */
  errorMessage?: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Optional enrichments returned by GET /workflows/:id
  plan?: WorkflowPlan;
  traces?: AgentTraceRecord[];
  approvals?: ApprovalRequest[];
  /** Token usage for the entire workflow run */
  tokenUsage?: number;
  /** Estimated USD cost for the workflow run */
  costUsd?: number;
}

// ─── Tool Call Types ──────────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

// ─── Agent Trace Record (API response shape) ──────────────────────────────────

export interface AgentTraceRecord {
  id: string;
  workflowId: string;
  tenantId: string;
  agentRole: AgentRole;
  status: string;
  steps: unknown[];
  output?: string;
  error?: string;
  durationMs?: number;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

// ─── Approval Types ───────────────────────────────────────────────────────────
// Must match the DB-persisted values returned by the API.

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'EXPIRED';
export type ApprovalDecision = 'APPROVED' | 'REJECTED' | 'DEFERRED';

export interface ApprovalRequest {
  id: string;
  workflowId: string;
  tenantId: string;
  taskId: string;
  agentRole: string;
  action: string;
  rationale: string;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  reviewedBy: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp when the approval request was created (alias for createdAt) */
  requestedAt?: string;
  /** Optional expiry deadline for this approval */
  expiresAt?: string;
  /** Current state of the resource before the proposed action */
  currentData?: Record<string, unknown>;
  /** Proposed changes the agent wants to apply */
  proposedData?: Record<string, unknown>;
}

// ─── Trace Types ──────────────────────────────────────────────────────────────

export interface TraceStep {
  id: string;
  traceId: string;
  stepNumber: number;
  agentRole: AgentRole;
  action: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  toolCalls?: ToolCall[];
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  tokenUsage?: number;
  costUsd?: number;
  error?: string;
  screenshotUrl?: string;
}

export interface Trace {
  id: string;
  workflowId: string;
  tenantId: string;
  steps: TraceStep[];
  totalDurationMs?: number;
  totalTokens?: number;
  totalCostUsd?: number;
  createdAt: string;
}

// ─── Memory / Knowledge Types ─────────────────────────────────────────────────

export type MemoryType = 'WORKFLOW' | 'USER_PREF' | 'KNOWLEDGE' | 'POLICY' | 'SKILL_REGISTRY';

export interface MemoryEntry {
  id: string;
  tenantId: string;
  type: MemoryType;
  key: string;
  value: string;
  source: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

// ─── Skill Types ──────────────────────────────────────────────────────────────

export type SkillStatus = 'pending' | 'approved' | 'rejected' | 'deprecated';

export interface Skill {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  code: string;
  status: SkillStatus;
  proposedBy: string;
  sandboxResult?: SandboxResult;
  createdAt: string;
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface SandboxResult {
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  executedAt: string;
}

// ─── Admin Types ──────────────────────────────────────────────────────────────

export interface TenantSettings {
  id: string;
  tenantId: string;
  industry: Industry;
  approvalThresholds: Record<RiskLevel, boolean>;
  enabledTools: string[];
  maxConcurrentAgents: number;
  maxTokensPerWorkflow: number;
  maxCostPerWorkflow: number;
}

export interface ApiKey {
  id: string;
  tenantId: string;
  name: string;
  keyPreview: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  permissions: string[];
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt?: string;
  isActive: boolean;
}

// ─── UI State Types ───────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  link?: string;
}

export interface CommandInputState {
  mode: 'text' | 'voice';
  text: string;
  industry: Industry;
  isSubmitting: boolean;
  isListening: boolean;
}

export interface WorkspaceState {
  activeWorkflowId?: string;
  commandHistory: string[];
  selectedStepId?: string;
  selectedApprovalId?: string;
}

// ─── Voice Types ──────────────────────────────────────────────────────────────

export type VoiceMode = 'push-to-talk' | 'hands-free' | 'disabled';
export type VoiceProvider = 'realtime-api' | 'deepgram' | 'browser-stt' | 'text';

export interface TranscriptSegment {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: string;
  speaker?: string;
  language?: string;
}

// ─── Schedule Types ──────────────────────────────────────────────────────────

export interface WorkflowSchedule {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  description?: string;
  goal: string;
  industry?: string;
  cronExpression: string;
  enabled: boolean;
  maxCostUsd?: number;
  lastRunAt?: string;
  nextRunAt?: string;
  lastRunStatus?: string;
  lastRunId?: string;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Filter / Query Types ─────────────────────────────────────────────────────

export interface WorkflowFilters {
  status?: WorkflowStatus[];
  industry?: Industry;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface TraceFilters {
  workflowId?: string;
  agentRole?: AgentRole;
  dateFrom?: string;
  dateTo?: string;
  hasErrors?: boolean;
  page?: number;
  pageSize?: number;
}

export interface MemoryFilters {
  type?: MemoryType;
  search?: string;
  page?: number;
  pageSize?: number;
}
