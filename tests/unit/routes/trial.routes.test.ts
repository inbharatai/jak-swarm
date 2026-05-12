/**
 * trial.routes.test.ts — integration-style coverage of the public trial flow.
 *
 * Exercises POST /trial/signup, POST /trial/verify/:token, GET /trial/status
 * end-to-end through Fastify (with @fastify/rate-limit registered). The DB,
 * email backend, and AuthService are stubbed; the routes themselves run
 * unmodified.
 *
 * The behaviours pinned here are the security/anti-enum properties of the
 * 30-day-trial flow:
 *   - Signup never leaks whether an email exists (anti-enum)
 *   - Per-email + per-IP rate limits compose without leaking signal
 *   - Verify path sets no-store headers + ≥80ms timing floor on EVERY exit
 *   - Status endpoint is auth-gated and returns counters for the calling tenant
 *
 * NOTE on dev-only fields: the route returns devToken/emailBackend/emailDelivered
 * ONLY when NODE_ENV !== 'production'. We assert on those fields under
 * NODE_ENV='test' (vitest default), and explicitly verify they are NEVER
 * returned under NODE_ENV='production'. This is an audit-relevant guarantee:
 * the cleartext token must not leak in prod responses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Fastify + @fastify/rate-limit live in apps/api's node_modules (the tests
// workspace doesn't depend on them directly). Import via the apps/api
// package's resolution context so Node finds them without a tests-side
// dependency. Mirrors the pattern in tests/unit/routes/documents.routes.test.ts.
import Fastify, { type FastifyInstance } from '../../../apps/api/node_modules/fastify/fastify.js';
import rateLimit from '../../../apps/api/node_modules/@fastify/rate-limit/index.js';
import { createHash, randomBytes } from 'node:crypto';

// Mock AuthService so trial-promotion.service can construct one without
// pulling bcrypt/CreditService/config into the test runtime. We stub the
// two methods the promotion path actually calls.
vi.mock('../../../apps/api/src/services/auth.service.js', () => ({
  AuthService: class {
    constructor(_db: unknown, private readonly fastify: { jwt: { sign: (p: unknown) => string } }) {}
    async hashPassword(pw: string): Promise<string> {
      return `bcrypt:${pw}`;
    }
    signToken(payload: unknown): string {
      return this.fastify.jwt.sign(payload);
    }
  },
}));

// Stub the trial-email service so we never hit the filesystem. We export a
// recording shim so tests can introspect what would have been sent.
const sentEmails: Array<{ to: string; cleartextToken: string; companyName: string | null }> = [];
const emailSendImpl = vi.fn(async (ctx: { to: string; cleartextToken: string; companyName: string | null }) => {
  sentEmails.push(ctx);
  return { delivered: true, backend: 'file' as const, detail: '/tmp/stub' };
});
vi.mock('../../../apps/api/src/services/trial/trial-email.service.js', () => ({
  TrialEmailService: class {
    async sendVerifyEmail(ctx: { to: string; cleartextToken: string; companyName: string | null }) {
      return emailSendImpl(ctx);
    }
  },
}));

// Imported AFTER vi.mock so the route plugin sees the mocked services.
const trialRoutesModule = await import('../../../apps/api/src/routes/trial.routes.js');
const trialRoutes = trialRoutesModule.default;
const { _resetEmailRateLimiterForTests } = trialRoutesModule;

// ---------------------------------------------------------------------------
// In-memory Prisma stub
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface TrialSignupRow {
  id: string;
  email: string;
  fingerprint: string;
  source: string;
  companyName: string | null;
  industry: string | null;
  teamSize: string | null;
  verifyTokenHash: string;
  verifyExpiresAt: Date;
  verifiedAt: Date | null;
  promotedAt: Date | null;
  status: string;
  tenantId: string | null;
  createdAt: Date;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  industry: string | null;
  plan: string;
}

interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: string;
  jobFunction: string | null;
}

interface SubscriptionRow {
  tenantId: string;
  planId: string;
  status: string;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  periodStart: Date;
  periodEnd: Date;
  dailyResetAt: Date;
  dailyAgentRunsUsed: number;
  dailyAgentRunsCap: number;
  dailyApprovalsUsed: number;
  dailyApprovalsCap: number;
  dailyToolMinutesUsed: number;
  dailyToolMinutesCap: number;
  dailyTokensUsed: number;
  dailyTokensCap: number;
  dailyUsed: number;
}

interface OnboardingStateRow {
  tenantId: string;
  completedSteps: string[];
  dismissed: boolean;
}

function makeStubDb() {
  const trialSignups: TrialSignupRow[] = [];
  const tenants: TenantRow[] = [];
  const users: UserRow[] = [];
  const subscriptions: SubscriptionRow[] = [];
  const onboardingStates: OnboardingStateRow[] = [];

  const matchSignupWhere = (row: TrialSignupRow, where: Record<string, unknown>): boolean => {
    if (where['id'] && row.id !== where['id']) return false;
    if (where['verifyTokenHash'] && row.verifyTokenHash !== where['verifyTokenHash']) return false;
    if (where['email'] && row.email !== where['email']) return false;
    if (where['fingerprint'] && row.fingerprint !== where['fingerprint']) return false;
    if (where['createdAt']) {
      const c = where['createdAt'] as { gte?: Date };
      if (c.gte && row.createdAt.getTime() < c.gte.getTime()) return false;
    }
    return true;
  };

  const findSignup = (where: Record<string, unknown>): TrialSignupRow | null => {
    if (where['OR']) {
      for (const branch of where['OR'] as Array<Record<string, unknown>>) {
        for (const r of trialSignups) {
          if (matchSignupWhere(r, branch)) return r;
        }
      }
      return null;
    }
    for (const r of trialSignups) {
      if (matchSignupWhere(r, where)) return r;
    }
    return null;
  };

  const db = {
    trialSignup: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        return findSignup(args.where);
      }),
      create: vi.fn(async (args: { data: Partial<TrialSignupRow> }) => {
        const row: TrialSignupRow = {
          id: `signup-${trialSignups.length + 1}`,
          email: args.data.email!,
          fingerprint: args.data.fingerprint!,
          source: args.data.source ?? 'landing',
          companyName: args.data.companyName ?? null,
          industry: args.data.industry ?? null,
          teamSize: args.data.teamSize ?? null,
          verifyTokenHash: args.data.verifyTokenHash!,
          verifyExpiresAt: args.data.verifyExpiresAt!,
          verifiedAt: null,
          promotedAt: null,
          status: args.data.status ?? 'PENDING_VERIFY',
          tenantId: null,
          createdAt: new Date(),
        };
        trialSignups.push(row);
        return row;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Partial<TrialSignupRow> }) => {
        const row = trialSignups.find((r) => r.id === args.where.id);
        if (!row) throw new Error(`signup ${args.where.id} not found`);
        Object.assign(row, args.data);
        return row;
      }),
    },
    tenant: {
      findUnique: vi.fn(async (args: { where: { slug?: string; id?: string } }) => {
        return (
          tenants.find(
            (t) => (args.where.slug && t.slug === args.where.slug) || (args.where.id && t.id === args.where.id),
          ) ?? null
        );
      }),
      create: vi.fn(async (args: { data: Partial<TenantRow> }) => {
        const row: TenantRow = {
          id: `tenant-${tenants.length + 1}`,
          name: args.data.name!,
          slug: args.data.slug!,
          status: args.data.status ?? 'ACTIVE',
          industry: args.data.industry ?? null,
          plan: args.data.plan ?? 'FREE',
        };
        tenants.push(row);
        return row;
      }),
    },
    user: {
      findFirst: vi.fn(async (args: { where: { tenantId?: string; email?: string }; include?: unknown }) => {
        const found = users.find(
          (u) =>
            (!args.where.tenantId || u.tenantId === args.where.tenantId) &&
            (!args.where.email || u.email === args.where.email),
        );
        if (!found) return null;
        // Mimic Prisma's `include: { tenant: { select: ... } }` shape.
        if (args.include) {
          const tenant = tenants.find((t) => t.id === found.tenantId);
          return { ...found, tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name } : null };
        }
        return found;
      }),
      create: vi.fn(async (args: { data: Partial<UserRow> }) => {
        const row: UserRow = {
          id: `user-${users.length + 1}`,
          tenantId: args.data.tenantId!,
          email: args.data.email!,
          name: args.data.name ?? '',
          passwordHash: args.data.passwordHash ?? '',
          role: args.data.role ?? 'TENANT_ADMIN',
          jobFunction: args.data.jobFunction ?? null,
        };
        users.push(row);
        return row;
      }),
    },
    subscription: {
      findUnique: vi.fn(async (args: { where: { tenantId: string } }) => {
        return subscriptions.find((s) => s.tenantId === args.where.tenantId) ?? null;
      }),
      create: vi.fn(async (args: { data: Partial<SubscriptionRow> }) => {
        const row: SubscriptionRow = {
          tenantId: args.data.tenantId!,
          planId: args.data.planId ?? 'trial_30d',
          status: args.data.status ?? 'trialing',
          trialStartedAt: args.data.trialStartedAt ?? new Date(),
          trialEndsAt: args.data.trialEndsAt ?? null,
          periodStart: args.data.periodStart ?? new Date(),
          periodEnd: args.data.periodEnd ?? new Date(),
          dailyResetAt: args.data.dailyResetAt ?? new Date(),
          dailyAgentRunsUsed: 0,
          dailyAgentRunsCap: 20,
          dailyApprovalsUsed: 0,
          dailyApprovalsCap: 5,
          dailyToolMinutesUsed: 0,
          dailyToolMinutesCap: 120,
          dailyTokensUsed: 0,
          dailyTokensCap: 200_000,
          dailyUsed: 0,
        };
        subscriptions.push(row);
        return row;
      }),
      update: vi.fn(async (args: { where: { tenantId: string }; data: Record<string, unknown> }) => {
        const row = subscriptions.find((s) => s.tenantId === args.where.tenantId);
        if (!row) throw new Error('subscription not found');
        for (const [k, v] of Object.entries(args.data)) {
          if (v && typeof v === 'object' && 'increment' in v) {
            (row as unknown as Record<string, number>)[k] =
              ((row as unknown as Record<string, number>)[k] ?? 0) + Number((v as { increment: number }).increment);
          } else {
            (row as unknown as Record<string, unknown>)[k] = v;
          }
        }
        return row;
      }),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const row of subscriptions) {
          if (args.where['tenantId'] && row.tenantId !== args.where['tenantId']) continue;
          if (args.where['dailyResetAt']) {
            const c = args.where['dailyResetAt'] as { lt?: Date };
            if (c.lt && row.dailyResetAt.getTime() >= c.lt.getTime()) continue;
          }
          Object.assign(row, args.data);
          count += 1;
        }
        return { count };
      }),
    },
    onboardingState: {
      create: vi.fn(async (args: { data: Partial<OnboardingStateRow> }) => {
        const row: OnboardingStateRow = {
          tenantId: args.data.tenantId!,
          completedSteps: args.data.completedSteps ?? [],
          dismissed: args.data.dismissed ?? false,
        };
        onboardingStates.push(row);
        return row;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Tests don't need true transactional semantics — pass through.
      return fn(db);
    }),
  };

  return { db, state: { trialSignups, tenants, users, subscriptions, onboardingStates } };
}

// ---------------------------------------------------------------------------
// Fastify app builder
// ---------------------------------------------------------------------------

interface BuildOpts {
  authToken?: { tenantId: string } | null;
  /** Override request.ip in the inject — Fastify reads it from the socket. */
}

