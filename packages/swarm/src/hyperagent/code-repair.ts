/**
 * code-repair.ts — HyperAgent Phase 12: bounded code self-repair (R5) policy gate.
 *
 * Repair level R5 = the HyperAgent patches the codebase itself. Per the standing
 * security constraint, code self-repair may create an ISOLATED branch + a DRAFT
 * pull request ONLY — NEVER push to main, NEVER deploy, NEVER merge its own PR,
 * NEVER touch branch protection / secrets / deploys / the Shield / approval
 * controls / its own permissions. This pure core is the hard boundary:
 *
 *   - `classifyRepair` assigns SAFE / NEEDS_REVIEW / FORBIDDEN to a proposal by
 *     checking the target paths, symbols, and diff markers against the policy.
 *     A FORBIDDEN proposal is blocked — the agent may NOT even create a branch.
 *   - `validateProposal` checks structural validity (non-empty diff, file count
 *     within budget, non-CRITICAL risk — CRITICAL ⇒ FORBIDDEN).
 *   - `branchNameFor` produces a deterministic ISOLATED branch name (never main).
 *   - `assertNotMain` throws if any target branch is main/master.
 *   - `canAutoMerge` is ALWAYS false — the agent NEVER merges its own PR.
 *   - `draftPrTitle` / `draftPrBody` generate the draft-PR metadata.
 *   - `advanceRepair` walks the bounded lifecycle DRAFT → BRANCH_CREATED →
 *     PR_OPENED → PR_DRAFT (the terminal human-owned state; never auto-MERGED).
 *
 * Pure + deterministic — no I/O, no LLM, no git. The LLM wrapper (CodeRepairAgent)
 * PROPOSES a patch from a FailureDiagnosis; only this gate decides it may proceed
 * to a branch + draft PR. Honest: a proposal that the gate cannot classify as
 * SAFE is NEEDS_REVIEW (never auto-advanced past PR_DRAFT).
 */
import {
  CodeRepairKind,
  CodeRepairSafetyClass,
  CodeRepairStatus,
  DEFAULT_CODE_REPAIR_POLICY,
} from '@jak-swarm/shared';
import type {
  CodeRepairPolicy,
  CodeRepairProposal,
  CodeRepairReview,
  CodeRepairRisk,
} from '@jak-swarm/shared';

export class CodeRepairError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodeRepairError';
  }
}

const PROTECTED_BRANCHES = new Set(['main', 'master', 'trunk', 'release', 'production']);

/** True when a branch name is a protected trunk branch the agent must never push to. */
export function isProtectedBranch(branch: string): boolean {
  return PROTECTED_BRANCHES.has(branch.toLowerCase());
}

/** Throw if `branch` is a protected trunk branch (the agent must never touch main). */
export function assertNotMain(branch: string): void {
  if (isProtectedBranch(branch)) {
    throw new CodeRepairError(`code self-repair must never target a protected branch: ${branch}`);
  }
}

/**
 * Deterministic isolated branch name for a proposal. Always prefixed
 * `hyperagent/r5-` so R5 branches are identifiable + never a protected branch.
 * Pure.
 */
export function branchNameFor(proposal: Pick<CodeRepairProposal, 'kind' | 'id'>): string {
  const slug = proposal.id.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40);
  return `hyperagent/r5-${proposal.kind.toLowerCase()}-${slug}`;
}

/**
 * Normalize a target path so prefix matching can't be evaded by redundant
 * `./`, `.\`, mixed separators, or `..` traversal. Resolves `.`/`..`
 * segments lexically (no filesystem access), preserves a trailing slash, and
 * re-anchors absolute paths. Pure + deterministic.
 *
 *   ./packages/security/src/shield-gateway/x.ts  ->  packages/security/src/shield-gateway/x.ts
 *   packages\\security\\src\\shield-gateway\\x.ts   ->  packages/security/src/shield-gateway/x.ts
 *   packages/security/src/../shield-gateway/x.ts ->  packages/security/src/shield-gateway/x.ts
 *   /etc/passwd                                    ->  /etc/passwd            (absolute, kept)
 *   ../../etc/passwd                               ->  ../../etc/passwd        (`..` retained to flag escape)
 */
