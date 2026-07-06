/**
 * A.1 — JAK JWT exchange: /auth/me mints a JAK JWT when the inbound token
 * is a Supabase access token, and is idempotent when the inbound token is
 * already a JAK JWT. Plus POST /auth/exchange mints a JAK JWT for a
 * Supabase token (non-web clients).
 *
 * This is the integration contract that kills the per-request Supabase
 * round-trip: once the web stores the minted JAK JWT, every subsequent
 * call authenticates via jwtVerify() on the first try (no Supabase
 * fallback, no fetch, no db.user.findFirst).
 *
 * Runs the REAL @fastify/jwt (real sign/verify with a test secret), the
 * REAL auth.plugin.ts (so request.authViaSupabase is set on the fallback
 * path), and the REAL auth.routes.ts. Only config + global fetch + the
 * db decorator are stubbed — the minting logic under test is exercised
 * unmodified.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from '../../../apps/api/node_modules/fastify/fastify.js';
import jwtPlugin from '../../../apps/api/node_modules/@fastify/jwt/jwt.js';
import rateLimit from '../../../apps/api/node_modules/@fastify/rate-limit/index.js';
import fp from '../../../apps/api/node_modules/fastify-plugin/plugin.js';

vi.mock('../../../apps/api/src/config.js', () => ({
  config: {
    supabaseUrl: 'https://fake-supabase.test',
    supabaseAnonKey: 'fake-anon-key',
    jwtExpiresIn: '7d',
    jwtSecret: 'test-secret',
  },
}));

// Imported AFTER vi.mock so the plugin/service/routes see the mocked config.
const authPluginModule = await import('../../../apps/api/src/plugins/auth.plugin.js');
const authRoutesModule = await import('../../../apps/api/src/routes/auth.routes.js');
const authPlugin = authPluginModule.default;
const authRoutes = authRoutesModule.default;

// ─── In-memory db stub ───────────────────────────────────────────────────────

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
      findUnique: vi.fn(async ({ where }: { where: { id?: string } }) => {
        return users.find((x) => where.id && x.id === where.id) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        const u = users.find((x) => x.id === where.id);
        if (!u) throw new Error(`user ${where.id} not found`);
        Object.assign(u, data);
        return u;
      }),
    },
    tenant: { findUnique: vi.fn(async () => null), create: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { db, state: { tenants, users } };
}

const SUPABASE_IDENTITY = {
  id: 'supabase-user-1',
  email: 'founder@acme.com',
  user_metadata: { name: 'Ada Founder' },
  app_metadata: {},
};

function seedActiveUser(state: { tenants: FakeTenant[]; users: FakeUser[] }) {
  state.tenants.push({ id: 'tnt-seed', slug: 'acme', name: 'Acme Inc', status: 'ACTIVE' });
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

function makeFetchMock() {
  return vi.fn(async (url: string, _init?: unknown) => {
    if (typeof url === 'string' && url.endsWith('/auth/v1/user')) {
      // A "bad" Supabase token is encoded as 'supabase-bad-*' → 401.
      // Real tokens resolve to the seeded identity.
      const authHeader = (_init as { headers?: { Authorization?: string } } | undefined)?.headers?.Authorization ?? '';
      const token = authHeader.replace(/^Bearer\s+/, '');
      if (token.startsWith('supabase-bad-')) {
        return { ok: false, status: 401, json: async () => ({}) } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => SUPABASE_IDENTITY,
      } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  });
}

// ─── App builder ─────────────────────────────────────────────────────────────

async function buildApp(stub: ReturnType<typeof makeFakeDb>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Real @fastify/jwt — sign/verify with the same test secret the mocked
  // config.jwtSecret exposes. This is what makes the JAK JWT short-circuit
  // test honest: the minted token really verifies.
  await app.register(jwtPlugin, { secret: 'test-secret' });

  // db-plugin stub — satisfies auth.plugin's `dependencies: ['db-plugin']`
  // and provides fastify.db.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fp(async (f: any) => { f.decorate('db', stub.db as any); }, { name: 'db-plugin' }) as any);

  // Real auth plugin (sets request.authViaSupabase on the Supabase fallback).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(authPlugin as any);

  await app.register(rateLimit, { global: false, max: 1000, timeWindow: '1 minute' });

  // Real auth routes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(authRoutes as any, { prefix: '/auth' });

  await app.ready();
  return app;
}

async function inject(
  app: FastifyInstance,
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await app.inject({
    method,
    url,
    payload: body !== undefined ? JSON.stringify(body) : undefined,
    headers: body !== undefined
      ? { 'content-type': 'application/json', ...headers }
      : headers,
  });
  return {
    status: res.statusCode,
    body: res.payload ? (JSON.parse(res.payload) as unknown) : null,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('A.1 JAK JWT exchange — /auth/me + /auth/exchange', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof makeFetchMock>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = makeFetchMock();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('GET /auth/me mints a JAK JWT when the inbound token is a Supabase access token', async () => {
    const { db, state } = makeFakeDb();
    seedActiveUser(state);
    const app = await buildApp({ db, state });

    const res = await inject(app, 'GET', '/auth/me', undefined, {
      Authorization: 'Bearer supabase-token-real',
    });

    expect(res.status).toBe(200);
    const body = res.body as { success: boolean; data: unknown; jakToken?: string };
    expect(body.success).toBe(true);
    expect(typeof body.jakToken).toBe('string');
    expect(body.jakToken!.length).toBeGreaterThan(0);

    // The minted token is a real JAK JWT — it verifies with the same secret.
    const decoded = app.jwt.verify(body.jakToken!) as { userId: string; tenantId: string; role: string };
    expect(decoded.userId).toBe('usr-seed');
    expect(decoded.tenantId).toBe('tnt-seed');
    expect(decoded.role).toBe('TENANT_ADMIN');

    // The Supabase fallback ran once to resolve the identity.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('GET /auth/me does NOT re-mint when the inbound token is already a JAK JWT (idempotent short-circuit)', async () => {
    const { db, state } = makeFakeDb();
    seedActiveUser(state);
    const app = await buildApp({ db, state });

    // First call with a Supabase token → mints a JAK JWT.
    const res1 = await inject(app, 'GET', '/auth/me', undefined, {
      Authorization: 'Bearer supabase-token-real',
    });
    const jakToken = (res1.body as { jakToken: string }).jakToken;
    expect(jakToken).toBeTruthy();
    const fetchCallsAfterFirst = fetchMock.mock.calls.length;

    // Second call with the minted JAK JWT → jwtVerify succeeds on the first
    // try, NO Supabase fallback, NO re-mint. jakToken is absent.
    const res2 = await inject(app, 'GET', '/auth/me', undefined, {
      Authorization: `Bearer ${jakToken}`,
    });

    expect(res2.status).toBe(200);
    const body2 = res2.body as { success: boolean; data: unknown; jakToken?: string };
    expect(body2.success).toBe(true);
    expect(body2.jakToken).toBeUndefined();
    // No additional Supabase fetch — the whole perf win.
    expect(fetchMock.mock.calls.length).toBe(fetchCallsAfterFirst);

    await app.close();
  });

  it('POST /auth/exchange mints a JAK JWT for a valid Supabase token', async () => {
    const { db, state } = makeFakeDb();
    seedActiveUser(state);
    const app = await buildApp({ db, state });

    const res = await inject(app, 'POST', '/auth/exchange', { supabaseToken: 'supabase-token-real' });

    expect(res.status).toBe(200);
    const body = res.body as { success: boolean; data: unknown; jakToken?: string };
    expect(body.success).toBe(true);
    expect(typeof body.jakToken).toBe('string');
    const decoded = app.jwt.verify(body.jakToken!) as { userId: string };
    expect(decoded.userId).toBe('usr-seed');

    await app.close();
  });

  it('POST /auth/exchange rejects an invalid Supabase token with 401', async () => {
    const { db, state } = makeFakeDb();
    seedActiveUser(state);
    const app = await buildApp({ db, state });

    const res = await inject(app, 'POST', '/auth/exchange', { supabaseToken: 'supabase-bad-token' });

    expect(res.status).toBe(401);
    const body = res.body as { success: boolean; error?: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('UNAUTHORIZED');

    await app.close();
  });
});