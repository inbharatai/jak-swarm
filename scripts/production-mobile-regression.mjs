#!/usr/bin/env node

/**
 * Mobile regression test — CEO+CMO and CTO prompts that previously
 * showed "Unknown error" on mobile. Tests via API since Playwright
 * browser setup is complex in CI.
 *
 * Verifies:
 * 1. CEO+CMO "Compile an executive summary" — no Unknown error
 * 2. CTO "review the website jakswarm.com" — no Unknown error
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const API = (process.env.E2E_API_BASE_URL ?? 'https://jak-swarm-api-production.up.railway.app').replace(/\/$/, '');
const OUT_DIR = 'C:/Users/reetu/Desktop/JackStorm test/09_final_report';
const POLL_MS = 3000;
const MAX_POLL_MS = 240000; // 4 minutes for multi-role

async function call(path, options = {}) {
  const url = `${API}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text };
}

async function registerAndAuth() {
  const unique = Date.now();
  const email = `mobile-reg-${unique}@jaktest.dev`;
  const password = 'MobileReg123!';
  const tenantSlug = `mobile-reg-${unique}`;

  const register = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      name: 'Mobile Regression',
      tenantName: `Mobile Regression ${unique}`,
      tenantSlug,
    }),
  });

  if (register.status !== 201 || !register.json?.data?.token) {
    throw new Error(`REGISTER_FAILED: status=${register.status} body=${register.text.slice(0, 300)}`);
  }

  return register.json.data.token;
}

async function testMobilePrompt(token, name, roleModes, prompt) {
  const startTime = Date.now();

  const create = await call('/workflows', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      goal: prompt,
      roleModes,
    }),
  });

  const createData = create.json?.data ?? {};
  const workflowId = createData.workflowId || createData.id;
  const createContractKind = createData.kind || 'legacy_shape';

  if (![201, 202].includes(create.status) || !workflowId) {
    return {
      name,
      status: 'CREATE_FAILED',
      createStatus: create.status,
      createBody: create.text.slice(0, 500),
      duration_ms: Date.now() - startTime,
    };
  }

  // Poll for terminal state
  const deadline = Date.now() + MAX_POLL_MS;
  let workflowStatus = 'PENDING';
  let finalOutput = '';
  let agentTraces = [];

  while (Date.now() < deadline) {
    const result = await call(`/workflows/${workflowId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    const wf = result.json?.data;
    workflowStatus = wf?.status || workflowStatus;
    finalOutput = wf?.finalOutput || finalOutput;
    agentTraces = wf?.agentTraces || agentTraces;

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(workflowStatus)) {
      break;
    }

    await new Promise(r => setTimeout(r, POLL_MS));
  }

  const outputLower = finalOutput.toLowerCase();
  const hasUnknownError = outputLower.includes('unknown error');
  const hasTrouble = outputLower.includes('i had trouble') || outputLower.includes("i couldn't");
  const hasWorkflowNotFound = outputLower.includes('workflow not found');
  const hasOutput = finalOutput.length > 20;

  return {
    name,
    prompt,
    roleModes,
    workflowId,
    createContractKind,
    createStatus: create.status,
    workflowStatus,
    finalOutputLen: finalOutput.length,
    finalOutputPreview: finalOutput.slice(0, 400),
    hasOutput,
    hasUnknownError,
    hasTrouble,
    hasWorkflowNotFound,
    agentTraceCount: agentTraces?.length ?? 0,
    duration_ms: Date.now() - startTime,
    verdict: workflowStatus === 'COMPLETED' && hasOutput && !hasUnknownError ? 'PASS' : 'NEEDS_REVIEW',
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('=== Mobile Regression Test ===');
  console.log(`API: ${API}\n`);

  // Register one user for both tests
  console.log('Registering test user...');
  const token = await registerAndAuth();
  console.log('User registered.\n');

  const tests = [
    {
      name: 'CEO+CMO Executive Summary (mobile)',
      roleModes: ['ceo', 'cmo'],
      prompt: 'Compile an executive summary of the last 30 days of activity',
    },
    {
      name: 'CTO Website Review (mobile)',
      roleModes: ['cto'],
      prompt: 'Review the website jakswarm.com and identify 3 key improvements',
    },
  ];

  const results = [];

  for (const t of tests) {
    console.log(`Testing: ${t.name}...`);
    try {
      const result = await testMobilePrompt(token, t.name, t.roleModes, t.prompt);
      results.push(result);
      const icon = result.verdict === 'PASS' ? '✅' : '⚠️';
      console.log(`  ${icon} ${result.name}: ${result.verdict}`);
      console.log(`     Status: ${result.workflowStatus}, Output: ${result.finalOutputLen} chars, Duration: ${(result.duration_ms / 1000).toFixed(1)}s`);
      if (result.hasUnknownError) console.log('     ⚠️ Contains "Unknown error"');
      if (result.hasTrouble) console.log('     ⚠️ Contains "I had trouble"');
      if (result.hasWorkflowNotFound) console.log('     ⚠️ Contains "Workflow not found"');
    } catch (err) {
      results.push({ name: t.name, status: 'ERROR', error: err.message });
      console.log(`  ❌ ${t.name}: ERROR — ${err.message}`);
    }
  }

  const summary = {
    timestamp: new Date().toISOString(),
    api_base_url: API,
    tests: results,
    passed: results.filter(r => r.verdict === 'PASS').length,
    needs_review: results.filter(r => r.verdict === 'NEEDS_REVIEW').length,
    errors: results.filter(r => r.status === 'ERROR').length,
  };

  writeFileSync(join(OUT_DIR, 'mobile-regression-results.json'), JSON.stringify(summary, null, 2));
  console.log(`\nResults saved to ${join(OUT_DIR, 'mobile-regression-results.json')}`);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed: ${summary.passed}/${tests.length}`);
  console.log(`Needs Review: ${summary.needs_review}/${tests.length}`);
  console.log(`Errors: ${summary.errors}/${tests.length}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});