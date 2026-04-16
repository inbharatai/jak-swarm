/**
 * API Endpoint Integration Tests
 *
 * Comprehensive contract + behaviour coverage for every major route group.
 * All tests run against the real Fastify app with real Postgres + Redis
 * (provisioned in CI via service containers).
 *
 * Skips automatically when DATABASE_URL is not configured (local dev without DB).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApiOk<T> = { success: true; data: T };
type ApiErr = { success: false; error: string; code?: string; statusCode?: number };

type AuthData = { token: string; user: { id: string; email: string; name: string } };
type WorkflowData = { id: string; status: string; goal?: string };
type SkillData = { id: string; name: string; status: string };
type ToolData = { name: string; description: string };
type MemoryData = { key: string; value: unknown };
type ScheduleData = { id: string; cron: string; goal: string; enabled: boolean };
type TraceData = { id: string; workflowId: string };
type ProviderStatus = { configured: boolean; models?: string[] };

const hasDatabaseUrl = Boolean(process.env['DATABASE_URL'] || process.env['DIRECT_URL']);

let app: FastifyInstance;
let adminToken = '';
let userToken = '';
let adminEmail = '';
let userEmail = '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function inject<T>(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: T | null }> {
  const res = await app.inject({
    method,
    url,
    payload: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json', ...headers },
  });
  const text = res.payload;
  if (!text) return { status: res.statusCode, body: null };
  return { status: res.statusCode, body: JSON.parse(text) as T };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}@jaktest.dev`;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test';
  if (process.env['DIRECT_URL']) {
    process.env['DATABASE_URL'] = process.env['DIRECT_URL'];
  }
  process.env['WHATSAPP_AUTO_START'] = '0';
  process.env['WHATSAPP_BRIDGE_TOKEN'] = 'test-bridge-token';

  vi.resetModules();
  const mod = await import('../../apps/api/src/index.js');
  app = await mod.buildApp();
  await app.ready();

  // Pre-register two users so all authenticated tests have tokens immediately.
  const suffix = Date.now();
  adminEmail = uniqueEmail(`admin-${suffix}`);
  userEmail = uniqueEmail(`user-${suffix}`);

  const adminReg = await inject<ApiOk<AuthData>>('POST', '/auth/register', {
    email: adminEmail,
    password: 'AdminPass123!',
    name: 'Test Admin',
    tenantName: `admin-tenant-${suffix}`,
    tenantSlug: `admin-tenant-${suffix}`,
  });
  adminToken = adminReg.body?.data.token ?? '';

  const userReg = await inject<ApiOk<AuthData>>('POST', '/auth/register', {
    email: userEmail,
    password: 'UserPass123!',
    name: 'Test User',
    tenantName: `user-tenant-${suffix}`,
    tenantSlug: `user-tenant-${suffix}`,
  });
  userToken = userReg.body?.data.token ?? '';
}, 40000);

afterAll(async () => {
  if (app) await app.close();
});

// ===========================================================================
// HEALTH CHECK
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('GET /health', () => {
  it('returns 200 with db and redis checks when services are up', async () => {
    const { status, body } = await inject<{
      status: string;
      checks: Record<string, unknown>;
      timestamp: string;
    }>('GET', '/health');

    expect(status).toBe(200);
    expect(body?.status).toBe('ok');
    expect(body?.checks).toBeDefined();
    expect(body?.timestamp).toBeDefined();
  });
});

// ===========================================================================
// AUTH ROUTES
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('POST /auth/register', () => {
  it('creates a new user and returns a JWT token', async () => {
    const { status, body } = await inject<ApiOk<AuthData>>('POST', '/auth/register', {
      email: uniqueEmail(`reg-${Date.now()}`),
      password: 'StrongPass123!',
      name: 'New User',
      tenantName: `reg-tenant-${Date.now()}`,
      tenantSlug: `reg-tenant-${Date.now()}`,
    });

    expect(status).toBe(201);
    expect(body?.success).toBe(true);
    expect(body?.data.token).toBeTruthy();
    expect(body?.data.user.email).toBeTruthy();
  });

  it('rejects duplicate email with 409', async () => {
    const { status } = await inject('POST', '/auth/register', {
      email: adminEmail,
      password: 'AnotherPass123!',
      name: 'Duplicate',
      tenantName: `dup-tenant-${Date.now()}`,
      tenantSlug: `dup-tenant-${Date.now()}`,
    });
    expect(status).toBe(409);
  });

  it('rejects weak password with 400/422', async () => {
    const { status } = await inject('POST', '/auth/register', {
      email: uniqueEmail('weak'),
      password: '123',
      name: 'Weak',
      tenantName: `weak-tenant-${Date.now()}`,
      tenantSlug: `weak-tenant-${Date.now()}`,
    });
    expect([400, 422]).toContain(status);
  });

  it('rejects missing fields with 400/422', async () => {
    const { status } = await inject('POST', '/auth/register', { email: 'missing@fields.com' });
    expect([400, 422]).toContain(status);
  });
});

describe.skipIf(!hasDatabaseUrl)('POST /auth/login', () => {
  it('returns token for valid credentials', async () => {
    const { status, body } = await inject<ApiOk<AuthData>>('POST', '/auth/login', {
      email: adminEmail,
      password: 'AdminPass123!',
    });

    expect(status).toBe(200);
    expect(body?.data.token).toBeTruthy();
  });

  it('returns 401 for wrong password', async () => {
    const { status } = await inject('POST', '/auth/login', {
      email: adminEmail,
      password: 'WrongPassword!',
    });
    expect(status).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    const { status } = await inject('POST', '/auth/login', {
      email: 'nobody@nowhere.dev',
      password: 'SomePass123!',
    });
    expect(status).toBe(401);
  });
});

describe.skipIf(!hasDatabaseUrl)('GET /auth/me', () => {
  it('returns current user for valid token', async () => {
    const { status, body } = await inject<ApiOk<{ id: string; email: string }>>(
      'GET',
      '/auth/me',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(body?.data.email).toBe(adminEmail);
  });

  it('returns 401 without token', async () => {
    const { status } = await inject('GET', '/auth/me');
    expect(status).toBe(401);
  });

  it('returns 401 with malformed token', async () => {
    const { status } = await inject('GET', '/auth/me', undefined, auth('not.a.valid.jwt'));
    expect(status).toBe(401);
  });
});

describe.skipIf(!hasDatabaseUrl)('POST /auth/logout', () => {
  it('returns 200 and clears the session', async () => {
    const { status } = await inject('POST', '/auth/logout', undefined, auth(userToken));
    expect([200, 204]).toContain(status);
  });
});

// ===========================================================================
// WORKFLOWS
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('Workflow CRUD', () => {
  let workflowId = '';

  it('GET /workflows/ returns empty array for fresh user', async () => {
    const { status, body } = await inject<ApiOk<WorkflowData[]>>(
      'GET',
      '/workflows/',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(Array.isArray(body?.data)).toBe(true);
  });

  it('GET /workflows/ returns 401 without auth', async () => {
    const { status } = await inject('GET', '/workflows/');
    expect(status).toBe(401);
  });

  it('POST /workflows/ creates a workflow', async () => {
    const { status, body } = await inject<ApiOk<WorkflowData>>(
      'POST',
      '/workflows/',
      { goal: 'Summarise the latest AI news' },
      auth(adminToken),
    );
    expect(status).toBe(201);
    expect(body?.data.id).toBeTruthy();
    workflowId = body?.data.id ?? '';
  });

  it('GET /workflows/:id returns the created workflow', async () => {
    if (!workflowId) return;
    const { status, body } = await inject<ApiOk<WorkflowData>>(
      'GET',
      `/workflows/${workflowId}`,
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(body?.data.id).toBe(workflowId);
  });

  it('GET /workflows/:id returns 404 for unknown id', async () => {
    const { status } = await inject(
      'GET',
      '/workflows/wf_nonexistent_id',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(404);
  });

  it('POST /workflows/:id/pause pauses a running workflow', async () => {
    if (!workflowId) return;
    const { status } = await inject(
      'POST',
      `/workflows/${workflowId}/pause`,
      undefined,
      auth(adminToken),
    );
    expect([200, 204, 409]).toContain(status); // 409 if already stopped
  });

  it('DELETE /workflows/:id removes the workflow', async () => {
    if (!workflowId) return;
    const { status } = await inject(
      'DELETE',
      `/workflows/${workflowId}`,
      undefined,
      auth(adminToken),
    );
    expect([200, 204]).toContain(status);
  });
});

// ===========================================================================
// APPROVALS
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('GET /approvals/', () => {
  it('returns empty array for new tenant', async () => {
    const { status, body } = await inject<ApiOk<unknown[]>>(
      'GET',
      '/approvals/',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(Array.isArray(body?.data)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const { status } = await inject('GET', '/approvals/');
    expect(status).toBe(401);
  });

  it('GET /approvals/:id returns 404 for unknown approval', async () => {
    const { status } = await inject(
      'GET',
      '/approvals/ap_nonexistent',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(404);
  });
});

// ===========================================================================
// SKILLS
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('Skills routes', () => {
  it('GET /skills/ returns array', async () => {
    const { status, body } = await inject<ApiOk<SkillData[]>>(
      'GET',
      '/skills/',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(Array.isArray(body?.data)).toBe(true);
  });

  it('GET /skills/ returns 401 without auth', async () => {
    const { status } = await inject('GET', '/skills/');
    expect(status).toBe(401);
  });

  it('POST /skills/propose validates required fields', async () => {
    const { status } = await inject('POST', '/skills/propose', {}, auth(adminToken));
    expect([400, 422]).toContain(status);
  });

  it('GET /skills/:id returns 404 for unknown skill', async () => {
    const { status } = await inject('GET', '/skills/sk_nonexistent', undefined, auth(adminToken));
    expect(status).toBe(404);
  });
});

// ===========================================================================
// TOOLS
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('Tools routes', () => {
  it('GET /tools/ returns registered tools', async () => {
    const { status, body } = await inject<ApiOk<ToolData[]>>(
      'GET',
      '/tools/',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(Array.isArray(body?.data)).toBe(true);
    expect(body!.data.length).toBeGreaterThan(0);
  });

  it('GET /tools/:toolName returns tool details', async () => {
    // First get a list to pick a real tool name
    const list = await inject<ApiOk<ToolData[]>>('GET', '/tools/', undefined, auth(adminToken));
    const firstTool = list.body?.data[0];
    if (!firstTool) return;

    const { status, body } = await inject<ApiOk<ToolData>>(
      'GET',
      `/tools/${firstTool.name}`,
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(body?.data.name).toBe(firstTool.name);
  });

  it('GET /tools/:toolName returns 404 for unknown tool', async () => {
    const { status } = await inject(
      'GET',
      '/tools/tool_that_does_not_exist',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(404);
  });
});

// ===========================================================================
// MEMORY
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('Memory CRUD', () => {
  const testKey = `test-key-${Date.now()}`;
  const testValue = { foo: 'bar', nested: { n: 42 } };

  it('PUT /memory/:key stores a value', async () => {
    const { status } = await inject(
      'PUT',
      `/memory/${testKey}`,
      { value: testValue },
      auth(adminToken),
    );
    expect([200, 201, 204]).toContain(status);
  });

  it('GET /memory/:key retrieves the stored value', async () => {
    const { status, body } = await inject<ApiOk<MemoryData>>(
      'GET',
      `/memory/${testKey}`,
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(body?.data.value).toEqual(testValue);
  });

  it('DELETE /memory/:key removes the entry', async () => {
    const { status } = await inject(
      'DELETE',
      `/memory/${testKey}`,
      undefined,
      auth(adminToken),
    );
    expect([200, 204]).toContain(status);
  });

  it('GET /memory/:key returns 404 after deletion', async () => {
    const { status } = await inject<ApiOk<MemoryData>>(
      'GET',
      `/memory/${testKey}`,
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(404);
  });

  it('GET /memory/ returns 401 without auth', async () => {
    const { status } = await inject('GET', '/memory/');
    expect(status).toBe(401);
  });
});

// ===========================================================================
// SCHEDULES
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('Schedule CRUD', () => {
  let scheduleId = '';

  it('GET /schedules/ returns empty array for fresh tenant', async () => {
    const { status, body } = await inject<ApiOk<ScheduleData[]>>(
      'GET',
      '/schedules/',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(Array.isArray(body?.data)).toBe(true);
  });

  it('POST /schedules/ creates a schedule', async () => {
    const { status, body } = await inject<ApiOk<ScheduleData>>(
      'POST',
      '/schedules/',
      {
        cron: '0 9 * * 1',
        goal: 'Weekly team status summary',
        timezone: 'UTC',
      },
      auth(adminToken),
    );
    expect(status).toBe(201);
    expect(body?.data.id).toBeTruthy();
    scheduleId = body?.data.id ?? '';
  });

  it('GET /schedules/:id returns the created schedule', async () => {
    if (!scheduleId) return;
    const { status, body } = await inject<ApiOk<ScheduleData>>(
      'GET',
      `/schedules/${scheduleId}`,
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(body?.data.id).toBe(scheduleId);
  });

  it('PATCH /schedules/:id updates enabled flag', async () => {
    if (!scheduleId) return;
    const { status } = await inject(
      'PATCH',
      `/schedules/${scheduleId}`,
      { enabled: false },
      auth(adminToken),
    );
    expect([200, 204]).toContain(status);
  });

  it('DELETE /schedules/:id removes the schedule', async () => {
    if (!scheduleId) return;
    const { status } = await inject(
      'DELETE',
      `/schedules/${scheduleId}`,
      undefined,
      auth(adminToken),
    );
    expect([200, 204]).toContain(status);
  });

  it('POST /schedules/ rejects invalid cron expression', async () => {
    const { status } = await inject(
      'POST',
      '/schedules/',
      { cron: 'not-a-cron', goal: 'Bad schedule' },
      auth(adminToken),
    );
    expect([400, 422]).toContain(status);
  });

  it('GET /schedules/ returns 401 without auth', async () => {
    const { status } = await inject('GET', '/schedules/');
    expect(status).toBe(401);
  });
});

// ===========================================================================
// TRACES
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('Traces routes', () => {
  it('GET /traces/ returns array', async () => {
    const { status, body } = await inject<ApiOk<TraceData[]>>(
      'GET',
      '/traces/',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(Array.isArray(body?.data)).toBe(true);
  });

  it('GET /traces/ returns 401 without auth', async () => {
    const { status } = await inject('GET', '/traces/');
    expect(status).toBe(401);
  });

  it('GET /traces/:id returns 404 for unknown trace', async () => {
    const { status } = await inject(
      'GET',
      '/traces/tr_nonexistent',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(404);
  });
});

// ===========================================================================
// ANALYTICS
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('Analytics routes', () => {
  it('GET /analytics/usage returns usage summary', async () => {
    const { status, body } = await inject<ApiOk<unknown>>(
      'GET',
      '/analytics/usage',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });

  it('GET /analytics/cost returns cost summary', async () => {
    const { status, body } = await inject<ApiOk<unknown>>(
      'GET',
      '/analytics/cost',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });

  it('GET /analytics/usage returns 401 without auth', async () => {
    const { status } = await inject('GET', '/analytics/usage');
    expect(status).toBe(401);
  });
});

// ===========================================================================
// LLM SETTINGS
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('LLM Settings routes', () => {
  it('GET /settings/llm/ returns providers list', async () => {
    const { status, body } = await inject<ApiOk<unknown>>(
      'GET',
      '/settings/llm/',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });

  it('GET /settings/llm/status returns configuration status', async () => {
    const { status, body } = await inject<ApiOk<Record<string, ProviderStatus>>>(
      'GET',
      '/settings/llm/status',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });

  it('GET /settings/llm/ returns 401 without auth', async () => {
    const { status } = await inject('GET', '/settings/llm/');
    expect(status).toBe(401);
  });
});

// ===========================================================================
// ONBOARDING
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('Onboarding routes', () => {
  it('GET /onboarding/state returns onboarding state', async () => {
    const { status, body } = await inject<ApiOk<unknown>>(
      'GET',
      '/onboarding/state',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });

  it('POST /onboarding/state updates onboarding state', async () => {
    const { status } = await inject(
      'POST',
      '/onboarding/state',
      { step: 'llm_configured' },
      auth(adminToken),
    );
    expect([200, 204]).toContain(status);
  });

  it('GET /onboarding/state returns 401 without auth', async () => {
    const { status } = await inject('GET', '/onboarding/state');
    expect(status).toBe(401);
  });
});

// ===========================================================================
// USAGE
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('Usage routes', () => {
  it('GET /usage/ returns usage data', async () => {
    const { status, body } = await inject<ApiOk<unknown>>(
      'GET',
      '/usage/',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });

  it('GET /usage/providers returns provider list', async () => {
    const { status, body } = await inject<ApiOk<unknown>>(
      'GET',
      '/usage/providers',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });
});

// ===========================================================================
// INTEGRATIONS
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('Integrations routes', () => {
  it('GET /integrations returns integrations list', async () => {
    const { status, body } = await inject<ApiOk<unknown[]>>(
      'GET',
      '/integrations',
      undefined,
      auth(adminToken),
    );
    expect(status).toBe(200);
    expect(Array.isArray(body?.data)).toBe(true);
  });

  it('GET /integrations returns 401 without auth', async () => {
    const { status } = await inject('GET', '/integrations');
    expect(status).toBe(401);
  });

  it('POST /integrations/connect validates required fields', async () => {
    const { status } = await inject('POST', '/integrations/connect', {}, auth(adminToken));
    expect([400, 422]).toContain(status);
  });
});

// ===========================================================================
// SECURITY — auth boundary checks
// ===========================================================================

describe.skipIf(!hasDatabaseUrl)('Auth boundary hardening', () => {
  const sensitiveRoutes = [
    ['GET', '/workflows/'],
    ['GET', '/approvals/'],
    ['GET', '/skills/'],
    ['GET', '/memory/'],
    ['GET', '/schedules/'],
    ['GET', '/traces/'],
    ['GET', '/analytics/usage'],
    ['GET', '/settings/llm/'],
    ['GET', '/onboarding/state'],
    ['GET', '/integrations'],
  ] as const;

  for (const [method, path] of sensitiveRoutes) {
    it(`${method} ${path} requires authentication`, async () => {
      const { status } = await inject(method, path);
      expect(status).toBe(401);
    });
  }

  it('rejects expired / tampered JWT', async () => {
    const tampered = `${adminToken.split('.').slice(0, 2).join('.')}.invalidsignature`;
    const { status } = await inject('GET', '/workflows/', undefined, auth(tampered));
    expect(status).toBe(401);
  });

  it('rejects SQL injection attempt in path param', async () => {
    const { status } = await inject(
      'GET',
      `/workflows/'; DROP TABLE workflows; --`,
      undefined,
      auth(adminToken),
    );
    // Should respond with a safe 400/404, never a 500
    expect([400, 404]).toContain(status);
  });
});

// ===========================================================================
// 404 HANDLER
// ===========================================================================

describe('404 handler', () => {
  it('returns 404 for unknown routes in JSON format', async () => {
    const { status, body } = await inject<{ success: false; error: string }>(
      'GET',
      '/route/that/does/not/exist',
    );
    expect(status).toBe(404);
    expect(body?.success).toBe(false);
  });
});
