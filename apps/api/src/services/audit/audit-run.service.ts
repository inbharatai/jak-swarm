/**
 * audit-run.service — orchestrates an end-to-end audit engagement.
 *
 * State machine (status):
 *   PLANNING → PLANNED → MAPPING → TESTING → REVIEWING → READY_TO_PACK → FINAL_PACK → COMPLETED
 *                                                                        ↓
 *                                                                       FAILED / CANCELLED
 *
 * The lifecycle event name `audit_run_started`, `audit_plan_created`, etc. flows
 * through the existing SSE channel so the cockpit displays each transition.
 *
 * Tenant isolation enforced at every method.
 *
 * Honesty:
 *   - Status transitions go through assertAuditTransition() — no jumping straight
 *     from PLANNING to COMPLETED.
 *   - The AuditCommander "agent" emits events with agentRole='AUDIT_COMMANDER';
 *     the work itself is real (writes real DB rows, runs real ComplianceMapperService).
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { AuditLogger, AuditAction } from '@jak-swarm/security';
import type { AuditPrismaClient } from '@jak-swarm/security';

// ─── State machine ─────────────────────────────────────────────────────

export type AuditRunStatus =
  | 'PLANNING'
  | 'PLANNED'
  | 'MAPPING'
  | 'TESTING'
  | 'REVIEWING'
  | 'READY_TO_PACK'
  | 'FINAL_PACK'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

const ALLOWED_TRANSITIONS: Record<AuditRunStatus, ReadonlySet<AuditRunStatus>> = {
  PLANNING: new Set(['PLANNED', 'FAILED', 'CANCELLED']),
  PLANNED: new Set(['MAPPING', 'TESTING', 'FAILED', 'CANCELLED']),
  MAPPING: new Set(['TESTING', 'FAILED', 'CANCELLED']),
  TESTING: new Set(['REVIEWING', 'FAILED', 'CANCELLED']),
  REVIEWING: new Set(['READY_TO_PACK', 'TESTING', 'FAILED', 'CANCELLED']),
  READY_TO_PACK: new Set(['FINAL_PACK', 'REVIEWING', 'FAILED', 'CANCELLED']),
  FINAL_PACK: new Set(['COMPLETED', 'FAILED']),
  COMPLETED: new Set(),
  FAILED: new Set(),
  CANCELLED: new Set(),
};

export class IllegalAuditRunTransitionError extends Error {
  constructor(public readonly from: AuditRunStatus, public readonly to: AuditRunStatus, public readonly auditRunId: string) {
    super(`[audit-run] illegal transition for ${auditRunId}: ${from} → ${to}. Allowed next: ${Array.from(ALLOWED_TRANSITIONS[from] ?? []).join(', ') || '(terminal)'}`);
    this.name = 'IllegalAuditRunTransitionError';
  }
}

function assertAuditTransition(from: AuditRunStatus, to: AuditRunStatus, auditRunId: string): void {
  if (from === to) return; // idempotent
  const allowed = ALLOWED_TRANSITIONS[from] ?? new Set();
  if (!allowed.has(to)) {
    throw new IllegalAuditRunTransitionError(from, to, auditRunId);
  }
}

// ─── Schema-missing fail-safe ──────────────────────────────────────────

export class AuditSchemaUnavailableError extends Error {
  constructor() {
    super(
      '[audit] audit_runs / control_tests / audit_exceptions / audit_workpapers tables not present. ' +
      'Apply migration 15_audit_runs via `pnpm db:migrate:deploy`.',
    );
    this.name = 'AuditSchemaUnavailableError';
  }
}

function rethrowIfSchemaMissing(err: unknown): never {
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(msg)) {
    throw new AuditSchemaUnavailableError();
  }
  throw err;
}

// ─── Audit lifecycle event vocabulary ──────────────────────────────────
//
// Extends the existing 13-event lifecycle vocabulary with audit-specific
// events. The audit-run service emits these via the same emitter the
// rest of the platform uses (SSE + AuditLog).

export type AuditLifecycleEventType =
  | 'audit_run_started'
  | 'audit_plan_created'
  | 'evidence_mapped'
  | 'control_test_started'
  | 'control_test_completed'
  | 'exception_found'
  | 'workpaper_generated'
  | 'reviewer_action_required'
  | 'final_pack_started'
  | 'final_pack_generated'
  | 'audit_run_completed'
  | 'audit_run_failed'
  | 'audit_run_cancelled';

export interface AuditLifecycleEvent {
  type: AuditLifecycleEventType;
  auditRunId: string;
  agentRole: 'AUDIT_COMMANDER' | 'COMPLIANCE_MAPPER' | 'CONTROL_TEST_AGENT' | 'EXCEPTION_FINDER' | 'WORKPAPER_WRITER' | 'FINAL_AUDIT_PACK_AGENT';
  timestamp: string;
  details?: Record<string, unknown>;
}

export type AuditLifecycleEmitter = (ev: AuditLifecycleEvent) => void;

// ─── Service ───────────────────────────────────────────────────────────

export interface CreateAuditRunInput {
  tenantId: string;
  userId: string;
  frameworkSlug: string;
  title: string;
  scope?: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  metadata?: Record<string, unknown>;
}

export class AuditRunService {
  private readonly audit: AuditLogger;

  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
    private readonly emit: AuditLifecycleEmitter = () => {},
  ) {
    this.audit = new AuditLogger(db as unknown as AuditPrismaClient);
  }

  /**
   * Create a new audit run + emit `audit_run_started`. Validates that the
   * framework slug exists. Initial status: PLANNING.
   */
  async create(input: CreateAuditRunInput): Promise<{ id: string; status: AuditRunStatus }> {
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    if (periodEnd <= periodStart) {
      throw new Error('periodEnd must be strictly after periodStart');
    }

    // Validate framework exists (compliance schema must be deployed too)
    const fw = await this.db.complianceFramework.findUnique({
      where: { slug: input.frameworkSlug },
      select: { id: true, slug: true, name: true },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (!fw) {
      throw new Error(`Framework not found: ${input.frameworkSlug}. Run \`pnpm seed:compliance\` first.`);
    }

    const row = await (this.db.auditRun.create as unknown as (a: unknown) => Promise<{ id: string }>)({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        frameworkSlug: input.frameworkSlug,
        title: input.title,
        ...(input.scope ? { scope: input.scope } : {}),
        periodStart,
        periodEnd,
        status: 'PLANNING',
        ...(input.metadata ? { metadata: input.metadata as object } : {}),
      },
    }).catch((err) => rethrowIfSchemaMissing(err));

    this.emit({
      type: 'audit_run_started',
      auditRunId: row.id,
      agentRole: 'AUDIT_COMMANDER',
      timestamp: new Date().toISOString(),
      details: { frameworkSlug: input.frameworkSlug, frameworkName: fw.name, title: input.title },
    });

    void this.audit
      .log({
        action: AuditAction.WORKFLOW_CREATED,
        tenantId: input.tenantId,
        userId: input.userId,
        resource: 'audit_run',
        resourceId: row.id,
        details: { frameworkSlug: input.frameworkSlug, title: input.title, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() },
      })
      .catch(() => { /* never block create on audit log */ });

    return { id: row.id, status: 'PLANNING' };
  }

  async get(id: string, tenantId: string): Promise<unknown> {
    const row = await (this.db.auditRun.findFirst as unknown as (a: unknown) => Promise<unknown>)({
      where: { id, tenantId, deletedAt: null },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (!row) throw new Error(`Audit run ${id} not found in tenant ${tenantId}`);
    return row;
  }

  async list(input: { tenantId: string; status?: AuditRunStatus; limit?: number; offset?: number }): Promise<{
    items: Array<unknown>;
    total: number;
  }> {
    const where: Record<string, unknown> = { tenantId: input.tenantId, deletedAt: null };
    if (input.status) where['status'] = input.status;
    const [items, total] = await Promise.all([
      this.db.auditRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: input.limit ?? 50,
        skip: input.offset ?? 0,
      }),
      this.db.auditRun.count({ where }),
    ]).catch((err) => { rethrowIfSchemaMissing(err); throw err; });
    return { items, total };
  }

  /**
   * Transition an audit run to a new status. Throws on illegal transition.
   * Emits the appropriate lifecycle event when terminal.
   */
  async transition(input: { id: string; tenantId: string; to: AuditRunStatus; reason?: string }): Promise<void> {
    const current = await this.db.auditRun.findFirst({
      where: { id: input.id, tenantId: input.tenantId },
      select: { status: true },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (!current) throw new Error(`Audit run ${input.id} not found`);

    assertAuditTransition(current.status as AuditRunStatus, input.to, input.id);

    await this.db.auditRun.update({
      where: { id: input.id },
      data: { status: input.to },
    });

    if (input.to === 'COMPLETED') {
      this.emit({ type: 'audit_run_completed', auditRunId: input.id, agentRole: 'AUDIT_COMMANDER', timestamp: new Date().toISOString() });
    } else if (input.to === 'FAILED') {
      this.emit({ type: 'audit_run_failed', auditRunId: input.id, agentRole: 'AUDIT_COMMANDER', timestamp: new Date().toISOString(), details: { reason: input.reason } });
    } else if (input.to === 'CANCELLED') {
      this.emit({ type: 'audit_run_cancelled', auditRunId: input.id, agentRole: 'AUDIT_COMMANDER', timestamp: new Date().toISOString(), details: { reason: input.reason } });
    }
  }

  /**
   * Seed ControlTest rows from the framework's controls. Status: PLANNING → PLANNED.
   * Emits `audit_plan_created` with the seeded count.
   *
   * Idempotent: re-running upserts by (auditRunId, controlId).
   */
  async plan(input: { id: string; tenantId: string }): Promise<{ controlsSeeded: number }> {
    const run = (await this.get(input.id, input.tenantId)) as { id: string; frameworkSlug: string; status: AuditRunStatus };

    const fw = await this.db.complianceFramework.findUnique({
      where: { slug: run.frameworkSlug },
      include: { controls: { orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] } },
    });
    if (!fw) throw new Error(`Framework ${run.frameworkSlug} not found`);

    let seeded = 0;
    for (const c of fw.controls) {
      try {
        await this.db.controlTest.upsert({
          where: { auditRunId_controlId: { auditRunId: run.id, controlId: c.id } },
          create: {
            tenantId: input.tenantId,
            auditRunId: run.id,
            controlId: c.id,
            controlCode: c.code,
            controlTitle: c.title,
            status: 'not_started',
            evidenceCount: 0,
          },
          update: {}, // never overwrite existing test state
        });
        seeded++;
      } catch (err) {
        this.log.warn({ controlId: c.id, err: err instanceof Error ? err.message : String(err) }, '[audit-run] control test seed failed');
      }
    }

    if (run.status === 'PLANNING') {
      await this.transition({ id: run.id, tenantId: input.tenantId, to: 'PLANNED' });
    }

    this.emit({
      type: 'audit_plan_created',
      auditRunId: run.id,
      agentRole: 'AUDIT_COMMANDER',
      timestamp: new Date().toISOString(),
      details: { controlCount: fw.controls.length, controlsSeeded: seeded, frameworkSlug: fw.slug },
    });

    return { controlsSeeded: seeded };
  }

  /**
   * Soft-delete an audit run.
   */
  async delete(input: { id: string; tenantId: string; deletedBy: string }): Promise<void> {
    const run = await this.db.auditRun.findFirst({
      where: { id: input.id, tenantId: input.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!run) throw new Error(`Audit run ${input.id} not found`);

    await this.db.auditRun.update({ where: { id: run.id }, data: { deletedAt: new Date() } });
    void this.audit.log({
      action: AuditAction.WORKFLOW_CANCELLED,
      tenantId: input.tenantId,
      userId: input.deletedBy,
      resource: 'audit_run',
      resourceId: run.id,
      details: {},
    }).catch(() => {});
  }
}
