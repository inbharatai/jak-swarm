/**
 * Auto-mapping rules — declarative source of truth for "which raw audit
 * record satisfies which compliance control".
 *
 * Each rule is a function that takes a tenant's recent audit/approval/
 * artifact rows and returns the (controlCode → evidenceRefs[]) bindings
 * the auto-mapper should persist.
 *
 * The rules are intentionally CONSERVATIVE — they only match patterns
 * we KNOW satisfy a control. Better to under-map (forcing human curation)
 * than over-map (claiming evidence that doesn't actually demonstrate
 * the control's intent).
 *
 * Rule keys are referenced from `seed-data/compliance-frameworks.ts`
 * via the control's `autoRuleKey` field. A control with no autoRuleKey
 * is human-mapped only.
 */

import type { AuditAction } from '@jak-swarm/security';

export interface EvidenceCandidate {
  /** AuditLog | Workflow | ApprovalRequest | WorkflowArtifact rows. */
  type: 'audit_log' | 'workflow' | 'approval' | 'artifact' | 'evidence_bundle';
  id: string;
  /** When the underlying record was produced. */
  at: Date;
  /** Original row payload for rules that need to inspect details. */
  source: Record<string, unknown>;
}

/**
 * The data set every rule operates on. Loaded once per auto-map run
 * by `compliance-mapper.service.ts` to avoid repeated DB roundtrips.
 */
export interface AutoMapInputs {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  auditLogs: Array<{ id: string; action: string; resource: string; resourceId: string | null; details: unknown; createdAt: Date; userId: string | null; severity: string }>;
  workflows: Array<{ id: string; status: string; goal: string; startedAt: Date; completedAt: Date | null; error: string | null }>;
  approvals: Array<{ id: string; status: string; riskLevel: string; createdAt: Date; reviewedAt: Date | null; reviewedBy: string | null; agentRole: string }>;
  artifacts: Array<{ id: string; artifactType: string; status: string; approvalState: string; createdAt: Date; producedBy: string }>;
}

export type AutoMappingRule = (inputs: AutoMapInputs) => EvidenceCandidate[];

// ─── Helpers ──────────────────────────────────────────────────────────

function actionsAsCandidates(
  inputs: AutoMapInputs,
  actions: ReadonlyArray<string>,
): EvidenceCandidate[] {
  return inputs.auditLogs
    .filter((r) => actions.includes(r.action))
    .map((r) => ({ type: 'audit_log', id: r.id, at: r.createdAt, source: r as unknown as Record<string, unknown> }));
}

// ─── Rules ────────────────────────────────────────────────────────────

/**
 * `tenant-rbac-changes` — used by CC1.3, CC1.4, CC3.4, CC6.2, CC7.1.
 * Captures any change to user/role/permission state for the tenant.
 */
const tenantRbacChanges: AutoMappingRule = (inputs) =>
  actionsAsCandidates(inputs, [
    'USER_CREATED',
    'USER_ROLE_CHANGED',
    'TENANT_SETTINGS_CHANGED',
    'INDUSTRY_PACK_SELECTED',
  ]);

/**
 * `approval-decisions` — used by CC1.5, CC5.1, CC6.3, P8.1.
 * Captures every approval grant/reject — the audit trail of human
 * accountability for high-risk actions.
 */
const approvalDecisions: AutoMappingRule = (inputs) => [
  ...actionsAsCandidates(inputs, [
    'APPROVAL_REQUESTED',
    'APPROVAL_GRANTED',
    'APPROVAL_REJECTED',
    'APPROVAL_DEFERRED',
  ]),
  // Also include the original ApprovalRequest rows themselves so a control
  // drill-in can show the request + the decision side-by-side.
  ...inputs.approvals
    .filter((a) => a.reviewedAt !== null) // only decided requests count as evidence
    .map((a) => ({
      type: 'approval' as const,
      id: a.id,
      at: a.reviewedAt ?? a.createdAt,
      source: a as unknown as Record<string, unknown>,
    })),
];

/**
 * `workflow-evidence-trail` — used by CC2.1, CC2.2, A1.1, PI1.1, PI1.3.
 * Every WORKFLOW_COMPLETED is evidence that the system produced quality
 * information following its documented procedures.
 */
const workflowEvidenceTrail: AutoMappingRule = (inputs) => [
  ...actionsAsCandidates(inputs, ['WORKFLOW_COMPLETED', 'WORKFLOW_PLANNED', 'WORKFLOW_RESUMED']),
  ...inputs.workflows
    .filter((w) => w.status === 'COMPLETED' && w.completedAt !== null)
    .map((w) => ({
      type: 'workflow' as const,
      id: w.id,
      at: w.completedAt ?? w.startedAt,
      source: w as unknown as Record<string, unknown>,
    })),
];

/**
 * `workflow-failures` — used by CC4.1, CC4.2, CC7.4.
 * Failures + their handling are evidence that monitoring works AND that
 * the entity acts on identified deficiencies.
 */
const workflowFailures: AutoMappingRule = (inputs) => [
  ...actionsAsCandidates(inputs, ['WORKFLOW_FAILED', 'WORKFLOW_STEP_FAILED', 'GUARDRAIL_TRIGGERED']),
  ...inputs.workflows
    .filter((w) => w.status === 'FAILED' && w.error)
    .map((w) => ({
      type: 'workflow' as const,
      id: w.id,
      at: w.completedAt ?? w.startedAt,
      source: w as unknown as Record<string, unknown>,
    })),
];

/**
 * `workflow-resumed-or-rolled-back` — used by CC7.5, A1.2.
 * Recovery from a halted/failed state demonstrates the entity can
 * recover from incidents.
 */
const workflowResumedOrRolledBack: AutoMappingRule = (inputs) =>
  actionsAsCandidates(inputs, ['WORKFLOW_RESUMED', 'WORKFLOW_CANCELLED']);

/**
 * `tool-blocked-and-policy` — used by CC5.2, CC6.1, CC6.8, PI1.2.
 * Tools blocked by tenant policy / industry pack restrictions are
 * evidence that the entity implements logical access controls and
 * detects unauthorised software introduction.
 */
const toolBlockedAndPolicy: AutoMappingRule = (inputs) =>
  actionsAsCandidates(inputs, ['TOOL_BLOCKED', 'PERMISSION_DENIED']);

/**
 * `guardrail-and-injection-events` — used by CC3.2, CC3.3, CC6.6, CC7.2,
 * CC7.3. The entity identifies + responds to security risks (prompt
 * injection, rule violations).
 */
const guardrailAndInjectionEvents: AutoMappingRule = (inputs) =>
  actionsAsCandidates(inputs, ['GUARDRAIL_TRIGGERED', 'INJECTION_DETECTED']);

/**
 * `pii-detection` — used by C1.1, P1.1, P3.1, P4.1.
 * PII detection events are evidence that the entity identifies +
 * controls confidential / personal information.
 */
const piiDetection: AutoMappingRule = (inputs) =>
  actionsAsCandidates(inputs, ['PII_DETECTED']);

/**
 * `artifact-approval-gates` — used by CC6.7, CC8.1, PI1.4, P6.1.
 * Approval-gated artifact downloads are evidence that the entity
 * restricts information transmission and authorises changes before
 * implementation.
 */
const artifactApprovalGates: AutoMappingRule = (inputs) =>
  inputs.artifacts
    .filter((a) => a.approvalState === 'APPROVED' || a.approvalState === 'REQUIRES_APPROVAL' || a.approvalState === 'REJECTED')
    .map((a) => ({
      type: 'artifact' as const,
      id: a.id,
      at: a.createdAt,
      source: a as unknown as Record<string, unknown>,
    }));

/**
 * `evidence-bundle-signed` — used by PI1.5.
 * Signed evidence bundles are direct evidence of completeness +
 * integrity controls over outputs.
 */
const evidenceBundleSigned: AutoMappingRule = (inputs) =>
  inputs.artifacts
    .filter((a) => a.artifactType === 'evidence_bundle' && a.status === 'READY')
    .map((a) => ({
      type: 'evidence_bundle' as const,
      id: a.id,
      at: a.createdAt,
      source: a as unknown as Record<string, unknown>,
    }));

// ─── Registry ─────────────────────────────────────────────────────────

/**
 * Public registry. Keys must match the `autoRuleKey` values in
 * `seed-data/compliance-frameworks.ts`. Adding a new rule:
 *   1. Implement the rule function above.
 *   2. Add it here.
 *   3. Reference its key from one or more controls in the catalogue.
 *   4. Re-run `pnpm seed:compliance` to update DB.
 */
export const AUTO_MAPPING_RULES: Record<string, AutoMappingRule> = {
  'tenant-rbac-changes': tenantRbacChanges,
  'approval-decisions': approvalDecisions,
  'workflow-evidence-trail': workflowEvidenceTrail,
  'workflow-failures': workflowFailures,
  'workflow-resumed-or-rolled-back': workflowResumedOrRolledBack,
  'tool-blocked-and-policy': toolBlockedAndPolicy,
  'guardrail-and-injection-events': guardrailAndInjectionEvents,
  'pii-detection': piiDetection,
  'artifact-approval-gates': artifactApprovalGates,
  'evidence-bundle-signed': evidenceBundleSigned,
};

/** Get every defined rule key — used by tests + diagnostic endpoint. */
export function listAutoRuleKeys(): string[] {
  return Object.keys(AUTO_MAPPING_RULES);
}

/** Look up a rule by key. Returns undefined for unknown keys. */
export function getAutoMappingRule(key: string): AutoMappingRule | undefined {
  return AUTO_MAPPING_RULES[key];
}

// Type re-export so the seed catalogue can reference AuditAction values
// without a separate import for type checking. Currently unused at runtime
// but kept for documentation + future expansion.
export type { AuditAction };
