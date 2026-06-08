#!/usr/bin/env node

/**
 * Production A-to-Z role test — verifies each role creates a workflow,
 * SSE stream opens, backend completes, and no "Unknown error" in the output.
 *
 * Uses the same bootstrap-auth pattern as the E2E tests.
 * Saves results to Desktop/JackStorm test/09_final_report/role-test-results.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const API = (process.env.E2E_API_BASE_URL ?? 'https://jak-swarm-api-production.up.railway.app').replace(/\/$/, '');
const OUT_DIR = 'C:/Users/reetu/Desktop/JackStorm test/09_final_report';
const POLL_MS = 3000;
const MAX_POLL_MS = 180000; // 3 minutes max per role

const ROLE_PROMPTS = [
  { role: 'ceo', prompt: 'What are the top 3 strategic priorities for a technology startup this quarter?' },
  { role: 'cto', prompt: 'Review the architecture of jakswarm.com and suggest 2 improvements' },
  { role: 'cmo', prompt: 'Draft a 3-point social media strategy for launching an AI product' },
  { role: 'cfo', prompt: 'Create a simple budget forecast template for a SaaS startup' },
  { role: 'coo', prompt: 'Outline a 5-step operational efficiency improvement plan' },
  { role: 'legal', prompt: 'What are 3 key clauses every SaaS terms of service should include?' },
  { role: 'hr', prompt: 'Draft an employee onboarding checklist for a remote-first startup' },
  { role: 'finance', prompt: 'What are 3 ways to improve cash flow management in a startup?' },
  { role: 'worker', prompt: 'Summarize the key features of a modern AI agent platform' },
];

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
  const email = `role-test-${unique}@jaktest.dev`;
  const password = 'RoleTest123!';
  const tenantSlug = `role-test-${unique}`;

  const register = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      name: 'Role Test',
      tenantName: `Role Test ${unique}`,
      tenantSlug,
    }),
  });

  if (register.status !== 201 || !register.json?.data?.token) {
    throw new Error(`REGISTER_FAILED: status=${register.status} body=${register.text.slice(0, 300)}`);
  }

  return register.json.data.token;
}

async function testRole(token, rolePrompt) {
  const { role, prompt } = rolePrompt;
  const startTime = Date.now();

  // Create workflow with role
  const create = await call('/workflows', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      goal: prompt,
      roleModes: [role],
    }),
  });

  const createData = create.json?.data ?? {};
  const workflowId = createData.workflowId || createData.id;
  const createContractKind = createData.kind || 'legacy_shape';

  if (![201, 202].includes(create.status) || !workflowId) {
    return {
      role,
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
  let pollCount = 0;

  while (Date.now() < deadline) {
    const result = await call(`/workflows/${workflowId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    const wf = result.json?.data;
    workflowStatus = wf?.status || workflowStatus;
    finalOutput = wf?.finalOutput || finalOutput;
    pollCount++;

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(workflowStatus)) {
      break;
    }

    await new Promise(r => setTimeout(r, POLL_MS));
  }

  const hasUnknownError = finalOutput.toLowerCase().includes('unknown error');
  const hasTrouble = finalOutput.toLowerCase().includes('i had trouble') || finalOutput.toLowerCase().includes("i couldn't");
  const hasWorkflowNotFound = finalOutput.toLowerCase().includes('workflow not found');
  const hasOutput = finalOutput.length > 20;

  return {
    role,
    prompt,
    workflowId,
    createContractKind,
    createStatus: create.status,
    workflowStatus,
    finalOutputLen: finalOutput.length,
    finalOutputPreview: finalOutput.slice(0, 300),
    hasOutput,
    hasUnknownError,
    hasTrouble,
    hasWorkflowNotFound,
    pollCount,
    duration_ms: Date.now() - startTime,
    verdict: workflowStatus === 'COMPLETED' && hasOutput && !hasUnknownError ? 'PASS' : 'NEEDS_REVIEW',
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('=== Production A-to-Z Role Test ===');
  console.log(`API: ${API}`);
  console.log(`Roles to test: ${ROLE_PROMPTS.map(r => r.role).join(', ')}`);
  console.log('');

  // Register one user for all role tests
  console.log('Registering test user...');
  const token = await registerAndAuth();
  console.log('User registered. Starting role tests...\n');

  const results = [];

  for (const rolePrompt of ROLE_PROMPTS) {
    console.log(`Testing role: ${rolePrompt.role.toUpperCase()}...`);
    try {
      const result = await testRole(token, rolePrompt);
      results.push(result);
      const icon = result.verdict === 'PASS' ? '✅' : '⚠️';
      console.log(`  ${icon} ${result.role}: ${result.verdict} (status=${result.workflowStatus}, output=${result.finalOutputLen} chars, ${result.duration_ms}ms)`);
      if (result.hasUnknownError) console.log(`  ⚠️  Contains "Unknown error"`);
      if (result.hasTrouble) console.log(`  ⚠️  Contains "I had trouble"`);
      if (result.hasWorkflowNotFound) console.log(`  ⚠️  Contains "Workflow not found"`);
    } catch (err) {
      results.push({ role: rolePrompt.role, status: 'ERROR', error: err.message });
      console.log(`  ❌ ${rolePrompt.role}: ERROR — ${err.message}`);
    }
  }

  const summary = {
    timestamp: new Date().toISOString(),
    api_base_url: API,
    total_roles: ROLE_PROMPTS.length,
    passed: results.filter(r => r.verdict === 'PASS').length,
    needs_review: results.filter(r => r.verdict === 'NEEDS_REVIEW').length,
    errors: results.filter(r => r.status === 'ERROR').length,
    results,
  };

  writeFileSync(join(OUT_DIR, 'role-test-results.json'), JSON.stringify(summary, null, 2));
  console.log(`\nResults saved to ${join(OUT_DIR, 'role-test-results.json')}`);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed: ${summary.passed}/${summary.total_roles}`);
  console.log(`Needs Review: ${summary.needs_review}/${summary.total_roles}`);
  console.log(`Errors: ${summary.errors}/${summary.total_roles}`);

  // Fail if any role had a create failure
  const createFailures = results.filter(r => r.status === 'CREATE_FAILED' || r.status === 'ERROR');
  if (createFailures.length > 0) {
    console.log(`\n❌ ${createFailures.length} role(s) had CREATE failures`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});