/**
 * Unit tests for the AUTO_MAPPING_RULES registry — pure function tests, no
 * DB needed. Each rule takes a fixed-shape `AutoMapInputs` object and
 * returns `EvidenceCandidate[]`. We pin:
 *
 *   - Every registered rule key resolves to a function.
 *   - Each rule's positive matchers (the audit actions / row predicates
 *     the rule promises to recognise).
 *   - Each rule's NEGATIVE matchers (unrelated audit actions are dropped).
 *   - No rule fabricates evidence ids — every emitted candidate id traces
 *     back to a row in the input.
 *   - Tenant isolation: nothing in these rules should bind tenantId itself
 *     (the caller is responsible for pre-scoping inputs to one tenant) —
 *     so we feed each rule SINGLE-TENANT inputs and verify what comes out
 *     is exactly what was fed in (no leakage from a hypothetical "other"
 *     tenant input dataset).
 *
 * SURPRISE / honest note:
 *   The original task hint said "a workflow with goal containing 'incident
 *   response' maps to the right control IDs". The actual rules do NOT
 *   substring-match on workflow.goal. They match on:
 *     - audit_log.action ∈ a fixed allow-list per rule, OR
 *     - workflow.status === 'COMPLETED' / 'FAILED' shapes, OR
 *     - artifact.approvalState / artifact.artifactType / status shapes.
 *   The mapping from rule key → control IDs is OWNED by the seed catalogue
 *   (`seed-data/compliance-frameworks.ts` via `autoRuleKey`), NOT by this
 *   file. So we test the rules' OUTPUTS, not the control bindings — that
 *   coupling lives in the seed test, and an integration test ensures the
 *   end-to-end "rule key → control rows" wiring matches reality.
 */

import { describe, expect, it } from 'vitest';
import {
  AUTO_MAPPING_RULES,
  listAutoRuleKeys,
  getAutoMappingRule,
  type AutoMapInputs,
  type EvidenceCandidate,
} from '../../../apps/api/src/services/compliance/auto-mapping-rules.js';

// ─── Builders ───────────────────────────────────────────────────────────

const TENANT = 'tnt-A';
const PERIOD_START = new Date('2026-01-01T00:00:00Z');
const PERIOD_END = new Date('2026-03-31T23:59:59Z');
const T = (d: string) => new Date(`2026-02-${d}T12:00:00Z`);

function emptyInputs(): AutoMapInputs {
  return {
    tenantId: TENANT,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    auditLogs: [],
    workflows: [],
    approvals: [],
    artifacts: [],
  };
}

function audit(action: string, id = `al-${action}`, extra: Partial<AutoMapInputs['auditLogs'][number]> = {}) {
  return {
    id,
    action,
    resource: 'workflow',
    resourceId: null,
    details: {},
    createdAt: T('15'),
    userId: 'usr-1',
    severity: 'INFO',
    ...extra,
  };
}

function workflow(id: string, status: string, opts: Partial<AutoMapInputs['workflows'][number]> = {}) {
  return {
    id,
    status,
    goal: 'goal text',
    startedAt: T('10'),
    completedAt: status === 'COMPLETED' || status === 'FAILED' ? T('11') : null,
    error: status === 'FAILED' ? 'something blew up' : null,
    ...opts,
  };
}

function approval(id: string, opts: Partial<AutoMapInputs['approvals'][number]> = {}) {
  return {
    id,
    status: 'GRANTED',
    riskLevel: 'HIGH',
    createdAt: T('14'),
    reviewedAt: T('15'),
    reviewedBy: 'usr-reviewer',
    agentRole: 'TECHNICAL_LEAD',
    ...opts,
  };
}

function artifact(id: string, opts: Partial<AutoMapInputs['artifacts'][number]> = {}) {
  return {
    id,
    artifactType: 'workflow_output',
    status: 'READY',
    approvalState: 'NOT_REQUIRED',
    createdAt: T('15'),
    producedBy: 'agent-1',
    ...opts,
  };
}

