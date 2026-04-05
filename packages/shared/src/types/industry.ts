import type { RiskLevel } from './workflow.js';
import type { ToolCategory } from './tool.js';

export enum Industry {
  HEALTHCARE = 'HEALTHCARE',
  EDUCATION = 'EDUCATION',
  RETAIL = 'RETAIL',
  LOGISTICS = 'LOGISTICS',
  FINANCE = 'FINANCE',
  INSURANCE = 'INSURANCE',
  RECRUITING = 'RECRUITING',
  LEGAL = 'LEGAL',
  HOSPITALITY = 'HOSPITALITY',
  CUSTOMER_SUPPORT = 'CUSTOMER_SUPPORT',
  MANUFACTURING = 'MANUFACTURING',
  CONSULTING = 'CONSULTING',
  GENERAL = 'GENERAL',
}

/** Domain-specific sub-function label, e.g. "claims-processing", "patient-intake" */
export type IndustrySubFunction = string;

export interface PolicyOverlay {
  name: string;
  /** Human-readable rule description */
  rule: string;
  enforcement: 'WARN' | 'BLOCK';
  appliesTo: ToolCategory[];
}

export interface IndustryPack {
  industry: Industry;
  displayName: string;
  description: string;
  subFunctions: IndustrySubFunction[];
  defaultWorkflows: string[];
  allowedTools: ToolCategory[];
  restrictedTools: ToolCategory[];
  complianceNotes: string[];
  agentPromptSupplement: string;
  recommendedApprovalThreshold: RiskLevel;
  defaultKPITemplates: string[];
  policyOverlays: PolicyOverlay[];
}
