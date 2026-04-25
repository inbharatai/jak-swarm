/**
 * Compliance auto-mapping rule tests.
 *
 * Each test exercises ONE rule against a hand-crafted AutoMapInputs and
 * asserts the rule emits the right candidate count. These are the
 * SECURITY contract — when one of these fails, an actual SOC 2 control
 * is being mis-mapped (over- or under-claiming evidence).
 *
 * NOT covered by these tests (covered elsewhere):
 *   - Persistence layer (compliance-mapper.service): tested via real
 *     Prisma in CI route-contract suite.
 *   - The PDF + signed bundle outputs (covered in the attestation tests).
 *   - End-to-end live workflow → evidence → attestation: requires running
 *     stack; documented as manual recipe in qa/audit-compliance-v1-status.md
 */
import { describe, it, expect } from 'vitest';
import {
  AUTO_MAPPING_RULES,
  listAutoRuleKeys,
  getAutoMappingRule,
  type AutoMapInputs,
} from '../../apps/api/src/services/compliance/auto-mapping-rules.js';

const TENANT = 't-1';
const NOW = new Date('2026-04-25T00:00:00Z');
const PERIOD_START = new Date('2026-01-01T00:00:00Z');
const PERIOD_END = new Date('2026-04-25T23:59:59Z');

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