function normalizeTargetPath(p: string): string {
  const unified = p.replace(/\\/g, '/');
  const isAbsolute = unified.startsWith('/');
  const parts = unified.split('/');
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue; // drop empty (//, leading ./) + cwd refs
    if (seg === '..') {
      // Pop a real segment if we have one; otherwise retain the `..` so an
      // escape past the repo root is still detectable downstream.
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
      continue;
    }
    out.push(seg);
  }
  const trailing = unified.endsWith('/') ? '/' : '';
  let norm = out.join('/');
  if (isAbsolute) norm = `/${norm}`;
  if (trailing && norm.length > 0 && !norm.endsWith('/')) norm += trailing;
  if (norm.length === 0) return isAbsolute ? '/' : '.';
  return norm;
}

/**
 * True when a normalized path escapes the repo root: absolute, or still
 * contains a `..` segment after normalization (traversal above the root).
 * Such a target is itself forbidden — code self-repair must stay in-repo.
 * Pure.
 */
function escapesRepoRoot(normalized: string): boolean {
  if (normalized.startsWith('/')) return true;
  return normalized.split('/').some((seg) => seg === '..');
}

/**
 * True when a target path is forbidden: it escapes the repo root, OR it
 * matches a forbidden prefix after normalization. Normalizing the candidate
 * (but NOT the trusted prefix constants, whose trailing-slash semantics must
 * be preserved) closes the `./` / `..\` / `..`-traversal evasion that let an
 * LLM-proposed path like `./packages/security/src/shield-gateway/x.ts`
 * bypass the `packages/security/src/shield-gateway/` prefix. Pure.
 */
function matchesForbiddenPath(path: string, prefixes: readonly string[]): boolean {
  const n = normalizeTargetPath(path);
  if (escapesRepoRoot(n)) return true;
  return prefixes.some((p) => n === p || n.startsWith(p));
}

/** True when the diff/rationale contains any forbidden marker. Pure. */
function containsForbiddenMarker(haystack: string, markers: readonly string[]): string | null {
  for (const m of markers) {
    if (haystack.includes(m)) return m;
  }
  return null;
}

/**
 * Classify a proposal's safety + validity against the policy. Pure.
 *
 * FORBIDDEN (hard boundary) when ANY of:
 *   - a target path is under a forbidden prefix (security/governance/ci/secrets/...);
 *   - the target symbol is a forbidden symbol (Shield/approval/branch-protection/...);
 *   - the diff or rationale contains a forbidden marker (disable shield / approval
 *     bypass / auto-merge / auto-deploy / secret literals);
 *   - the risk is CRITICAL.
 * NEEDS_REVIEW when valid but the patch exceeds the file budget or touches a
 * sensitive area not explicitly forbidden. SAFE otherwise. The `valid` flag is
 * false when the proposal is structurally malformed (empty diff, no files).
 */
