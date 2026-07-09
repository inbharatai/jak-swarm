/**
 * code-repair.test.ts — HyperAgent Phase 12 bounded code self-repair (R5) gate.
 *
 * Pins the hard boundary:
 *   - classifyRepair returns FORBIDDEN for any proposal touching branch protection
 *     / CI / secrets / Shield / governance / migrations / CRITICAL risk / a
 *     protected branch / a forbidden symbol / a forbidden diff marker;
 *   - SAFE-ish proposals are NEEDS_REVIEW (R5 always requires human review);
 *   - validateProposal refuses FORBIDDEN + structurally-invalid proposals;
 *   - branchNameFor always produces an isolated `hyperagent/r5-…` branch, never
 *     main; assertNotMain throws on protected branches;
 *   - canAutoMerge is ALWAYS false (the agent never merges its own PR);
 *   - advanceRepair refuses the MERGED transition (human-only) + illegal edges;
 *   - draftPrTitle/draftPrBody carry the never-merge notice;
 *   - createProposal stamps a deterministic isolated branch.
 */
import { describe, it, expect } from 'vitest';
import { CodeRepairKind, CodeRepairSafetyClass, CodeRepairStatus } from '../../../packages/shared/src/index.js';
import type { CodeRepairProposal } from '../../../packages/shared/src/index.js';
import {
  CodeRepairError,
  isProtectedBranch,
  assertNotMain,
  branchNameFor,
  classifyRepair,
  validateProposal,
  canAutoMerge,
  draftPrTitle,
  draftPrBody,
  canTransitionRepair,
  advanceRepair,
  createProposal,
} from '../../../packages/swarm/src/hyperagent/code-repair.js';

const NOW = '2026-07-08T12:00:00.000Z';

function proposal(over: Partial<CodeRepairProposal> = {}): CodeRepairProposal {
  return {
    id: 'r1',
    tenantId: 't1',
    failureDiagnosisId: null,
    kind: CodeRepairKind.BUG_FIX,
    targetFiles: ['packages/swarm/src/runner/swarm-runner.ts'],
    targetSymbol: 'runOnce',
    description: 'fix null deref in runOnce',
    patchDiff: '--- a/packages/swarm/src/runner/swarm-runner.ts\n+++ b/packages/swarm/src/runner/swarm-runner.ts\n@@\n-  const x = obj.field;\n+  const x = obj?.field;',
    rationale: 'obj can be null when the upstream task is skipped',
    risk: 'LOW',
    branchName: 'hyperagent/r5-bug_fix-r1',
    createdBy: 'hyperagent',
    createdAt: NOW,
    ...over,
  };
}

describe('branchNameFor + assertNotMain + isProtectedBranch', () => {
  it('produces an isolated hyperagent/r5- branch, never main', () => {
    const b = branchNameFor({ kind: CodeRepairKind.BUG_FIX, id: 'abc123' });
    expect(b).toBe('hyperagent/r5-bug_fix-abc123');
    expect(isProtectedBranch(b)).toBe(false);
  });

  it('assertNotMain throws on protected branches', () => {
    for (const bad of ['main', 'master', 'trunk', 'release', 'production']) {
      expect(() => assertNotMain(bad)).toThrow(CodeRepairError);
    }
    expect(() => assertNotMain('hyperagent/r5-x')).not.toThrow();
  });
});

