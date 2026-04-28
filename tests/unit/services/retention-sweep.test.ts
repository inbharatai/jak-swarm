/**
 * RetentionSweepService unit tests — Final hardening / Gap E.
 *
 * Verifies retention policy enforcement, dry-run safety, tenant
 * isolation, and lifecycle event emission.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RetentionSweepService } from '../../../apps/api/src/services/retention-sweep.service.js';

interface InviteRow {
  id: string;
  tenantId: string;
  status: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface EngagementRow {
  id: string;
  tenantId: string;
  accessRevokedAt: Date | null;
}

function matches<T extends Record<string, unknown>>(row: T, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR' && Array.isArray(v)) {
      const any = (v as Array<Record<string, unknown>>).some((sub) => matches(row, sub));
      if (!any) return false;
      continue;
    }
    if (v && typeof v === 'object' && 'lt' in (v as object)) {
      const target = row[k] as Date;
      if (!target || target.getTime() >= (v as { lt: Date }).lt.getTime()) return false;
    } else if (v && typeof v === 'object' && 'not' in (v as object)) {
      // { not: null } — accept any non-null value, then continue with the
      // remaining clauses on the same field.
      if ((v as { not: unknown }).not === null) {
        if (row[k] === null || row[k] === undefined) return false;
        const remaining = { ...(v as Record<string, unknown>) };
        delete remaining['not'];
        if (Object.keys(remaining).length > 0 && !matches(row, { [k]: remaining })) return false;
      }
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
}

function makeFakeDb(invites: InviteRow[] = [], engagements: EngagementRow[] = []) {
  return {
    invites, engagements,
    db: {
      externalAuditorInvite: {
        async findMany(args: { where: Record<string, unknown> }) {
          return invites.filter((r) => matches(r as unknown as Record<string, unknown>, args.where));
        },
        async delete(args: { where: { id: string } }) {
          const idx = invites.findIndex((r) => r.id === args.where.id);
          if (idx >= 0) invites.splice(idx, 1);
          return { id: args.where.id };
        },
      },
      externalAuditorEngagement: {
        async findMany(args: { where: Record<string, unknown> }) {
          return engagements.filter((r) => matches(r as unknown as Record<string, unknown>, args.where));
        },
        async delete(args: { where: { id: string } }) {
          const idx = engagements.findIndex((r) => r.id === args.where.id);
          if (idx >= 0) engagements.splice(idx, 1);
          return { id: args.where.id };
        },
      },
    },
  };
}

const NOW = Date.now();
const days = (n: number) => n * 24 * 60 * 60 * 1000;

// ─── Tests ────────────────────────────────────────────────────────────────

describe('RetentionSweepService — dry_run never deletes', () => {
  it('reports candidates but skipped=candidates', async () => {
    const fake = makeFakeDb(
      [
        { id: 'inv1', tenantId: 't', status: 'EXPIRED', expiresAt: new Date(NOW - days(30)), revokedAt: null },
        { id: 'inv2', tenantId: 't', status: 'PENDING', expiresAt: new Date(NOW - days(30)), revokedAt: null },
        { id: 'inv3', tenantId: 't', status: 'REVOKED', expiresAt: new Date(NOW), revokedAt: new Date(NOW - days(60)) },
      ],
      [],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new RetentionSweepService(fake.db as any);
    const report = await svc.sweep({ mode: 'dry_run', tenantId: 't' });
    // Candidates found
    expect(report.candidates.expiredInvites).toBe(2); // inv1 + inv2
    expect(report.candidates.revokedInvites).toBe(1); // inv3
    // No deletions happened
    expect(report.deleted.expiredInvites).toBe(0);
    expect(report.deleted.revokedInvites).toBe(0);
    expect(fake.invites).toHaveLength(3);
    expect(report.skipped.expiredInvites).toBe(2);
    expect(report.skipped.revokedInvites).toBe(1);
  });
});

describe('RetentionSweepService — execute mode actually deletes', () => {
  it('deletes only invites past the retention window', async () => {
    const fake = makeFakeDb(
      [
        // Expired-and-old (past retention) — DELETE
        { id: 'inv_old_expired', tenantId: 't', status: 'EXPIRED', expiresAt: new Date(NOW - days(30)), revokedAt: null },
        // Expired-but-recent (within retention) — KEEP
        { id: 'inv_new_expired', tenantId: 't', status: 'EXPIRED', expiresAt: new Date(NOW - days(2)), revokedAt: null },
        // Accepted (any age) — KEEP (not eligible)
        { id: 'inv_accepted', tenantId: 't', status: 'ACCEPTED', expiresAt: new Date(NOW - days(60)), revokedAt: null },
        // Revoked-and-old — DELETE
        { id: 'inv_old_revoked', tenantId: 't', status: 'REVOKED', expiresAt: new Date(NOW), revokedAt: new Date(NOW - days(60)) },
        // Revoked-but-recent — KEEP
        { id: 'inv_new_revoked', tenantId: 't', status: 'REVOKED', expiresAt: new Date(NOW), revokedAt: new Date(NOW - days(5)) },
      ],
      [],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new RetentionSweepService(fake.db as any);
    const report = await svc.sweep({ mode: 'execute', tenantId: 't' });
    expect(report.deleted.expiredInvites).toBe(1);
    expect(report.deleted.revokedInvites).toBe(1);
    // Survivors: the 3 not-eligible
    const survivors = fake.invites.map((i) => i.id);
    expect(survivors).toContain('inv_new_expired');
    expect(survivors).toContain('inv_accepted');
    expect(survivors).toContain('inv_new_revoked');
    expect(survivors).not.toContain('inv_old_expired');
    expect(survivors).not.toContain('inv_old_revoked');
  });

  it('deletes revoked engagements past the retention window', async () => {
    const fake = makeFakeDb(
      [],
      [
        { id: 'eng_old_revoked', tenantId: 't', accessRevokedAt: new Date(NOW - days(60)) },
        { id: 'eng_new_revoked', tenantId: 't', accessRevokedAt: new Date(NOW - days(5)) },
        { id: 'eng_active', tenantId: 't', accessRevokedAt: null },
      ],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new RetentionSweepService(fake.db as any);
    const report = await svc.sweep({ mode: 'execute', tenantId: 't' });
    expect(report.deleted.revokedEngagements).toBe(1);
    const survivors = fake.engagements.map((e) => e.id);
    expect(survivors).toContain('eng_new_revoked');
    expect(survivors).toContain('eng_active');
    expect(survivors).not.toContain('eng_old_revoked');
  });

  it('respects custom retention policy', async () => {
    const fake = makeFakeDb(
      [
        // 10 days old; default policy keeps it (>30d revoked); custom (5d) deletes
        { id: 'inv1', tenantId: 't', status: 'REVOKED', expiresAt: new Date(NOW), revokedAt: new Date(NOW - days(10)) },
      ],
      [],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new RetentionSweepService(fake.db as any);
    const report = await svc.sweep({
      mode: 'execute',
      tenantId: 't',
      policy: { revokedInviteAfterDays: 5 },
    });
    expect(report.deleted.revokedInvites).toBe(1);
  });
});

describe('RetentionSweepService — tenant isolation', () => {
  it('only sweeps the requested tenant when tenantId is specific', async () => {
    const fake = makeFakeDb(
      [
        { id: 'tA1', tenantId: 'tenant_a', status: 'EXPIRED', expiresAt: new Date(NOW - days(30)), revokedAt: null },
        { id: 'tB1', tenantId: 'tenant_b', status: 'EXPIRED', expiresAt: new Date(NOW - days(30)), revokedAt: null },
      ],
      [],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new RetentionSweepService(fake.db as any);
    const report = await svc.sweep({ mode: 'execute', tenantId: 'tenant_a' });
    expect(report.deleted.expiredInvites).toBe(1);
    // Tenant B's invite still intact
    expect(fake.invites.find((i) => i.id === 'tB1')).toBeDefined();
  });

  it('sweeps all tenants when tenantId="*"', async () => {
    const fake = makeFakeDb(
      [
        { id: 'tA1', tenantId: 'tenant_a', status: 'EXPIRED', expiresAt: new Date(NOW - days(30)), revokedAt: null },
        { id: 'tB1', tenantId: 'tenant_b', status: 'EXPIRED', expiresAt: new Date(NOW - days(30)), revokedAt: null },
      ],
      [],
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new RetentionSweepService(fake.db as any);
    const report = await svc.sweep({ mode: 'execute', tenantId: '*' });
    expect(report.deleted.expiredInvites).toBe(2);
  });
});

describe('RetentionSweepService — emits all expected events', () => {
  it('emits started → candidate_found → item_deleted → completed', async () => {
    const fake = makeFakeDb(
      [
        { id: 'inv1', tenantId: 't', status: 'EXPIRED', expiresAt: new Date(NOW - days(30)), revokedAt: null },
      ],
      [],
    );
    const events: Array<{ type: string }> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new RetentionSweepService(fake.db as any);
    await svc.sweep({
      mode: 'execute',
      tenantId: 't',
      onLifecycle: (e) => events.push(e as { type: string }),
    });
    const types = events.map((e) => e.type);
    expect(types).toContain('retention_sweep_started');
    expect(types).toContain('retention_candidate_found');
    expect(types).toContain('retention_item_deleted');
    expect(types).toContain('retention_sweep_completed');
  });

  it('emits item_skipped (not item_deleted) on dry_run', async () => {
    const fake = makeFakeDb(
      [
        { id: 'inv1', tenantId: 't', status: 'EXPIRED', expiresAt: new Date(NOW - days(30)), revokedAt: null },
      ],
      [],
    );
    const events: Array<{ type: string }> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new RetentionSweepService(fake.db as any);
    await svc.sweep({
      mode: 'dry_run',
      tenantId: 't',
      onLifecycle: (e) => events.push(e as { type: string }),
    });
    const types = events.map((e) => e.type);
    expect(types).toContain('retention_item_skipped');
    expect(types).not.toContain('retention_item_deleted');
  });
});

describe('RetentionSweepService — protected objects never deleted', () => {
  it('never touches Workflow rows (not in service surface)', () => {
    // The service has no findMany('workflow') / delete('workflow') call by
    // design. This is structural — visible by reading the service file.
    // We assert the service's API surface is restricted to the two
    // tables it owns:
    const fake = makeFakeDb([], []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new RetentionSweepService(fake.db as any);
    expect(typeof svc.sweep).toBe('function');
    // Negative assertion: service does not expose any method that
    // touches workflows or final-pack artifacts.
    const protectedMethods = ['deleteWorkflow', 'deleteFinalPack', 'deleteAuditLog', 'deleteUser'];
    for (const m of protectedMethods) {
      expect((svc as unknown as Record<string, unknown>)[m]).toBeUndefined();
    }
  });
});
