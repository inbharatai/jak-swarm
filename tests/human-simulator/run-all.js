#!/usr/bin/env node
/**
 * JAK Swarm — Human Simulator Test Suite
 *
 * 5 simulated users test the platform end-to-end like real humans:
 *
 *   SARAH (CEO)            — strategy, research, content, finance, PR, legal
 *   DEV (Engineer)         — code, architecture, files, PDF, project mgmt
 *   MAYA (Marketing)       — SEO, social, leads, email sequences, analytics
 *   ALEX (Operations)      — email verify, dedup, churn, winback, HR, CS
 *   BROWSER BOT (Automation) — navigate, text, screenshot, type, keys, scroll, JS, wait
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
    console.log(`  \x1b[32m\u2713\x1b[0m ${testName} \x1b[90m(${(ms / 1000).toFixed(1)}s)\x1b[0m`);
    return result;
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err.message ? err.message.slice(0, 80) : String(err).slice(0, 80);
    results.push({ agent: agentName, name: testName, passed: false, ms, error: msg });
    console.log(`  \x1b[31m\u2717\x1b[0m ${testName} \x1b[90m(${(ms / 1000).toFixed(1)}s)\x1b[0m \u2014 ${msg}`);
    return null;
  }
}

function makeCtx() {
  return new agents.AgentContext({ tenantId: 'sim_tenant', userId: 'sim_user', workflowId: 'sim_wf_' + Date.now() });
}
const toolCtx = { tenantId: 'sim_t', userId: 'sim_u', workflowId: 'sim_w', runId: 'sim_r' };

// ════════════════════════════════════════════════════════════════
//  SARAH — CEO / Founder (8 tests)
// ════════════════════════════════════════════════════════════════
async function runSarah() {
  console.log('\n\x1b[1m\ud83d\udc69\u200d\ud83d\udcbc SARAH (CEO / Founder)\x1b[0m\n');

  await test('Sarah', 'Strategic analysis (StrategistAgent)', async () => {
    const a = new agents.StrategistAgent();
    const r = await a.execute({ action: 'STRATEGIC_ANALYSIS', question: 'Should we enter the healthcare AI market?', industry: 'TECHNOLOGY' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'Competitor research (ResearchAgent)', async () => {
    const a = new agents.ResearchAgent();
    const r = await a.execute({ query: 'Top 3 AI agent platforms features and pricing 2024', maxSources: 3 }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'Board summary (ContentAgent blog)', async () => {
    const a = new agents.ContentAgent();
    const r = await a.execute({ action: 'WRITE_BLOG', topic: 'Q1 company highlights and Q2 strategic priorities', audience: 'Board of directors' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'Financial model (FinanceAgent)', async () => {
    const a = new agents.FinanceAgent();
    const r = await a.execute({ action: 'FINANCIAL_MODEL', question: 'Unit economics for SaaS: 500 customers, $100/mo, 5% churn, $200 CAC', data: { mrr: 50000, churnRate: 0.05 } }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'Press release draft (PRAgent)', async () => {
    const a = new agents.PRAgent();
    const r = await a.execute({ action: 'DRAFT_PRESS_RELEASE', topic: 'JAK Swarm launches AI platform with 33 autonomous agents', company: 'JAK Technologies' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'Legal compliance checklist (LegalAgent)', async () => {
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
//  DEV — Senior Engineer (8 tests)
// ════════════════════════════════════════════════════════════════
async function runDev() {
  console.log('\n\x1b[1m\ud83d\udc68\u200d\ud83d\udcbb DEV (Senior Engineer)\x1b[0m\n');

  await test('Dev', 'Code generation (CoderAgent)', async () => {
    const a = new agents.CoderAgent();
    const r = await a.execute({ action: 'WRITE_CODE', requirements: 'Write a TypeScript function that validates email addresses using regex and returns {valid, reason}', language: 'typescript' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Dev', 'Architecture review (TechnicalAgent)', async () => {
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

  await test('Dev', 'Tool: file_write + file_read round-trip', async () => {
    const content = '// Generated by JAK test agent\nconst x = 42;\nconsole.log(x);';
    const w = await toolRegistry.execute('file_write', { path: 'sim_test_output.js', content }, toolCtx);
    if (!w.success) throw new Error('Write: ' + w.error);
    const rd = await toolRegistry.execute('file_read', { path: 'sim_test_output.js' }, toolCtx);
    if (!rd.success) throw new Error('Read: ' + rd.error);
  });

  await test('Dev', 'Tool: pdf_extract_text', async () => {
    const r = await toolRegistry.execute('pdf_extract_text', {
      source: 'https://www.africau.edu/images/default/sample.pdf',
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
    // Note: most test PDFs are image-based (no extractable text layer).
    // We verify the tool runs without crashing and returns a result object.
    if (!r.data) throw new Error('No data returned');
  });

  await test('Dev', 'Project timeline estimation (ProjectAgent)', async () => {
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
//  MAYA — Marketing Director (8 tests)
// ════════════════════════════════════════════════════════════════
async function runMaya() {
  console.log('\n\x1b[1m\ud83d\udc69\u200d\ud83c\udfa8 MAYA (Marketing Director)\x1b[0m\n');

  await test('Maya', 'LinkedIn post (ContentAgent social)', async () => {
    const a = new agents.ContentAgent();
    const r = await a.execute({ action: 'WRITE_SOCIAL', topic: 'How AI is transforming small business operations', platform: 'linkedin' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Maya', 'SEO content gap analysis (SEOAgent)', async () => {
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
//  ALEX — Operations Manager (8 tests)
// ════════════════════════════════════════════════════════════════
async function runAlex() {
  console.log('\n\x1b[1m\ud83d\udcca ALEX (Operations Manager)\x1b[0m\n');

  await test('Alex', 'Tool: verify_email', async () => {
    const r = await toolRegistry.execute('verify_email', { email: 'contact@google.com' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Alex', 'Tool: deduplicate_contacts', async () => {
    const r = await toolRegistry.execute('deduplicate_contacts', {
      contacts: [
        { name: 'John Smith', email: 'john@acme.com' },
        { name: 'J. Smith', email: 'john@acme.com' },
        { name: 'Jane Doe', email: 'jane@other.com' },
      ],
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Alex', 'Tool: predict_churn', async () => {
    const r = await toolRegistry.execute('predict_churn', { engagementScore: 25, daysSinceLastLogin: 60 }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Alex', 'Tool: generate_winback', async () => {
    const r = await toolRegistry.execute('generate_winback', { customerName: 'Acme Corp', churnReason: 'pricing too high' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Alex', 'Tool: generate_report', async () => {
    const r = await toolRegistry.execute('generate_report', { reportType: 'summary', title: 'Weekly Ops', data: { uptime: 99.9, incidents: 2 } }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Alex', 'HR onboarding plan (HRAgent)', async () => {
    const a = new agents.HRAgent();
    const r = await a.execute({ action: 'ONBOARDING_PLAN', request: 'Create onboarding plan for a new senior engineer starting Monday' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Alex', 'Customer health score (SuccessAgent)', async () => {
    const a = new agents.SuccessAgent();
    const r = await a.execute({ action: 'SCORE_HEALTH', customerName: 'Acme Corp', industry: 'SaaS' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Alex', 'Tool: classify_text', async () => {
    const r = await toolRegistry.execute('classify_text', {
      text: 'The product keeps crashing and I want a refund',
      categories: ['complaint', 'bug_report', 'feature_request', 'billing'],
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });
}

// ════════════════════════════════════════════════════════════════
//  BROWSER BOT — Automation Tester (8 tests)
// ════════════════════════════════════════════════════════════════
async function runBrowserBot() {
  console.log('\n\x1b[1m\ud83e\udd16 BROWSER BOT (Automation Tester)\x1b[0m\n');

  // First check if browser tools work at all
  let navResult;
  try {
    navResult = await toolRegistry.execute('browser_navigate', { url: 'https://example.com' }, toolCtx);
  } catch (e) {
    navResult = { success: false, error: e.message };
  }

  if (!navResult.success) {
    console.log('  \u26a0\ufe0f  Browser tools unavailable (Playwright Chromium not installed)');
    console.log('  \u26a0\ufe0f  Skipping 8 browser tests');
    const browserTests = [
      'browser_navigate', 'browser_get_text', 'browser_screenshot', 'browser_type_text',
      'browser_press_key', 'browser_scroll', 'browser_evaluate_js', 'browser_wait_for',
    ];
    for (const name of browserTests) {
      results.push({ agent: 'BrowserBot', name: 'Tool: ' + name, passed: false, ms: 0, error: 'Playwright not installed' });
    }
    return;
  }

  // navigate already succeeded, record it
  results.push({ agent: 'BrowserBot', name: 'Tool: browser_navigate', passed: true, ms: 0 });
  console.log(`  \x1b[32m\u2713\x1b[0m Tool: browser_navigate \x1b[90m(0.0s)\x1b[0m`);

  await test('BrowserBot', 'Tool: browser_get_text', async () => {
    const r = await toolRegistry.execute('browser_get_text', { selector: 'h1' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('BrowserBot', 'Tool: browser_screenshot', async () => {
    const r = await toolRegistry.execute('browser_screenshot', {}, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('BrowserBot', 'Tool: browser_type_text', async () => {
    // Navigate to a page with an input first
    await toolRegistry.execute('browser_navigate', { url: 'https://httpbin.org/forms/post' }, toolCtx);
    const r = await toolRegistry.execute('browser_type_text', { selector: 'input[name="custname"]', text: 'JAK Test User' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('BrowserBot', 'Tool: browser_press_key', async () => {
    const r = await toolRegistry.execute('browser_press_key', { key: 'Tab' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('BrowserBot', 'Tool: browser_scroll', async () => {
    const r = await toolRegistry.execute('browser_scroll', { direction: 'down', amount: 300 }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('BrowserBot', 'Tool: browser_evaluate_js', async () => {
    const r = await toolRegistry.execute('browser_evaluate_js', { code: 'document.title' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('BrowserBot', 'Tool: browser_wait_for', async () => {
    const r = await toolRegistry.execute('browser_wait_for', { selector: 'body', timeout: 5000 }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });
}

// ════════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n\x1b[1m\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557\x1b[0m');
  console.log('\x1b[1m\u2551   JAK SWARM \u2014 Human Simulator Test Suite              \u2551\x1b[0m');
  console.log('\x1b[1m\u2551   5 Users \u00d7 8 Tests = 40 End-to-End Scenarios         \u2551\x1b[0m');
  console.log('\x1b[1m\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d\x1b[0m');

  await runSarah();
  await runDev();
  await runMaya();
  await runAlex();
  await runBrowserBot();

  // Scorecard
  const totalMs = Date.now() - globalStart;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('\n\x1b[1m\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557\x1b[0m');
  console.log('\x1b[1m\u2551                    SCORECARD                          \u2551\x1b[0m');
  console.log('\x1b[1m\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563\x1b[0m');

  const agentMeta = [
    { key: 'Sarah',      emoji: '\ud83d\udc69\u200d\ud83d\udcbc', label: 'Sarah     ' },
    { key: 'Dev',        emoji: '\ud83d\udc68\u200d\ud83d\udcbb', label: 'Dev       ' },
    { key: 'Maya',       emoji: '\ud83d\udc69\u200d\ud83c\udfa8', label: 'Maya      ' },
    { key: 'Alex',       emoji: '\ud83d\udcca', label: 'Alex      ' },
    { key: 'BrowserBot', emoji: '\ud83e\udd16', label: 'BrowserBot' },
  ];

  for (const { key, emoji, label } of agentMeta) {
    const ar = results.filter(r => r.agent === key);
    const ap = ar.filter(r => r.passed).length;
    const bar = '\u2588'.repeat(ap) + '\u2591'.repeat(ar.length - ap);
    console.log(`\x1b[1m\u2551\x1b[0m  ${emoji} ${label} ${bar} ${ap}/${ar.length}                  \x1b[1m\u2551\x1b[0m`);
  }

  console.log('\x1b[1m\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563\x1b[0m');
  const pct = ((passed / (passed + failed)) * 100).toFixed(0);
  const status = failed === 0 ? '\x1b[32mALL PASSED\x1b[0m' : `\x1b[31m${failed} FAILED\x1b[0m`;
  console.log(`\x1b[1m\u2551\x1b[0m  Total: ${passed}/${passed + failed} (${pct}%) | ${status} | ${(totalMs / 1000).toFixed(0)}s        \x1b[1m\u2551\x1b[0m`);
  console.log('\x1b[1m\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d\x1b[0m');

  if (failed > 0) {
    console.log('\n\x1b[31mFailed tests:\x1b[0m');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  \u2717 [${r.agent}] ${r.name}: ${r.error}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