export function classifyRepair(proposal: CodeRepairProposal, policy: CodeRepairPolicy = DEFAULT_CODE_REPAIR_POLICY): CodeRepairReview {
  const issues: string[] = [];

  // Structural validity.
  if (proposal.patchDiff.trim().length === 0) issues.push('patch diff is empty');
  if (proposal.targetFiles.length === 0) issues.push('no target files specified');
  if (proposal.description.trim().length === 0) issues.push('description is empty');

  // Hard boundary: forbidden paths.
  const forbiddenFile = proposal.targetFiles.find((f) => matchesForbiddenPath(f, policy.forbiddenPathPrefixes));
  if (forbiddenFile) {
    return {
      safety: CodeRepairSafetyClass.FORBIDDEN,
      valid: false,
      issues: [...issues, `target path '${forbiddenFile}' is in a forbidden area (branch protection / CI / secrets / Shield / governance / migrations)`],
      blockReason: `forbidden path: ${forbiddenFile}`,
    };
  }

  // Hard boundary: forbidden symbols.
  if (proposal.targetSymbol && policy.forbiddenSymbols.includes(proposal.targetSymbol)) {
    return {
      safety: CodeRepairSafetyClass.FORBIDDEN,
      valid: false,
      issues: [...issues, `target symbol '${proposal.targetSymbol}' is forbidden (Shield / approval / branch-protection / permissions)`],
      blockReason: `forbidden symbol: ${proposal.targetSymbol}`,
    };
  }

  // Hard boundary: forbidden diff/rationale markers.
  const marker = containsForbiddenMarker(`${proposal.patchDiff}\n${proposal.rationale}`, policy.forbiddenDiffMarkers);
  if (marker) {
    return {
      safety: CodeRepairSafetyClass.FORBIDDEN,
      valid: false,
      issues: [...issues, `diff/rationale contains forbidden marker '${marker}'`],
      blockReason: `forbidden marker: ${marker}`,
    };
  }

  // Hard boundary: CRITICAL risk.
  if (proposal.risk === 'CRITICAL') {
    return {
      safety: CodeRepairSafetyClass.FORBIDDEN,
      valid: false,
      issues: [...issues, 'CRITICAL-risk code repair is forbidden (human must perform these)'],
      blockReason: 'critical risk',
    };
  }

  // Hard boundary: protected branch target.
  if (isProtectedBranch(proposal.branchName)) {
    return {
      safety: CodeRepairSafetyClass.FORBIDDEN,
      valid: false,
      issues: [...issues, `branch '${proposal.branchName}' is a protected trunk branch`],
      blockReason: `protected branch: ${proposal.branchName}`,
    };
  }

  // NEEDS_REVIEW when the patch exceeds the file budget.
  if (proposal.targetFiles.length > policy.maxFilesPerPatch) {
    issues.push(`patch touches ${proposal.targetFiles.length} files > max ${policy.maxFilesPerPatch}`);
    return { safety: CodeRepairSafetyClass.NEEDS_REVIEW, valid: issues.length === 0, issues, blockReason: null };
  }

  const valid = issues.length === 0;
  // R5 always requires human review before merge, so a structurally-valid
  // proposal is NEEDS_REVIEW (the human owns the merge), never auto-SAFE-past-PR.
  return { safety: CodeRepairSafetyClass.NEEDS_REVIEW, valid, issues, blockReason: null };
}

/** Validate a proposal is structurally well-formed (subset of classifyRepair). Pure. */
export function validateProposal(proposal: CodeRepairProposal, policy: CodeRepairPolicy = DEFAULT_CODE_REPAIR_POLICY): { valid: boolean; issues: string[] } {
  const r = classifyRepair(proposal, policy);
  return { valid: r.valid && r.safety !== CodeRepairSafetyClass.FORBIDDEN, issues: r.issues };
}

/** The agent NEVER merges its own PR — `canAutoMerge` is always false. Pure. */
export function canAutoMerge(): boolean {
  return false;
}

/** Generate the draft-PR title for a proposal. Pure. */
export function draftPrTitle(proposal: CodeRepairProposal): string {
  return `[R5/hyperagent] ${proposal.kind}: ${proposal.description.slice(0, 60)}`;
}

