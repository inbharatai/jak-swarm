/**
 * Unit tests for AuthService — verifies the password-based register/login
 * flow plus the JWT helpers and bcrypt round-trip.
 *
 * Critical behaviors covered:
 *   1.  register: happy path creates Tenant + User in a transaction and
 *       returns a JWT + AuthSession
 *   2.  register: invalid slug formats throw ValidationError
 *   3.  register: existing slug throws ConflictError with the exact slug
 *   4.  register: existing email anywhere blocks registration with
 *       ConflictError
 *   5.  register: created user has a bcrypt hash, NOT the plaintext
 *       password — round-trip via verifyPassword succeeds
 *   6.  register: first user of a new tenant is TENANT_ADMIN
 *   7.  login: happy path returns JWT + session
 *   8.  login: wrong password yields the generic UnauthorizedError
 *       message (no enumeration)
 *   9.  login: unknown email yields the SAME generic message
 *  10.  login: inactive user → 'Account is not active'
 *  11.  login: suspended tenant → 'Tenant account is suspended or deleted'
 *  12.  login: tenantSlug scopes the lookup
 *  13.  hashPassword + verifyPassword round-trip
 *  14.  signToken passes role + tenantId + userId to fastify.jwt.sign
 *  15.  verifyToken delegates to fastify.jwt.verify
 *
 * Supabase identity flows (authenticateSupabaseToken,
 * resolveSupabaseIdentity, provisionUserFromSupabase) are deferred to
 * `it.todo` — they require mocking global fetch, the CreditService
 * constructor, and additional Prisma surface area; out of scope for this
 * password-path-first pass.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../apps/api/src/services/auth.service.js';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../apps/api/src/errors.js';

// ---------------------------------------------------------------------------
// Fake Prisma — in-memory store, mirrors the trial-promotion.test.ts pattern.
// ---------------------------------------------------------------------------

interface FakeTenant {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
}

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  role: string;
  passwordHash: string | null;
  jobFunction: string | null;
  active: boolean;
  avatarUrl: string | null;
}

function makeFakeDb() {
  const tenants: FakeTenant[] = [];
  const users: FakeUser[] = [];

  let cuid = 0;
  const id = (prefix = 'id') => `${prefix}-${++cuid}`;

  const matchesUserWhere = (u: FakeUser, where: any): boolean => {
    if (!where) return true;
    if (where.id && u.id !== where.id) return false;
    if (where.email && u.email !== where.email) return false;
    if (where.tenantId && u.tenantId !== where.tenantId) return false;
    if (where.tenant?.slug) {
      const t = tenants.find((tn) => tn.id === u.tenantId);
      if (!t || t.slug !== where.tenant.slug) return false;
    }
    return true;
  };

  const enrichUser = (u: FakeUser, include: any): any => {
    if (!include?.tenant) return u;
    const tenant = tenants.find((t) => t.id === u.tenantId) ?? null;
    if (!tenant) return { ...u, tenant: null };
    // include.tenant.select narrows shape, but the service only reads
    // id/slug/status, which we always have anyway.
    return {
      ...u,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        status: tenant.status,
      },
    };
  };

  const tx: any = {
    tenant: {
      create: vi.fn(async ({ data }: any) => {
        const t: FakeTenant = {
          id: id('tnt'),
          slug: data.slug,
          name: data.name,
          status: data.status ?? 'ACTIVE',
        };
        tenants.push(t);
        return t;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.slug) return tenants.find((t) => t.slug === where.slug) ?? null;
        if (where.id) return tenants.find((t) => t.id === where.id) ?? null;
        return null;
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
          active: data.active ?? true,
          avatarUrl: data.avatarUrl ?? null,
        };
        users.push(u);
        return u;
      }),
      findFirst: vi.fn(async ({ where, include }: any) => {
        const found = users.find((u) => matchesUserWhere(u, where));
        return found ? enrichUser(found, include) : null;
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const found = users.find((u) => matchesUserWhere(u, where));
        return found ? enrichUser(found, include) : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const u = users.find((x) => x.id === where.id);
        if (!u) throw new Error(`user ${where.id} not found`);
        Object.assign(u, data);
        return u;
      }),
    },
  };

  const db: any = {
    ...tx,
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };

  return { db, _state: { tenants, users } };
}

// ---------------------------------------------------------------------------
// Fake Fastify
// ---------------------------------------------------------------------------

function makeFakeFastify() {
  return {
    jwt: {
      sign: vi.fn((_payload: any, _opts?: any) => 'fake.jwt.token'),
      verify: vi.fn((_token: string) => ({
        sub: 'usr-from-token',
        userId: 'usr-from-token',
        tenantId: 'tnt-from-token',
        email: 'token@example.com',
        name: 'Token User',
        role: 'TENANT_ADMIN',
        jobFunction: null,
      })),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const VALID = {
  email: 'founder@acme.com',
  password: 'CorrectHorseBattery9!',
  name: 'Ada Founder',
  tenantName: 'Acme Inc',
  tenantSlug: 'acme',
};

// A throwaway service used purely as a bcrypt wrapper from test code, so
// the test file doesn't need to depend on bcryptjs directly (it's a
// transitive dep of the api workspace, not @jak-swarm/tests).
const _hashSvc = new AuthService({} as any, makeFakeFastify());

async function seedActiveUser(
  db: any,
  state: { tenants: FakeTenant[]; users: FakeUser[] },
  overrides: Partial<FakeUser> & { tenantStatus?: FakeTenant['status']; password?: string } = {},
) {
  const password = overrides.password ?? VALID.password;
  const passwordHash = await _hashSvc.hashPassword(password);
  const tenant: FakeTenant = {
    id: overrides.tenantId ?? 'tnt-seed',
    slug: 'acme',
    name: 'Acme Inc',
    status: overrides.tenantStatus ?? 'ACTIVE',
  };
  state.tenants.push(tenant);

  const user: FakeUser = {
    id: overrides.id ?? 'usr-seed',
    tenantId: tenant.id,
    email: overrides.email ?? VALID.email.toLowerCase(),
    name: overrides.name ?? VALID.name,
    role: overrides.role ?? 'TENANT_ADMIN',
    passwordHash,
    jobFunction: overrides.jobFunction ?? null,
    active: overrides.active ?? true,
    avatarUrl: overrides.avatarUrl ?? null,
  };
  state.users.push(user);
  return { tenant, user, password };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthService.register', () => {
  let db: any;
  let state: { tenants: FakeTenant[]; users: FakeUser[] };
  let fastify: any;
  let svc: AuthService;

  beforeEach(() => {
    const fake = makeFakeDb();
    db = fake.db;
    state = fake._state;
    fastify = makeFakeFastify();
    svc = new AuthService(db, fastify);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: creates tenant + admin user atomically and returns JWT + session', async () => {
    const result = await svc.register(
      VALID.email,
      VALID.password,
      VALID.name,
      VALID.tenantName,
      VALID.tenantSlug,
    );

    expect(result.token).toBe('fake.jwt.token');
    expect(state.tenants).toHaveLength(1);
    expect(state.users).toHaveLength(1);

    const tenant = state.tenants[0]!;
    const user = state.users[0]!;

    expect(tenant.slug).toBe('acme');
    expect(tenant.name).toBe('Acme Inc');
    expect(tenant.status).toBe('ACTIVE');

    expect(user.tenantId).toBe(tenant.id);
    expect(user.email).toBe('founder@acme.com');
    expect(user.role).toBe('TENANT_ADMIN');

    // Ensure the work happened inside a $transaction call.
    expect(db.$transaction).toHaveBeenCalledTimes(1);

    // Returned session shape.
    expect(result.user).toMatchObject({
      sub: user.id,
      userId: user.id,
      tenantId: tenant.id,
      email: 'founder@acme.com',
      name: VALID.name,
      role: 'TENANT_ADMIN',
      jobFunction: null,
    });
  });

  it('lowercases the email before storing it', async () => {
    await svc.register(
      'Founder@ACME.com',
      VALID.password,
      VALID.name,
      VALID.tenantName,
      VALID.tenantSlug,
    );
    expect(state.users[0]!.email).toBe('founder@acme.com');
  });

  it.each([
    ['UPPERCASE', 'ACME'],
    ['contains a space', 'acme co'],
    ['contains underscore', 'acme_co'],
    ['contains a dot', 'acme.co'],
    ['contains slash', 'acme/co'],
    ['empty string', ''],
  ])('rejects invalid slug — %s', async (_label, slug) => {
    await expect(
      svc.register(VALID.email, VALID.password, VALID.name, VALID.tenantName, slug),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(state.tenants).toHaveLength(0);
    expect(state.users).toHaveLength(0);
  });

  it('rejects a slug that already exists with ConflictError naming the slug', async () => {
    state.tenants.push({
      id: 'tnt-prior',
      slug: 'acme',
      name: 'Existing Acme',
      status: 'ACTIVE',
    });

    const promise = svc.register(
      VALID.email,
      VALID.password,
      VALID.name,
      VALID.tenantName,
      'acme',
    );

    await expect(promise).rejects.toBeInstanceOf(ConflictError);
    await expect(promise).rejects.toThrow(/Tenant slug 'acme' is already taken/);
    expect(state.users).toHaveLength(0);
  });

  it('rejects an email that already exists ANYWHERE in the system', async () => {
    // Pre-existing user under an unrelated tenant.
    state.tenants.push({
      id: 'tnt-other',
      slug: 'globex',
      name: 'Globex',
      status: 'ACTIVE',
    });
    state.users.push({
      id: 'usr-other',
      tenantId: 'tnt-other',
      email: 'founder@acme.com',
      name: 'Existing',
      role: 'TENANT_ADMIN',
      passwordHash: 'h',
      jobFunction: null,
      active: true,
      avatarUrl: null,
    });

    const promise = svc.register(
      'Founder@Acme.com', // mixed case, must still match
      VALID.password,
      VALID.name,
      VALID.tenantName,
      VALID.tenantSlug,
    );

    // B4 (audit 2026-05-08): the rejection IS a ConflictError, but the
    // message must NOT echo the attempted email back (enumeration oracle).
    // Use the new generic copy "Registration could not be completed."
    await expect(promise).rejects.toBeInstanceOf(ConflictError);
    await expect(promise).rejects.toThrow(/Registration could not be completed/);
    // Crucially the email submitted MUST NOT appear in the error message.
    await expect(promise).rejects.not.toThrow(/Founder@Acme\.com/i);
    // No new tenant was created.
    expect(state.tenants).toHaveLength(1);
    expect(state.users).toHaveLength(1);
  });

  it('stores a bcrypt hash, NOT the cleartext password (round-trip)', async () => {
    await svc.register(
      VALID.email,
      VALID.password,
      VALID.name,
      VALID.tenantName,
      VALID.tenantSlug,
    );

    const stored = state.users[0]!.passwordHash!;
    expect(stored).toBeTruthy();
    expect(stored).not.toBe(VALID.password);
    // bcryptjs hashes start with $2a$ / $2b$ / $2y$.
    expect(stored).toMatch(/^\$2[aby]\$\d{2}\$/);

    // Round-trip via the service's verifyPassword (delegates to bcrypt.compare).
    expect(await svc.verifyPassword(VALID.password, stored)).toBe(true);
    expect(await svc.verifyPassword('not-the-password', stored)).toBe(false);
  });

  it('the first user is TENANT_ADMIN, not END_USER / VIEWER', async () => {
    await svc.register(
      VALID.email,
      VALID.password,
      VALID.name,
      VALID.tenantName,
      VALID.tenantSlug,
    );
    expect(state.users[0]!.role).toBe('TENANT_ADMIN');
    expect(state.users[0]!.role).not.toBe('END_USER');
    expect(state.users[0]!.role).not.toBe('VIEWER');
  });
});

describe('AuthService.login', () => {
  let db: any;
  let state: { tenants: FakeTenant[]; users: FakeUser[] };
  let fastify: any;
  let svc: AuthService;

  beforeEach(() => {
    const fake = makeFakeDb();
    db = fake.db;
    state = fake._state;
    fastify = makeFakeFastify();
    svc = new AuthService(db, fastify);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: correct credentials return JWT + session', async () => {
    const { user, tenant, password } = await seedActiveUser(db, state);

    const result = await svc.login(VALID.email, password);

    expect(result.token).toBe('fake.jwt.token');
    expect(result.user).toMatchObject({
      sub: user.id,
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: 'TENANT_ADMIN',
    });
    // signToken was called with a session payload.
    expect(fastify.jwt.sign).toHaveBeenCalledTimes(1);
  });

  it('wrong password → generic "Invalid email or password" (no enumeration)', async () => {
    await seedActiveUser(db, state);

    const promise = svc.login(VALID.email, 'totally-wrong-password');
    await expect(promise).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(promise).rejects.toThrow('Invalid email or password');
    // Failure logged with userId (not email) for correlation.
    expect(fastify.log.warn).toHaveBeenCalled();
  });

  it('unknown email → SAME generic message (no enumeration)', async () => {
    // No user seeded.
    const promise = svc.login('ghost@nowhere.com', 'whatever');
    await expect(promise).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(promise).rejects.toThrow('Invalid email or password');
  });

  it('the wrong-password and unknown-email errors are indistinguishable', async () => {
    await seedActiveUser(db, state);

    let wrongPwMsg = '';
    let unknownEmailMsg = '';
    try {
      await svc.login(VALID.email, 'nope');
    } catch (e: any) {
      wrongPwMsg = e.message;
    }
    try {
      await svc.login('ghost@nowhere.com', 'nope');
    } catch (e: any) {
      unknownEmailMsg = e.message;
    }
    expect(wrongPwMsg).toBe(unknownEmailMsg);
    expect(wrongPwMsg).toBe('Invalid email or password');
  });

  it('inactive user → "Account is not active"', async () => {
    const { password } = await seedActiveUser(db, state, { active: false });

    const promise = svc.login(VALID.email, password);
    await expect(promise).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(promise).rejects.toThrow('Account is not active');
  });

  it('suspended tenant → "Tenant account is suspended or deleted"', async () => {
    const { password } = await seedActiveUser(db, state, { tenantStatus: 'SUSPENDED' });

    const promise = svc.login(VALID.email, password);
    await expect(promise).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(promise).rejects.toThrow('Tenant account is suspended or deleted');
  });

  it('deleted tenant → same "suspended or deleted" error', async () => {
    const { password } = await seedActiveUser(db, state, { tenantStatus: 'DELETED' });

    const promise = svc.login(VALID.email, password);
    await expect(promise).rejects.toThrow('Tenant account is suspended or deleted');
  });

  it('tenantSlug scopes the lookup — wrong slug behaves like unknown email', async () => {
    const { password } = await seedActiveUser(db, state); // tenant slug = 'acme'

    // Right user, but wrong tenant slug → no match → generic error.
    const promise = svc.login(VALID.email, password, 'globex');
    await expect(promise).rejects.toThrow('Invalid email or password');
  });

  it('tenantSlug scopes the lookup — correct slug succeeds', async () => {
    const { password } = await seedActiveUser(db, state); // tenant slug = 'acme'

    const result = await svc.login(VALID.email, password, 'acme');
    expect(result.token).toBe('fake.jwt.token');
  });
});

describe('AuthService.hashPassword + verifyPassword', () => {
  it('round-trip: hash(p) → verify(p, hash) is true; verify(wrong, hash) is false', async () => {
    const fake = makeFakeDb();
    const fastify = makeFakeFastify();
    const svc = new AuthService(fake.db, fastify);

    const password = 'sup3r-s3cret-string!';
    const hash = await svc.hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);

    expect(await svc.verifyPassword(password, hash)).toBe(true);
    expect(await svc.verifyPassword('wrong', hash)).toBe(false);
    expect(await svc.verifyPassword(password, '')).toBe(false);
  });

  it('produces different hashes for the same password (salted)', async () => {
    const fake = makeFakeDb();
    const fastify = makeFakeFastify();
    const svc = new AuthService(fake.db, fastify);

    const a = await svc.hashPassword('same');
    const b = await svc.hashPassword('same');
    expect(a).not.toBe(b);
    expect(await svc.verifyPassword('same', a)).toBe(true);
    expect(await svc.verifyPassword('same', b)).toBe(true);
  });
});

describe('AuthService.signToken', () => {
  it('passes a payload containing role + tenantId + userId to fastify.jwt.sign', () => {
    const fake = makeFakeDb();
    const fastify = makeFakeFastify();
    const svc = new AuthService(fake.db, fastify);

    const session = {
      sub: 'usr-1',
      userId: 'usr-1',
      tenantId: 'tnt-1',
      email: 'a@b.com',
      name: 'A B',
      role: 'TENANT_ADMIN' as const,
      jobFunction: null,
    };

    const token = svc.signToken(session);
    expect(token).toBe('fake.jwt.token');

    expect(fastify.jwt.sign).toHaveBeenCalledTimes(1);
    const [payloadArg, optsArg] = fastify.jwt.sign.mock.calls[0]!;
    expect(payloadArg).toMatchObject({
      role: 'TENANT_ADMIN',
      tenantId: 'tnt-1',
      userId: 'usr-1',
      sub: 'usr-1',
      email: 'a@b.com',
    });
    // expiresIn is forwarded from config.
    expect(optsArg).toHaveProperty('expiresIn');
  });
});

describe('AuthService.verifyToken', () => {
  it('delegates to fastify.jwt.verify and returns its result', () => {
    const fake = makeFakeDb();
    const fastify = makeFakeFastify();
    const svc = new AuthService(fake.db, fastify);

    const result = svc.verifyToken('some.signed.token');

    expect(fastify.jwt.verify).toHaveBeenCalledTimes(1);
    expect(fastify.jwt.verify).toHaveBeenCalledWith('some.signed.token');
    expect(result).toMatchObject({
      userId: 'usr-from-token',
      tenantId: 'tnt-from-token',
      role: 'TENANT_ADMIN',
    });
  });

  it('propagates verification errors from fastify.jwt.verify', () => {
    const fake = makeFakeDb();
    const fastify = makeFakeFastify();
    fastify.jwt.verify = vi.fn(() => {
      throw new Error('jwt expired');
    });
    const svc = new AuthService(fake.db, fastify);

    expect(() => svc.verifyToken('expired.token')).toThrow('jwt expired');
  });
});

describe('AuthService.getUserById', () => {
  it('returns an AuthSession for an existing user', async () => {
    const fake = makeFakeDb();
    const fastify = makeFakeFastify();
    const svc = new AuthService(fake.db, fastify);

    await seedActiveUser(fake.db, fake._state, { id: 'usr-known' });

    const session = await svc.getUserById('usr-known');
    expect(session).toMatchObject({
      sub: 'usr-known',
      userId: 'usr-known',
      tenantId: 'tnt-seed',
      email: VALID.email.toLowerCase(),
      role: 'TENANT_ADMIN',
    });
  });

  it('throws NotFoundError for an unknown user id', async () => {
    const fake = makeFakeDb();
    const fastify = makeFakeFastify();
    const svc = new AuthService(fake.db, fastify);

    await expect(svc.getUserById('usr-missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Supabase identity helpers — deferred.
// ---------------------------------------------------------------------------

describe('AuthService Supabase identity helpers', () => {
  it('does not trust user_metadata role or tenantId when provisioning a Supabase user', async () => {
    const fake = makeFakeDb();
    const fastify = makeFakeFastify();
    const svc = new AuthService(fake.db, fastify);

    fake._state.tenants.push({
      id: 'tnt-victim',
      slug: 'victim-co',
      name: 'Victim Co',
      status: 'ACTIVE',
    });

    const session = await (svc as any).resolveSupabaseIdentity({
      id: 'supabase-attacker',
      email: 'attacker@example.com',
      user_metadata: {
        name: 'Attacker',
        role: 'SYSTEM_ADMIN',
        tenantId: 'tnt-victim',
        tenantName: 'Attacker Workspace',
      },
      app_metadata: {},
    });

    expect(session.role).toBe('TENANT_ADMIN');
    expect(session.tenantId).not.toBe('tnt-victim');
    expect(fake._state.users[0]!.role).toBe('TENANT_ADMIN');
    expect(fake._state.users[0]!.tenantId).not.toBe('tnt-victim');
    expect(fake._state.tenants).toHaveLength(2);
  });

  it('uses trusted app_metadata tenantId and role for invited Supabase users', async () => {
    const fake = makeFakeDb();
    const fastify = makeFakeFastify();
    const svc = new AuthService(fake.db, fastify);

    fake._state.tenants.push({
      id: 'tnt-invite',
      slug: 'invited-co',
      name: 'Invited Co',
      status: 'ACTIVE',
    });

    const session = await (svc as any).resolveSupabaseIdentity({
      id: 'supabase-invitee',
      email: 'reviewer@example.com',
      user_metadata: {
        name: 'Reviewer Person',
        role: 'SYSTEM_ADMIN',
        tenantId: 'tnt-attacker-controlled',
      },
      app_metadata: {
        tenantId: 'tnt-invite',
        role: 'REVIEWER',
      },
    });

    expect(session.tenantId).toBe('tnt-invite');
    expect(session.role).toBe('REVIEWER');
    expect(fake._state.users[0]).toMatchObject({
      tenantId: 'tnt-invite',
      role: 'REVIEWER',
      email: 'reviewer@example.com',
    });
  });

  it('rejects invalid trusted app_metadata tenant assignments instead of creating a silent new tenant', async () => {
    const fake = makeFakeDb();
    const fastify = makeFakeFastify();
    const svc = new AuthService(fake.db, fastify);

    await expect((svc as any).resolveSupabaseIdentity({
      id: 'supabase-stale-invite',
      email: 'stale@example.com',
      user_metadata: { tenantName: 'Should Not Be Created' },
      app_metadata: { tenantId: 'tnt-missing', role: 'REVIEWER' },
    })).rejects.toBeInstanceOf(UnauthorizedError);

    expect(fake._state.tenants).toHaveLength(0);
    expect(fake._state.users).toHaveLength(0);
  });

  it('never provisions SYSTEM_ADMIN from Supabase app_metadata', async () => {
    const fake = makeFakeDb();
    const fastify = makeFakeFastify();
    const svc = new AuthService(fake.db, fastify);

    fake._state.tenants.push({
      id: 'tnt-invite',
      slug: 'invited-co',
      name: 'Invited Co',
      status: 'ACTIVE',
    });

    const session = await (svc as any).resolveSupabaseIdentity({
      id: 'supabase-system-admin-request',
      email: 'system-admin-request@example.com',
      user_metadata: { name: 'Nope' },
      app_metadata: {
        tenantId: 'tnt-invite',
        role: 'SYSTEM_ADMIN',
      },
    });

    expect(session.role).toBe('VIEWER');
    expect(fake._state.users[0]!.role).toBe('VIEWER');
  });

  it.todo(
    'authenticateSupabaseToken: returns a session for a valid Supabase access token — needs global fetch mock + config.supabaseUrl/AnonKey injection',
  );
  it.todo(
    'authenticateSupabaseToken: throws UnauthorizedError when Supabase responds non-2xx — same fetch-mock requirement',
  );
  it.todo(
    'authenticateSupabaseToken: throws "Supabase authentication is not configured" when env is missing — needs to override config module',
  );
  it.todo(
    'resolveSupabaseIdentity: matches an existing user by email and updates name/jobFunction/avatarUrl when changed (private method — exercise via authenticateSupabaseToken)',
  );
  it.todo(
    'resolveSupabaseIdentity: rejects inactive user with "Account is not active"',
  );
  it.todo(
    'resolveSupabaseIdentity: rejects suspended tenant with "Tenant account is suspended or deleted"',
  );
  it.todo(
    'provisionUserFromSupabase: creates a new tenant + user when no requestedTenantId resolves — needs CreditService.createFreeSubscription mocked (constructor side-effect on free-tier creation)',
  );
  it.todo('authenticateSupabaseToken: exercises trusted app_metadata via fetch instead of private helper access');
  it.todo(
    'generateTenantSlug: appends -2, -3 ... when the base slug is taken (private — exercise via provisionUserFromSupabase)',
  );
  it.todo('mapSupabaseRole: full role matrix through trusted app_metadata');
});
