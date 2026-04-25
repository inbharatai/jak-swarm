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

/**
 * Honest classification of WHAT happened when a tool ran. Independent
 * of the boolean `success` (which a fake-success mock could lie about).
 *
 * - real_success:           an actual external side-effect occurred (email sent,
 *                           CRM record updated, file written, API call returned)
 * - draft_created:          a draft / preview was produced, no external commit
 *                           (e.g. social post saved as draft, email composed but
 *                           not sent)
 * - mock_provider:          synthetic data from a mock adapter — useful for
 *                           local dev, MUST NOT be displayed as real success
 * - not_configured:         tool would run but missing credentials / config
 *                           (the operator hasn't connected the integration)
 * - blocked_requires_config:tool was registered but tenant policy or industry
 *                           pack blocks it without additional configuration
 * - failed:                 tool ran and a real error occurred (network, 4xx,
 *                           parsing failure)
 *
 * The cockpit + audit log read this field to render an honest badge instead
 * of guessing from substrings in the response payload.
 */
export type ToolOutcome =
  | 'real_success'
  | 'draft_created'
  | 'mock_provider'
  | 'not_configured'
  | 'blocked_requires_config'
  | 'failed';

export interface ToolResult<T = unknown> {
  /**
   * Coarse boolean for "did the call complete without throwing?". Kept
   * for backwards compatibility with all existing call sites — but the
   * honest classification is `outcome` below.
   */
  success: boolean;
  /**
   * Honest outcome classification. Optional only because old call sites
   * may not yet populate it; new code should always set it. The cockpit
   * defaults to `'real_success'` when success=true and outcome is absent
   * (legacy compatibility), but emits a console warning so we can grep
   * for unlabelled call sites and fix them.
   */
  outcome?: ToolOutcome;
  data?: T;
  error?: string;
  durationMs: number;
  /**
   * Optional human-readable note shown next to the outcome badge in the
   * cockpit. Use for "draft saved to /drafts/abc" or "Gmail credentials
   * not connected — connect via /integrations".
   */
  outcomeMessage?: string;
}
