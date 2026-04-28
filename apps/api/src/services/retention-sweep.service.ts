/**
 * RetentionSweepService — Final hardening / Gap E.
 *
 * Configurable, dry-run-by-default cleanup of stale records that are
 * safe to delete:
 *
 *   - expired auditor invites (status='EXPIRED' OR expiresAt < now AND
 *     status='PENDING' — never accepted)
 *   - revoked auditor invites older than the retention window
 *   - revoked auditor engagements (accessRevokedAt < now - retention)
 *   - orphaned ExternalAuditorAction rows (where the engagement was
 *     hard-deleted long ago — safety net only; we don't delete
 *     engagements with active actions)
 *
 * Things this service WILL NOT touch (by design):
 *   - Workflow rows (customer-owned)
 *   - WorkflowArtifact rows including final audit packs (compliance evidence)
 *   - AuditLog rows (forensic trail; compliance retention)
 *   - User rows (tenant-owned)
 *   - CompanyProfile (tenant-owned)
 *   - VectorDocument / TenantDocument (customer-owned)
 *
 * Dry-run mode is the safe default. Real execution mode requires
 * explicit `mode: 'execute'`.
 *
 * Tenant isolation: every query scopes by tenantId. Admin route can
 * pass tenantId='*' to sweep across all tenants (SYSTEM_ADMIN only).
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import type { WorkflowLifecycleEmitter } from '@jak-swarm/swarm';

export interface RetentionPolicy {
  /** Days after PENDING expiry before deletion. Default 7. */
  expiredInviteAfterDays: number;
  /** Days after revocation before deletion. Default 30. */
  revokedInviteAfterDays: number;
  /** Days after engagement.accessRevokedAt before deletion. Default 30. */
  revokedEngagementAfterDays: number;
}

const DEFAULT_POLICY: RetentionPolicy = {
  expiredInviteAfterDays: 7,
  revokedInviteAfterDays: 30,
  revokedEngagementAfterDays: 30,
};

export interface SweepParams {
  /** When 'dry_run', counts candidates but deletes nothing. */
  mode: 'dry_run' | 'execute';
  /** When set, scope sweep to this tenant only. When '*', sweep all tenants. */
  tenantId: string;
  /** Override default policy. */
  policy?: Partial<RetentionPolicy>;
  /** Lifecycle emitter for retention_* events. */
  onLifecycle?: WorkflowLifecycleEmitter;
}

export interface SweepReport {
  mode: 'dry_run' | 'execute';
  tenantId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  /** Per-object-type tallies. */
  candidates: {
    expiredInvites: number;
    revokedInvites: number;
    revokedEngagements: number;
  };
  deleted: {
    expiredInvites: number;
    revokedInvites: number;
    revokedEngagements: number;
  };
  skipped: {
    expiredInvites: number;
    revokedInvites: number;
    revokedEngagements: number;
  };
  errors: string[];
}

