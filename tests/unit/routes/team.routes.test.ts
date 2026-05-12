/**
 * Unit tests for `apps/api/src/routes/team.routes.ts` — the department
 * org-chart CRUD + searchable member directory.
 *
 * The hot spot under test is the **indirect-cycle detection** added by the
 * 2026-05-08 P0-8 audit fix on `PATCH /team/departments/:id`: a 64-deep
 * ancestor walk that refuses any reparenting which would close a cycle in
 * the dept tree, and also short-circuits if it stumbles into a pre-existing
 * cycle in the data so the loop can never run forever.
 *
 * Test harness pattern: real Fastify, real `teamRoutes` plugin, but
 * everything around it is faked:
 *   - `fastify.db` is a hand-rolled in-memory store mirroring the bits of
 *     Prisma the route uses (department.findMany / findFirst / create /
 *     update / delete + user.findMany / findFirst / update). The shape
 *     matches `tests/unit/services/trial-promotion.test.ts`.
 *   - `fastify.authenticate` is a test-only preHandler that reads
 *     `x-test-user` (a JSON-encoded AuthSession) and stamps it onto
 *     `request.user`. No JWT, no Supabase.
 *   - `fastify.requireRole` mirrors the production factory: throws
 *     ForbiddenError if the role isn't in the allow-list.
 *   - The global error handler is duplicated from `apps/api/src/index.ts`
 *     so AppError instances thrown inside route handlers become the right
 *     HTTP status + structured JSON body.
 */

// Tests workspace doesn't list fastify directly — import via apps/api's
// installed copy. Mirrors the pattern in inbox.routes.test.ts +
// trial.routes.test.ts so all route tests resolve fastify the same way.
import FastifyImport from '../../../apps/api/node_modules/fastify/fastify.js';
const Fastify = (FastifyImport as unknown as { default?: typeof FastifyImport }).default ?? FastifyImport;
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { describe, expect, it, beforeEach } from 'vitest';
import teamRoutes from '../../../apps/api/src/routes/team.routes.js';
import { AppError, ForbiddenError, UnauthorizedError } from '../../../apps/api/src/errors.js';
import type { AuthSession, UserRole } from '../../../apps/api/src/types.js';

// ───────────────────────────────────────────────────────────────────────────
// In-memory DB stub
// ───────────────────────────────────────────────────────────────────────────

interface FakeDept {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  jobTitle: string | null;
  role: UserRole;
  active: boolean;
  departmentId: string | null;
  managerId: string | null;
  avatarUrl: string | null;
}

interface FakeState {
  departments: FakeDept[];
  users: FakeUser[];
}

function whereMatchesScalar(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, val] of Object.entries(where)) {
    if (key === 'OR' || key === 'AND') continue;
    if (val !== undefined && row[key] !== val) return false;
  }
  return true;
}

function applyContains(haystack: string | null | undefined, clause: { contains: string; mode?: string }): boolean {
  if (haystack == null) return false;
  if (clause.mode === 'insensitive') {
    return haystack.toLowerCase().includes(clause.contains.toLowerCase());
  }
  return haystack.includes(clause.contains);
}

function userMatchesOR(user: FakeUser, ors: Array<Record<string, unknown>>): boolean {
  return ors.some((clause) => {
    for (const [field, expr] of Object.entries(clause)) {
      if (expr && typeof expr === 'object' && 'contains' in (expr as object)) {
        const val = (user as unknown as Record<string, unknown>)[field] as string | null | undefined;
        if (applyContains(val, expr as { contains: string; mode?: string })) return true;
      }
    }
    return false;
  });
}

