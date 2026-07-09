/**
 * hyperagent.ts — shared types for the bounded HyperAgent self-healing +
 * self-learning layer.
 *
 * Design rule (from the HyperAgent spec): autonomy is an explicit, bounded
 * ladder. The system can be strongly autonomous without being unaccountable.
 * Every capability the HyperAgent may exercise is gated by an `AutonomyLevel`,
 * and a fixed set of capabilities (merge, deploy, secrets, payments, production
 * data deletion, external publish, permission expansion, governance rewrite)
 * are *never* autonomous — they require a human at every level.
 *
 * These types are pure data + enums. The decision logic lives in
 * `packages/security/src/governance/autonomy-policy.ts` so there is ONE
 * central evaluator (the spec mandates: "Do not scatter autonomy checks
 * through unrelated files").
 */

/** Coarse execution mode for the HyperAgent layer on a tenant. */
export enum HyperAgentMode {
  /** HyperAgent layer fully off — current Swarm behaviour, no changes. */
  OFF = 'OFF',
  /** Run the diagnosis/evaluation pipeline but take no action; emit reports only. */
  OBSERVE = 'OBSERVE',
  /** Propose repairs/learnings and execute safe ones within the autonomy level. */
  ASSISTED = 'ASSISTED',
  /** Autonomous within the safe boundary defined by the autonomy level + budgets. */
  AUTONOMOUS_SAFE = 'AUTONOMOUS_SAFE',
}

/**
 * Autonomy ladder. Each level strictly *adds* capabilities to the level below;
 * it never removes a hard block. See `AUTONOMY_CAPABILITY_MATRIX` in
 * autonomy-policy.ts for the canonical mapping.
 *
 *  L0 — Observe and report
 *  L1 — Propose repairs and learnings
 *  L2 — Retry safe read-only failures and correct outputs
 *  L3 — Replan within existing approved agents, tools and budget
 *  L4 — Run prompt/workflow experiments in shadow and canary modes
 *  L5 — Create code branches and draft PRs; human merge required
 */
export enum AutonomyLevel {
  L0 = 'L0',
  L1 = 'L1',
  L2 = 'L2',
  L3 = 'L3',
  L4 = 'L4',
  L5 = 'L5',
}

/**
 * Capabilities the HyperAgent might attempt. Grouped:
 *  - SAFE_*   : permitted at some autonomy level without approval
 *  - APPROVAL_* : permitted only with explicit human approval (never autonomous)
 *  - NEVER_*  : blocked at every autonomy level — human-only, always
 */
export enum AutonomyCapability {
  /** Read-only observation / reporting. */
  OBSERVE_REPORT = 'OBSERVE_REPORT',
  /** Propose (not apply) repairs and learnings for human review. */
  PROPOSE_REPAIRS = 'PROPOSE_REPAIRS',
  PROPOSE_LEARNINGS = 'PROPOSE_LEARNINGS',
  /** Retry a transient/read-only failure (R1). */
  RETRY_SAFE_READONLY = 'RETRY_SAFE_READONLY',
  /** Regenerate an output using verifier feedback (R2). */
  CORRECT_OUTPUT = 'CORRECT_OUTPUT',
  /** Replan within already-approved agents/tools/budget (R3). */
  REPLAN_WITHIN_APPROVED = 'REPLAN_WITHIN_APPROVED',
  /** Propose prompt/router/workflow changes (R4) — promotion is a separate gate. */
  PROPOSE_CONFIG_CHANGE = 'PROPOSE_CONFIG_CHANGE',
  /** Run a candidate change in shadow mode (no user-facing effect). */
  SHADOW_EXPERIMENT = 'SHADOW_EXPERIMENT',
  /** Run an approved candidate in canary mode (limited user-facing effect). */
  CANARY_EXPERIMENT = 'CANARY_EXPERIMENT',
  /** Promote a versioned config change to ACTIVE after gates pass. */
  PROMOTE_CONFIG = 'PROMOTE_CONFIG',
  /** Create an isolated branch + draft PR with a code patch (R5). */
  CODE_PATCH_BRANCH = 'CODE_PATCH_BRANCH',

  // — Approval-gated: never autonomous, even at L5 —
  /** Merge a pull request. */
  MERGE_PR = 'MERGE_PR',
  /** Deploy to production. */
  DEPLOY_PRODUCTION = 'DEPLOY_PRODUCTION',
  /** Change/rotate secrets or credentials. */
  CHANGE_SECRETS = 'CHANGE_SECRETS',
  /** Approve or send a payment. */
  APPROVE_PAYMENTS = 'APPROVE_PAYMENTS',
  /** Delete production data. */
  DELETE_PRODUCTION_DATA = 'DELETE_PRODUCTION_DATA',
  /** Publish content/messages externally (LinkedIn, YouTube, email blasts, …). */
  PUBLISH_EXTERNALLY = 'PUBLISH_EXTERNALLY',
  /** Expand an agent's permissions or autonomy level. */
  EXPAND_PERMISSIONS = 'EXPAND_PERMISSIONS',
  /** Modify the governance rules / autonomy policy itself. */
  MODIFY_GOVERNANCE = 'MODIFY_GOVERNANCE',
}

/** Result of an autonomy policy evaluation. */
export interface AutonomyDecision {
  capability: AutonomyCapability;
  level: AutonomyLevel;
  /** True if the HyperAgent may perform the action without a human. */
  allowed: boolean;
  /** True if a human must approve first (allowed only after approval). */
  requiresApproval: boolean;
  /** Human-readable reason for audit logging. */
  reason: string;
}

/**
 * Unified repair budgets for the HyperAgent repair-budget auction. The live
 * same-input R1/R2 loop is now unified on `taskRetryCount` + a single shared
 * `MAX_TASK_RETRIES` ceiling (edges.ts / verifier-node.ts); this `RepairBudget`
 * is the richer model the auction uses to allocate finite budget across repair
 * levels (R1 execution retry · R2 output correction · R3 plan repair · ...).
 */
export interface RepairBudget {
  maxExecutionRetries: number;
  maxOutputRepairs: number;
  maxPlanRepairs: number;
  maxCapabilityRepairs: number;
  maxTotalCostUsd: number;
  maxDurationMs: number;
}

/** Tenant-level HyperAgent configuration (one row per tenant). */
export interface HyperAgentConfig {
  tenantId: string;
  hyperAgentEnabled: boolean;
  hyperAgentMode: HyperAgentMode;
  autonomyLevel: AutonomyLevel;
  maxHyperAgentIterations: number;
  budget: RepairBudget;
  allowShadowOptimization: boolean;
  allowCanaryOptimization: boolean;
  allowCodePatchProposal: boolean;
  requireApprovalForPromptPromotion: boolean;
  requireApprovalForWorkflowPromotion: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Safe defaults — disabled, observe-only, zero budget. Preserves current behaviour. */
export const DEFAULT_HYPERAGENT_BUDGET: RepairBudget = {
  maxExecutionRetries: 2,
  maxOutputRepairs: 2,
  maxPlanRepairs: 1,
  maxCapabilityRepairs: 1,
  maxTotalCostUsd: 0,
  maxDurationMs: 0,
};