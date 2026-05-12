/**
 * Unit tests for TrialPromotionService — verifies the path from a VERIFIED
 * TrialSignup row → real Tenant + first User (TENANT_ADMIN) + trialing
 * Subscription → JWT.
 *
 * Critical behaviors covered:
 *   1. Happy path: VERIFIED signup → tenant + user + sub created atomically
 *   2. Idempotency: PROMOTED signup returns fresh JWT for existing tenant
 *   3. Wrong-status guard: PENDING_VERIFY rejected
 *   4. Email collision: existing user blocks promotion
 *   5. Slug collision: appends suffix instead of crashing
 *   6. Trial subscription is created with trial_30d + status=trialing +
 *      trialEndsAt = now + 30 days
 */

import { describe, expect, it, vi } from 'vitest';
import { TrialPromotionService } from '../../../apps/api/src/services/trial/trial-promotion.service.js';

interface FakeTenant { id: string; slug: string; name: string }
interface FakeUser {
  id: string; tenantId: string; email: string; name: string | null;
  role: string; passwordHash: string | null; jobFunction: string | null;
}
interface FakeSubscription {
  tenantId: string; planId: string; status: string;
  trialStartedAt: Date | null; trialEndsAt: Date | null;
}

function makeFakeDb() {
  const tenants: FakeTenant[] = [];
  const users: FakeUser[] = [];
  const subscriptions: FakeSubscription[] = [];
  const onboardingStates: Array<{ tenantId: string }> = [];
  const trialSignups: Array<{
    id: string; status: string; tenantId: string | null; promotedAt: Date | null;
  }> = [];

  let cuid = 0;
  const id = (prefix = 'id') => `${prefix}-${++cuid}`;

  const tx: any = {
    tenant: {
      create: vi.fn(async ({ data }: any) => {
        const t = { id: id('tnt'), slug: data.slug, name: data.name };
        tenants.push(t);
        return t;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return tenants.find((t) => t.slug === where.slug) ?? null;
      }),
    },
    user: {
      create: vi.fn(async ({ data }: any) => {
        const u: FakeUser = {
          id: id('usr'),
          tenantId: data.tenantId,
          email: data.email,
          name: data.name ?? null,
          role: data.role,
          passwordHash: data.passwordHash ?? null,
          jobFunction: data.jobFunction ?? null,
        };
        users.push(u);
        return u;
      }),
      findFirst: vi.fn(async ({ where, include }: any) => {
        const found = users.find((u) => {
          if (where.tenantId && u.tenantId !== where.tenantId) return false;
          if (where.email && u.email !== where.email) return false;
          return true;
        });
        if (!found) return null;
        if (include?.tenant) {
          const tenant = tenants.find((t) => t.id === found.tenantId);
          return { ...found, tenant: tenant ?? null };
        }
        return found;
      }),
    },
    subscription: {
      create: vi.fn(async ({ data }: any) => {
        const s: FakeSubscription = {
          tenantId: data.tenantId,
          planId: data.planId,
          status: data.status,
          trialStartedAt: data.trialStartedAt ?? null,
          trialEndsAt: data.trialEndsAt ?? null,
        };
        subscriptions.push(s);
        return s;
      }),
    },
    onboardingState: {
      create: vi.fn(async ({ data }: any) => {
        const o = { tenantId: data.tenantId };
        onboardingStates.push(o);
        return o;
      }),
    },
    trialSignup: {
      update: vi.fn(async ({ where, data }: any) => {
        // Lazily create the row on first reference so test setup doesn't
        // need to pre-seed it (the service treats the row as input-only
        // when calling promote — it just stamps PROMOTED back onto it).
        let s = trialSignups.find((x) => x.id === where.id);
        if (!s) {
          s = { id: where.id, status: 'VERIFIED', tenantId: null, promotedAt: null };
          trialSignups.push(s);
        }
        Object.assign(s, data);
        return s;
      }),
    },
  };

  // The service uses BOTH the top-level db and a $transaction(tx => ...).
  // We make both refer to the same fake collections so the test sees
  // post-transaction state through the top-level db too.
  const db: any = {
    ...tx,
    user: {
      ...tx.user,
      findFirst: tx.user.findFirst,
    },
    tenant: tx.tenant,
    subscription: tx.subscription,
    onboardingState: tx.onboardingState,
    trialSignup: tx.trialSignup,
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };

  return { db, _state: { tenants, users, subscriptions, onboardingStates, trialSignups } };
}

const baseFastify = {
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  jwt: { sign: vi.fn(() => 'fake.jwt.token') },
} as any;

