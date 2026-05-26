const baseUrl = 'https://jak-swarm-api-production.up.railway.app';
const ROLES = ['ceo', 'cto', 'cmo', 'code', 'research', 'design', 'auto', 'legal'];

async function call(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text };
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function testRole(role) {
  const unique = Date.now() + Math.floor(Math.random() * 1000);
  const email = `smoke-${role}-${unique}@jaktest.dev`;
  const password = 'SmokePass123!';

  // Register
  const register = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name: 'Smoke', tenantName: `Smoke ${unique}`, tenantSlug: `smoke-${unique}` }),
  });
  if (register.status !== 201 || !register.json?.data?.token) {
    return { role, ok: false, error: `register failed: ${register.status}` };
  }
  const token = register.json.data.token;

  // Create workflow
  const create = await call('/workflows', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ goal: 'www.jakswarm.com, just review the website', roleModes: [role] }),
  });
  const workflowId = create.json?.data?.workflowId || create.json?.data?.id;
  if (!workflowId) {
    return { role, ok: false, error: `create failed: ${create.status}` };
  }

  // Poll until terminal
  const deadline = Date.now() + 180000;
  let status = 'PENDING';
  let finalOutput = null;
  let traceCount = 0;
  while (Date.now() < deadline) {
    const result = await call(`/workflows/${workflowId}`, { headers: authHeader(token) });
    status = result.json?.data?.status || status;
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) {
      finalOutput = result.json?.data?.finalOutput;
      traceCount = result.json?.data?.traces?.length ?? 0;
      break;
    }
    await new Promise(r => setTimeout(r, 5000));
  }

  const isStub = !finalOutput ||
    finalOutput.includes('trouble understanding') ||
    finalOutput.includes('I\'m not sure') ||
    finalOutput.includes('no current system details') ||
    finalOutput.length < 50;

  return { role, ok: status === 'COMPLETED' && !isStub, status, traceCount, finalOutputLength: finalOutput?.length ?? 0, isStub };
}

async function main() {
  console.log('Multi-role smoke test starting...\n');
  const results = [];
  for (const role of ROLES) {
    const result = await testRole(role);
    results.push(result);
    console.log(`${result.ok ? '✅' : '❌'} ${role.toUpperCase()} — status: ${result.status}, traces: ${result.traceCount}, stub: ${result.isStub}${result.error ? ', error: ' + result.error : ''}`);
  }

  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  console.log(`Passed: ${passed.length}/${ROLES.length}`);
  if (failed.length > 0) {
    console.log('Failed roles:', failed.map(r => r.role).join(', '));
  }
}

main().catch(e => { console.error('Script error:', e); process.exit(1); });