async function buildApp(stub: ReturnType<typeof makeStubDb>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: false });

  // jwt stub — sign returns a deterministic synthetic token; verify echoes it
  // back as a session payload that the trial routes don't consume directly.
  // The /status preHandler reads request.user, which we drive via the
  // authenticate decorator below.
  app.decorate('jwt', {
    sign: (payload: unknown) => `jwt:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`,
    verify: <T>(token: string): T => {
      if (!token.startsWith('jwt:')) throw new Error('bad token');
      return JSON.parse(Buffer.from(token.slice(4), 'base64url').toString('utf8')) as T;
    },
  });

  // db stub — the routes read fastify.db.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate('db', stub.db as any);

  // authenticate decorator — read Bearer token, decode via the stub jwt.verify,
  // attach to request.user. No token → 401.
  app.decorate('authenticate', async (request: { headers: Record<string, unknown>; user?: unknown }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
    const auth = request.headers['authorization'] as string | undefined;
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = (app as any).jwt.verify(auth.slice(7));
      request.user = session;
    } catch {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
    }
  });

  await app.register(rateLimit, {
    global: false,
    max: 1000,
    timeWindow: '1 minute',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(trialRoutes as any, { prefix: '/trial' });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function inject(
  app: FastifyInstance,
  method: 'POST' | 'GET',
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const effectiveHeaders: Record<string, string> = body !== undefined
    ? { 'content-type': 'application/json', 'user-agent': 'vitest-trial', ...headers }
    : { 'user-agent': 'vitest-trial', ...headers };
  const res = await app.inject({
    method,
    url,
    payload: body !== undefined ? JSON.stringify(body) : undefined,
    headers: effectiveHeaders,
  });
  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.payload ? (JSON.parse(res.payload) as unknown) : null,
  };
}

function bodyData<T>(body: unknown): T {
  return (body as { success: true; data: T }).data;
}

function bodyError(body: unknown): { code: string; message: string } {
  return (body as { success: false; error: { code: string; message: string } }).error;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /trial/signup', () => {
  let app: FastifyInstance;
  let stub: ReturnType<typeof makeStubDb>;

  beforeEach(async () => {
    _resetEmailRateLimiterForTests();
    sentEmails.length = 0;
    emailSendImpl.mockClear();
    process.env['NODE_ENV'] = 'test';
    stub = makeStubDb();
    app = await buildApp(stub);
  });

  afterEach(async () => {
    await app.close();
  });

  it('happy path: returns 200 + generic message + dev fields', async () => {
    const res = await inject(app, 'POST', '/trial/signup', {
      email: 'alice@example.com',
      companyName: 'Acme',
    });
    expect(res.status).toBe(200);
    const data = bodyData<{ message: string; devToken?: string; emailBackend?: string; emailDelivered?: boolean }>(res.body);
    expect(data.message).toMatch(/verify email sent/i);
    expect(data.devToken).toBeTruthy();
    expect(data.devToken!.length).toBeGreaterThanOrEqual(32);
    expect(data.emailBackend).toBe('file');
    expect(data.emailDelivered).toBe(true);
    expect(stub.state.trialSignups).toHaveLength(1);
    expect(emailSendImpl).toHaveBeenCalledOnce();
  });

  it('invalid email → 422', async () => {
    const res = await inject(app, 'POST', '/trial/signup', { email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(bodyError(res.body).code).toBe('VALIDATION_ERROR');
    expect(stub.state.trialSignups).toHaveLength(0);
  });

  it('second signup with same email → 200 generic, NO new row inserted', async () => {
    // First signup creates the row.
    const first = await inject(app, 'POST', '/trial/signup', { email: 'bob@example.com' });
    expect(first.status).toBe(200);
    expect(stub.state.trialSignups).toHaveLength(1);

    // Second signup with the same email — anti-enum: still 200 generic.
    const second = await inject(app, 'POST', '/trial/signup', { email: 'bob@example.com' });
    expect(second.status).toBe(200);
    const data = bodyData<{ message: string; devToken?: string }>(second.body);
    expect(data.message).toMatch(/eligible|verify/i);
    // No new signup row — anti-cycling held.
    expect(stub.state.trialSignups).toHaveLength(1);
  });

  it('same fingerprint within 90 days → silent (200 generic, no new row)', async () => {
    const headers = { 'user-agent': 'shared-ua/1.0' };
    const a = await inject(app, 'POST', '/trial/signup', { email: 'a@example.com' }, headers);
    expect(a.status).toBe(200);
    expect(stub.state.trialSignups).toHaveLength(1);

    const b = await inject(app, 'POST', '/trial/signup', { email: 'b@example.com' }, headers);
    expect(b.status).toBe(200);
    // fingerprint matched → anti-cycling fired → no new row.
    expect(stub.state.trialSignups).toHaveLength(1);
  });

  it('per-email rate limit (P0-5): 4th attempt within window returns 200 generic, no new email sent', async () => {
    // The per-email limiter is 3/hour. 4th attempt is rejected (returns 200
    // with the generic anti-enum body) but does NOT trigger an email send.
    const email = 'flooded@example.com';
    // 1st: real signup, email sent.
    await inject(app, 'POST', '/trial/signup', { email });
    // 2nd + 3rd: dup-email, anti-cycling silent, but limiter increments.
    await inject(app, 'POST', '/trial/signup', { email });
    await inject(app, 'POST', '/trial/signup', { email });
    expect(emailSendImpl).toHaveBeenCalledTimes(1); // only the first one creates a signup

    // 4th attempt — limiter rejects BEFORE the DB lookup.
    const fourth = await inject(app, 'POST', '/trial/signup', { email });
    expect(fourth.status).toBe(200);
    const data = bodyData<{ message: string; devToken?: string; emailDelivered?: boolean }>(fourth.body);
    // Generic anti-enum message — the dev fields are NOT present on this
    // path because the limiter early-returns before generating a token.
    expect(data.message).toMatch(/eligible/i);
    expect(data.devToken).toBeUndefined();
    expect(data.emailDelivered).toBeUndefined();
    expect(emailSendImpl).toHaveBeenCalledTimes(1);
    // Retry-After header should be set on the rejection.
    expect(fourth.headers['retry-after']).toBeTruthy();
  });

  it('per-IP rate limit: 6th attempt in 1 minute → 429', async () => {
    // The per-IP limit is max=5/minute on this route. 6 distinct emails so
    // the per-email limiter never trips first; X-Forwarded-For shares the
    // IP key for all 6.
    const xff = '198.51.100.42';
    for (let i = 0; i < 5; i++) {
      const r = await inject(
        app,
        'POST',
        '/trial/signup',
        { email: `ip-burst-${i}@example.com` },
        { 'x-forwarded-for': xff },
      );
      expect(r.status).toBe(200);
    }
    const sixth = await inject(
      app,
      'POST',
      '/trial/signup',
      { email: 'ip-burst-6@example.com' },
      { 'x-forwarded-for': xff },
    );
    expect(sixth.status).toBe(429);
  });

  it('production mode: dev-only fields (devToken, emailBackend, emailDelivered) are NOT in the response', async () => {
    process.env['NODE_ENV'] = 'production';
    const res = await inject(app, 'POST', '/trial/signup', { email: 'prod@example.com' });
    expect(res.status).toBe(200);
    const data = bodyData<{ message: string; devToken?: string; emailBackend?: string; emailDelivered?: boolean }>(res.body);
    expect(data.message).toMatch(/eligible/i);
    expect(data.devToken).toBeUndefined();
    expect(data.emailBackend).toBeUndefined();
    expect(data.emailDelivered).toBeUndefined();
    // The signup was still created + email send was still attempted.
    expect(stub.state.trialSignups).toHaveLength(1);
    expect(emailSendImpl).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Helpers for the verify tests — seed a signup row directly so we don't have
// to re-run the signup flow in every it() block.
// ---------------------------------------------------------------------------

function seedSignup(
  stub: ReturnType<typeof makeStubDb>,
  opts: { email?: string; expiresInMs?: number; status?: string; tenantId?: string | null } = {},
): { token: string; signupId: string } {
  const cleartext = randomBytes(32).toString('hex');
  const verifyExpiresAt = new Date(Date.now() + (opts.expiresInMs ?? 24 * 60 * 60 * 1000));
  const id = `signup-seed-${stub.state.trialSignups.length + 1}`;
  stub.state.trialSignups.push({
    id,
    email: (opts.email ?? 'verify@example.com').toLowerCase(),
    fingerprint: 'seed-fp',
    source: 'landing',
    companyName: 'SeedCo',
    industry: null,
    teamSize: null,
    verifyTokenHash: hashToken(cleartext),
    verifyExpiresAt,
    verifiedAt: null,
    promotedAt: null,
    status: opts.status ?? 'PENDING_VERIFY',
    tenantId: opts.tenantId ?? null,
    createdAt: new Date(),
  });
  return { token: cleartext, signupId: id };
}

describe('POST /trial/verify/:token', () => {
  let app: FastifyInstance;
  let stub: ReturnType<typeof makeStubDb>;

  beforeEach(async () => {
    _resetEmailRateLimiterForTests();
    process.env['NODE_ENV'] = 'test';
    stub = makeStubDb();
    app = await buildApp(stub);
  });

  afterEach(async () => {
    await app.close();
  });

  it('token < 16 chars → 400 INVALID_TOKEN', async () => {
    const res = await inject(app, 'POST', '/trial/verify/short');
    expect(res.status).toBe(400);
    expect(bodyError(res.body).code).toBe('INVALID_TOKEN');
  });

  it('random unknown token → 404 NOT_FOUND', async () => {
    const tok = randomBytes(32).toString('hex');
    const res = await inject(app, 'POST', `/trial/verify/${tok}`);
    expect(res.status).toBe(404);
    expect(bodyError(res.body).code).toBe('NOT_FOUND');
  });

  it('expired token → 410 EXPIRED + signup row marked EXPIRED', async () => {
    const { token, signupId } = seedSignup(stub, { expiresInMs: -1000 });
    const res = await inject(app, 'POST', `/trial/verify/${token}`);
    expect(res.status).toBe(410);
    expect(bodyError(res.body).code).toBe('EXPIRED');
    const row = stub.state.trialSignups.find((r) => r.id === signupId);
    expect(row?.status).toBe('EXPIRED');
  });

  it('happy path: 200 with token + initialPassword + tenant + user + reusedExistingTenant: false', async () => {
    const { token } = seedSignup(stub, { email: 'newgrad@example.com' });
    const res = await inject(app, 'POST', `/trial/verify/${token}`);
    expect(res.status).toBe(200);
    const data = bodyData<{
      token: string;
      initialPassword: string;
      tenant: { id: string; slug: string; name: string };
      user: { id: string; email: string; role: string };
      reusedExistingTenant: boolean;
    }>(res.body);
    expect(data.token).toMatch(/^jwt:/);
    expect(data.initialPassword).toBeTruthy();
    expect(data.initialPassword).not.toBe('<already-set>');
    expect(data.initialPassword.length).toBeGreaterThanOrEqual(20);
    expect(data.tenant.id).toBeTruthy();
    expect(data.tenant.slug).toBeTruthy();
    expect(data.user.email).toBe('newgrad@example.com');
    expect(data.user.role).toBe('TENANT_ADMIN');
    expect(data.reusedExistingTenant).toBe(false);
    // Side effects verified.
    expect(stub.state.tenants).toHaveLength(1);
    expect(stub.state.users).toHaveLength(1);
    expect(stub.state.subscriptions).toHaveLength(1);
    expect(stub.state.onboardingStates).toHaveLength(1);
  });

  it('second click: 200 with reusedExistingTenant: true and initialPassword "<already-set>"', async () => {
    const { token } = seedSignup(stub, { email: 'twice@example.com' });
    const first = await inject(app, 'POST', `/trial/verify/${token}`);
    expect(first.status).toBe(200);
    expect(bodyData<{ reusedExistingTenant: boolean }>(first.body).reusedExistingTenant).toBe(false);

    const second = await inject(app, 'POST', `/trial/verify/${token}`);
    expect(second.status).toBe(200);
    const data = bodyData<{ reusedExistingTenant: boolean; initialPassword: string; token: string }>(second.body);
    expect(data.reusedExistingTenant).toBe(true);
    expect(data.initialPassword).toBe('<already-set>');
    expect(data.token).toMatch(/^jwt:/);
    // No duplicate tenant created.
    expect(stub.state.tenants).toHaveLength(1);
    expect(stub.state.users).toHaveLength(1);
  });

  it('Cache-Control + Pragma + Expires no-store headers set on EVERY exit path', async () => {
    const expectNoStore = (headers: Record<string, unknown>) => {
      expect(headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
      expect(headers['pragma']).toBe('no-cache');
      expect(headers['expires']).toBe('0');
    };

    // 400 path — token too short.
    const r400 = await inject(app, 'POST', '/trial/verify/short');
    expect(r400.status).toBe(400);
    expectNoStore(r400.headers);

    // 404 path — random token.
    const r404 = await inject(app, 'POST', `/trial/verify/${randomBytes(32).toString('hex')}`);
    expect(r404.status).toBe(404);
    expectNoStore(r404.headers);

    // 410 path — expired.
    const expired = seedSignup(stub, { expiresInMs: -1000 });
    const r410 = await inject(app, 'POST', `/trial/verify/${expired.token}`);
    expect(r410.status).toBe(410);
    expectNoStore(r410.headers);

    // 200 path — valid promotion.
    const ok = seedSignup(stub, { email: 'cache@example.com' });
    const r200 = await inject(app, 'POST', `/trial/verify/${ok.token}`);
    expect(r200.status).toBe(200);
    expectNoStore(r200.headers);
  });

  it('response time floor (P0-2): every exit path takes ≥ 80ms', async () => {
    // The route's padToFloor uses VERIFY_FLOOR_MS = 80. Windows Date.now()
    // has ~16ms granularity, so we relax to 64ms (80 - 16) to avoid a
    // platform-specific flake while still detecting any regression that
    // strips the floor entirely (which would land in the 0–20ms range).
    const FLOOR_LOWER_BOUND_MS = 64;

    // 400 path
    const t1 = Date.now();
    await inject(app, 'POST', '/trial/verify/short');
    expect(Date.now() - t1).toBeGreaterThanOrEqual(FLOOR_LOWER_BOUND_MS);

    // 404 path
    const t2 = Date.now();
    await inject(app, 'POST', `/trial/verify/${randomBytes(32).toString('hex')}`);
    expect(Date.now() - t2).toBeGreaterThanOrEqual(FLOOR_LOWER_BOUND_MS);

    // 410 path
    const expired = seedSignup(stub, { expiresInMs: -1000 });
    const t3 = Date.now();
    await inject(app, 'POST', `/trial/verify/${expired.token}`);
    expect(Date.now() - t3).toBeGreaterThanOrEqual(FLOOR_LOWER_BOUND_MS);

    // 200 path
    const ok = seedSignup(stub, { email: 'timing@example.com' });
    const t4 = Date.now();
    await inject(app, 'POST', `/trial/verify/${ok.token}`);
    expect(Date.now() - t4).toBeGreaterThanOrEqual(FLOOR_LOWER_BOUND_MS);
  });
});

describe('GET /trial/status', () => {
  let app: FastifyInstance;
  let stub: ReturnType<typeof makeStubDb>;

  function tokenForTenant(tenantId: string): string {
    return `jwt:${Buffer.from(JSON.stringify({ sub: 'u1', userId: 'u1', tenantId, email: 'e@e.com', name: 'e', role: 'TENANT_ADMIN' })).toString('base64url')}`;
  }

  beforeEach(async () => {
    _resetEmailRateLimiterForTests();
    process.env['NODE_ENV'] = 'test';
    stub = makeStubDb();
    app = await buildApp(stub);
  });

  afterEach(async () => {
    await app.close();
  });

  it('no token → 401', async () => {
    const res = await inject(app, 'GET', '/trial/status');
    expect(res.status).toBe(401);
  });

  it('returns { allowed, counters, trial, resetsAt } for the calling tenant', async () => {
    // Seed a trialing subscription.
    const trialEnds = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    stub.state.subscriptions.push({
      tenantId: 'tenant-status-1',
      planId: 'trial_30d',
      status: 'trialing',
      trialStartedAt: new Date(),
      trialEndsAt: trialEnds,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      dailyResetAt: new Date(),
      dailyAgentRunsUsed: 3,
      dailyAgentRunsCap: 20,
      dailyApprovalsUsed: 0,
      dailyApprovalsCap: 5,
      dailyToolMinutesUsed: 0,
      dailyToolMinutesCap: 120,
      dailyTokensUsed: 0,
      dailyTokensCap: 200_000,
      dailyUsed: 0,
    });

    const res = await inject(app, 'GET', '/trial/status', undefined, {
      authorization: `Bearer ${tokenForTenant('tenant-status-1')}`,
    });
    expect(res.status).toBe(200);
    const data = bodyData<{
      allowed: boolean;
      counters: { agentRuns: { used: number; cap: number } };
      trial: { isTrialing: boolean; expired: boolean; daysRemaining: number | null };
      resetsAt: string;
    }>(res.body);
    expect(data.allowed).toBe(true);
    expect(data.counters.agentRuns).toEqual({ used: 3, cap: 20 });
    expect(data.trial.isTrialing).toBe(true);
    expect(data.trial.expired).toBe(false);
    expect(typeof data.trial.daysRemaining).toBe('number');
    expect(data.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('paid tenant: trial.isTrialing=false, allowed=true regardless of counter values', async () => {
    // Seed a paid subscription with counters above cap. Paid plans skip caps.
    stub.state.subscriptions.push({
      tenantId: 'tenant-paid-1',
      planId: 'team_50',
      status: 'active',
      trialStartedAt: null,
      trialEndsAt: null,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      dailyResetAt: new Date(),
      dailyAgentRunsUsed: 9999,
      dailyAgentRunsCap: 20,
      dailyApprovalsUsed: 9999,
      dailyApprovalsCap: 5,
      dailyToolMinutesUsed: 9999,
      dailyToolMinutesCap: 120,
      dailyTokensUsed: 9_999_999,
      dailyTokensCap: 200_000,
      dailyUsed: 0,
    });

    const res = await inject(app, 'GET', '/trial/status', undefined, {
      authorization: `Bearer ${tokenForTenant('tenant-paid-1')}`,
    });
    expect(res.status).toBe(200);
    const data = bodyData<{
      allowed: boolean;
      trial: { isTrialing: boolean; expired: boolean };
    }>(res.body);
    expect(data.allowed).toBe(true);
    expect(data.trial.isTrialing).toBe(false);
    expect(data.trial.expired).toBe(false);
  });
});
