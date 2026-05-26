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
      console.log('Total traces from API:', result.json?.data?.traces?.length);
      break;
    }
    await new Promise(r => setTimeout(r, 5000));
  }

  // Fetch traces
  const traces = await call(`/workflows/${workflowId}`, { headers: authHeader(token) });
  const traceList = traces.json?.data?.traces || [];
  console.log('\n=== TRACES ===');
  console.log('Total traces:', traceList.length);
  for (const t of traceList) {
    console.log(`\nRole: ${t.agentRole} | Step: ${t.stepIndex} | Status: ${t.status}`);
    const outStr = t.output != null ? JSON.stringify(t.output).slice(0, 800) : '(null/undefined output)';
    console.log('Output preview:', outStr);
    if (t.error) {
      console.log('Error:', JSON.stringify(t.error).slice(0, 500));
    }
  }

  // Also print raw JSON for analysis
  console.log('\n=== RAW TRACE ROLES ===');
  console.log(JSON.stringify(traceList.map(t => ({ role: t.agentRole, step: t.stepIndex, status: t.status, hasOutput: t.output != null, hasError: t.error != null }))));
}

main().catch(e => { console.error('Script error:', e); process.exit(1); });