function makeFakeDb(state: FakeState) {
  let counter = 0;
  const id = (prefix: string) => `${prefix}-${++counter}`;

  return {
    department: {
      findMany: async (args: {
        where?: Record<string, unknown>;
        orderBy?: unknown;
        include?: { _count?: { select?: { members?: boolean; children?: boolean } } };
      }) => {
        const where = args?.where ?? {};
        const matched = state.departments.filter((d) =>
          whereMatchesScalar(d as unknown as Record<string, unknown>, where),
        );
        // The route asks for `_count: { select: { members: true, children: true } }`.
        // We model this by post-filtering members/children per dept.
        return matched
          .map((d) => {
            const _count = {
              members: state.users.filter((u) => u.departmentId === d.id).length,
              children: state.departments.filter((c) => c.parentId === d.id).length,
            };
            return args?.include?._count ? { ...d, _count } : d;
          })
          .sort((a, b) => {
            // parentId asc, then name asc — matches the route's orderBy.
            const pa = a.parentId ?? '';
            const pb = b.parentId ?? '';
            if (pa !== pb) return pa < pb ? -1 : 1;
            return a.name < b.name ? -1 : 1;
          });
      },
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        const found = state.departments.find((d) =>
          whereMatchesScalar(d as unknown as Record<string, unknown>, where),
        );
        return found ?? null;
      },
      create: async (args: { data: Partial<FakeDept> & { tenantId: string; name: string } }) => {
        // Enforce the (tenantId, name) unique constraint Prisma would.
        const dup = state.departments.find(
          (d) => d.tenantId === args.data.tenantId && d.name === args.data.name,
        );
        if (dup) {
          const e: Error & { code?: string } = new Error('Unique constraint failed');
          e.code = 'P2002';
          throw e;
        }
        const now = new Date();
        const dept: FakeDept = {
          id: id('dept'),
          tenantId: args.data.tenantId,
          name: args.data.name,
          description: args.data.description ?? null,
          parentId: args.data.parentId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        state.departments.push(dept);
        return dept;
      },
      update: async (args: { where: { id: string }; data: Partial<FakeDept> }) => {
        const dept = state.departments.find((d) => d.id === args.where.id);
        if (!dept) throw new Error(`dept ${args.where.id} not found`);
        Object.assign(dept, args.data, { updatedAt: new Date() });
        return dept;
      },
      delete: async (args: { where: { id: string } }) => {
        const idx = state.departments.findIndex((d) => d.id === args.where.id);
        if (idx === -1) throw new Error(`dept ${args.where.id} not found`);
        const [removed] = state.departments.splice(idx, 1);
        // SET NULL on children + members, mirroring the FK behaviour.
        for (const c of state.departments) if (c.parentId === args.where.id) c.parentId = null;
        for (const u of state.users) if (u.departmentId === args.where.id) u.departmentId = null;
        return removed;
      },
    },
    user: {
      findMany: async (args: {
        where?: Record<string, unknown>;
        select?: unknown;
        orderBy?: unknown;
        take?: number;
      }) => {
        const where = args?.where ?? {};
        const ors = (where.OR as Array<Record<string, unknown>> | undefined) ?? null;
        const filtered = state.users.filter((u) => {
          if (where.tenantId !== undefined && u.tenantId !== where.tenantId) return false;
          if (where.active !== undefined && u.active !== where.active) return false;
          if (where.departmentId !== undefined && u.departmentId !== where.departmentId) return false;
          if (ors && !userMatchesOR(u, ors)) return false;
          return true;
        });
        filtered.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        const limited = args?.take ? filtered.slice(0, args.take) : filtered;
        // Decorate with department/manager joins like the `select` clause does.
        return limited.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          jobTitle: u.jobTitle,
          role: u.role,
          departmentId: u.departmentId,
          managerId: u.managerId,
          avatarUrl: u.avatarUrl,
          department: u.departmentId
            ? (() => {
                const d = state.departments.find((x) => x.id === u.departmentId);
                return d ? { id: d.id, name: d.name } : null;
              })()
            : null,
          manager: u.managerId
            ? (() => {
                const m = state.users.find((x) => x.id === u.managerId);
                return m ? { id: m.id, name: m.name, email: m.email } : null;
              })()
            : null,
        }));
      },
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        const found = state.users.find((u) =>
          whereMatchesScalar(u as unknown as Record<string, unknown>, where),
        );
        return found ?? null;
      },
      update: async (args: { where: { id: string }; data: Partial<FakeUser> }) => {
        const u = state.users.find((x) => x.id === args.where.id);
        if (!u) throw new Error(`user ${args.where.id} not found`);
        Object.assign(u, args.data);
        return u;
      },
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Test-only auth decorators
// ───────────────────────────────────────────────────────────────────────────

