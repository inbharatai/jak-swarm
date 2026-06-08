#!/usr/bin/env node
/**
 * Quick spot-check: register a user, create one workflow per role,
 * wait up to 90s for each, record results.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://jak-swarm-api-production.up.railway.app';
const OUT_DIR = 'C:/Users/reetu/Desktop/JackStorm test/09_final_report';
const POLL_MS = 5000;
const MAX_POLL_MS = 90000;

async function call(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text };
}

async function registerAndAuth() {
  const unique = Date.now();
  const res = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `quick-${unique}@jaktest.dev`,
      password: 'QuickTest123!',
      name: 'Quick Test',
      tenantName: `Quick Test ${unique}`,
      tenantSlug: `quick-${unique}`,
    }),
  });
  if (res.status !== 201 || !res.json?.data?.token) {
    throw new Error(`REGISTER_FAILED: ${res.status} ${res.text.slice(0, 200)}`);
  }
  return res.json.data.token;
}

const ROLES = [
  { role: 'ceo', prompt: 'List 3 strategic priorities for a tech startup this quarter' },
  { role: 'cto', prompt: 'Suggest 2 architectural improvements for a SaaS platform' },
  { role: 'cmo', prompt: 'Draft a brief social media strategy for an AI product launch' },
  { role: 'worker', prompt: 'Summarize what an AI agent platform does in 3 bullet points' },
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log('=== Quick Role Verification ===\n');

  const token = await registerAndAuth();
  console.log('User registered.\n');

  const results = [];
  for (const { role, prompt } of ROLES) {
    console.log(`Testing ${role.toUpperCase()}...`);
    const create = await call('/workflows', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ goal: prompt, roleModes: [role] }),
    });

    const createData = create.json?.data ?? {};
    const workflowId = createData.workflowId || createData.id;
    const createContractKind = createData.kind || 'legacy_shape';

    if (![201, 202].includes(create.status) || !workflowId) {
      results.push({ role, verdict: 'CREATE_FAILED', createStatus: create.status, error: create.text.slice(0, 300) });
      console.log(`  ❌ CREATE_FAILED: ${create.status}`);
      continue;
    }

    console.log(`  Created: ${workflowId} (kind=${createContractKind})`);

    // Poll for completion
    const deadline = Date.now() + MAX_POLL_MS;
    let status = 'PENDING';
    let finalOutput = '';
    while (Date.now() < deadline) {
      const r = await call(`/workflows/${workflowId}`, { headers: { Authorization: `Bearer ${token}` } });
      const wf = r.json?.data;
      status = wf?.status || status;
      finalOutput = wf?.finalOutput || finalOutput;
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) break;
      await new Promise(r => setTimeout(r, POLL_MS));
    }

    const hasUnknownError = finalOutput.toLowerCase().includes('unknown error');
    const hasTrouble = finalOutput.toLowerCase().includes('i had trouble');
    const hasOutput = finalOutput.length > 20;

    results.push({
      role,
      workflowId,
      createContractKind,
      createStatus: create.status,
      workflowStatus: status,
      finalOutputLen: finalOutput.length,
      finalOutputPreview: finalOutput.slice(0, 200),
      hasOutput,
      hasUnknownError,
      hasTrouble,
      verdict: status === 'COMPLETED' && hasOutput && !hasUnknownError ? 'PASS' : 'NEEDS_REVIEW',
    });

    const icon = results[results.length - 1].verdict === 'PASS' ? '✅' : '⚠️';
    console.log(`  ${icon} ${role}: ${results[results.length - 1].verdict} (status=${status}, output=${finalOutput.length} chars)`);
  }

  writeFileSync(join(OUT_DIR, 'role-test-results.json'), JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
  console.log(`\nSaved to ${join(OUT_DIR, 'role-test-results.json')}`);
  console.log(`\nPassed: ${results.filter(r => r.verdict === 'PASS').length}/${results.length}`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });