/**
 * audit-exception.service — exception lifecycle for an audit run.
 *
 * AuditException rows are created automatically by ControlTestService when a
 * test result is 'fail' or 'exception'. They can also be created manually by
 * a reviewer who wants to record an issue that the auto-test loop missed.
 *
 * Lifecycle:
 *   open → remediation_planned → remediation_in_progress → remediation_complete
 *           ↓                       ↓                         ↓
 *           accepted (with reviewer note)   rejected (with reviewer note)
 *           closed (terminal — included in final pack)
 *
 * Tenant isolation enforced at every method.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { AuditLogger, AuditAction } from '@jak-swarm/security';
import type { AuditPrismaClient } from '@jak-swarm/security';
import { AuditSchemaUnavailableError, type AuditLifecycleEmitter } from './audit-run.service.js';

function rethrowIfSchemaMissing(err: unknown): never {
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(msg)) {
    throw new AuditSchemaUnavailableError();
  }
  throw err;
}

export type AuditExceptionStatus =
  | 'open'
  | 'remediation_planned'
  | 'remediation_in_progress'
  | 'remediation_complete'
  | 'accepted'
  | 'rejected'
  | 'closed';

export type AuditExceptionSeverity = 'low' | 'medium' | 'high' | 'critical';

const ALLOWED_TRANSITIONS: Record<AuditExceptionStatus, ReadonlySet<AuditExceptionStatus>> = {
  open: new Set(['remediation_planned', 'accepted', 'rejected']),
  remediation_planned: new Set(['remediation_in_progress', 'accepted', 'rejected']),
  remediation_in_progress: new Set(['remediation_complete', 'accepted', 'rejected']),
  remediation_complete: new Set(['closed', 'accepted']),
  accepted: new Set(['closed']),
  rejected: new Set(['closed', 'remediation_planned']),
  closed: new Set(),
};

export class IllegalAuditExceptionTransitionError extends Error {
  constructor(public readonly from: AuditExceptionStatus, public readonly to: AuditExceptionStatus, public readonly exceptionId: string) {
    super(`[audit-exception] illegal transition for ${exceptionId}: ${from} → ${to}. Allowed next: ${Array.from(ALLOWED_TRANSITIONS[from] ?? []).join(', ') || '(terminal)'}`);
    this.name = 'IllegalAuditExceptionTransitionError';
  }
}

function assertExceptionTransition(from: AuditExceptionStatus, to: AuditExceptionStatus, id: string): void {
  if (from === to) return;
  if (!(ALLOWED_TRANSITIONS[from] ?? new Set()).has(to)) {
    throw new IllegalAuditExceptionTransitionError(from, to, id);
  }
}

// ─── Service ───────────────────────────────────────────────────────────

export interface CreateFromTestInput {
  tenantId: string;
  auditRunId: string;
  controlTestId: string;
  controlId: string;
  controlCode: string;
  severity: AuditExceptionSeverity;
  description: string;
  rationale: string;
  recommendedRemediation?: string;
}

export interface CreateManualInput {
  tenantId: string;
  auditRunId: string;
  controlId: string;
  controlCode: string;
  severity: AuditExceptionSeverity;
  description: string;
  cause?: string;
  impact?: string;
  remediationPlan?: string;
  remediationOwner?: string;
  remediationDueDate?: Date | string;
  createdBy: string;
}

export class AuditExceptionService {
  private readonly audit: AuditLogger;

  constructor(
    private readonly db: PrismaClient,
    _log: FastifyBaseLogger,
    private readonly emit: AuditLifecycleEmitter = () => {},
  ) {
    this.audit = new AuditLogger(db as unknown as AuditPrismaClient);
  }

  /**
   * Auto-create from a failed control test. Idempotent on (auditRunId,
   * controlTestId) — if the test already has an exception, return it instead
   * of creating a duplicate.
   */
  async createFromTest(input: CreateFromTestInput): Promise<{ id: string; status: AuditExceptionStatus }> {
    const existing = await (this.db.auditException.findFirst as unknown as (a: unknown) => Promise<{ id: string; status: AuditExceptionStatus } | null>)({
      where: { tenantId: input.tenantId, auditRunId: input.auditRunId, controlTestId: input.controlTestId },
      select: { id: true, status: true },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (existing) return existing;

    const row = await (this.db.auditException.create as unknown as (a: unknown) => Promise<{ id: string }>)({
      data: {
        tenantId: input.tenantId,
        auditRunId: input.auditRunId,
        controlTestId: input.controlTestId,
        controlId: input.controlId,
        controlCode: input.controlCode,
        severity: input.severity,
        description: input.description,
        cause: input.rationale,
        ...(input.recommendedRemediation ? { remediationPlan: input.recommendedRemediation } : {}),
        status: 'open',
      },
    });

    return { id: row.id, status: 'open' };
  }

  /**
   * Manual exception creation — reviewer wants to record something the
   * automated loop didn't catch.
   */
  async createManual(input: CreateManualInput): Promise<{ id: string; status: AuditExceptionStatus }> {
    const row = await (this.db.auditException.create as unknown as (a: unknown) => Promise<{ id: string }>)({
      data: {
        tenantId: input.tenantId,
        auditRunId: input.auditRunId,
        controlId: input.controlId,
        controlCode: input.controlCode,
        severity: input.severity,
        description: input.description,
        ...(input.cause ? { cause: input.cause } : {}),
        ...(input.impact ? { impact: input.impact } : {}),
        ...(input.remediationPlan ? { remediationPlan: input.remediationPlan } : {}),
        ...(input.remediationOwner ? { remediationOwner: input.remediationOwner } : {}),
        ...(input.remediationDueDate ? { remediationDueDate: new Date(input.remediationDueDate) } : {}),
        status: 'open',
      },
    }).catch((err) => rethrowIfSchemaMissing(err));

    this.emit({
      type: 'exception_found',
      auditRunId: input.auditRunId,
      agentRole: 'EXCEPTION_FINDER',
      timestamp: new Date().toISOString(),
      details: { controlCode: input.controlCode, exceptionId: row.id, severity: input.severity, manual: true, createdBy: input.createdBy },
    });

    void this.audit.log({
      action: AuditAction.WORKFLOW_CREATED,
      tenantId: input.tenantId,
      userId: input.createdBy,
      resource: 'audit_exception',
      resourceId: row.id,
      details: { auditRunId: input.auditRunId, controlCode: input.controlCode, severity: input.severity, manual: true },
    }).catch(() => {});

    return { id: row.id, status: 'open' };
  }

  async list(input: { tenantId: string; auditRunId: string; status?: AuditExceptionStatus; severity?: AuditExceptionSeverity }): Promise<unknown[]> {
    const where: Record<string, unknown> = { tenantId: input.tenantId, auditRunId: input.auditRunId };
    if (input.status) where['status'] = input.status;
    if (input.severity) where['severity'] = input.severity;
    return (this.db.auditException.findMany as unknown as (a: unknown) => Promise<unknown[]>)({
      where,
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
    }).catch((err) => rethrowIfSchemaMissing(err));
  }

  async get(input: { tenantId: string; id: string }): Promise<unknown> {
    const row = await (this.db.auditException.findFirst as unknown as (a: unknown) => Promise<unknown | null>)({
      where: { id: input.id, tenantId: input.tenantId },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (!row) throw new Error(`AuditException ${input.id} not found in tenant ${input.tenantId}`);
    return row;
  }

  /**
   * Update remediation fields. Reviewer-only at the route layer.
   */
  async updateRemediation(input: {
    id: string;
    tenantId: string;
    remediationPlan?: string;
    remediationOwner?: string;
    remediationDueDate?: Date | string;
    updatedBy: string;
  }): Promise<unknown> {
    const exc = (await this.get({ id: input.id, tenantId: input.tenantId })) as { id: string; status: AuditExceptionStatus };
    const data: Record<string, unknown> = {};
    if (input.remediationPlan !== undefined) data['remediationPlan'] = input.remediationPlan;
    if (input.remediationOwner !== undefined) data['remediationOwner'] = input.remediationOwner;
    if (input.remediationDueDate !== undefined) data['remediationDueDate'] = new Date(input.remediationDueDate);
    if (Object.keys(data).length === 0) return exc;

    // If a plan is provided and we're still 'open', auto-advance to remediation_planned
    if (exc.status === 'open' && input.remediationPlan) {
      assertExceptionTransition(exc.status, 'remediation_planned', exc.id);
      data['status'] = 'remediation_planned';
    }
    const updated = await this.db.auditException.update({ where: { id: exc.id }, data });
    void this.audit.log({
      action: AuditAction.WORKFLOW_RESUMED,
      tenantId: input.tenantId,
      userId: input.updatedBy,
      resource: 'audit_exception',
      resourceId: exc.id,
      details: { fields: Object.keys(data) },
    }).catch(() => {});
    return updated;
  }

  /**
   * Apply a reviewer decision. Reviewer-only at the route layer.
   */
  async transition(input: {
    id: string;
    tenantId: string;
    to: AuditExceptionStatus;
    reviewerComment?: string;
    reviewedBy: string;
  }): Promise<unknown> {
    const exc = (await this.get({ id: input.id, tenantId: input.tenantId })) as { id: string; status: AuditExceptionStatus; auditRunId: string; controlCode: string };
    assertExceptionTransition(exc.status, input.to, exc.id);

    const data: Record<string, unknown> = { status: input.to };
    if (input.to === 'accepted' || input.to === 'rejected' || input.to === 'closed') {
      data['reviewerStatus'] = input.to;
      data['reviewedBy'] = input.reviewedBy;
      data['reviewedAt'] = new Date();
      if (input.reviewerComment) data['reviewerComment'] = input.reviewerComment;
    } else if (input.reviewerComment) {
      data['reviewerComment'] = input.reviewerComment;
    }

    const updated = await this.db.auditException.update({ where: { id: exc.id }, data });

    void this.audit.log({
      action: input.to === 'accepted' ? AuditAction.APPROVAL_GRANTED
        : input.to === 'rejected' ? AuditAction.APPROVAL_REJECTED
        : AuditAction.WORKFLOW_RESUMED,
      tenantId: input.tenantId,
      userId: input.reviewedBy,
      resource: 'audit_exception',
      resourceId: exc.id,
      details: { from: exc.status, to: input.to },
    }).catch(() => {});

    return updated;
  }
}
