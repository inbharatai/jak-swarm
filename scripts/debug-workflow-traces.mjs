const baseUrl = 'https://jak-swarm-api-production.up.railway.app';

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

async function main() {
  const unique = Date.now();
  const email = `debug-${unique}@jaktest.dev`;
  const password = 'DebugPass123!';

  const register = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name: 'Debug', tenantName: `Debug ${unique}`, tenantSlug: `debug-${unique}` }),
  });
  if (register.status !== 201 || !register.json?.data?.token) {
    console.error('REGISTER_FAILED:', register.status, register.text.slice(0, 200));
    return;
  }
  const token = register.json.data.token;

  const create = await call('/workflows', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ goal: 'www.jakswarm.com, just review the website', roleModes: ['cto'] }),
  });
  const workflowId = create.json?.data?.workflowId || create.json?.data?.id;
  console.log('Workflow created:', workflowId, 'status:', create.status);

  // Poll until terminal
  const deadline = Date.now() + 180000;
  let status = 'PENDING';
  while (Date.now() < deadline) {
    const result = await call(`/workflows/${workflowId}`, { headers: authHeader(token) });
    status = result.json?.data?.status || status;
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) {
      console.log('Terminal status:', status);
      console.log('finalOutput:', result.json?.data?.finalOutput);
      console.log('error:', result.json?.data?.error);
      break;
    }
    await new Promise(r => setTimeout(r, 5000));
  }

  // Fetch traces
  const traces = await call(`/workflows/${workflowId}`, { headers: authHeader(token) });
  console.log('\n=== TRACES ===');
  for (const t of traces.json?.data?.traces || []) {
    console.log(`\nRole: ${t.agentRole} | Step: ${t.stepIndex} | Status: ${t.status}`);
    console.log('Output preview:', JSON.stringify(t.output).slice(0, 500));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