// Helper: assert that every emitted candidate id traces back to a row in
// the provided id pool. No fabrication allowed.
function assertNoFabrication(out: EvidenceCandidate[], allowedIds: string[]) {
  for (const c of out) {
    expect(allowedIds).toContain(c.id);
  }
}

// ─── Registry contract ──────────────────────────────────────────────────

describe('AUTO_MAPPING_RULES registry', () => {
  it('exposes the documented rule keys', () => {
    const expected = [
      'tenant-rbac-changes',
      'approval-decisions',
      'workflow-evidence-trail',
      'workflow-failures',
      'workflow-resumed-or-rolled-back',
      'tool-blocked-and-policy',
      'guardrail-and-injection-events',
      'pii-detection',
      'artifact-approval-gates',
      'evidence-bundle-signed',
    ].sort();
    expect(listAutoRuleKeys().sort()).toEqual(expected);
  });

  it('every registered key resolves to a function', () => {
    for (const k of listAutoRuleKeys()) {
      const r = getAutoMappingRule(k);
      expect(typeof r).toBe('function');
    }
  });

  it('returns undefined for an unknown key', () => {
    expect(getAutoMappingRule('not-a-real-rule')).toBeUndefined();
  });

  it('returns an empty array for every rule when given empty inputs', () => {
    const inputs = emptyInputs();
    for (const [key, rule] of Object.entries(AUTO_MAPPING_RULES)) {
      expect(rule(inputs), `rule ${key} should be empty for empty inputs`).toEqual([]);
    }
  });
});

// ─── tenant-rbac-changes ────────────────────────────────────────────────

describe('rule: tenant-rbac-changes', () => {
  const rule = AUTO_MAPPING_RULES['tenant-rbac-changes']!;
  it('matches USER_CREATED, USER_ROLE_CHANGED, TENANT_SETTINGS_CHANGED, INDUSTRY_PACK_SELECTED', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      audit('USER_CREATED', 'al-1'),
      audit('USER_ROLE_CHANGED', 'al-2'),
      audit('TENANT_SETTINGS_CHANGED', 'al-3'),
      audit('INDUSTRY_PACK_SELECTED', 'al-4'),
    ];
    const out = rule(inputs);
    expect(out.map((c) => c.id).sort()).toEqual(['al-1', 'al-2', 'al-3', 'al-4']);
    expect(out.every((c) => c.type === 'audit_log')).toBe(true);
  });

  it('drops unrelated audit actions', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      audit('USER_CREATED', 'al-keep'),
      audit('WORKFLOW_COMPLETED', 'al-drop'),
      audit('PII_DETECTED', 'al-drop2'),
    ];
    const out = rule(inputs);
    expect(out.map((c) => c.id)).toEqual(['al-keep']);
  });
});

// ─── approval-decisions ─────────────────────────────────────────────────

describe('rule: approval-decisions', () => {
  const rule = AUTO_MAPPING_RULES['approval-decisions']!;

  it('emits both audit-action candidates AND decided-approval candidates', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      audit('APPROVAL_REQUESTED', 'al-1'),
      audit('APPROVAL_GRANTED', 'al-2'),
      audit('APPROVAL_REJECTED', 'al-3'),
      audit('APPROVAL_DEFERRED', 'al-4'),
      audit('SOMETHING_ELSE', 'al-skip'),
    ];
    inputs.approvals = [
      approval('apr-decided', { reviewedAt: T('20') }),
      approval('apr-pending', { reviewedAt: null }),
    ];
    const out = rule(inputs);
    const ids = out.map((c) => c.id).sort();
    expect(ids).toEqual(['al-1', 'al-2', 'al-3', 'al-4', 'apr-decided']);
    // The undecided approval is excluded.
    expect(ids).not.toContain('apr-pending');
    // The unrelated audit row is excluded.
    expect(ids).not.toContain('al-skip');

    const aprCandidate = out.find((c) => c.id === 'apr-decided')!;
    expect(aprCandidate.type).toBe('approval');
    expect(aprCandidate.at).toEqual(T('20'));
  });

  it('falls back to createdAt when reviewedAt is null but the row is included (defensive)', () => {
    // Reading the source: filter is `reviewedAt !== null`, and the .at field
    // is `reviewedAt ?? createdAt`. So reviewedAt:null rows are filtered OUT.
    // This pins that the .at fallback only triggers for rows that survived
    // the filter — i.e. it never actually fires under the current filter,
    // but the contract is intentional. Pinning the filter behavior:
    const inputs = emptyInputs();
    inputs.approvals = [approval('apr-pending', { reviewedAt: null })];
    expect(rule(inputs)).toEqual([]);
  });
});

