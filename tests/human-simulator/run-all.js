#!/usr/bin/env node
/**
 * JAK Swarm — Human Simulator Test Suite
 *
 * 3 simulated users test the platform end-to-end like real humans:
 *
 *   SARAH (CEO)      — strategy, research, content, finance, PR
 *   DEV (Engineer)    — code, architecture, files, PDF, project mgmt
 *   MAYA (Marketing)  — SEO, social, leads, email sequences, analytics
 *
 * Usage: OPENAI_API_KEY=sk-... node tests/human-simulator/run-all.js
 */

const path = require('path');

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.error('\n  ERROR: Set OPENAI_API_KEY environment variable\n');
  process.exit(1);
}

// Load compiled packages
const { toolRegistry } = require(path.resolve(__dirname, '../../packages/tools/dist/index.js'));
const agents = require(path.resolve(__dirname, '../../packages/agents/dist/index.js'));

const results = [];
const globalStart = Date.now();

async function test(agentName, testName, fn) {
  const t0 = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT (60s)')), 60000)),
    ]);
    const ms = Date.now() - t0;
    results.push({ agent: agentName, name: testName, passed: true, ms });
    console.log(`  \x1b[32m✓\x1b[0m ${testName} \x1b[90m(${(ms / 1000).toFixed(1)}s)\x1b[0m`);
    return result;
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err.message ? err.message.slice(0, 80) : String(err).slice(0, 80);
    results.push({ agent: agentName, name: testName, passed: false, ms, error: msg });
    console.log(`  \x1b[31m✗\x1b[0m ${testName} \x1b[90m(${(ms / 1000).toFixed(1)}s)\x1b[0m — ${msg}`);
    return null;
  }
}

function makeCtx() {
  return new agents.AgentContext({ tenantId: 'sim_tenant', userId: 'sim_user', workflowId: 'sim_wf_' + Date.now() });
}
const toolCtx = { tenantId: 'sim_t', userId: 'sim_u', workflowId: 'sim_w', runId: 'sim_r' };