/**
 * Reads `x-test-user` (JSON-encoded AuthSession) off the inject() request
 * and stamps it on `request.user`. Missing/invalid header → 401, mirroring
 * the prod path closely enough for these tests.
 */
function testAuthenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers['x-test-user'];
  if (!header || typeof header !== 'string') {
    throw new UnauthorizedError('Missing x-test-user header');
  }
  try {
    const session = JSON.parse(header) as AuthSession;
    (request as FastifyRequest & { user: AuthSession }).user = session;
  } catch {
    throw new UnauthorizedError('Invalid x-test-user header');
  }
  return Promise.resolve();
}

function testRequireRole(...roles: UserRole[]) {
  return (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = (request as FastifyRequest & { user?: AuthSession }).user;
    if (!user) throw new UnauthorizedError();
    if (!roles.includes(user.role)) {
      throw new ForbiddenError(
        `Role '${user.role}' is not allowed. Required: ${roles.join(', ')}`,
      );
    }
    return Promise.resolve();
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Harness
// ───────────────────────────────────────────────────────────────────────────

const TENANT = 'tnt-acme';
const OTHER_TENANT = 'tnt-other';

function adminSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    sub: 'usr-admin',
    userId: 'usr-admin',
    tenantId: TENANT,
    email: 'admin@acme.test',
    name: 'Admin',
    role: 'TENANT_ADMIN',
    ...overrides,
  };
}

function endUserSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    sub: 'usr-eu',
    userId: 'usr-eu',
    tenantId: TENANT,
    email: 'enduser@acme.test',
    name: 'End User',
    role: 'END_USER',
    ...overrides,
  };
}

async function buildApp(state: FakeState): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });

  // Decorators must exist BEFORE teamRoutes registers (the plugin reads
  // fastify.authenticate / fastify.requireRole at registration time).
  fastify.decorate('authenticate', testAuthenticate);
  fastify.decorate('requireRole', testRequireRole);
  fastify.decorate('db', makeFakeDb(state));

  fastify.setErrorHandler((error: Error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }
    request.log.error({ err: error }, 'unhandled');
    return reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  });

  await fastify.register(teamRoutes, { prefix: '/team' });
  await fastify.ready();
  return fastify;
}

function authHeaders(session: AuthSession): Record<string, string> {
  return { 'x-test-user': JSON.stringify(session) };
}

function jsonHeaders(session: AuthSession): Record<string, string> {
  return { ...authHeaders(session), 'content-type': 'application/json' };
}

// Empty state factory — each test gets a fresh slate.
function emptyState(): FakeState {
  return { departments: [], users: [] };
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe('team.routes — GET /team/departments', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = undefined as unknown as FastifyInstance;
  });

  it('lists this tenant\'s departments and reports member counts via _count', async () => {
    const state = emptyState();
    const now = new Date();
    state.departments.push(
      { id: 'd-eng', tenantId: TENANT, name: 'Engineering', description: null, parentId: null, createdAt: now, updatedAt: now },
      { id: 'd-mkt', tenantId: TENANT, name: 'Marketing', description: null, parentId: null, createdAt: now, updatedAt: now },
      { id: 'd-foreign', tenantId: OTHER_TENANT, name: 'Engineering', description: null, parentId: null, createdAt: now, updatedAt: now },
    );
    state.users.push(
      { id: 'u1', tenantId: TENANT, email: 'a@x', name: 'Alice', jobTitle: null, role: 'OPERATOR', active: true, departmentId: 'd-eng', managerId: null, avatarUrl: null },
      { id: 'u2', tenantId: TENANT, email: 'b@x', name: 'Bob', jobTitle: null, role: 'OPERATOR', active: true, departmentId: 'd-eng', managerId: null, avatarUrl: null },
      { id: 'u3', tenantId: TENANT, email: 'c@x', name: 'Cara', jobTitle: null, role: 'OPERATOR', active: true, departmentId: 'd-mkt', managerId: null, avatarUrl: null },
      // Cross-tenant user attached to d-foreign — must NOT inflate this tenant's counts.
      { id: 'u-other', tenantId: OTHER_TENANT, email: 'x@x', name: 'X', jobTitle: null, role: 'OPERATOR', active: true, departmentId: 'd-foreign', managerId: null, avatarUrl: null },
    );

    app = await buildApp(state);
    const res = await app.inject({ method: 'GET', url: '/team/departments', headers: authHeaders(adminSession()) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.count).toBe(2); // The OTHER_TENANT dept must be filtered out.
    const names = body.data.items.map((d: { name: string }) => d.name).sort();
    expect(names).toEqual(['Engineering', 'Marketing']);
    const eng = body.data.items.find((d: { id: string }) => d.id === 'd-eng');
    expect(eng._count.members).toBe(2);
    expect(eng._count.children).toBe(0);
    await app.close();
  });
});

