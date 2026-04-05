import type { RiskLevel } from './workflow.js';

export enum SkillTier {
  BUILTIN = 1,
  GENERATED_PLAN = 2,
  PROPOSED = 3,
}

export enum SkillStatus {
  ACTIVE = 'ACTIVE',
  PROPOSED = 'PROPOSED',
  SANDBOX_TESTING = 'SANDBOX_TESTING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  DEPRECATED = 'DEPRECATED',
}

export enum SkillPermission {
  READ_EMAIL = 'READ_EMAIL',
  WRITE_EMAIL = 'WRITE_EMAIL',
  READ_CALENDAR = 'READ_CALENDAR',
  WRITE_CALENDAR = 'WRITE_CALENDAR',
  READ_CRM = 'READ_CRM',
  WRITE_CRM = 'WRITE_CRM',
  READ_DOCUMENTS = 'READ_DOCUMENTS',
  WRITE_DOCUMENTS = 'WRITE_DOCUMENTS',
  BROWSER_READ = 'BROWSER_READ',
  BROWSER_WRITE = 'BROWSER_WRITE',
  EXTERNAL_MESSAGE = 'EXTERNAL_MESSAGE',
  PAYMENT = 'PAYMENT',
  DELETE_RECORDS = 'DELETE_RECORDS',
}

export interface SkillTestCase {
  description: string;
  input: unknown;
  expectedOutputSchema: Record<string, unknown>;
  shouldPass: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  tier: SkillTier;
  status: SkillStatus;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  permissions: SkillPermission[];
  riskLevel: RiskLevel;
  testCases: SkillTestCase[];
  /** Source code — only populated for sandbox/proposed skills */
  implementation?: string;
  sandboxResult?: unknown;
  approvedBy?: string;
  approvedAt?: Date;
  createdAt: Date;
}