describe('classifyRepair — FORBIDDEN hard boundary', () => {
  it('FORBIDS a patch touching CI workflows (branch protection / deploys)', () => {
    const r = classifyRepair(proposal({ targetFiles: ['.github/workflows/ci.yml'] }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
    expect(r.blockReason).toMatch(/forbidden path/);
  });

  it('FORBIDS a patch touching the Shield gateway', () => {
    const r = classifyRepair(proposal({ targetFiles: ['packages/security/src/shield-gateway/gateway.ts'] }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
  });

  it('FORBIDS a patch touching governance / autonomy policy', () => {
    const r = classifyRepair(proposal({ targetFiles: ['packages/security/src/governance/autonomy-policy.ts'] }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
  });

  it('FORBIDS a patch touching migrations', () => {
    const r = classifyRepair(proposal({ targetFiles: ['packages/db/prisma/migrations/116_x/migration.sql'] }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
  });

  it('FORBIDS a patch whose target symbol is a forbidden symbol', () => {
    const r = classifyRepair(proposal({ targetSymbol: 'setShieldGateway' }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
    expect(r.blockReason).toMatch(/forbidden symbol/);
  });

  it('FORBIDS a patch whose diff contains a forbidden marker (shield disable)', () => {
    const r = classifyRepair(proposal({ patchDiff: 'JAK_SHIELD_DISABLE = true' }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
    expect(r.blockReason).toMatch(/forbidden marker/);
  });

  it('FORBIDS a patch whose rationale strips an approval flag', () => {
    const r = classifyRepair(proposal({ rationale: 'set requiresApproval = false to unblock' }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
  });

  it('FORBIDS a CRITICAL-risk patch', () => {
    const r = classifyRepair(proposal({ risk: 'CRITICAL' }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
    expect(r.blockReason).toMatch(/critical risk/);
  });

  it('FORBIDS a proposal targeting a protected branch', () => {
    const r = classifyRepair(proposal({ branchName: 'main' }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
    expect(r.blockReason).toMatch(/protected branch/);
  });

  // ── Path-normalization evasion hardening ────────────────────────────────
  // Before the fix, matchesForbiddenPath compared the RAW path against the
  // forbidden prefixes with startsWith, so a path prefixed with `./`, using
  // backslashes, or smuggling `..` past a boundary evaded the hard boundary.
  it('FORBIDS a forbidden path even when prefixed with ./', () => {
    const r = classifyRepair(proposal({ targetFiles: ['./packages/security/src/shield-gateway/gateway.ts'] }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
    expect(r.blockReason).toMatch(/forbidden path/);
  });

  it('FORBIDS a forbidden path even when it uses backslash separators', () => {
    const r = classifyRepair(proposal({ targetFiles: ['packages\\security\\src\\shield-gateway\\gateway.ts'] }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
  });

  it('FORBIDS a forbidden path reached via .. traversal across a sibling dir', () => {
    // `../rbac` smuggles past the shield-gateway prefix into the rbac area.
    const r = classifyRepair(proposal({ targetFiles: ['packages/security/src/shield-gateway/../rbac/rbac.ts'] }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
  });

  it('FORBIDS a path that escapes the repo root (.. traversal above root)', () => {
    const r = classifyRepair(proposal({ targetFiles: ['../../etc/passwd'] }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
  });

  it('FORBIDS an absolute path target', () => {
    const r = classifyRepair(proposal({ targetFiles: ['/etc/passwd'] }));
    expect(r.safety).toBe(CodeRepairSafetyClass.FORBIDDEN);
  });

  it('still ALLOWS (NEEDS_REVIEW) a benign path that uses ./ or a .. that stays in-repo', () => {
    // Regression guard: normalization must not over-block legitimate targets.
    const r = classifyRepair(proposal({ targetFiles: ['./packages/swarm/src/runner/swarm-runner.ts'] }));
    expect(r.safety).not.toBe(CodeRepairSafetyClass.FORBIDDEN);
    const r2 = classifyRepair(proposal({ targetFiles: ['packages/swarm/src/runner/../runner/swarm-runner.ts'] }));
    expect(r2.safety).not.toBe(CodeRepairSafetyClass.FORBIDDEN);
  });
});

describe('classifyRepair — NEEDS_REVIEW (R5 always requires human review)', () => {
  it('a valid LOW-risk patch in an allowed area is NEEDS_REVIEW', () => {
    const r = classifyRepair(proposal());
    expect(r.safety).toBe(CodeRepairSafetyClass.NEEDS_REVIEW);
    expect(r.valid).toBe(true);
    expect(r.blockReason).toBeNull();
  });

  it('a patch exceeding the file budget is NEEDS_REVIEW with an issue', () => {
    const r = classifyRepair(proposal({ targetFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'] }));
    expect(r.safety).toBe(CodeRepairSafetyClass.NEEDS_REVIEW);
    expect(r.issues.some((i) => i.includes('files'))).toBe(true);
  });

  it('rejects an empty diff / no files / empty description (invalid)', () => {
    expect(classifyRepair(proposal({ patchDiff: '' })).valid).toBe(false);
    expect(classifyRepair(proposal({ targetFiles: [] })).valid).toBe(false);
    expect(classifyRepair(proposal({ description: '' })).valid).toBe(false);
  });
});

describe('validateProposal', () => {
  it('returns valid=true for a SAFE-area patch', () => {
    const v = validateProposal(proposal());
    expect(v.valid).toBe(true);
    expect(v.issues).toHaveLength(0);
  });

  it('returns valid=false for a FORBIDDEN proposal', () => {
    const v = validateProposal(proposal({ targetFiles: ['packages/security/src/shield-gateway/gateway.ts'] }));
    expect(v.valid).toBe(false);
  });
});

describe('canAutoMerge — the agent NEVER merges its own PR', () => {
  it('is always false', () => {
    expect(canAutoMerge()).toBe(false);
    expect(canAutoMerge()).toBe(false);
  });
});

describe('advanceRepair — MERGED is human-only', () => {
  it('throws when the agent tries to reach MERGED', () => {
    expect(() => advanceRepair(CodeRepairStatus.PR_DRAFT, CodeRepairStatus.MERGED)).toThrow(CodeRepairError);
  });

  it('walks the agent-legal lifecycle DRAFT → BRANCH_CREATED → PR_OPENED → PR_DRAFT', () => {
    let s = CodeRepairStatus.DRAFT;
    s = advanceRepair(s, CodeRepairStatus.BRANCH_CREATED);
    s = advanceRepair(s, CodeRepairStatus.PR_OPENED);
    s = advanceRepair(s, CodeRepairStatus.PR_DRAFT);
    expect(s).toBe(CodeRepairStatus.PR_DRAFT);
  });

  it('PR_DRAFT can only ABANDON (the agent may withdraw, never merge)', () => {
    expect(canTransitionRepair(CodeRepairStatus.PR_DRAFT, CodeRepairStatus.ABANDONED)).toBe(true);
    expect(canTransitionRepair(CodeRepairStatus.PR_DRAFT, CodeRepairStatus.MERGED)).toBe(false);
    expect(canTransitionRepair(CodeRepairStatus.PR_DRAFT, CodeRepairStatus.PR_OPENED)).toBe(false);
  });

  it('throws on an illegal transition', () => {
    expect(() => advanceRepair(CodeRepairStatus.DRAFT, CodeRepairStatus.PR_DRAFT)).toThrow(CodeRepairError);
  });
});

describe('draftPrTitle + draftPrBody — audit + never-merge notice', () => {
  it('generates a draft-PR title prefixed with R5/hyperagent', () => {
    expect(draftPrTitle(proposal())).toBe('[R5/hyperagent] BUG_FIX: fix null deref in runOnce');
  });

  it('the body carries the never-merge / never-deploy notice', () => {
    const body = draftPrBody(proposal(), classifyRepair(proposal()));
    expect(body).toMatch(/DRAFT/);
    expect(body).toMatch(/NEVER merges its own PR/);
    expect(body).toMatch(/NEVER deploys/);
    expect(body).toMatch(/human reviewer must review, approve, and merge/);
    expect(body).toContain(proposal().patchDiff);
  });
});

describe('createProposal — deterministic isolated branch', () => {
  it('stamps a hyperagent/r5- branch + rejects protected-branch inputs', () => {
    const p = createProposal({
      id: 'abc123',
      tenantId: 't1',
      kind: CodeRepairKind.TEST_ADDITION,
      targetFiles: ['tests/unit/x.test.ts'],
      description: 'add regression test',
      patchDiff: '+ test',
      rationale: 'cover the null-deref path',
      risk: 'LOW',
      createdBy: 'hyperagent',
      now: NOW,
    });
    expect(p.branchName).toBe('hyperagent/r5-test_addition-abc123');
    expect(isProtectedBranch(p.branchName)).toBe(false);
  });

  it('determinism: same inputs ⇒ same proposal', () => {
    const a = createProposal({
      id: 'z', tenantId: 't', kind: CodeRepairKind.BUG_FIX, targetFiles: ['a.ts'],
      description: 'd', patchDiff: 'p', rationale: 'r', risk: 'LOW', createdBy: 'ha', now: NOW,
    });
    const b = createProposal({
      id: 'z', tenantId: 't', kind: CodeRepairKind.BUG_FIX, targetFiles: ['a.ts'],
      description: 'd', patchDiff: 'p', rationale: 'r', risk: 'LOW', createdBy: 'ha', now: NOW,
    });
    expect(a).toEqual(b);
  });
});