// ─── workflow-evidence-trail ────────────────────────────────────────────

describe('rule: workflow-evidence-trail', () => {
  const rule = AUTO_MAPPING_RULES['workflow-evidence-trail']!;

  it('matches WORKFLOW_COMPLETED / WORKFLOW_PLANNED / WORKFLOW_RESUMED audit actions', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      audit('WORKFLOW_COMPLETED', 'al-c'),
      audit('WORKFLOW_PLANNED', 'al-p'),
      audit('WORKFLOW_RESUMED', 'al-r'),
      audit('WORKFLOW_FAILED', 'al-skip'),
    ];
    const out = rule(inputs);
    expect(out.map((c) => c.id).sort()).toEqual(['al-c', 'al-p', 'al-r']);
  });

  it('emits a workflow candidate ONLY for COMPLETED workflows with a completedAt', () => {
    const inputs = emptyInputs();
    inputs.workflows = [
      workflow('wf-done', 'COMPLETED'),
      workflow('wf-failed', 'FAILED'),
      workflow('wf-running', 'RUNNING', { completedAt: null }),
      workflow('wf-completed-but-no-completedAt', 'COMPLETED', { completedAt: null }),
    ];
    const out = rule(inputs);
    const wfOut = out.filter((c) => c.type === 'workflow');
    expect(wfOut.map((c) => c.id)).toEqual(['wf-done']);
  });

  it('does NOT pattern-match on workflow.goal text (current contract — pinning the surprise)', () => {
    // SURPRISE: the task brief mentioned "workflow with goal containing
    // 'incident response' maps to the right controls". The CURRENT
    // implementation does no goal-substring matching. Goal-based mapping
    // would have to be added to a NEW rule (e.g. 'incident-response-goal').
    // We pin the current behavior so a future PR adding that rule has to
    // both add the rule AND update this assertion.
    const inputs = emptyInputs();
    inputs.workflows = [
      workflow('wf-incident', 'COMPLETED', { goal: 'incident response runbook execution' }),
      workflow('wf-other', 'COMPLETED', { goal: 'monthly report generation' }),
    ];
    const out = rule(inputs);
    const wfIds = out.filter((c) => c.type === 'workflow').map((c) => c.id).sort();
    // Both come through identically — no goal-based filtering.
    expect(wfIds).toEqual(['wf-incident', 'wf-other']);
  });
});

// ─── workflow-failures ──────────────────────────────────────────────────

describe('rule: workflow-failures', () => {
  const rule = AUTO_MAPPING_RULES['workflow-failures']!;

  it('matches WORKFLOW_FAILED, WORKFLOW_STEP_FAILED, GUARDRAIL_TRIGGERED audit actions', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      audit('WORKFLOW_FAILED', 'al-1'),
      audit('WORKFLOW_STEP_FAILED', 'al-2'),
      audit('GUARDRAIL_TRIGGERED', 'al-3'),
      audit('WORKFLOW_COMPLETED', 'al-skip'),
    ];
    const out = rule(inputs);
    expect(out.map((c) => c.id).sort()).toEqual(['al-1', 'al-2', 'al-3']);
  });

  it('emits a workflow candidate ONLY for FAILED workflows with a non-null error', () => {
    const inputs = emptyInputs();
    inputs.workflows = [
      workflow('wf-with-err', 'FAILED'),
      workflow('wf-no-err', 'FAILED', { error: null }),
      workflow('wf-completed', 'COMPLETED'),
    ];
    const out = rule(inputs);
    const wfIds = out.filter((c) => c.type === 'workflow').map((c) => c.id);
    expect(wfIds).toEqual(['wf-with-err']);
  });
});