describe('team.routes — POST /team/departments', () => {
  it('rejects END_USER with 403 (TENANT_ADMIN-only)', async () => {
    const app = await buildApp(emptyState());
    const res = await app.inject({
      method: 'POST',
      url: '/team/departments',
      headers: jsonHeaders(endUserSession()),
      payload: { name: 'New Dept' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    await app.close();
  });

  it('returns 409 CONFLICT on duplicate name within the same tenant', async () => {
    const state = emptyState();
    const now = new Date();
    state.departments.push({
      id: 'd-existing',
      tenantId: TENANT,
      name: 'Engineering',
      description: null,
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    const app = await buildApp(state);
    const res = await app.inject({
      method: 'POST',
      url: '/team/departments',
      headers: jsonHeaders(adminSession()),
      payload: { name: 'Engineering' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
    await app.close();
  });

  it('rejects parentId belonging to a different tenant with 422', async () => {
    const state = emptyState();
    const now = new Date();
    state.departments.push({
      id: 'd-other',
      tenantId: OTHER_TENANT,
      name: 'Foreign',
      description: null,
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    const app = await buildApp(state);
    const res = await app.inject({
      method: 'POST',
      url: '/team/departments',
      headers: jsonHeaders(adminSession()),
      payload: { name: 'Child', parentId: 'd-other' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.message).toMatch(/parentId is not in this tenant/);
    await app.close();
  });

  it('happy path: TENANT_ADMIN creates a department, server stamps tenantId and returns 201', async () => {
    const app = await buildApp(emptyState());
    const res = await app.inject({
      method: 'POST',
      url: '/team/departments',
      headers: jsonHeaders(adminSession()),
      payload: { name: 'Sales', description: 'go-to-market' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.name).toBe('Sales');
    expect(body.data.tenantId).toBe(TENANT);
    expect(body.data.parentId).toBeNull();
    await app.close();
  });
});

describe('team.routes — PATCH /team/departments/:id (cycle prevention)', () => {
  it('refuses direct self-parent (A → A) with 422', async () => {
    const state = emptyState();
    const now = new Date();
    state.departments.push({
      id: 'd-a',
      tenantId: TENANT,
      name: 'A',
      description: null,
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    const app = await buildApp(state);
    const res = await app.inject({
      method: 'PATCH',
      url: '/team/departments/d-a',
      headers: jsonHeaders(adminSession()),
      payload: { parentId: 'd-a' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/cannot be its own parent/);
    await app.close();
  });

  // The hot-spot test for the 2026-05-08 audit fix.
  it('refuses indirect cycles: A→B→C, then setting A.parent=C with 422', async () => {
    const state = emptyState();
    const now = new Date();
    // Tree: A is root, B's parent = A, C's parent = B  (A → B → C in
    // child-direction; in parent-direction C → B → A). Reparenting A under
    // C would close the loop A → C → B → A.
    state.departments.push(
      { id: 'd-a', tenantId: TENANT, name: 'A', description: null, parentId: null, createdAt: now, updatedAt: now },
      { id: 'd-b', tenantId: TENANT, name: 'B', description: null, parentId: 'd-a', createdAt: now, updatedAt: now },
      { id: 'd-c', tenantId: TENANT, name: 'C', description: null, parentId: 'd-b', createdAt: now, updatedAt: now },
    );
    const app = await buildApp(state);
    const res = await app.inject({
      method: 'PATCH',
      url: '/team/departments/d-a',
      headers: jsonHeaders(adminSession()),
      payload: { parentId: 'd-c' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/Reparenting would create a cycle/);
    // Sanity: A's parentId must NOT have been mutated.
    expect(state.departments.find((d) => d.id === 'd-a')!.parentId).toBeNull();
    await app.close();
  });

  it('depth-cap protects against pre-existing cycles in the data (no infinite loop)', async () => {
    const state = emptyState();
    const now = new Date();
    // Pre-existing corruption: X.parent = Y, Y.parent = X. We then ask to
    // set Z.parent = X. The walk hits X → Y → X and the `seen` set must
    // detect the loop before chewing through 64 hops, returning 422 with
    // the data-corruption message.
    state.departments.push(
      { id: 'd-x', tenantId: TENANT, name: 'X', description: null, parentId: 'd-y', createdAt: now, updatedAt: now },
      { id: 'd-y', tenantId: TENANT, name: 'Y', description: null, parentId: 'd-x', createdAt: now, updatedAt: now },
      { id: 'd-z', tenantId: TENANT, name: 'Z', description: null, parentId: null, createdAt: now, updatedAt: now },
    );
    const app = await buildApp(state);

    // Wrap the call in a hard timeout — the test should finish in
    // microseconds; if the route lacked the depth cap it would hang
    // forever. The 64-iter for-loop bounds the work even without the
    // `seen` Set, but we keep the timeout to make a regression loud.
    const promise = app.inject({
      method: 'PATCH',
      url: '/team/departments/d-z',
      headers: jsonHeaders(adminSession()),
      payload: { parentId: 'd-x' },
    });
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('PATCH hung — depth cap regressed')), 1500),
    );
    const res = await Promise.race([promise, timeout]);

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/cycle/i);
    await app.close();
  });

  it('happy path: rename + reparent under a non-cycle target', async () => {
    const state = emptyState();
    const now = new Date();
    state.departments.push(
      { id: 'd-a', tenantId: TENANT, name: 'A', description: null, parentId: null, createdAt: now, updatedAt: now },
      { id: 'd-b', tenantId: TENANT, name: 'B', description: null, parentId: null, createdAt: now, updatedAt: now },
    );
    const app = await buildApp(state);
    const res = await app.inject({
      method: 'PATCH',
      url: '/team/departments/d-a',
      headers: jsonHeaders(adminSession()),
      payload: { name: 'A-renamed', parentId: 'd-b' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.name).toBe('A-renamed');
    expect(body.data.parentId).toBe('d-b');
    await app.close();
  });
});

describe('team.routes — DELETE /team/departments/:id', () => {
  it('TENANT_ADMIN gets 204 on success; non-existent id → 404', async () => {
    const state = emptyState();
    const now = new Date();
    state.departments.push({
      id: 'd-doomed',
      tenantId: TENANT,
      name: 'Doomed',
      description: null,
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    const app = await buildApp(state);

    // Happy path.
    const ok = await app.inject({
      method: 'DELETE',
      url: '/team/departments/d-doomed',
      headers: authHeaders(adminSession()),
    });
    expect(ok.statusCode).toBe(204);
    expect(state.departments.find((d) => d.id === 'd-doomed')).toBeUndefined();

    // Missing id.
    const missing = await app.inject({
      method: 'DELETE',
      url: '/team/departments/d-nope',
      headers: authHeaders(adminSession()),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');

    await app.close();
  });

  it('rejects END_USER with 403', async () => {
    const state = emptyState();
    const now = new Date();
    state.departments.push({
      id: 'd-x',
      tenantId: TENANT,
      name: 'X',
      description: null,
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    const app = await buildApp(state);
    const res = await app.inject({
      method: 'DELETE',
      url: '/team/departments/d-x',
      headers: authHeaders(endUserSession()),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('team.routes — GET /team/members', () => {
  it('only returns active=true users in this tenant', async () => {
    const state = emptyState();
    state.users.push(
      { id: 'u1', tenantId: TENANT, email: 'a@x', name: 'Alice', jobTitle: 'Eng', role: 'OPERATOR', active: true, departmentId: null, managerId: null, avatarUrl: null },
      { id: 'u2', tenantId: TENANT, email: 'b@x', name: 'Bob', jobTitle: 'Eng', role: 'OPERATOR', active: false, departmentId: null, managerId: null, avatarUrl: null },
      { id: 'u3', tenantId: OTHER_TENANT, email: 'c@x', name: 'Cara', jobTitle: 'Eng', role: 'OPERATOR', active: true, departmentId: null, managerId: null, avatarUrl: null },
    );
    const app = await buildApp(state);
    const res = await app.inject({ method: 'GET', url: '/team/members', headers: authHeaders(adminSession()) });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.items.map((u: { id: string }) => u.id);
    expect(ids).toEqual(['u1']); // Bob inactive, Cara wrong tenant.
    await app.close();
  });

  it('searches case-insensitively across name, email, and jobTitle', async () => {
    const state = emptyState();
    state.users.push(
      { id: 'u-name', tenantId: TENANT, email: 'a@x.test', name: 'Alice Andersen', jobTitle: 'Designer', role: 'OPERATOR', active: true, departmentId: null, managerId: null, avatarUrl: null },
      { id: 'u-email', tenantId: TENANT, email: 'BOB@example.com', name: 'Bob', jobTitle: 'Sales', role: 'OPERATOR', active: true, departmentId: null, managerId: null, avatarUrl: null },
      { id: 'u-title', tenantId: TENANT, email: 'c@x.test', name: 'Cara', jobTitle: 'Senior Engineer', role: 'OPERATOR', active: true, departmentId: null, managerId: null, avatarUrl: null },
      { id: 'u-noise', tenantId: TENANT, email: 'd@x.test', name: 'Dan', jobTitle: 'Janitor', role: 'OPERATOR', active: true, departmentId: null, managerId: null, avatarUrl: null },
    );
    const app = await buildApp(state);

    const byName = await app.inject({ method: 'GET', url: '/team/members?q=ALICE', headers: authHeaders(adminSession()) });
    expect(byName.statusCode).toBe(200);
    expect(byName.json().data.items.map((u: { id: string }) => u.id)).toEqual(['u-name']);

    const byEmail = await app.inject({ method: 'GET', url: '/team/members?q=bob@example', headers: authHeaders(adminSession()) });
    expect(byEmail.json().data.items.map((u: { id: string }) => u.id)).toEqual(['u-email']);

    const byTitle = await app.inject({ method: 'GET', url: '/team/members?q=engineer', headers: authHeaders(adminSession()) });
    expect(byTitle.json().data.items.map((u: { id: string }) => u.id)).toEqual(['u-title']);

    await app.close();
  });

  it('filters by departmentId', async () => {
    const state = emptyState();
    const now = new Date();
    state.departments.push(
      { id: 'd-eng', tenantId: TENANT, name: 'Eng', description: null, parentId: null, createdAt: now, updatedAt: now },
      { id: 'd-mkt', tenantId: TENANT, name: 'Mkt', description: null, parentId: null, createdAt: now, updatedAt: now },
    );
    state.users.push(
      { id: 'u1', tenantId: TENANT, email: 'a@x', name: 'Alice', jobTitle: null, role: 'OPERATOR', active: true, departmentId: 'd-eng', managerId: null, avatarUrl: null },
      { id: 'u2', tenantId: TENANT, email: 'b@x', name: 'Bob', jobTitle: null, role: 'OPERATOR', active: true, departmentId: 'd-mkt', managerId: null, avatarUrl: null },
    );
    const app = await buildApp(state);
    const res = await app.inject({
      method: 'GET',
      url: '/team/members?departmentId=d-eng',
      headers: authHeaders(adminSession()),
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.items.map((u: { id: string }) => u.id);
    expect(ids).toEqual(['u1']);
    await app.close();
  });
});

describe('team.routes — PATCH /team/members/:userId', () => {
  it('rejects END_USER with 403', async () => {
    const state = emptyState();
    state.users.push({
      id: 'u-target',
      tenantId: TENANT,
      email: 'tgt@x',
      name: 'Target',
      jobTitle: null,
      role: 'OPERATOR',
      active: true,
      departmentId: null,
      managerId: null,
      avatarUrl: null,
    });
    const app = await buildApp(state);
    const res = await app.inject({
      method: 'PATCH',
      url: '/team/members/u-target',
      headers: jsonHeaders(endUserSession()),
      payload: { jobTitle: 'New Title' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('refuses department in a different tenant with 422', async () => {
    const state = emptyState();
    const now = new Date();
    state.departments.push({
      id: 'd-other',
      tenantId: OTHER_TENANT,
      name: 'Foreign',
      description: null,
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    state.users.push({
      id: 'u-target',
      tenantId: TENANT,
      email: 'tgt@x',
      name: 'Target',
      jobTitle: null,
      role: 'OPERATOR',
      active: true,
      departmentId: null,
      managerId: null,
      avatarUrl: null,
    });
    const app = await buildApp(state);
    const res = await app.inject({
      method: 'PATCH',
      url: '/team/members/u-target',
      headers: jsonHeaders(adminSession()),
      payload: { departmentId: 'd-other' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/departmentId is not in this tenant/);
    await app.close();
  });

  it('refuses managerId === userId (self-management) with 422', async () => {
    const state = emptyState();
    state.users.push({
      id: 'u-target',
      tenantId: TENANT,
      email: 'tgt@x',
      name: 'Target',
      jobTitle: null,
      role: 'OPERATOR',
      active: true,
      departmentId: null,
      managerId: null,
      avatarUrl: null,
    });
    const app = await buildApp(state);
    const res = await app.inject({
      method: 'PATCH',
      url: '/team/members/u-target',
      headers: jsonHeaders(adminSession()),
      payload: { managerId: 'u-target' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/cannot be their own manager/);
    await app.close();
  });

  it('refuses managerId not in tenant with 422 (cross-tenant manager)', async () => {
    const state = emptyState();
    state.users.push(
      { id: 'u-target', tenantId: TENANT, email: 'tgt@x', name: 'Target', jobTitle: null, role: 'OPERATOR', active: true, departmentId: null, managerId: null, avatarUrl: null },
      { id: 'u-foreign', tenantId: OTHER_TENANT, email: 'f@x', name: 'Foreign Mgr', jobTitle: null, role: 'TENANT_ADMIN', active: true, departmentId: null, managerId: null, avatarUrl: null },
    );
    const app = await buildApp(state);
    const res = await app.inject({
      method: 'PATCH',
      url: '/team/members/u-target',
      headers: jsonHeaders(adminSession()),
      payload: { managerId: 'u-foreign' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/managerId is not a member of this tenant/);
    await app.close();
  });

  it('happy path: change department + jobTitle + manager in one call', async () => {
    const state = emptyState();
    const now = new Date();
    state.departments.push({
      id: 'd-eng',
      tenantId: TENANT,
      name: 'Eng',
      description: null,
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    state.users.push(
      { id: 'u-target', tenantId: TENANT, email: 'tgt@x', name: 'Target', jobTitle: null, role: 'OPERATOR', active: true, departmentId: null, managerId: null, avatarUrl: null },
      { id: 'u-mgr', tenantId: TENANT, email: 'mgr@x', name: 'Manager', jobTitle: null, role: 'OPERATOR', active: true, departmentId: null, managerId: null, avatarUrl: null },
    );
    const app = await buildApp(state);
    const res = await app.inject({
      method: 'PATCH',
      url: '/team/members/u-target',
      headers: jsonHeaders(adminSession()),
      payload: { departmentId: 'd-eng', jobTitle: 'Staff Eng', managerId: 'u-mgr' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.departmentId).toBe('d-eng');
    expect(body.data.jobTitle).toBe('Staff Eng');
    expect(body.data.managerId).toBe('u-mgr');
    // Persistence sanity.
    const u = state.users.find((x) => x.id === 'u-target')!;
    expect(u.departmentId).toBe('d-eng');
    expect(u.jobTitle).toBe('Staff Eng');
    expect(u.managerId).toBe('u-mgr');
    await app.close();
  });
});