describe('TrialPromotionService.promote', () => {
  it('creates a tenant + admin user + trialing subscription on a VERIFIED signup', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new TrialPromotionService(db, baseFastify);

    const result = await svc.promote({
      id: 'sig-1',
      email: 'founder@acme.com',
      companyName: 'Acme Inc',
      industry: 'TECHNOLOGY',
      status: 'VERIFIED',
      tenantId: null,
      verifiedAt: new Date(),
    });

    expect(result.reusedExistingTenant).toBe(false);
    expect(result.tenant.name).toBe('Acme Inc');
    expect(result.tenant.slug).toMatch(/^acme/);
    expect(result.user.email).toBe('founder@acme.com');
    expect(result.user.role).toBe('TENANT_ADMIN');
    expect(result.token).toBe('fake.jwt.token');
    expect(result.initialPassword).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.initialPassword.length).toBeGreaterThan(20);

    // Check side-effects.
    expect(_state.tenants).toHaveLength(1);
    expect(_state.users).toHaveLength(1);
    expect(_state.subscriptions).toHaveLength(1);
    const sub = _state.subscriptions[0]!;
    expect(sub.planId).toBe('trial_30d');
    expect(sub.status).toBe('trialing');
    expect(sub.trialEndsAt).toBeInstanceOf(Date);
    // ~30 days out
    const daysOut = Math.round(((sub.trialEndsAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    expect(daysOut).toBeGreaterThanOrEqual(29);
    expect(daysOut).toBeLessThanOrEqual(31);
  });

  it('is idempotent on a PROMOTED signup', async () => {
    const { db, _state } = makeFakeDb();

    // Pre-seed an already-promoted signup with its tenant + user.
    _state.tenants.push({ id: 'tnt-existing', slug: 'reused-co', name: 'Reused Co' });
    _state.users.push({
      id: 'usr-existing',
      tenantId: 'tnt-existing',
      email: 'reused@example.com',
      name: 'Reused',
      role: 'TENANT_ADMIN',
      passwordHash: 'bcrypt-hash',
      jobFunction: 'founder',
    });

    const svc = new TrialPromotionService(db, baseFastify);
    const result = await svc.promote({
      id: 'sig-2',
      email: 'reused@example.com',
      companyName: 'Reused Co',
      industry: null,
      status: 'PROMOTED',
      tenantId: 'tnt-existing',
      verifiedAt: new Date(),
    });

    expect(result.reusedExistingTenant).toBe(true);
    expect(result.tenant.id).toBe('tnt-existing');
    expect(result.token).toBe('fake.jwt.token');
    expect(result.initialPassword).toBe('<already-set>');
    // Did not double-create the tenant.
    expect(_state.tenants).toHaveLength(1);
  });

  it('refuses to promote a signup not yet VERIFIED', async () => {
    const { db } = makeFakeDb();
    const svc = new TrialPromotionService(db, baseFastify);
    await expect(svc.promote({
      id: 'sig-3',
      email: 'pending@example.com',
      companyName: null,
      industry: null,
      status: 'PENDING_VERIFY',
      tenantId: null,
      verifiedAt: null,
    })).rejects.toThrow(/cannot promote signup with status='PENDING_VERIFY'/);
  });

  it('refuses if the email is already attached to a non-trial user', async () => {
    const { db, _state } = makeFakeDb();
    _state.users.push({
      id: 'usr-other',
      tenantId: 'tnt-other',
      email: 'taken@example.com',
      name: null,
      role: 'TENANT_ADMIN',
      passwordHash: 'h',
      jobFunction: null,
    });
    const svc = new TrialPromotionService(db, baseFastify);
    await expect(svc.promote({
      id: 'sig-4',
      email: 'taken@example.com',
      companyName: 'Anything',
      industry: null,
      status: 'VERIFIED',
      tenantId: null,
      verifiedAt: new Date(),
    })).rejects.toThrow(/already has a user account/);
  });

  it('appends a suffix when the slug is taken', async () => {
    const { db, _state } = makeFakeDb();
    // Pre-seed a tenant occupying the slug "acme".
    _state.tenants.push({ id: 'tnt-prior', slug: 'acme', name: 'Acme Old' });

    const svc = new TrialPromotionService(db, baseFastify);
    const result = await svc.promote({
      id: 'sig-5',
      email: 'second@acme.com',
      companyName: 'Acme',
      industry: null,
      status: 'VERIFIED',
      tenantId: null,
      verifiedAt: new Date(),
    });
    expect(result.tenant.slug).not.toBe('acme');
    expect(result.tenant.slug).toMatch(/^acme-/);
  });
});