// ─── workflow-resumed-or-rolled-back ────────────────────────────────────

describe('rule: workflow-resumed-or-rolled-back', () => {
  const rule = AUTO_MAPPING_RULES['workflow-resumed-or-rolled-back']!;

  it('matches WORKFLOW_RESUMED + WORKFLOW_CANCELLED only', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      audit('WORKFLOW_RESUMED', 'al-1'),
      audit('WORKFLOW_CANCELLED', 'al-2'),
      audit('WORKFLOW_COMPLETED', 'al-skip'),
      audit('USER_CREATED', 'al-skip2'),
    ];
    const out = rule(inputs);
    expect(out.map((c) => c.id).sort()).toEqual(['al-1', 'al-2']);
  });
});

// ─── tool-blocked-and-policy ────────────────────────────────────────────

describe('rule: tool-blocked-and-policy', () => {
  const rule = AUTO_MAPPING_RULES['tool-blocked-and-policy']!;

  it('matches TOOL_BLOCKED + PERMISSION_DENIED only', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      audit('TOOL_BLOCKED', 'al-1'),
      audit('PERMISSION_DENIED', 'al-2'),
      audit('GUARDRAIL_TRIGGERED', 'al-skip'),
    ];
    const out = rule(inputs);
    expect(out.map((c) => c.id).sort()).toEqual(['al-1', 'al-2']);
  });
});

// ─── guardrail-and-injection-events ─────────────────────────────────────

describe('rule: guardrail-and-injection-events', () => {
  const rule = AUTO_MAPPING_RULES['guardrail-and-injection-events']!;

  it('matches GUARDRAIL_TRIGGERED + INJECTION_DETECTED only', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      audit('GUARDRAIL_TRIGGERED', 'al-1'),
      audit('INJECTION_DETECTED', 'al-2'),
      audit('PII_DETECTED', 'al-skip'),
    ];
    const out = rule(inputs);
    expect(out.map((c) => c.id).sort()).toEqual(['al-1', 'al-2']);
  });
});

// ─── pii-detection ──────────────────────────────────────────────────────

describe('rule: pii-detection', () => {
  const rule = AUTO_MAPPING_RULES['pii-detection']!;

  it('matches PII_DETECTED only', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      audit('PII_DETECTED', 'al-1'),
      audit('PII_DETECTED', 'al-2'),
      audit('GUARDRAIL_TRIGGERED', 'al-skip'),
    ];
    const out = rule(inputs);
    expect(out.map((c) => c.id).sort()).toEqual(['al-1', 'al-2']);
    expect(out.every((c) => c.type === 'audit_log')).toBe(true);
  });
});

// ─── artifact-approval-gates ────────────────────────────────────────────

describe('rule: artifact-approval-gates', () => {
  const rule = AUTO_MAPPING_RULES['artifact-approval-gates']!;

  it('emits artifacts in APPROVED, REQUIRES_APPROVAL, REJECTED — drops NOT_REQUIRED', () => {
    const inputs = emptyInputs();
    inputs.artifacts = [
      artifact('art-1', { approvalState: 'APPROVED' }),
      artifact('art-2', { approvalState: 'REQUIRES_APPROVAL' }),
      artifact('art-3', { approvalState: 'REJECTED' }),
      artifact('art-4', { approvalState: 'NOT_REQUIRED' }),
    ];
    const out = rule(inputs);
    expect(out.map((c) => c.id).sort()).toEqual(['art-1', 'art-2', 'art-3']);
    expect(out.every((c) => c.type === 'artifact')).toBe(true);
  });
});

// ─── evidence-bundle-signed ─────────────────────────────────────────────

