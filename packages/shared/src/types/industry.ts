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
  /**
   * NOTE: this field name is misleading — it's a list of tool CATEGORIES
   * (ToolCategory enum values), not tool names. It's wired through
   * swarm-execution.service.ts → TenantToolRegistry.restrictedCategories
   * at the category level. Preserved as-is for backwards compatibility
   * with the 19 existing industry pack files; new code should prefer
   * `restrictedToolNames` below for per-tool blocks.
   */
  restrictedTools: ToolCategory[];
  /**
   * Optional per-tool-name blocklist. Higher-granularity complement to
   * `restrictedTools` (which blocks at the category level). When an
   * industry has to ban, say, `code_execute` or `browser_evaluate_js`
   * specifically — not the whole BROWSER category — use this. Enforced
   * via TenantToolRegistry.disabledToolNames in swarm-execution.service.ts.
   */
  restrictedToolNames?: string[];
  complianceNotes: string[];
  agentPromptSupplement: string;
  recommendedApprovalThreshold: RiskLevel;
  defaultKPITemplates: string[];
  policyOverlays: PolicyOverlay[];
}
