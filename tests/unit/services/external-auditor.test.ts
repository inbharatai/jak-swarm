/**
 * ExternalAuditorService unit tests — Sprint 2.6.
 *
 * Verifies the security-critical token + isolation contracts. Runs
 * against an in-memory fake of the Prisma client; the real DB path
 * would be exercised by an integration test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { ExternalAuditorService } from '../../../apps/api/src/services/audit/external-auditor.service.js';

// ─── Fake Prisma client ───────────────────────────────────────────────────

interface InviteRow {
  id: string;
  tenantId: string;
  auditRunId: string;
  auditorEmail: string;
  auditorName: string | null;
  tokenHash: string;
  scopes: string[];
  status: string;
  createdBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedUserId: string | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  emailStatus?: string | null;
  emailSentAt?: Date | null;
  emailError?: string | null;
  emailProvider?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EngagementRow {
  id: string;
  tenantId: string;
  userId: string;
  auditorEmail: string;
  auditRunId: string;
  inviteId: string;
  scopes: string[];
  accessGrantedAt: Date;
  accessRevokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface ActionRow {
  id: string;
  tenantId: string;
  userId: string;
  auditorEmail: string;
  auditRunId: string;
  engagementId: string;
  objectType: string;
  objectId: string | null;
  action: string;
  comment: string | null;
  metadata: object | null;
  createdAt: Date;
}

interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
}

function makeFakeDb() {
  const invites: InviteRow[] = [];
  const engagements: EngagementRow[] = [];
  const actions: ActionRow[] = [];
  const users: UserRow[] = [];
  const auditRuns: Array<{ id: string; tenantId: string }> = [
    { id: 'run_a', tenantId: 'tenant_a' },
    { id: 'run_b', tenantId: 'tenant_b' },
  ];
  let counter = 0;

  function matches<T extends Record<string, unknown>>(row: T, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object' && 'gt' in (v as object)) {
        const target = row[k] as Date;
        if (!(target.getTime() > (v as { gt: Date }).gt.getTime())) return false;
      } else if (row[k] !== v) {
        return false;
      }
    }
    return true;
  }

  return {
    invites, engagements, actions, users,
    db: {
      externalAuditorInvite: {
        async create(args: { data: Omit<InviteRow, 'id' | 'createdAt' | 'updatedAt'> }) {
          const row: InviteRow = {
            id: `inv_${++counter}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...args.data,
          };
          invites.push(row);
          return row;
        },
        async findUnique(args: { where: Record<string, unknown> }) {
          return invites.find((r) => matches(r as unknown as Record<string, unknown>, args.where)) ?? null;
        },
        async findFirst(args: { where: Record<string, unknown> }) {
          return invites.find((r) => matches(r as unknown as Record<string, unknown>, args.where)) ?? null;
        },
        async findMany(args: { where: Record<string, unknown> }) {
          return invites.filter((r) => matches(r as unknown as Record<string, unknown>, args.where));
        },
        async update(args: { where: { id: string }; data: Partial<InviteRow> }) {
          const idx = invites.findIndex((r) => r.id === args.where.id);
          if (idx < 0) throw new Error('not found');
          invites[idx] = { ...invites[idx], ...args.data, updatedAt: new Date() } as InviteRow;
          return invites[idx];
        },
      },
      externalAuditorEngagement: {
        async upsert(args: { where: { userId_auditRunId: { userId: string; auditRunId: string } }; create: Omit<EngagementRow, 'id' | 'createdAt' | 'updatedAt' | 'accessGrantedAt'>; update: Partial<EngagementRow> }) {
          const existing = engagements.find(
            (e) => e.userId === args.where.userId_auditRunId.userId && e.auditRunId === args.where.userId_auditRunId.auditRunId,
          );
          if (existing) {
            Object.assign(existing, args.update, { updatedAt: new Date() });
            return existing;
          }
          const row: EngagementRow = {
            id: `eng_${++counter}`,
            accessGrantedAt: new Date(),
            accessRevokedAt: null, // explicit so findFirst({ accessRevokedAt: null }) matches
            createdAt: new Date(),
            updatedAt: new Date(),
            ...args.create,
          };
          engagements.push(row);
          return row;
        },
        async findFirst(args: { where: Record<string, unknown> }) {
          return engagements.find((r) => matches(r as unknown as Record<string, unknown>, args.where)) ?? null;
        },
        async findMany(args: { where: Record<string, unknown> }) {
          return engagements.filter((r) => matches(r as unknown as Record<string, unknown>, args.where));
        },
        async updateMany(args: { where: Record<string, unknown>; data: Partial<EngagementRow> }) {
          let count = 0;
          for (const r of engagements) {
            if (matches(r as unknown as Record<string, unknown>, args.where)) {
              Object.assign(r, args.data);
              count++;
            }
          }
          return { count };
        },
      },
      externalAuditorAction: {
        async create(args: { data: Omit<ActionRow, 'id' | 'createdAt'> }) {
          const row: ActionRow = { id: `act_${++counter}`, createdAt: new Date(), ...args.data };
          actions.push(row);
          return row;
        },
        async findMany(args: { where: Record<string, unknown> }) {
          return actions.filter((r) => matches(r as unknown as Record<string, unknown>, args.where));
        },
      },
      auditRun: {
        async findFirst(args: { where: { id: string; tenantId: string } }) {
          return auditRuns.find((r) => r.id === args.where.id && r.tenantId === args.where.tenantId) ?? null;
        },
      },
      user: {
        async findFirst(args: { where: Record<string, unknown> }) {
          return users.find((u) => matches(u as unknown as Record<string, unknown>, args.where)) ?? null;
        },
        async create(args: { data: Omit<UserRow, 'id'> }) {
          const row: UserRow = { id: `usr_${++counter}`, ...args.data };
          users.push(row);
          return row;
        },
      },
      $transaction: async (calls: Promise<unknown>[]) => Promise.all(calls),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ExternalAuditorService — invite token security', () => {
  let svc: ExternalAuditorService;
  let fake: ReturnType<typeof makeFakeDb>;

  beforeEach(() => {
    fake = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc = new ExternalAuditorService(fake.db as any);
  });

  it('createInvite returns a 64-char hex cleartext token', async () => {
    const result = await svc.createInvite({
      tenantId: 'tenant_a',
      auditRunId: 'run_a',
      auditorEmail: 'auditor@firm.com',
      createdBy: 'admin_1',
    });
    expect(result.cleartextToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.acceptUrl).toContain(result.cleartextToken);
  });

  it('persists ONLY the SHA-256 hash of the token, never cleartext', async () => {
    const result = await svc.createInvite({
      tenantId: 'tenant_a',
      auditRunId: 'run_a',
      auditorEmail: 'auditor@firm.com',
      createdBy: 'admin_1',
    });
    const stored = fake.invites[0];
    expect(stored.tokenHash).toBe(createHash('sha256').update(result.cleartextToken).digest('hex'));
    expect(stored.tokenHash).not.toBe(result.cleartextToken);
    // Verify cleartext appears nowhere in the persisted row
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(result.cleartextToken);
  });

  it('refuses to create invite for an audit run from a different tenant', async () => {
    await expect(
      svc.createInvite({
        tenantId: 'tenant_a',
        auditRunId: 'run_b', // belongs to tenant_b
        auditorEmail: 'auditor@firm.com',
        createdBy: 'admin_1',
      }),
    ).rejects.toThrow(/not found in tenant/);
  });

  it('acceptInvite with a valid token creates the engagement + EXTERNAL_AUDITOR user', async () => {
    const created = await svc.createInvite({
      tenantId: 'tenant_a',
      auditRunId: 'run_a',
      auditorEmail: 'auditor@firm.com',
      scopes: ['view_workpapers', 'comment'],
      createdBy: 'admin_1',
    });
    const accepted = await svc.acceptInvite({ cleartextToken: created.cleartextToken });
    expect(accepted.tenantId).toBe('tenant_a');
    expect(accepted.auditRunId).toBe('run_a');
    expect(accepted.scopes).toEqual(['view_workpapers', 'comment']);
    // User created with EXTERNAL_AUDITOR role
    expect(fake.users[0].role).toBe('EXTERNAL_AUDITOR');
    expect(fake.users[0].email).toBe('auditor@firm.com');
  });

  it('acceptInvite rejects invalid tokens', async () => {
    const fakeToken = 'a'.repeat(64);
    await expect(svc.acceptInvite({ cleartextToken: fakeToken })).rejects.toThrow(/invalid/i);
  });

  it('acceptInvite rejects already-accepted invites', async () => {
    const created = await svc.createInvite({
      tenantId: 'tenant_a', auditRunId: 'run_a', auditorEmail: 'a@b.com', createdBy: 'admin_1',
    });
    await svc.acceptInvite({ cleartextToken: created.cleartextToken });
    await expect(svc.acceptInvite({ cleartextToken: created.cleartextToken })).rejects.toThrow(/cannot accept/);
  });

  it('acceptInvite rejects expired invites + marks them EXPIRED', async () => {
    const created = await svc.createInvite({
      tenantId: 'tenant_a', auditRunId: 'run_a', auditorEmail: 'a@b.com', createdBy: 'admin_1',
    });
    // Force expire
    fake.invites[0].expiresAt = new Date(Date.now() - 1_000);
    await expect(svc.acceptInvite({ cleartextToken: created.cleartextToken })).rejects.toThrow(/expired/);
    // Status should now be EXPIRED
    expect(fake.invites[0].status).toBe('EXPIRED');
  });

  it('revokeInvite flips status + revokes engagement access', async () => {
    const created = await svc.createInvite({
      tenantId: 'tenant_a', auditRunId: 'run_a', auditorEmail: 'a@b.com', createdBy: 'admin_1',
    });
    await svc.acceptInvite({ cleartextToken: created.cleartextToken });
    expect(fake.engagements[0].accessRevokedAt).toBeNull();

    await svc.revokeInvite({ inviteId: created.inviteId, tenantId: 'tenant_a', revokedBy: 'admin_1' });

    expect(fake.invites[0].status).toBe('REVOKED');
    expect(fake.invites[0].revokedAt).toBeInstanceOf(Date);
    expect(fake.engagements[0].accessRevokedAt).toBeInstanceOf(Date);
  });

  it('findActiveEngagement excludes expired and revoked engagements', async () => {
    const created = await svc.createInvite({
      tenantId: 'tenant_a', auditRunId: 'run_a', auditorEmail: 'a@b.com', createdBy: 'admin_1',
    });
    const accepted = await svc.acceptInvite({ cleartextToken: created.cleartextToken });
    // Active immediately after accept
    let found = await svc.findActiveEngagement(accepted.userId, accepted.auditRunId);
    expect(found).toBeDefined();
    expect(found!.tenantId).toBe('tenant_a');

    // Revoke
    await svc.revokeInvite({ inviteId: created.inviteId, tenantId: 'tenant_a', revokedBy: 'admin_1' });
    found = await svc.findActiveEngagement(accepted.userId, accepted.auditRunId);
    expect(found).toBeUndefined();
  });
});

describe('ExternalAuditorService.sendInviteEmail — Gap C honest status', () => {
  let svc: ExternalAuditorService;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    const fake = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc = new ExternalAuditorService(fake.db as any);
    originalEnv = {
      JAK_INVITE_EMAIL_HOST: process.env['JAK_INVITE_EMAIL_HOST'],
      JAK_INVITE_EMAIL_USER: process.env['JAK_INVITE_EMAIL_USER'],
      JAK_INVITE_EMAIL_PASS: process.env['JAK_INVITE_EMAIL_PASS'],
    };
    delete process.env['JAK_INVITE_EMAIL_HOST'];
    delete process.env['JAK_INVITE_EMAIL_USER'];
    delete process.env['JAK_INVITE_EMAIL_PASS'];
  });

  function restoreEnv() {
    if (originalEnv['JAK_INVITE_EMAIL_HOST']) process.env['JAK_INVITE_EMAIL_HOST'] = originalEnv['JAK_INVITE_EMAIL_HOST'];
    if (originalEnv['JAK_INVITE_EMAIL_USER']) process.env['JAK_INVITE_EMAIL_USER'] = originalEnv['JAK_INVITE_EMAIL_USER'];
    if (originalEnv['JAK_INVITE_EMAIL_PASS']) process.env['JAK_INVITE_EMAIL_PASS'] = originalEnv['JAK_INVITE_EMAIL_PASS'];
  }

  it('returns status=not_configured when SMTP env vars missing', async () => {
    const result = await svc.sendInviteEmail({
      auditorEmail: 'auditor@firm.com',
      acceptUrl: 'https://app.jak-swarm.com/auditor/accept/abc',
      expiresAt: new Date(),
    });
    expect(result.status).toBe('not_configured');
    expect(result.error).toBeUndefined();
    restoreEnv();
  });

  it('returns status=not_configured when only HOST set (partial config)', async () => {
    process.env['JAK_INVITE_EMAIL_HOST'] = 'smtp.example.com';
    const result = await svc.sendInviteEmail({
      auditorEmail: 'auditor@firm.com',
      acceptUrl: 'https://app.jak-swarm.com/auditor/accept/abc',
      expiresAt: new Date(),
    });
    expect(result.status).toBe('not_configured');
    delete process.env['JAK_INVITE_EMAIL_HOST'];
    restoreEnv();
  });

  it('returns status=failed when SMTP host unreachable (real connection attempt)', async () => {
    // Set env to an unreachable SMTP server. The send will fail at
    // connection time. This proves we DO actually try to send when
    // configured — we don't fake-success.
    process.env['JAK_INVITE_EMAIL_HOST'] = '127.0.0.1';
    process.env['JAK_INVITE_EMAIL_PORT'] = '12345'; // unlikely to be in use
    process.env['JAK_INVITE_EMAIL_USER'] = 'test@test.com';
    process.env['JAK_INVITE_EMAIL_PASS'] = 'test-password';
    const result = await svc.sendInviteEmail({
      auditorEmail: 'auditor@firm.com',
      acceptUrl: 'https://app.jak-swarm.com/auditor/accept/abc',
      expiresAt: new Date(),
    });
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
    delete process.env['JAK_INVITE_EMAIL_HOST'];
    delete process.env['JAK_INVITE_EMAIL_PORT'];
    delete process.env['JAK_INVITE_EMAIL_USER'];
    delete process.env['JAK_INVITE_EMAIL_PASS'];
    restoreEnv();
  }, 15_000);
});

describe('ExternalAuditorService.createInvite — Gap C email status persisted', () => {
  let fake: ReturnType<typeof makeFakeDb>;
  let svc: ExternalAuditorService;

  beforeEach(() => {
    fake = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc = new ExternalAuditorService(fake.db as any);
    delete process.env['JAK_INVITE_EMAIL_HOST'];
    delete process.env['JAK_INVITE_EMAIL_USER'];
    delete process.env['JAK_INVITE_EMAIL_PASS'];
  });

  it('createInvite returns emailStatus=not_configured when SMTP not set', async () => {
    const result = await svc.createInvite({
      tenantId: 'tenant_a',
      auditRunId: 'run_a',
      auditorEmail: 'auditor@firm.com',
      createdBy: 'admin_1',
    });
    expect(result.emailStatus).toBe('not_configured');
    // Persisted on the row
    expect(fake.invites[0].emailStatus).toBe('not_configured');
    expect(fake.invites[0].emailSentAt).toBeFalsy();
  });

  it('createInvite still creates the invite even when email fails to send', async () => {
    process.env['JAK_INVITE_EMAIL_HOST'] = '127.0.0.1';
    process.env['JAK_INVITE_EMAIL_PORT'] = '12346';
    process.env['JAK_INVITE_EMAIL_USER'] = 'u';
    process.env['JAK_INVITE_EMAIL_PASS'] = 'p';
    const result = await svc.createInvite({
      tenantId: 'tenant_a',
      auditRunId: 'run_a',
      auditorEmail: 'auditor@firm.com',
      createdBy: 'admin_1',
    });
    // Invite was created
    expect(result.inviteId).toBeTruthy();
    expect(result.cleartextToken).toMatch(/^[0-9a-f]{64}$/);
    // Email failed honestly
    expect(result.emailStatus).toBe('failed');
    expect(result.emailError).toBeDefined();
    // Status persisted
    expect(fake.invites[0].emailStatus).toBe('failed');
    delete process.env['JAK_INVITE_EMAIL_HOST'];
    delete process.env['JAK_INVITE_EMAIL_PORT'];
    delete process.env['JAK_INVITE_EMAIL_USER'];
    delete process.env['JAK_INVITE_EMAIL_PASS'];
  }, 15_000);
});

describe('ExternalAuditorService — cross-tenant isolation', () => {
  let svc: ExternalAuditorService;
  let fake: ReturnType<typeof makeFakeDb>;

  beforeEach(() => {
    fake = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc = new ExternalAuditorService(fake.db as any);
  });

  it('an auditor invited to tenant_a cannot see tenant_b engagements', async () => {
    const inviteA = await svc.createInvite({
      tenantId: 'tenant_a', auditRunId: 'run_a', auditorEmail: 'auditor@firm.com', createdBy: 'admin_a',
    });
    const inviteB = await svc.createInvite({
      tenantId: 'tenant_b', auditRunId: 'run_b', auditorEmail: 'other@firm.com', createdBy: 'admin_b',
    });
    const acceptedA = await svc.acceptInvite({ cleartextToken: inviteA.cleartextToken });
    const acceptedB = await svc.acceptInvite({ cleartextToken: inviteB.cleartextToken });

    // Auditor A cannot find auditor B's engagement
    const wrongLookup = await svc.findActiveEngagement(acceptedA.userId, acceptedB.auditRunId);
    expect(wrongLookup).toBeUndefined();

    // listEngagementsForAuditor scopes to userId
    const aEngagements = await svc.listEngagementsForAuditor(acceptedA.userId);
    expect(aEngagements).toHaveLength(1);
    expect(aEngagements[0].tenantId).toBe('tenant_a');
  });

  it('logAction writes to the audit trail with correct tenantId', async () => {
    const created = await svc.createInvite({
      tenantId: 'tenant_a', auditRunId: 'run_a', auditorEmail: 'a@b.com', createdBy: 'admin_1',
    });
    const accepted = await svc.acceptInvite({ cleartextToken: created.cleartextToken });
    await svc.logAction({
      tenantId: accepted.tenantId,
      userId: accepted.userId,
      auditorEmail: 'a@b.com',
      auditRunId: accepted.auditRunId,
      engagementId: accepted.engagementId,
      objectType: 'workpaper',
      objectId: 'wp_1',
      action: 'view',
    });
    const trail = await svc.listActionsForAuditRun('tenant_a', 'run_a');
    expect(trail).toHaveLength(1);
    expect(trail[0].action).toBe('view');
    expect(trail[0].objectId).toBe('wp_1');
    expect(trail[0].tenantId).toBe('tenant_a');
  });
});