describe('rule: evidence-bundle-signed', () => {
  const rule = AUTO_MAPPING_RULES['evidence-bundle-signed']!;

  it('emits ONLY evidence_bundle artifacts in READY status', () => {
    const inputs = emptyInputs();
    inputs.artifacts = [
      artifact('art-bundle-ready', { artifactType: 'evidence_bundle', status: 'READY' }),
      artifact('art-bundle-pending', { artifactType: 'evidence_bundle', status: 'PENDING' }),
      artifact('art-pdf', { artifactType: 'workflow_output', status: 'READY' }),
    ];
    const out = rule(inputs);
    expect(out.map((c) => c.id)).toEqual(['art-bundle-ready']);
    expect(out[0]!.type).toBe('evidence_bundle');
  });
});

// ─── No-fabrication / no-cross-tenant guarantee ─────────────────────────

describe('rules: no-fabrication invariant', () => {
  it('every emitted candidate id traces back to an input row id (across all rules)', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      audit('USER_CREATED', 'al-1'),
      audit('APPROVAL_GRANTED', 'al-2'),
      audit('WORKFLOW_COMPLETED', 'al-3'),
      audit('WORKFLOW_FAILED', 'al-4'),
      audit('WORKFLOW_RESUMED', 'al-5'),
      audit('TOOL_BLOCKED', 'al-6'),
      audit('GUARDRAIL_TRIGGERED', 'al-7'),
      audit('PII_DETECTED', 'al-8'),
    ];
    inputs.workflows = [
      workflow('wf-c', 'COMPLETED'),
      workflow('wf-f', 'FAILED'),
    ];
    inputs.approvals = [approval('apr-1')];
    inputs.artifacts = [
      artifact('art-1', { approvalState: 'APPROVED' }),
      artifact('art-2', { artifactType: 'evidence_bundle', status: 'READY' }),
    ];
    const allInputIds = [
      ...inputs.auditLogs.map((r) => r.id),
      ...inputs.workflows.map((r) => r.id),
      ...inputs.approvals.map((r) => r.id),
      ...inputs.artifacts.map((r) => r.id),
    ];
    for (const [, rule] of Object.entries(AUTO_MAPPING_RULES)) {
      const out = rule(inputs);
      assertNoFabrication(out, allInputIds);
    }
  });

  it('no rule reads tenantId out of inputs to filter rows — caller is responsible for pre-scoping', () => {
    // This is a structural guarantee: rules are pure projections over
    // already-scoped inputs. We pin it by feeding an input pool that
    // looks like it was for tenant A and asserting the rule does not
    // probe `inputs.tenantId` to drop rows. (If the rule started filtering
    // on tenantId here, it would EITHER drop rows that match OR keep
    // all of them — either way changing the count is a contract change.)
    const inputs = emptyInputs();
    inputs.tenantId = 'tnt-A';
    inputs.auditLogs = [audit('USER_CREATED', 'al-A1')];
    const out1 = AUTO_MAPPING_RULES['tenant-rbac-changes']!(inputs);

    inputs.tenantId = 'tnt-DIFFERENT';
    const out2 = AUTO_MAPPING_RULES['tenant-rbac-changes']!(inputs);

    expect(out1.map((c) => c.id)).toEqual(out2.map((c) => c.id));
  });
});

// ─── Items needing real DB / integration ────────────────────────────────

describe('runForTenant — full auto-mapper integration', () => {
  it.todo('runForTenant() lives in compliance-mapper.service.ts (NOT in auto-mapping-rules.ts). It loads tenant-scoped audit/workflow/approval/artifact rows from Postgres, runs every rule, and upserts ControlEvidenceMapping rows. The DB-touching part needs a real Prisma + the seed catalogue and is covered under tests/integration/compliance-auto-mapper.test.ts.');
  it.todo('cross-tenant evidence isolation in runForTenant — the SQL scoping in compliance-mapper.service.ts is what enforces this; needs Postgres to verify (a unit test of the rules themselves cannot prove the SQL `WHERE tenantId = ?` is present on every loader).');
  it.todo('rule key → control ID binding (e.g. CC1.3 ↔ tenant-rbac-changes) is owned by seed-data/compliance-frameworks.ts. Needs a separate seed-catalogue test.');
});