function makeAuditRow(action: string, resourceId: string = 'r-1', extras: Partial<{ id: string; severity: string; details: unknown }> = {}) {
  return {
    id: extras.id ?? `audit-${action}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    resource: 'workflow',
    resourceId,
    details: extras.details ?? null,
    createdAt: NOW,
    userId: 'user-1',
    severity: extras.severity ?? 'INFO',
  };
}

describe('Auto-mapping rule registry', () => {
  it('every rule key is a function', () => {
    for (const key of listAutoRuleKeys()) {
      const rule = getAutoMappingRule(key);
      expect(rule).toBeTypeOf('function');
    }
  });

  it('catalogue rule keys map to existing implementations', async () => {
    const { FRAMEWORKS } = await import('../../packages/db/prisma/seed-data/compliance-frameworks.js');
    const allReferencedKeys = new Set<string>();
    for (const fw of FRAMEWORKS) {
      for (const c of fw.controls) {
        if (c.autoRuleKey) allReferencedKeys.add(c.autoRuleKey);
      }
    }
    for (const key of allReferencedKeys) {
      expect(AUTO_MAPPING_RULES[key], `Catalogue references rule "${key}" but no implementation found`).toBeDefined();
    }
  });
});

describe('Per-rule candidate counts', () => {
  it('tenant-rbac-changes captures USER_ROLE_CHANGED + USER_CREATED + TENANT_SETTINGS_CHANGED + INDUSTRY_PACK_SELECTED', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      makeAuditRow('USER_CREATED'),
      makeAuditRow('USER_ROLE_CHANGED'),
      makeAuditRow('TENANT_SETTINGS_CHANGED'),
      makeAuditRow('INDUSTRY_PACK_SELECTED'),
      makeAuditRow('WORKFLOW_COMPLETED'), // should NOT match
    ];
    const candidates = AUTO_MAPPING_RULES['tenant-rbac-changes']!(inputs);
    expect(candidates).toHaveLength(4);
    expect(candidates.every((c) => c.type === 'audit_log')).toBe(true);
  });

  it('approval-decisions captures APPROVAL_* audit rows + decided ApprovalRequest rows', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      makeAuditRow('APPROVAL_REQUESTED'),
      makeAuditRow('APPROVAL_GRANTED'),
      makeAuditRow('APPROVAL_REJECTED'),
      makeAuditRow('APPROVAL_DEFERRED'),
      makeAuditRow('UNRELATED_ACTION'), // should NOT match
    ];
    inputs.approvals = [
      // decided one — should match
      { id: 'apr-1', status: 'APPROVED', riskLevel: 'HIGH', createdAt: NOW, reviewedAt: NOW, reviewedBy: 'rev-1', agentRole: 'WORKER_EMAIL' },
      // pending — should NOT match (decidedAt null filter)
      { id: 'apr-2', status: 'PENDING', riskLevel: 'HIGH', createdAt: NOW, reviewedAt: null, reviewedBy: null, agentRole: 'WORKER_EMAIL' },
    ] as never;
    const candidates = AUTO_MAPPING_RULES['approval-decisions']!(inputs);
    // 4 audit_log + 1 approval = 5
    expect(candidates).toHaveLength(5);
    expect(candidates.filter((c) => c.type === 'approval')).toHaveLength(1);
    expect(candidates.filter((c) => c.type === 'audit_log')).toHaveLength(4);
  });

  it('workflow-evidence-trail captures completed workflows + matching audit rows', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      makeAuditRow('WORKFLOW_COMPLETED'),
      makeAuditRow('WORKFLOW_PLANNED'),
      makeAuditRow('WORKFLOW_RESUMED'),
      makeAuditRow('WORKFLOW_FAILED'), // should NOT match this rule
    ];
    inputs.workflows = [
      { id: 'wf-1', status: 'COMPLETED', goal: 'g', startedAt: NOW, completedAt: NOW, error: null },
      { id: 'wf-2', status: 'FAILED', goal: 'g', startedAt: NOW, completedAt: NOW, error: 'oops' },
      { id: 'wf-3', status: 'COMPLETED', goal: 'g', startedAt: NOW, completedAt: null, error: null },
    ];
    const candidates = AUTO_MAPPING_RULES['workflow-evidence-trail']!(inputs);
    // 3 audit + 1 workflow (wf-1, the only completed with completedAt set) = 4
    expect(candidates).toHaveLength(4);
    const wfCands = candidates.filter((c) => c.type === 'workflow');
    expect(wfCands).toHaveLength(1);
    expect(wfCands[0]!.id).toBe('wf-1');
  });

  it('workflow-failures captures failed workflows + matching audit rows', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      makeAuditRow('WORKFLOW_FAILED'),
      makeAuditRow('WORKFLOW_STEP_FAILED'),
      makeAuditRow('GUARDRAIL_TRIGGERED'),
      makeAuditRow('WORKFLOW_COMPLETED'), // should NOT match
    ];
    inputs.workflows = [
      { id: 'wf-1', status: 'FAILED', goal: 'g', startedAt: NOW, completedAt: NOW, error: 'oops' },
      { id: 'wf-2', status: 'COMPLETED', goal: 'g', startedAt: NOW, completedAt: NOW, error: null },
    ];
    const candidates = AUTO_MAPPING_RULES['workflow-failures']!(inputs);
    expect(candidates).toHaveLength(4); // 3 audit + 1 workflow
    expect(candidates.filter((c) => c.type === 'workflow').map((c) => c.id)).toEqual(['wf-1']);
  });

  it('artifact-approval-gates captures any artifact with an approval state set', () => {
    const inputs = emptyInputs();
    inputs.artifacts = [
      { id: 'art-1', artifactType: 'export', status: 'READY', approvalState: 'APPROVED', createdAt: NOW, producedBy: 'u' },
      { id: 'art-2', artifactType: 'export', status: 'READY', approvalState: 'REQUIRES_APPROVAL', createdAt: NOW, producedBy: 'u' },
      { id: 'art-3', artifactType: 'export', status: 'READY', approvalState: 'REJECTED', createdAt: NOW, producedBy: 'u' },
      { id: 'art-4', artifactType: 'export', status: 'READY', approvalState: 'NOT_REQUIRED', createdAt: NOW, producedBy: 'u' },
    ];
    const candidates = AUTO_MAPPING_RULES['artifact-approval-gates']!(inputs);
    expect(candidates).toHaveLength(3);
    expect(candidates.every((c) => c.type === 'artifact')).toBe(true);
  });

  it('evidence-bundle-signed captures only READY evidence_bundle artifacts', () => {
    const inputs = emptyInputs();
    inputs.artifacts = [
      { id: 'b-1', artifactType: 'evidence_bundle', status: 'READY', approvalState: 'REQUIRES_APPROVAL', createdAt: NOW, producedBy: 'u' },
      { id: 'b-2', artifactType: 'evidence_bundle', status: 'PENDING', approvalState: 'REQUIRES_APPROVAL', createdAt: NOW, producedBy: 'u' },
      { id: 'art-1', artifactType: 'export', status: 'READY', approvalState: 'APPROVED', createdAt: NOW, producedBy: 'u' },
    ];
    const candidates = AUTO_MAPPING_RULES['evidence-bundle-signed']!(inputs);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.id).toBe('b-1');
    expect(candidates[0]!.type).toBe('evidence_bundle');
  });

  it('pii-detection captures only PII_DETECTED audit rows', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      makeAuditRow('PII_DETECTED', 'r-1', { severity: 'WARN' }),
      makeAuditRow('PII_DETECTED', 'r-2', { severity: 'WARN' }),
      makeAuditRow('GUARDRAIL_TRIGGERED'),
    ];
    const candidates = AUTO_MAPPING_RULES['pii-detection']!(inputs);
    expect(candidates).toHaveLength(2);
  });

  it('guardrail-and-injection-events captures both action types', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      makeAuditRow('GUARDRAIL_TRIGGERED'),
      makeAuditRow('INJECTION_DETECTED'),
      makeAuditRow('PII_DETECTED'), // should NOT match this rule
    ];
    const candidates = AUTO_MAPPING_RULES['guardrail-and-injection-events']!(inputs);
    expect(candidates).toHaveLength(2);
  });

  it('tool-blocked-and-policy captures policy-driven blocks', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      makeAuditRow('TOOL_BLOCKED'),
      makeAuditRow('PERMISSION_DENIED'),
      makeAuditRow('USER_ROLE_CHANGED'), // should NOT match this rule
    ];
    const candidates = AUTO_MAPPING_RULES['tool-blocked-and-policy']!(inputs);
    expect(candidates).toHaveLength(2);
  });

  it('workflow-resumed-or-rolled-back captures recovery audit rows', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [
      makeAuditRow('WORKFLOW_RESUMED'),
      makeAuditRow('WORKFLOW_CANCELLED'),
      makeAuditRow('WORKFLOW_COMPLETED'), // should NOT match
    ];
    const candidates = AUTO_MAPPING_RULES['workflow-resumed-or-rolled-back']!(inputs);
    expect(candidates).toHaveLength(2);
  });
});

describe('Conservatism guarantees (no over-claiming)', () => {
  it('every rule emits 0 candidates on empty inputs', () => {
    const empty = emptyInputs();
    for (const key of listAutoRuleKeys()) {
      const candidates = AUTO_MAPPING_RULES[key]!(empty);
      expect(candidates, `rule "${key}" emitted candidates from empty input`).toEqual([]);
    }
  });

  it('rules are pure functions — repeated calls return same results', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [makeAuditRow('PII_DETECTED'), makeAuditRow('PII_DETECTED')];
    const a = AUTO_MAPPING_RULES['pii-detection']!(inputs);
    const b = AUTO_MAPPING_RULES['pii-detection']!(inputs);
    expect(a).toEqual(b);
  });

  it('no rule mutates the inputs', () => {
    const inputs = emptyInputs();
    inputs.auditLogs = [makeAuditRow('PII_DETECTED'), makeAuditRow('GUARDRAIL_TRIGGERED'), makeAuditRow('USER_CREATED')];
    const snapshot = JSON.stringify(inputs);
    for (const key of listAutoRuleKeys()) {
      AUTO_MAPPING_RULES[key]!(inputs);
    }
    expect(JSON.stringify(inputs)).toBe(snapshot);
  });
});

describe('Tenant isolation expectations', () => {
  it('inputs always include the tenantId — rules pass it through', () => {
    // The rules don't enforce tenant isolation themselves (the
    // mapper.service.ts loadInputs() call IS the security boundary).
    // This test documents that contract: rules receive pre-filtered
    // tenant-scoped inputs and produce candidates derived from THOSE
    // inputs only.
    const inputs = emptyInputs();
    inputs.auditLogs = [makeAuditRow('PII_DETECTED')];
    const candidates = AUTO_MAPPING_RULES['pii-detection']!(inputs);
    // Each candidate's id should be one we put in the inputs.
    const inputIds = new Set(inputs.auditLogs.map((r) => r.id));
    for (const c of candidates) {
      expect(inputIds.has(c.id), `rule emitted id ${c.id} not present in inputs`).toBe(true);
    }
  });
});
