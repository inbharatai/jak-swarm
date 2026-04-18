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

/**
 * Honest classification of a tool's runtime behavior. Used for the maturity manifest,
 * truth-check (docs vs registry), and trace UI badges so operators don't assume an
 * `llm_passthrough` tool is doing real work.
 *
 * - real:           hits an external API or system with real auth + error handling, live-tested
 * - config_dependent: real, but needs env vars / OAuth / browser session to actually work
 * - heuristic:      local logic only (regex, computation), no external call
 * - llm_passthrough: returns input + instruction text, deferring to the LLM (NOT a real integration)
 * - experimental:   in development; behavior unstable
 * - test_only:      must not be registered in production builds
 * - unclassified:   not yet labeled — treated as opaque by the manifest until classified
 */
export type ToolMaturity =
  | 'real'
  | 'config_dependent'
  | 'heuristic'
  | 'llm_passthrough'
  | 'experimental'
  | 'test_only'
  | 'unclassified';

/** Coarse classification of side-effects. Drives confirmation UI and audit trails. */
export type ToolSideEffectLevel = 'read' | 'write' | 'destructive' | 'external';

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
  /** Honest runtime classification. Defaults to 'unclassified' in the manifest if absent. */
  maturity?: ToolMaturity;
  /** Env vars the tool needs to actually do real work (e.g. ['GMAIL_EMAIL', 'GMAIL_APP_PASSWORD']). */
  requiredEnvVars?: string[];
  /** Whether the tool has been exercised against a real external system in CI or staging. */
  liveTested?: boolean;
  /** Coarse side-effect class. Independent of riskClass (which is policy-facing). */
  sideEffectLevel?: ToolSideEffectLevel;
}

/**
 * Subscription tier coarse-grained for runtime gating of paid external services
 * (search APIs, vision APIs, etc.).
 *
 * Derived from `Subscription.maxModelTier` at workflow creation time:
 *   maxModelTier >= 2  -> 'paid'
 *   otherwise          -> 'free'
 *
 * When undefined (admin scripts, bench harness, dev without a tenant), the
 * gate is OPEN — callers behave as if on 'paid'. This preserves backwards
 * compatibility for non-workflow call sites.
 */
export type SubscriptionTier = 'free' | 'paid';

export interface ToolExecutionContext {
  tenantId: string;
  userId: string;
  workflowId: string;
  runId: string;
  approvalId?: string;
  idempotencyKey?: string;
  allowedDomains?: string[];
  db?: Record<string, unknown>;
  /**
   * Coarse plan tier for gating paid external services. Populated from the
   * tenant's Subscription at workflow creation. Undefined = no gate (permissive).
   */
  subscriptionTier?: SubscriptionTier;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  durationMs: number;
}
