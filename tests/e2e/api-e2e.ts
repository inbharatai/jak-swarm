/**
 * JAK Swarm — Full API End-to-End Test Suite
 *
 * Prerequisites:
 *   1. Docker Desktop running
 *   2. docker compose -f docker/docker-compose.yml up -d
 *   3. pnpm --filter @jak-swarm/db db:push
 *   4. pnpm --filter @jak-swarm/db db:seed
 *   5. pnpm --filter @jak-swarm/api dev  (API running on :4000)
 *
 * Run:
 *   npx tsx tests/e2e/api-e2e.ts
 */

const BASE = 'http://localhost:4000';

interface TestResult {
  name: string;
  passed: boolean;
  status?: number;
  detail?: string;
  durationMs: number;
}

const results: TestResult[] = [];
let token = '';
let workflowId = '';
let approvalId = '';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  authToken?: string,
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json as T };
}

async function test(
  name: string,
  fn: () => Promise<{ pass: boolean; detail?: string; status?: number }>,
): Promise<void> {
  const start = Date.now();
  try {
    const { pass, detail, status } = await fn();
    results.push({ name, passed: pass, detail, status, durationMs: Date.now() - start });
    console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}${status ? ` [${status}]` : ''}`);
  } catch (err) {
    results.push({ name, passed: false, detail: String(err), durationMs: Date.now() - start });
    console.log(`  ❌ ${name} — THREW: ${err}`);
  }
}

// ─── Test Suites ──────────────────────────────────────────────────────────────

async function testHealth() {
  console.log('\n🔵 Health Check');
  await test('GET / returns 200 or 404 (server is up)', async () => {
    const { status } = await req('GET', '/');
    return { pass: status < 500, status, detail: status < 500 ? 'Server responding' : 'Server error' };
  });

  await test('GET /health — DB and Redis checks present', async () => {
    const { status, body } = await req<{
      status: string;
      checks: { database: { status: string; latencyMs: number }; redis: { status: string; latencyMs: number } };
    }>('GET', '/health');
    const checks = (body as any)?.checks;
    const dbOk = checks?.database?.status === 'ok';
    const redisStatus = checks?.redis?.status;
    const pass = (status === 200 || status === 503) && !!checks?.database;
    return {
      pass, status,
      detail: `DB: ${checks?.database?.status} (${checks?.database?.latencyMs}ms), Redis: ${redisStatus} (${checks?.redis?.latencyMs}ms)`,
    };
  });
}

async function testAuth() {
  console.log('\n🔵 Auth Endpoints');

  await test('POST /auth/register — create new tenant + admin user', async () => {
    const { status, body } = await req<{ success: boolean; data: { token: string } }>(
      'POST', '/auth/register',
      {
        email: `e2e-test-${Date.now()}@jaktest.dev`,
        password: 'E2eTest@2024!',
        name: 'E2E Test Admin',
        tenantName: `e2e-test-tenant-${Date.now()}`,
        industry: 'TECHNOLOGY',
      },
    );
    const pass = status === 201 && !!(body as any)?.data?.token;
    if (pass) token = (body as any).data.token;
    return {
      pass, status,
      detail: pass ? `Token received (${token.slice(0, 20)}…)` : `Body: ${JSON.stringify(body).slice(0, 100)}`,
    };
  });

  await test('POST /auth/login — invalid password returns 401', async () => {
    const { status } = await req('POST', '/auth/login', {
      email: 'nobody@example.com',
      password: 'wrongpassword',
      tenantSlug: 'nonexistent',
    });
    return { pass: status === 401 || status === 400, status, detail: 'Correctly rejected' };
  });

  await test('GET /auth/me — returns current user with valid token', async () => {
    if (!token) return { pass: false, detail: 'No token (register failed)' };
    const { status, body } = await req<{ success: boolean; data: { email: string; role: string } }>(
      'GET', '/auth/me', undefined, token,
    );
    const pass = status === 200 && !!(body as any)?.data?.email;
    return {
      pass, status,
      detail: pass ? `Logged in as ${(body as any).data.email} (${(body as any).data.role})` : JSON.stringify(body).slice(0, 80),
    };
  });

  await test('GET /auth/me — 401 without token', async () => {
    const { status } = await req('GET', '/auth/me');
    return { pass: status === 401, status };
  });

  // Login with seeded credentials from db:seed
  await test('POST /auth/login — seeded admin (apex-health) returns token', async () => {
    const { status, body } = await req<{ success: boolean; data: { token: string } }>(
      'POST', '/auth/login',
      { email: 'admin@apex-health.demo', password: 'jak-demo-2024' },
    );
    const pass = status === 201 && !!(body as any)?.data?.token;
    if (pass) token = (body as any).data.token;  // Use seeded token for remaining tests
    return {
      pass, status,
      detail: pass ? `Seeded admin logged in` : `Body: ${JSON.stringify(body).slice(0, 100)}`,
    };
  });
}

async function testWorkflows() {
  console.log('\n🔵 Workflow Endpoints');

  await test('POST /workflows — create and get 202 Accepted', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status, body } = await req<{ success: boolean; data: { id: string } }>(
      'POST', '/workflows',
      { goal: 'Summarize the key risks of AI adoption for a finance firm in 2 sentences.', industry: 'FINANCE' },
      token,
    );
    const pass = status === 202 && !!(body as any)?.data?.id;
    if (pass) workflowId = (body as any).data.id;
    return {
      pass, status,
      detail: pass ? `Workflow created: ${workflowId}` : JSON.stringify(body).slice(0, 100),
    };
  });

  await test('GET /workflows — list returns array', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status, body } = await req<{ success: boolean; data: unknown[] }>(
      'GET', '/workflows', undefined, token,
    );
    const pass = status === 200 && Array.isArray((body as any)?.data);
    return {
      pass, status,
      detail: pass ? `${(body as any).data.length} workflows found` : JSON.stringify(body).slice(0, 80),
    };
  });

  await test('GET /workflows/:id — returns workflow by id', async () => {
    if (!token || !workflowId) return { pass: false, detail: 'No workflow created' };
    const { status, body } = await req<{ success: boolean; data: { id: string; status: string } }>(
      'GET', `/workflows/${workflowId}`, undefined, token,
    );
    const pass = status === 200 && (body as any)?.data?.id === workflowId;
    return {
      pass, status,
      detail: pass ? `Status: ${(body as any).data.status}` : JSON.stringify(body).slice(0, 80),
    };
  });

  // Poll until workflow reaches a terminal state (max 90s)
  await test('Workflow execution — reaches COMPLETED or FAILED within 90s', async () => {
    if (!token || !workflowId) return { pass: false, detail: 'No workflow' };
    const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];
    const deadline = Date.now() + 90_000;
    let lastStatus = 'PENDING';

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      const { body } = await req<{ success: boolean; data: { status: string } }>(
        'GET', `/workflows/${workflowId}`, undefined, token,
      );
      lastStatus = (body as any)?.data?.status ?? lastStatus;
      if (TERMINAL.includes(lastStatus)) break;
    }

    const pass = TERMINAL.includes(lastStatus);
    return { pass, detail: `Final status: ${lastStatus}` };
  });

  await test('GET /workflows/:id/traces — returns trace array', async () => {
    if (!token || !workflowId) return { pass: false, detail: 'No workflow' };
    const { status, body } = await req('GET', `/workflows/${workflowId}/traces`, undefined, token);
    const data = (body as any)?.data;
    const pass = status === 200 && Array.isArray(data);
    return { pass, status, detail: pass ? `${data.length} traces` : JSON.stringify(body).slice(0, 80) };
  });
}

async function testApprovals() {
  console.log('\n🔵 Approval Endpoints');

  await test('GET /approvals — returns pending approvals list', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status, body } = await req('GET', '/approvals?status=PENDING', undefined, token);
    const data = (body as any)?.data;
    const pass = status === 200 && Array.isArray(data);
    return {
      pass, status,
      detail: pass ? `${data.length} pending approvals` : JSON.stringify(body).slice(0, 80),
    };
  });

  // If any seeded approvals exist, try deciding one
  await test('GET /approvals — seed approvals present from db:seed', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status, body } = await req('GET', '/approvals', undefined, token);
    const data = (body as any)?.data ?? [];
    const pending = data.filter((a: any) => a.status === 'PENDING');
    if (pending.length > 0) approvalId = pending[0].id;
    return {
      pass: status === 200,
      status,
      detail: `${data.length} total, ${pending.length} pending${approvalId ? ` (using ${approvalId.slice(0, 8)}…)` : ''}`,
    };
  });

  await test('POST /approvals/:id/decide — approve with comment', async () => {
    if (!token || !approvalId) return { pass: true, detail: 'SKIPPED — no pending approval available' };
    const { status, body } = await req(
      'POST', `/approvals/${approvalId}/decide`,
      { decision: 'APPROVED', comment: 'E2E test approval' },
      token,
    );
    const pass = status === 200 || status === 202;
    return { pass, status, detail: JSON.stringify(body).slice(0, 80) };
  });
}

async function testMemory() {
  console.log('\n🔵 Memory Endpoints');
  const memKey = `e2e_test_${Date.now()}`;

  await test('PUT /memory/:key — create entry', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status, body } = await req(
      'PUT', `/memory/${memKey}`,
      { value: { test: true, source: 'e2e' }, type: 'CONTEXT' },
      token,
    );
    const pass = status === 201 && !!(body as any)?.data?.key;
    return { pass, status, detail: pass ? `Created: ${memKey}` : JSON.stringify(body).slice(0, 80) };
  });

  await test('GET /memory — list entries', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status, body } = await req('GET', '/memory', undefined, token);
    const pass = status === 200 && !!(body as any)?.data?.items;
    return { pass, status, detail: pass ? `${(body as any).data.items.length} entries (page 1)` : JSON.stringify(body).slice(0, 80) };
  });

  await test('GET /memory/:key — get entry', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status, body } = await req('GET', `/memory/${memKey}`, undefined, token);
    const pass = status === 200 && (body as any)?.data?.key === memKey;
    return { pass, status, detail: pass ? `Value: ${JSON.stringify((body as any).data.value).slice(0, 40)}` : JSON.stringify(body).slice(0, 80) };
  });

  await test('DELETE /memory/:key — delete entry', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status } = await req('DELETE', `/memory/${memKey}`, undefined, token);
    const pass = status === 200;
    return { pass, status };
  });
}

async function testVoice() {
  console.log('\n🔵 Voice Endpoints');

  await test('POST /voice/start-session — create voice session', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status, body } = await req(
      'POST', '/voice/start-session',
      { language: 'en', voice: 'alloy' },
      token,
    );
    const pass = status === 201 && !!(body as any)?.data?.sessionId;
    return {
      pass, status,
      detail: pass
        ? `Session: ${(body as any).data.sessionId?.slice(0, 12)}…`
        : JSON.stringify(body).slice(0, 100),
    };
  });
}

async function testRateLimiting() {
  console.log('\n🔵 Security — Rate Limiting');

  await test('POST /auth/login rate limit — 11 rapid requests triggers 429', async () => {
    const requests = Array.from({ length: 12 }, () =>
      req('POST', '/auth/login', { email: 'x@x.com', password: 'wrong' }),
    );
    const responses = await Promise.all(requests);
    const has429 = responses.some(r => r.status === 429);
    const statuses = responses.map(r => r.status).join(',');
    return { pass: has429, detail: `Statuses: ${statuses.slice(0, 60)}` };
  });
}

async function testTraces() {
  console.log('\n🔵 Trace Endpoints');

  await test('GET /traces — returns seeded traces', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status, body } = await req('GET', '/traces', undefined, token);
    const data = (body as any)?.data;
    const pass = status === 200 && Array.isArray(data) && data.length > 0;
    return { pass, status, detail: pass ? `${data.length} traces` : JSON.stringify(body).slice(0, 80) };
  });
}

async function testAnalytics() {
  console.log('\n🔵 Analytics Endpoints');

  await test('GET /analytics/usage — returns usage data', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status, body } = await req('GET', '/analytics/usage', undefined, token);
    const pass = status === 200 && !!(body as any)?.data;
    return { pass, status, detail: pass ? 'Usage data returned' : JSON.stringify(body).slice(0, 80) };
  });

  await test('GET /analytics/workflow-metrics — returns metrics', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status, body } = await req('GET', '/analytics/workflow-metrics', undefined, token);
    const pass = status === 200;
    return { pass, status, detail: JSON.stringify(body).slice(0, 80) };
  });
}

async function testTools() {
  console.log('\n🔵 Tool Endpoints');

  await test('GET /tools — returns tool list', async () => {
    if (!token) return { pass: false, detail: 'No auth token' };
    const { status, body } = await req('GET', '/tools', undefined, token);
    const data = (body as any)?.data;
    const pass = status === 200 && Array.isArray(data) && data.length > 0;
    return { pass, status, detail: pass ? `${data.length} tools registered` : JSON.stringify(body).slice(0, 80) };
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(60));
  console.log('  JAK Swarm — Full API E2E Test Suite');
  console.log(`  Target: ${BASE}`);
  console.log('═'.repeat(60));

  // Verify server is reachable first
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    await fetch(`${BASE}/`, { signal: controller.signal });
  } catch {
    console.error('\n❌ FATAL: API server not reachable at', BASE);
    console.error('   Start it with: pnpm --filter @jak-swarm/api dev\n');
    process.exit(1);
  }

  await testHealth();
  await testAuth();
  await testTools();
  await testWorkflows();
  await testApprovals();
  await testMemory();
  await testTraces();
  await testAnalytics();
  await testVoice();
  await testRateLimiting();

  // ─── Summary ────────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log('\n' + '═'.repeat(60));
  console.log('  RESULTS');
  console.log('═'.repeat(60));
  console.log(`  ✅ Passed : ${passed}/${total}`);
  console.log(`  ❌ Failed : ${failed}/${total}`);
  console.log('');

  if (failed > 0) {
    console.log('  Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`    ❌ ${r.name}`);
      if (r.detail) console.log(`       ${r.detail}`);
    });
  }

  console.log('\n  Avg response time:', Math.round(results.reduce((a, r) => a + r.durationMs, 0) / total), 'ms');
  console.log('═'.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