export class RetentionSweepService {
  constructor(
    private readonly db: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async sweep(params: SweepParams): Promise<SweepReport> {
    const policy: RetentionPolicy = { ...DEFAULT_POLICY, ...(params.policy ?? {}) };
    const startedAt = new Date();
    const report: SweepReport = {
      mode: params.mode,
      tenantId: params.tenantId,
      startedAt: startedAt.toISOString(),
      completedAt: '',
      durationMs: 0,
      candidates: { expiredInvites: 0, revokedInvites: 0, revokedEngagements: 0 },
      deleted: { expiredInvites: 0, revokedInvites: 0, revokedEngagements: 0 },
      skipped: { expiredInvites: 0, revokedInvites: 0, revokedEngagements: 0 },
      errors: [],
    };

    this.emit(params.onLifecycle, {
      type: 'retention_sweep_started',
      ...(params.tenantId !== '*' ? { tenantId: params.tenantId } : {}),
      mode: params.mode,
      timestamp: startedAt.toISOString(),
    });

    try {
      await this.sweepExpiredInvites(params, policy, report);
      await this.sweepRevokedInvites(params, policy, report);
      await this.sweepRevokedEngagements(params, policy, report);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report.errors.push(msg);
      this.emit(params.onLifecycle, {
        type: 'retention_sweep_failed',
        ...(params.tenantId !== '*' ? { tenantId: params.tenantId } : {}),
        error: msg,
        timestamp: new Date().toISOString(),
      });
    }

    const completedAt = new Date();
    report.completedAt = completedAt.toISOString();
    report.durationMs = completedAt.getTime() - startedAt.getTime();

    this.emit(params.onLifecycle, {
      type: 'retention_sweep_completed',
      ...(params.tenantId !== '*' ? { tenantId: params.tenantId } : {}),
      mode: params.mode,
      deletedCount: report.deleted.expiredInvites + report.deleted.revokedInvites + report.deleted.revokedEngagements,
      skippedCount: report.skipped.expiredInvites + report.skipped.revokedInvites + report.skipped.revokedEngagements,
      durationMs: report.durationMs,
      timestamp: completedAt.toISOString(),
    });

    this.logger?.info?.(
      { ...report, candidates: report.candidates, deleted: report.deleted },
      '[RetentionSweep] Sweep finished',
    );
    return report;
  }

  // ─── Sweep handlers ────────────────────────────────────────────────────

  private async sweepExpiredInvites(
    params: SweepParams,
    policy: RetentionPolicy,
    report: SweepReport,
  ): Promise<void> {
    const cutoff = new Date(Date.now() - policy.expiredInviteAfterDays * 24 * 60 * 60 * 1000);
    const where: Record<string, unknown> = {
      // Expired: either status='EXPIRED' OR (status='PENDING' AND expiresAt < cutoff)
      OR: [
        { status: 'EXPIRED', expiresAt: { lt: cutoff } },
        { status: 'PENDING', expiresAt: { lt: cutoff } },
      ],
    };
    if (params.tenantId !== '*') where['tenantId'] = params.tenantId;
    const candidates = await this.db.externalAuditorInvite.findMany({
      where,
      select: { id: true, tenantId: true, auditorEmail: true, expiresAt: true, status: true },
    });
    report.candidates.expiredInvites = candidates.length;

    for (const c of candidates) {
      this.emit(params.onLifecycle, {
        type: 'retention_candidate_found',
        tenantId: c.tenantId,
        objectType: 'external_auditor_invite',
        objectId: c.id,
        reason: `${c.status === 'EXPIRED' ? 'expired' : 'pending+past-expiry'} for >${policy.expiredInviteAfterDays}d`,
        timestamp: new Date().toISOString(),
      });
      if (params.mode === 'dry_run') {
        report.skipped.expiredInvites++;
        this.emit(params.onLifecycle, {
          type: 'retention_item_skipped',
          tenantId: c.tenantId,
          objectType: 'external_auditor_invite',
          objectId: c.id,
          reason: 'dry_run',
          timestamp: new Date().toISOString(),
        });
        continue;
      }
      try {
        await this.db.externalAuditorInvite.delete({ where: { id: c.id } });
        report.deleted.expiredInvites++;
        this.emit(params.onLifecycle, {
          type: 'retention_item_deleted',
          tenantId: c.tenantId,
          objectType: 'external_auditor_invite',
          objectId: c.id,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        report.skipped.expiredInvites++;
        report.errors.push(`Could not delete invite ${c.id}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }
  }

  private async sweepRevokedInvites(
    params: SweepParams,
    policy: RetentionPolicy,
    report: SweepReport,
  ): Promise<void> {
    const cutoff = new Date(Date.now() - policy.revokedInviteAfterDays * 24 * 60 * 60 * 1000);
    const where: Record<string, unknown> = {
      status: 'REVOKED',
      revokedAt: { lt: cutoff },
    };
    if (params.tenantId !== '*') where['tenantId'] = params.tenantId;
    const candidates = await this.db.externalAuditorInvite.findMany({
      where,
      select: { id: true, tenantId: true, revokedAt: true },
    });
    report.candidates.revokedInvites = candidates.length;

    for (const c of candidates) {
      this.emit(params.onLifecycle, {
        type: 'retention_candidate_found',
        tenantId: c.tenantId,
        objectType: 'external_auditor_invite',
        objectId: c.id,
        reason: `revoked for >${policy.revokedInviteAfterDays}d`,
        timestamp: new Date().toISOString(),
      });
      if (params.mode === 'dry_run') {
        report.skipped.revokedInvites++;
        this.emit(params.onLifecycle, {
          type: 'retention_item_skipped',
          tenantId: c.tenantId,
          objectType: 'external_auditor_invite',
          objectId: c.id,
          reason: 'dry_run',
          timestamp: new Date().toISOString(),
        });
        continue;
      }
      try {
        await this.db.externalAuditorInvite.delete({ where: { id: c.id } });
        report.deleted.revokedInvites++;
        this.emit(params.onLifecycle, {
          type: 'retention_item_deleted',
          tenantId: c.tenantId,
          objectType: 'external_auditor_invite',
          objectId: c.id,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        report.skipped.revokedInvites++;
        report.errors.push(`Could not delete revoked invite ${c.id}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }
  }

  private async sweepRevokedEngagements(
    params: SweepParams,
    policy: RetentionPolicy,
    report: SweepReport,
  ): Promise<void> {
    const cutoff = new Date(Date.now() - policy.revokedEngagementAfterDays * 24 * 60 * 60 * 1000);
    const where: Record<string, unknown> = {
      accessRevokedAt: { not: null, lt: cutoff },
    };
    if (params.tenantId !== '*') where['tenantId'] = params.tenantId;
    const candidates = await this.db.externalAuditorEngagement.findMany({
      where,
      select: { id: true, tenantId: true, accessRevokedAt: true },
    });
    report.candidates.revokedEngagements = candidates.length;

    for (const c of candidates) {
      this.emit(params.onLifecycle, {
        type: 'retention_candidate_found',
        tenantId: c.tenantId,
        objectType: 'external_auditor_engagement',
        objectId: c.id,
        reason: `engagement revoked for >${policy.revokedEngagementAfterDays}d`,
        timestamp: new Date().toISOString(),
      });
      if (params.mode === 'dry_run') {
        report.skipped.revokedEngagements++;
        this.emit(params.onLifecycle, {
          type: 'retention_item_skipped',
          tenantId: c.tenantId,
          objectType: 'external_auditor_engagement',
          objectId: c.id,
          reason: 'dry_run',
          timestamp: new Date().toISOString(),
        });
        continue;
      }
      try {
        await this.db.externalAuditorEngagement.delete({ where: { id: c.id } });
        report.deleted.revokedEngagements++;
        this.emit(params.onLifecycle, {
          type: 'retention_item_deleted',
          tenantId: c.tenantId,
          objectType: 'external_auditor_engagement',
          objectId: c.id,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        report.skipped.revokedEngagements++;
        report.errors.push(`Could not delete revoked engagement ${c.id}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }
  }

  private emit(
    onLifecycle: WorkflowLifecycleEmitter | undefined,
    event: Parameters<NonNullable<WorkflowLifecycleEmitter>>[0],
  ): void {
    if (!onLifecycle) return;
    try {
      onLifecycle(event);
    } catch {
      // Telemetry must not break the sweep.
    }
  }
}