// ════════════════════════════════════════════════════════════════
//  SARAH — CEO / Founder
// ════════════════════════════════════════════════════════════════
async function runSarah() {
  console.log('\n\x1b[1m👩‍💼 SARAH (CEO / Founder)\x1b[0m\n');

  await test('Sarah', 'Strategic analysis', async () => {
    const a = new agents.StrategistAgent();
    const r = await a.execute({ action: 'STRATEGIC_ANALYSIS', question: 'Should we enter the healthcare AI market?', industry: 'TECHNOLOGY' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'Competitor research (web search)', async () => {
    const a = new agents.ResearchAgent();
    const r = await a.execute({ query: 'Top 3 AI agent platforms features and pricing 2024', maxSources: 3 }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'Board summary (content)', async () => {
    const a = new agents.ContentAgent();
    const r = await a.execute({ action: 'WRITE_BLOG', topic: 'Q1 company highlights and Q2 strategic priorities', audience: 'Board of directors' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'Financial model (unit economics)', async () => {
    const a = new agents.FinanceAgent();
    const r = await a.execute({ action: 'FINANCIAL_MODEL', question: 'Unit economics for SaaS: 500 customers, $100/mo, 5% churn, $200 CAC', data: { mrr: 50000, churnRate: 0.05 } }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'Press release draft', async () => {
    const a = new agents.PRAgent();
    const r = await a.execute({ action: 'DRAFT_PRESS_RELEASE', topic: 'JAK Swarm launches AI platform with 33 autonomous agents', company: 'JAK Technologies' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'Legal compliance checklist', async () => {
    const a = new agents.LegalAgent();
    const r = await a.execute({ action: 'COMPLIANCE_CHECKLIST', industry: 'SaaS', description: 'GDPR compliance requirements' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'Tool: web_search', async () => {
    const r = await toolRegistry.execute('web_search', { query: 'AI agent market size 2024' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Sarah', 'Tool: compute_statistics', async () => {
    const r = await toolRegistry.execute('compute_statistics', { values: [45000, 48000, 52000, 49000, 55000, 58000, 62000] }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });
}

// ════════════════════════════════════════════════════════════════
//  DEV — Senior Engineer
// ════════════════════════════════════════════════════════════════
async function runDev() {
  console.log('\n\x1b[1m👨‍💻 DEV (Senior Engineer)\x1b[0m\n');

  await test('Dev', 'Code generation (TypeScript)', async () => {
    const a = new agents.CoderAgent();
    const r = await a.execute({ action: 'WRITE_CODE', requirements: 'Write a TypeScript function that validates email addresses using regex and returns {valid, reason}', language: 'typescript' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Dev', 'Architecture review', async () => {
    const a = new agents.TechnicalAgent();
    const r = await a.execute({ action: 'ARCHITECTURE_REVIEW', question: 'Evaluate microservices vs monolith for a team of 5 building an AI SaaS' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Dev', 'Tool: code_execute (JavaScript)', async () => {
    const r = await toolRegistry.execute('code_execute', {
      code: 'const fib=(n)=>n<=1?n:fib(n-1)+fib(n-2); JSON.stringify({fib10:fib(10),fib15:fib(15)})',
      language: 'javascript',
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    if (data.result && JSON.parse(data.result).fib10 !== 55) throw new Error('Wrong fib(10)');
  });

  await test('Dev', 'Tool: file write + read round-trip', async () => {
    const content = '// Generated by JAK test agent\nconst x = 42;\nconsole.log(x);';
    const w = await toolRegistry.execute('file_write', { path: 'sim_test_output.js', content }, toolCtx);
    if (!w.success) throw new Error('Write: ' + w.error);
    const rd = await toolRegistry.execute('file_read', { path: 'sim_test_output.js' }, toolCtx);
    if (!rd.success) throw new Error('Read: ' + rd.error);
  });

  await test('Dev', 'Tool: PDF text extraction', async () => {
    const r = await toolRegistry.execute('pdf_extract_text', {
      source: 'https://www.africau.edu/images/default/sample.pdf',
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
    if (!r.data || !r.data.text || r.data.text.trim().length === 0) throw new Error('No text extracted');
  });

  await test('Dev', 'Project timeline estimation', async () => {
    const a = new agents.ProjectAgent();
    const r = await a.execute({ action: 'ESTIMATE_TIMELINE', projectName: 'API v2 Migration', description: 'Migrate 15 endpoints from Express to Fastify, add OpenAPI docs, write tests' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Dev', 'Feature spec (ProductAgent)', async () => {
    const a = new agents.ProductAgent();
    const r = await a.execute({ action: 'WRITE_SPEC', feature: 'Real-time collaborative editing', targetUser: 'Enterprise teams' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Dev', 'Tool: web_fetch (API endpoint)', async () => {
    const r = await toolRegistry.execute('web_fetch', { url: 'https://httpbin.org/json' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });
}

// ════════════════════════════════════════════════════════════════
//  MAYA — Marketing Director
// ════════════════════════════════════════════════════════════════
async function runMaya() {
  console.log('\n\x1b[1m👩‍🎨 MAYA (Marketing Director)\x1b[0m\n');

  await test('Maya', 'LinkedIn post (social content)', async () => {
    const a = new agents.ContentAgent();
    const r = await a.execute({ action: 'WRITE_SOCIAL', topic: 'How AI is transforming small business operations', platform: 'linkedin' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Maya', 'SEO content gap analysis', async () => {
    const a = new agents.SEOAgent();
    const r = await a.execute({ action: 'CONTENT_GAP_ANALYSIS', keyword: 'AI automation for business' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Maya', 'Tool: score_lead', async () => {
    const r = await toolRegistry.execute('score_lead', { name: 'Jane Smith', company: 'TechCorp', title: 'VP Engineering', industry: 'SaaS' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Maya', 'Tool: create_email_sequence', async () => {
    const r = await toolRegistry.execute('create_email_sequence', {
      name: 'Product Launch',
      steps: [
        { subject: 'Big news from JAK', body: 'We just launched...', delayDays: 0 },
        { subject: 'Did you see?', body: 'In case you missed it...', delayDays: 3 },
      ],
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Maya', 'Tool: research_keywords', async () => {
    const r = await toolRegistry.execute('research_keywords', { seed_keyword: 'AI automation' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Maya', 'Tool: audit_seo (example.com)', async () => {
    const r = await toolRegistry.execute('audit_seo', { url: 'https://example.com' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Maya', 'Competitor messaging (MarketingAgent)', async () => {
    const a = new agents.MarketingAgent();
    const r = await a.execute({ action: 'COMPETITIVE_MESSAGING', brief: 'Analyze competitor positioning for AI agent platforms and find messaging gaps', industry: 'TECHNOLOGY' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Maya', 'Trend analysis (AnalyticsAgent)', async () => {
    const a = new agents.AnalyticsAgent();
    const r = await a.execute({ action: 'TREND_ANALYSIS', query: 'SaaS adoption and growth metrics trends' }, makeCtx());
    if (!r) throw new Error('No result');
  });
}

// ════════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n\x1b[1m╔═══════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[1m║   JAK SWARM — Human Simulator Test Suite              ║\x1b[0m');
  console.log('\x1b[1m║   3 Users × 8 Tests = 24 End-to-End Scenarios         ║\x1b[0m');
  console.log('\x1b[1m╚═══════════════════════════════════════════════════════╝\x1b[0m');

  await runSarah();
  await runDev();
  await runMaya();

  // Scorecard
  const totalMs = Date.now() - globalStart;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('\n\x1b[1m╔═══════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[1m║                    SCORECARD                          ║\x1b[0m');
  console.log('\x1b[1m╠═══════════════════════════════════════════════════════╣\x1b[0m');

  for (const name of ['Sarah', 'Dev', 'Maya']) {
    const ar = results.filter(r => r.agent === name);
    const ap = ar.filter(r => r.passed).length;
    const emoji = name === 'Sarah' ? '👩‍💼' : name === 'Dev' ? '👨‍💻' : '👩‍🎨';
    const bar = '█'.repeat(ap) + '░'.repeat(ar.length - ap);
    console.log(`\x1b[1m║\x1b[0m  ${emoji} ${name.padEnd(7)} ${bar} ${ap}/${ar.length}                       \x1b[1m║\x1b[0m`);
  }

  console.log('\x1b[1m╠═══════════════════════════════════════════════════════╣\x1b[0m');
  const pct = ((passed / (passed + failed)) * 100).toFixed(0);
  const status = failed === 0 ? '\x1b[32mALL PASSED\x1b[0m' : `\x1b[31m${failed} FAILED\x1b[0m`;
  console.log(`\x1b[1m║\x1b[0m  Total: ${passed}/${passed + failed} (${pct}%) | ${status} | ${(totalMs / 1000).toFixed(0)}s        \x1b[1m║\x1b[0m`);
  console.log('\x1b[1m╚═══════════════════════════════════════════════════════╝\x1b[0m');

  if (failed > 0) {
    console.log('\n\x1b[31mFailed tests:\x1b[0m');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ✗ [${r.agent}] ${r.name}: ${r.error}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
