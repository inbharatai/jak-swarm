export enum ToolRiskClass {
  READ_ONLY = 'READ_ONLY',
  WRITE = 'WRITE',
  DESTRUCTIVE = 'DESTRUCTIVE',
  EXTERNAL_SIDE_EFFECT = 'EXTERNAL_SIDE_EFFECT',
}

export enum ToolCategory {
  EMAIL = 'EMAIL',
  CALENDAR = 'CALENDAR',
  CRM = 'CRM',
  DOCUMENT = 'DOCUMENT',
  SPREADSHEET = 'SPREADSHEET',
  BROWSER = 'BROWSER',
  RESEARCH = 'RESEARCH',
  KNOWLEDGE = 'KNOWLEDGE',
  MESSAGING = 'MESSAGING',
  STORAGE = 'STORAGE',
  WEBHOOK = 'WEBHOOK',
}

export interface ToolMetadata {
  name: string;
  description: string;
  category: ToolCategory;
  riskClass: ToolRiskClass;
  requiresApproval: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  provider?: string;
  version: string;
}

export interface ToolExecutionContext {
  tenantId: string;
  userId: string;
  workflowId: string;
  runId: string;
  approvalId?: string;
  idempotencyKey?: string;
  allowedDomains?: string[];
  db?: Record<string, unknown>;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  durationMs: number;
}
