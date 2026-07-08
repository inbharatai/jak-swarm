/**
 * code-repair.ts — HyperAgent Phase 12 shared types: bounded code self-repair (R5).
 *
 * Repair level R5 = the HyperAgent patches the CODEBASE itself. Per the standing
 * security constraint, code self-repair may create an ISOLATED branch + a DRAFT
 * pull request ONLY — it must NEVER push directly to main, NEVER deploy, NEVER
 * merge its own PR, and NEVER touch branch protection / secrets / deploys / the
 * Shield / approval controls. These types model a code-repair proposal + the
 * bounded lifecycle it moves through; the pure policy gate (code-repair.ts in
 * swarm) classifies each proposal SAFE / NEEDS_REVIEW / FORBIDDEN and refuses to
 * create a branch for any FORBIDDEN proposal.
 */

/** The kind of code repair a proposal makes. */
export enum CodeRepairKind {
  BUG_FIX = 'BUG_FIX',
  REFACTOR = 'REFACTOR',
  GUARDRAIL_ADDITION = 'GUARDRAIL_ADDITION',
  TEST_ADDITION = 'TEST_ADDITION',
  CONFIG_FIX = 'CONFIG_FIX',
}

/** The bounded lifecycle a code repair moves through. */
export enum CodeRepairStatus {
  DRAFT = 'DRAFT',
  BRANCH_CREATED = 'BRANCH_CREATED',
  PR_OPENED = 'PR_OPENED',
  PR_DRAFT = 'PR_DRAFT',
  REJECTED = 'REJECTED',
  MERGED = 'MERGED',
  ABANDONED = 'ABANDONED',
}

/** The safety class the policy gate assigns to a proposal. */
export enum CodeRepairSafetyClass {
  /** Allowed to create a branch + draft PR. */
  SAFE = 'SAFE',
  /** Allowed, but a human MUST review before any merge (always true for R5). */
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  /** The agent may NOT even create a branch — hard boundary. */
  FORBIDDEN = 'FORBIDDEN',
}

/** The risk level of a proposed patch (mirrors RiskLevel but kept independent). */
export type CodeRepairRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** A code-repair proposal (the agent's output; the gate decides if it may proceed). */
export interface CodeRepairProposal {
  id: string;
  tenantId: string;
  /** The diagnosis that triggered this repair, if any. */
  failureDiagnosisId?: string | null;
  kind: CodeRepairKind;
  /** Repo-relative path(s) the patch touches. */
  targetFiles: string[];
  /** Optional symbol (function/class) the patch is about. */
  targetSymbol?: string;
  description: string;
  /** A unified diff or patch payload (Text). Never executed by the agent. */
  patchDiff: string;
  rationale: string;
  risk: CodeRepairRisk;
  /** The isolated branch the patch would land on (never main/master). */
  branchName: string;
  createdBy: string;
  createdAt: string;
}

/** The policy that bounds code self-repair (the hard boundary). */
export interface CodeRepairPolicy {
  /**
   * Path prefixes/globs the agent may NEVER touch (FORBIDDEN). Defaults encode
   * the standing constraint: branch protection, CI/deploys, secrets, the Shield,
   * approval controls, governance, autonomy policy.
   */
  forbiddenPathPrefixes: readonly string[];
  /** Symbols the agent may NEVER touch (e.g. setShieldGateway, modifyBranchProtection). */
  forbiddenSymbols: readonly string[];
  /** Substrings in the diff/rationale that mark a patch FORBIDDEN. */
  forbiddenDiffMarkers: readonly string[];
  /** Max files a single patch may touch (explodes ⇒ NEEDS_REVIEW → likely reject). */
  maxFilesPerPatch: number;
  /** Whether a human must review before merge (ALWAYS true for R5). */
  requireHumanReview: boolean;
  /** Whether the PR must be opened as a DRAFT (ALWAYS true for R5). */
  requireDraftPR: boolean;
}

/** The result of classifying + validating a proposal. */
export interface CodeRepairReview {
  safety: CodeRepairSafetyClass;
  valid: boolean;
  issues: string[];
  /** The reason a FORBIDDEN proposal was blocked (audit). */
  blockReason: string | null;
}

export const DEFAULT_CODE_REPAIR_POLICY: CodeRepairPolicy = Object.freeze({
  // Hard boundaries from the standing security constraint. The agent may NEVER
  // touch: branch protection / CI workflows / deploys, secrets, the JAK Shield,
  // approval controls, governance + autonomy policy, or its own permissions.
  forbiddenPathPrefixes: Object.freeze([
    '.github/workflows/',
    '.github/branch-protection',
    'packages/security/src/shield-gateway/',
    'packages/security/src/governance/',
    'packages/security/src/encryption/',
    'packages/security/src/rbac/',
    'packages/security/src/audit/',
    'packages/db/prisma/migrations/',
    'secrets/',
    '.env',
    'deploy/',
    'infrastructure/',
  ]),
  forbiddenSymbols: Object.freeze([
    'setShieldGateway',
    'setShieldGatewayForTesting',
    'evaluateAutonomy',
    'evaluateForConfig',
    'modifyBranchProtection',
    'deployProduction',
    'changeSecrets',
    'approvePayments',
    'deleteProductionData',
    'expandPermissions',
    'mergeOwnPullRequest',
    'disableShield',
  ]),
  forbiddenDiffMarkers: Object.freeze([
    'JAK_SHIELD_DISABLE',
    'approval_required = false',
    'requiresApproval = false',
    'branch_protection',
    'auto_merge',
    'auto_deploy',
    'GITHUB_TOKEN',
    'AWS_SECRET_ACCESS_KEY',
    'OPENAI_API_KEY',
  ]),
  maxFilesPerPatch: 5,
  requireHumanReview: true,
  requireDraftPR: true,
});