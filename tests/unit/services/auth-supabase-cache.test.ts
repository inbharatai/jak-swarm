/**
 * A.1 — authenticateSupabaseToken in-process LRU cache.
 *
 * The cache is the perf fix: without it, every authenticated API call
 * whose stored token is a Supabase access token round-trips to Supabase
 * (/auth/v1/user) + db.user.findFirst. With it, the per-token round-trip
 * happens at most once per 60s. These tests pin the four honest
 * guarantees the rest of the system relies on:
 *
 *   1. cache HIT  — a second call with the same token does NOT call fetch.
 *   2. cache MISS — a different token calls fetch again.
 *   3. a throw is NEVER cached — a non-2xx Supabase response is re-fetched
 *      on the next call (a revoked session must not be pinned valid for 60s).
 *   4. TTL expiry — after the 60s window the entry is evicted and fetch
 *      is called again.
 *
 * config + global fetch are mocked; the db is an in-memory stub mirroring
 * the auth.service.test.ts pattern. The real AuthService + the real
 * module-level cache run unmodified.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../apps/api/src/config.js', () => ({
  config: {
    supabaseUrl: 'https://fake-supabase.test',
    supabaseAnonKey: 'fake-anon-key',
    jwtExpiresIn: '7d',
    jwtSecret: 'test-secret',
  },
}));

import { AuthService, _resetSupabaseIdentityCacheForTests } from '../../../apps/api/src/services/auth.service.js';

// ─── Minimal in-memory db stub ───────────────────────────────────────────────

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

  const db = {
    user: {
      findFirst: vi.fn(async ({ where }: { where: { email?: string } }) => {
        const u = users.find((x) => where.email && x.email === where.email);
        if (!u) return null;
        const tenant = tenants.find((t) => t.id === u.tenantId) ?? null;
        return { ...u, tenant: tenant ? { id: tenant.id, status: tenant.status } : null };
      }),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        const u = users.find((x) => x.id === where.id);
        if (!u) throw new Error(`user ${where.id} not found`);
        Object.assign(u, data);
        return u;
      }),
    },
    tenant: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => null),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { db, state: { tenants, users } };
}

function makeFakeFastify() {
  return {
    jwt: {
      sign: vi.fn((_p: unknown) => 'fake.jwt.token'),
      verify: vi.fn((_t: string) => ({})),
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as Parameters<typeof AuthService['constructor'] extends new (
    db: infer D,
    fastify: infer F,
  ) => unknown ? [D, F] : never>[1];
}

const SUPABASE_IDENTITY = {
  id: 'supabase-user-1',
  email: 'founder@acme.com',
  user_metadata: { name: 'Ada Founder' },
  app_metadata: {},
};

function seedActiveUser(state: { tenants: FakeTenant[]; users: FakeUser[] }) {
  state.tenants.push({
    id: 'tnt-seed',
    slug: 'acme',
    name: 'Acme Inc',
    status: 'ACTIVE',
  });
  state.users.push({
    id: 'usr-seed',
    tenantId: 'tnt-seed',
    email: 'founder@acme.com',
    name: 'Ada Founder',
    role: 'TENANT_ADMIN',
    passwordHash: null,
    jobFunction: null,
    active: true,
    avatarUrl: null,
  });
}

// ─── fetch mock ──────────────────────────────────────────────────────────────

function makeFetchMock(opts: { ok: boolean; identity?: typeof SUPABASE_IDENTITY }) {
  return vi.fn(async () => {
    if (!opts.ok) {
      return { ok: false, status: 401, json: async () => ({}) } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => opts.identity ?? SUPABASE_IDENTITY,
    } as unknown as Response;
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuthService.authenticateSupabaseToken — A.1 in-process cache', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // The cache is module-level and would otherwise leak between tests,
    // turning a "miss" assertion into a stale hit from a prior test.
    _resetSupabaseIdentityCacheForTests();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cache HIT: a second call with the same token does NOT call fetch', async () => {
    const { db, state } = makeFakeDb();
    seedActiveUser(state);
    const fetchMock = makeFetchMock({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const svc = new AuthService(db as unknown as ConstructorParameters<typeof AuthService>[0], makeFakeFastify());

    const a = await svc.authenticateSupabaseToken('supabase-token-A');
    const b = await svc.authenticateSupabaseToken('supabase-token-A');

    expect(a.userId).toBe('usr-seed');
    expect(b.userId).toBe('usr-seed');
    // The whole point: one Supabase round-trip for N calls with the same token.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cache MISS: a different token calls fetch again', async () => {
    const { db, state } = makeFakeDb();
    seedActiveUser(state);
    const fetchMock = makeFetchMock({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const svc = new AuthService(db as unknown as ConstructorParameters<typeof AuthService>[0], makeFakeFastify());

    await svc.authenticateSupabaseToken('supabase-token-A');
    await svc.authenticateSupabaseToken('supabase-token-B');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a throw is NEVER cached: a non-2xx response is re-fetched on the next call', async () => {
    const { db, state } = makeFakeDb();
    seedActiveUser(state);
    const fetchMock = makeFetchMock({ ok: false });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const svc = new AuthService(db as unknown as ConstructorParameters<typeof AuthService>[0], makeFakeFastify());

    await expect(svc.authenticateSupabaseToken('revoked-token')).rejects.toThrow(/Invalid or expired Supabase session/);
    await expect(svc.authenticateSupabaseToken('revoked-token')).rejects.toThrow(/Invalid or expired Supabase session/);

    // A revoked session must not be pinned as valid for 60s — both calls hit Supabase.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('TTL expiry: after the 60s window the entry is evicted and fetch is called again', async () => {
    const { db, state } = makeFakeDb();
    seedActiveUser(state);
    const fetchMock = makeFetchMock({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    vi.useFakeTimers();

    const svc = new AuthService(db as unknown as ConstructorParameters<typeof AuthService>[0], makeFakeFastify());

    await svc.authenticateSupabaseToken('supabase-token-TTL');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Within the TTL — cache hit, no new fetch.
    vi.advanceTimersByTime(45_000);
    await svc.authenticateSupabaseToken('supabase-token-TTL');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past the 60s TTL — cache entry expired, fetch fires again.
    vi.advanceTimersByTime(20_000); // total 65s
    await svc.authenticateSupabaseToken('supabase-token-TTL');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});