/** Generate the draft-PR body for a proposal (audit: rationale + safety + the never-merge notice). Pure. */
export function draftPrBody(proposal: CodeRepairProposal, review: CodeRepairReview): string {
  return [
    `## HyperAgent R5 code-repair proposal`,
    '',
    `**Kind:** ${proposal.kind}`,
    `**Safety class:** ${review.safety}`,
    `**Risk:** ${proposal.risk}`,
    `**Files:** ${proposal.targetFiles.join(', ')}`,
    proposal.targetSymbol ? `**Symbol:** ${proposal.targetSymbol}` : '',
    '',
    '### Rationale',
    proposal.rationale,
    '',
    '### Patch',
    '```diff',
    proposal.patchDiff,
    '```',
    '',
    review.issues.length > 0 ? `### Issues\n- ${review.issues.join('\n- ')}` : '',
    '',
    '---',
    '_Generated by the JAK Swarm HyperAgent (Phase 12). Opened as a **DRAFT** PR per the bounded self-modification policy. The HyperAgent NEVER merges its own PR and NEVER deploys — a human reviewer must review, approve, and merge._',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Allowed lifecycle transitions (bounded). */
const ALLOWED_REPAIR_TRANSITIONS: Readonly<Record<CodeRepairStatus, readonly CodeRepairStatus[]>> = Object.freeze({
  [CodeRepairStatus.DRAFT]: [CodeRepairStatus.BRANCH_CREATED, CodeRepairStatus.REJECTED, CodeRepairStatus.ABANDONED],
  [CodeRepairStatus.BRANCH_CREATED]: [CodeRepairStatus.PR_OPENED, CodeRepairStatus.REJECTED, CodeRepairStatus.ABANDONED],
  [CodeRepairStatus.PR_OPENED]: [CodeRepairStatus.PR_DRAFT, CodeRepairStatus.REJECTED, CodeRepairStatus.ABANDONED],
  // PR_DRAFT is the terminal human-owned state: the agent may NOT advance it
  // (no auto-merge, no auto-deploy). Only ABANDONED is reachable (the agent
  // may withdraw its own proposal).
  [CodeRepairStatus.PR_DRAFT]: [CodeRepairStatus.ABANDONED],
  [CodeRepairStatus.REJECTED]: [CodeRepairStatus.ABANDONED],
  [CodeRepairStatus.MERGED]: [],
  [CodeRepairStatus.ABANDONED]: [],
});

export function canTransitionRepair(from: CodeRepairStatus, to: CodeRepairStatus): boolean {
  return (ALLOWED_REPAIR_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Advance a repair's status, but ONLY through agent-legal transitions. The
 * MERGED state is NEVER agent-reachable (a human performs it out-of-band).
 * Throws CodeRepairError on an illegal transition. Pure.
 */
export function advanceRepair(
  status: CodeRepairStatus,
  to: CodeRepairStatus,
): CodeRepairStatus {
  if (to === CodeRepairStatus.MERGED) {
    throw new CodeRepairError('the HyperAgent may never merge its own PR — MERGED is human-only');
  }
  if (!canTransitionRepair(status, to)) {
    throw new CodeRepairError(`illegal code-repair transition: ${status} → ${to}`);
  }
  return to;
}

/** Create a proposal with a deterministic isolated branch name. Pure. */
export function createProposal(input: {
  id: string;
  tenantId: string;
  kind: CodeRepairKind;
  targetFiles: string[];
  targetSymbol?: string;
  description: string;
  patchDiff: string;
  rationale: string;
  risk: CodeRepairRisk;
  createdBy: string;
  now: string;
  failureDiagnosisId?: string | null;
}): CodeRepairProposal {
  const branchName = branchNameFor({ kind: input.kind, id: input.id });
  assertNotMain(branchName);
  return {
    id: input.id,
    tenantId: input.tenantId,
    failureDiagnosisId: input.failureDiagnosisId ?? null,
    kind: input.kind,
    targetFiles: input.targetFiles,
    targetSymbol: input.targetSymbol,
    description: input.description,
    patchDiff: input.patchDiff,
    rationale: input.rationale,
    risk: input.risk,
    branchName,
    createdBy: input.createdBy,
    createdAt: input.now,
  };
}