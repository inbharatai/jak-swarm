export enum ToolRiskClass {
  READ_ONLY = 'READ_ONLY',
  WRITE = 'WRITE',
  DESTRUCTIVE = 'DESTRUCTIVE',
  EXTERNAL_SIDE_EFFECT = 'EXTERNAL_SIDE_EFFECT',
}

/**
 * Six-level tool-capability risk lattice (Item D of the OpenClaw-inspired
 * Phase 1). The 4-class `ToolRiskClass` lumps too many operations into
 * `WRITE` and `EXTERNAL_SIDE_EFFECT`, which forces the approval gate into
 * over-conservative behavior. The 6-level lattice gives the policy engine
 * a per-tool capability description that the approval-node can map to a
 * specific gate without losing precision.
 *
 * Ordering (lowest risk first — used for threshold comparison):
 *   READ_ONLY              < DRAFT_ONLY
 *   < SANDBOX_EDIT
 *   < LOCAL_EXEC_ALLOWLIST
 *   < EXTERNAL_ACTION_APPROVAL
 *   < CRITICAL_MANUAL_ONLY
 *
 * `ToolRiskClass` stays exported for back-compat — every existing tool
 * registration continues to compile. The runtime maps the old value to
 * a level via `RISK_CLASS_TO_LEVEL` below; new tool registrations may
 * use `riskLevel` directly via the optional `ToolMetadata.riskLevel`
 * field.
 *
 * Note on scope: this is a TOOL-capability lattice. The four-tier
 * task-level `RiskLevel` enum in `workflow.ts` (LOW/MEDIUM/HIGH/CRITICAL)
 * stays — that one is for approval-threshold comparison. Different
 * axis, different lattice.
 */
export enum ToolRiskLevel {
  /** No side effects. Reading public APIs, fetching documents the
      tenant already has access to, summarizing in-memory data. */
  READ_ONLY = 'READ_ONLY',
  /** Produces a drafted artifact (email draft, social post draft,
      generated code). The artifact is materialized somewhere the user
      can review, but no external action has been taken. */
  DRAFT_ONLY = 'DRAFT_ONLY',
  /** Mutates files inside a sandbox or workspace copy only. The tenant's
      production state is untouched. Generated SaaS apps + Remotion
      project scaffolding land here. */
  SANDBOX_EDIT = 'SANDBOX_EDIT',
  /** Runs a local subprocess from an allowlisted package (e.g. Remotion
      CLI render). Requires `sourceAllowlist` in the connector manifest. */
  LOCAL_EXEC_ALLOWLIST = 'LOCAL_EXEC_ALLOWLIST',
  /** Sends, posts, or deploys to a third party (Slack message, email
      send, Vercel deploy, Stripe charge create). ALWAYS requires an
      approval — auto-approve only for tenants that have explicitly
      opted in for this exact tool name. */
  EXTERNAL_ACTION_APPROVAL = 'EXTERNAL_ACTION_APPROVAL',
  /** Destructive on production state (DELETE on prod DB, payment
      refund, mass message, secret rotation). NEVER auto-approves
      regardless of tenant settings. */
  CRITICAL_MANUAL_ONLY = 'CRITICAL_MANUAL_ONLY',
}

/**
 * Numeric ordering for threshold comparison (smaller = lower risk).
 * Mirrors `RISK_ORDER` in `approval-node.ts` so a single comparison
 * works for both task-risk and tool-risk axes.
 */
export const TOOL_RISK_LEVEL_ORDER: Record<ToolRiskLevel, number> = {
  [ToolRiskLevel.READ_ONLY]: 1,
  [ToolRiskLevel.DRAFT_ONLY]: 2,
  [ToolRiskLevel.SANDBOX_EDIT]: 3,
  [ToolRiskLevel.LOCAL_EXEC_ALLOWLIST]: 4,
  [ToolRiskLevel.EXTERNAL_ACTION_APPROVAL]: 5,
  [ToolRiskLevel.CRITICAL_MANUAL_ONLY]: 6,
};

/**
 * Back-compat map: every existing tool registered with `ToolRiskClass`
 * gets a default `ToolRiskLevel`. Conservative — when the old enum is
 * ambiguous (e.g. WRITE could mean DRAFT_ONLY or SANDBOX_EDIT), we pick
 * the SAFER option (SANDBOX_EDIT > DRAFT_ONLY by ordering) so an
 * unannotated tool can never accidentally auto-approve more than it
 * could before.
 */
export const RISK_CLASS_TO_LEVEL: Record<ToolRiskClass, ToolRiskLevel> = {
  [ToolRiskClass.READ_ONLY]: ToolRiskLevel.READ_ONLY,
  [ToolRiskClass.WRITE]: ToolRiskLevel.SANDBOX_EDIT,
  [ToolRiskClass.DESTRUCTIVE]: ToolRiskLevel.CRITICAL_MANUAL_ONLY,
  [ToolRiskClass.EXTERNAL_SIDE_EFFECT]: ToolRiskLevel.EXTERNAL_ACTION_APPROVAL,
};

/**
 * Resolves the canonical `ToolRiskLevel` for a tool, preferring an
 * explicit `riskLevel` if the registration has one (new code path),
 * falling back to the back-compat map of the legacy `riskClass`.
 */
export function resolveToolRiskLevel(
  riskClass: ToolRiskClass,
  explicitRiskLevel?: ToolRiskLevel,
): ToolRiskLevel {
  return explicitRiskLevel ?? RISK_CLASS_TO_LEVEL[riskClass];
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
  /** Legacy 4-class capability label. Preserved for back-compat. New
      tool registrations may set `riskLevel` directly; the back-compat
      map in `RISK_CLASS_TO_LEVEL` resolves the level when only
      `riskClass` is set. */
  riskClass: ToolRiskClass;
  /** New 6-level capability lattice (Item D of the OpenClaw-inspired
      Phase 1). When present, takes precedence over the legacy
      `riskClass` for approval-gate comparisons. Use
      `resolveToolRiskLevel(riskClass, riskLevel)` in code that needs
      the canonical value. */
  riskLevel?: ToolRiskLevel;
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
  /**
   * The tool was blocked by the centralized ApprovalPolicy because the
   * action category (EXTERNAL_POST / DESTRUCTIVE / CREDENTIAL / INSTALL)
   * requires explicit approval and the call did not include an
   * approvalId. Caller should pause the workflow, emit an
   * ApprovalRequest with the proposed input, and re-issue the tool call
   * with `context.approvalId` after the user decides.
   */
  | 'approval_required'
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
