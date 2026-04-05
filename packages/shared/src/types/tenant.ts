export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  TRIAL = 'TRIAL',
}

export enum TenantPlan {
  FREE = 'FREE',
  STARTER = 'STARTER',
  PROFESSIONAL = 'PROFESSIONAL',
  ENTERPRISE = 'ENTERPRISE',
}

export interface TenantSettings {
  requireApprovals: boolean;
  /** Minimum risk level that triggers a human approval gate */
  approvalThreshold: import('./workflow.js').RiskLevel;
  allowedDomains: string[];
  maxConcurrentWorkflows: number;
  enableVoice: boolean;
  enableBrowserAutomation: boolean;
  logRetentionDays: number;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: TenantPlan;
  industry?: string;
  settings: TenantSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: import('./user.js').UserRole;
}
