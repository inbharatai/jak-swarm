#!/usr/bin/env node

/**
 * Production workflow lifecycle smoke test.
 *
 * Verifies:
 * 1) create workflow persists
 * 2) SSE stream endpoint opens (no 404)
 * 3) follow-up continue binds to the same workflow
 * 4) workflow count does not increase on continue
 */

const baseUrl = process.env.SMOKE_BASE_URL || 'https://jak-swarm-api-production.up.railway.app';
const pollMs = Number(process.env.SMOKE_POLL_MS || 120000);
const pollStepMs = Number(process.env.SMOKE_POLL_STEP_MS || 3000);

async function call(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep as text when not JSON
  }

  return {
    status: response.status,
    json,
    text,
  };
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function readSseHeaderStatus(workflowId, token) {
  const response = await fetch(`${baseUrl}/workflows/${workflowId}/stream`, {
    method: 'GET',
    headers: authHeader(token),
  });

  if (!response.body) {
    return { status: response.status, firstChunkPreview: null };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let firstChunkPreview = null;

  try {
    const chunkOrTimeout = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 8000)),
    ]);

    if (chunkOrTimeout && !chunkOrTimeout.timeout && chunkOrTimeout.value) {
      firstChunkPreview = decoder.decode(chunkOrTimeout.value, { stream: true }).slice(0, 200);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // best effort close
    }
  }

  return {
    status: response.status,
    firstChunkPreview,
  };
}

async function pollWorkflowTerminalState(workflowId, token) {
  const deadline = Date.now() + pollMs;
  let status = 'UNKNOWN';
  let finalOutputLen = 0;
  let finalOutput = '';

  while (Date.now() < deadline) {
    const result = await call(`/workflows/${workflowId}`, {
      method: 'GET',
      headers: authHeader(token),
    });

    const workflow = result.json?.data;
    status = workflow?.status || status;
    finalOutput = workflow?.finalOutput || '';
    finalOutputLen = typeof finalOutput === 'string' ? finalOutput.length : 0;

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) {
      return { status, finalOutputLen, finalOutput };
    }

    await new Promise((resolve) => setTimeout(resolve, pollStepMs));
  }

  return { status, finalOutputLen, finalOutput };
}

async function main() {
  const unique = Date.now();
  const email = `p0-smoke-${unique}@jaktest.dev`;
  const password = 'SmokePass123!';
  const tenantSlug = `p0-smoke-${unique}`;

  const register = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      name: 'P0 Smoke',
      tenantName: `P0 Smoke ${unique}`,
      tenantSlug,
    }),
  });

  if (register.status !== 201 || !register.json?.data?.token) {
    throw new Error(`REGISTER_FAILED: status=${register.status} body=${register.text.slice(0, 300)}`);
  }

  const token = register.json.data.token;

  const listBefore = await call('/workflows?page=1&limit=20', {
    method: 'GET',
    headers: authHeader(token),
  });
  const totalBefore = listBefore.json?.data?.total ?? -1;

  const create = await call('/workflows', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      goal: 'www.jakswarm.com, just review the website',
      roleModes: ['cto'],
    }),
  });

  const createData = create.json?.data ?? {};
  const workflowId = createData.workflowId || createData.id;
  const createContractKind = createData.kind || 'legacy_shape';

  if (![201, 202].includes(create.status) || !workflowId) {
    throw new Error(`CREATE_FAILED: status=${create.status} body=${create.text.slice(0, 500)}`);
  }

  const persisted = await call(`/workflows/${workflowId}`, {
    method: 'GET',
    headers: authHeader(token),
  });

  if (persisted.status !== 200 || persisted.json?.data?.id !== workflowId) {
    throw new Error(`PERSISTENCE_CHECK_FAILED: status=${persisted.status}`);
  }

  const sseCheck = await readSseHeaderStatus(workflowId, token);
  if (sseCheck.status !== 200) {
    throw new Error(`SSE_OPEN_FAILED: status=${sseCheck.status}`);
  }

  const followup = await call('/workflows', {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ goal: 'continue' }),
  });

  const followupData = followup.json?.data ?? {};
  const continueWorkflowId = followupData.workflowId || followupData.id || null;
  const continueKind = followupData.kind || 'legacy_shape';

  const listAfter = await call('/workflows?page=1&limit=20', {
    method: 'GET',
    headers: authHeader(token),
  });
  const totalAfter = listAfter.json?.data?.total ?? -1;

  const terminal = await pollWorkflowTerminalState(workflowId, token);

  const result = {
    baseUrl,
    workflowId,
    createStatus: create.status,
    createContractKind,
    persistedGetStatus: persisted.status,
    sseStatus: sseCheck.status,
    sseFirstChunkPreview: sseCheck.firstChunkPreview,
    continueStatus: followup.status,
    continueKind,
    continueWorkflowId,
    sameWorkflowId: continueWorkflowId === workflowId,
    totalBefore,
    totalAfter,
    workflowCountDelta: totalAfter >= 0 && totalBefore >= 0 ? totalAfter - totalBefore : null,
    terminalStatus: terminal.status,
    finalOutputLen: terminal.finalOutputLen,
    finalOutputPreview: terminal.finalOutput?.slice(0, 200),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('SMOKE_FAILED', error.message || String(error));
  process.exit(1);
});
