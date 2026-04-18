#!/usr/bin/env node
/**
 * JAK Swarm — Human Simulator Test Suite
 *
 * 10 simulated users test the platform end-to-end like real humans:
 *
 *   SARAH   (CEO / Founder)        — strategy, OKRs, competitors, board reports
 *   DEV     (Senior Engineer)      — code, repos, deps, tech debt, files
 *   MAYA    (Marketing Director)   — brand monitoring, social auto-reply, SEO
 *   ALEX    (Operations Manager)   — email, dedup, churn, winback, reports
 *   FINANCE (CFO)                  — financial models, budgets, cashflow, CSV
 *   LEGAL   (General Counsel)      — compliance, contracts, obligations, regs
 *   HR      (People Director)      — onboarding, screening, job posts, offers
 *   GROWTH  (Growth Hacker)        — SEO, keywords, enrichment, engagement
 *   PRODUCT (Product Manager)      — specs, stories, timelines, UX, content
 *   BROWSER BOT (Automation)       — navigate, text, screenshot, type, keys, scroll, JS, wait
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
//  1. SARAH — CEO / Founder (8 tests)
// ════════════════════════════════════════════════════════════════
async function runSarah() {
  console.log('\n\x1b[1m\ud83d\udc69\u200d\ud83d\udcbc SARAH (CEO / Founder)\x1b[0m\n');

  await test('Sarah', 'StrategistAgent (STRATEGIC_ANALYSIS)', async () => {
    const a = new agents.StrategistAgent();
    const r = await a.execute({ action: 'STRATEGIC_ANALYSIS', question: 'Should we enter the healthcare AI market?', industry: 'TECHNOLOGY' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'StrategistAgent (TRACK_EXECUTION)', async () => {
    const a = new agents.StrategistAgent();
    const r = await a.execute({ action: 'TRACK_EXECUTION', question: 'Track progress on Q1 OKRs: grow ARR to $1M, ship v2, hire 5 engineers' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Sarah', 'Tool: track_okrs', async () => {
    const r = await toolRegistry.execute('track_okrs', {
      action: 'set',
      objective: 'Grow ARR to $1M',
      keyResults: [
        { metric: 'ARR', target: 1000000, current: 650000 },
        { metric: 'New customers', target: 50, current: 32 },
      ],
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Sarah', 'Tool: monitor_competitors', async () => {
    const r = await toolRegistry.execute('monitor_competitors', {
      competitors: ['OpenAI', 'Anthropic'],
      timeframe: 'this month',
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Sarah', 'Tool: generate_board_report', async () => {
    const r = await toolRegistry.execute('generate_board_report', {
      companyName: 'JAK Technologies',
      period: 'Q1 2026',
      metrics: { arr: 650000, customers: 32, churn: 0.03 },
      highlights: ['Launched v2 platform', 'Closed Series A'],
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Sarah', 'ResearchAgent (web search)', async () => {
    const a = new agents.ResearchAgent();
    const r = await a.execute({ query: 'Top 3 AI agent platforms features and pricing 2024', maxSources: 3 }, makeCtx());
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
//  2. DEV — Senior Engineer (8 tests)
// ════════════════════════════════════════════════════════════════
async function runDev() {
  console.log('\n\x1b[1m\ud83d\udc68\u200d\ud83d\udcbb DEV (Senior Engineer)\x1b[0m\n');

  await test('Dev', 'CoderAgent (WRITE_CODE)', async () => {
    const a = new agents.CoderAgent();
    const r = await a.execute({ action: 'WRITE_CODE', requirements: 'Write a TypeScript function that validates email addresses using regex and returns {valid, reason}', language: 'typescript' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Dev', 'TechnicalAgent (ANALYZE_REPO)', async () => {
    const a = new agents.TechnicalAgent();
    const r = await a.execute({ action: 'ANALYZE_REPO', question: 'Analyze the architecture of a Node.js monorepo with packages/tools, packages/agents, and packages/orchestrator' }, makeCtx());
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

  await test('Dev', 'Tool: analyze_github_repo', async () => {
    const r = await toolRegistry.execute('analyze_github_repo', { owner: 'microsoft', repo: 'TypeScript' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Dev', 'Tool: check_dependencies', async () => {
    const r = await toolRegistry.execute('check_dependencies', {
      packageJson: JSON.stringify({
        name: 'test-app',
        dependencies: { express: '^4.18.0', lodash: '^4.17.21' },
        devDependencies: { typescript: '^5.0.0' },
      }),
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Dev', 'Tool: estimate_tech_debt', async () => {
    const r = await toolRegistry.execute('estimate_tech_debt', {
      files: [
        { path: 'src/index.ts', content: '// TODO: refactor this\nconst x: any = getData();\n// FIXME: race condition\nconsole.log(x);' },
        { path: 'src/utils.ts', content: '// HACK: workaround for API bug\ntry { parse() } catch(e) {}\n// @ts-ignore\nconst y: any = null;' },
      ],
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Dev', 'Tool: web_fetch', async () => {
    const r = await toolRegistry.execute('web_fetch', { url: 'https://httpbin.org/json' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });
}

// ════════════════════════════════════════════════════════════════
//  3. MAYA — Marketing Director (8 tests)
// ════════════════════════════════════════════════════════════════
async function runMaya() {
  console.log('\n\x1b[1m\ud83d\udc69\u200d\ud83c\udfa8 MAYA (Marketing Director)\x1b[0m\n');

  await test('Maya', 'MarketingAgent (MONITOR_BRAND)', async () => {
    const a = new agents.MarketingAgent();
    const r = await a.execute({ action: 'MONITOR_BRAND', brief: 'Monitor brand mentions for JAK Swarm across social media and tech news', industry: 'TECHNOLOGY' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Maya', 'ContentAgent (WRITE_SOCIAL)', async () => {
    const a = new agents.ContentAgent();
    const r = await a.execute({ action: 'WRITE_SOCIAL', topic: 'How AI is transforming small business operations', platform: 'linkedin' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Maya', 'Tool: monitor_brand_mentions', async () => {
    const r = await toolRegistry.execute('monitor_brand_mentions', { brand: 'JAK Swarm' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Maya', 'Tool: auto_reply_reddit', async () => {
    const r = await toolRegistry.execute('auto_reply_reddit', { topic: 'AI automation tools', product: 'JAK Swarm', tone: 'helpful' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Maya', 'Tool: auto_reply_twitter', async () => {
    const r = await toolRegistry.execute('auto_reply_twitter', { topic: 'AI agent platforms', product: 'JAK Swarm' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Maya', 'Tool: auto_engage_linkedin', async () => {
    const r = await toolRegistry.execute('auto_engage_linkedin', { keywords: ['AI automation', 'agent platforms'], productName: 'JAK Swarm', tone: 'thought-leadership' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Maya', 'Tool: generate_seo_report', async () => {
    const r = await toolRegistry.execute('generate_seo_report', { url: 'https://example.com', keywords: ['AI automation'] }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Maya', 'Tool: track_content_performance', async () => {
    const r = await toolRegistry.execute('track_content_performance', {
      action: 'track',
      url: 'https://blog.example.com/ai-agents',
      title: 'How AI Agents Are Changing Business',
      platform: 'blog',
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });
}

// ════════════════════════════════════════════════════════════════
//  4. ALEX — Operations Manager (8 tests)
// ════════════════════════════════════════════════════════════════
async function runAlex() {
  console.log('\n\x1b[1m\ud83d\udcca ALEX (Operations Manager)\x1b[0m\n');

  await test('Alex', 'Tool: verify_email_deliverability', async () => {
    const r = await toolRegistry.execute('verify_email_deliverability', { email: 'contact@google.com' }, toolCtx);
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

  await test('Alex', 'Tool: classify_text', async () => {
    const r = await toolRegistry.execute('classify_text', {
      text: 'The product keeps crashing and I want a refund',
      categories: ['complaint', 'bug_report', 'feature_request', 'billing'],
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Alex', 'Tool: score_lead', async () => {
    const r = await toolRegistry.execute('score_lead', { name: 'Jane Smith', company: 'TechCorp', title: 'VP Engineering', industry: 'SaaS' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Alex', 'Tool: create_email_sequence', async () => {
    const r = await toolRegistry.execute('create_email_sequence', {
      name: 'Ops Onboarding',
      steps: [
        { subject: 'Welcome aboard', body: 'Welcome to the team...', delayDays: 0 },
        { subject: 'Check-in', body: 'How is your first week going?', delayDays: 7 },
      ],
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });
}

// ════════════════════════════════════════════════════════════════
//  5. FINANCE — CFO (8 tests)
// ════════════════════════════════════════════════════════════════
async function runFinance() {
  console.log('\n\x1b[1m\ud83d\udcb0 FINANCE (CFO)\x1b[0m\n');

  await test('Finance', 'FinanceAgent (FINANCIAL_MODEL)', async () => {
    const a = new agents.FinanceAgent();
    const r = await a.execute({ action: 'FINANCIAL_MODEL', question: 'Unit economics for SaaS: 500 customers, $100/mo, 5% churn, $200 CAC', data: { mrr: 50000, churnRate: 0.05 } }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Finance', 'FinanceAgent (TRACK_BUDGET)', async () => {
    const a = new agents.FinanceAgent();
    const r = await a.execute({ action: 'TRACK_BUDGET', question: 'Track Q1 budget: $200k engineering, $100k marketing, $50k operations' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Finance', 'Tool: parse_financial_csv', async () => {
    const r = await toolRegistry.execute('parse_financial_csv', {
      csvContent: 'Category,Q1,Q2,Q3,Q4\nRevenue,100000,120000,135000,150000\nCOGS,40000,45000,50000,55000\nGross Profit,60000,75000,85000,95000',
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Finance', 'Tool: track_budget', async () => {
    const r = await toolRegistry.execute('track_budget', { action: 'set_budget', category: 'Engineering', amount: 200000, period: '2026-Q1' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Finance', 'Tool: forecast_cashflow', async () => {
    const r = await toolRegistry.execute('forecast_cashflow', {
      historicalData: [50000, 55000, 58000, 62000, 67000, 72000],
      periods: 3,
      method: 'linear',
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Finance', 'Tool: compute_statistics', async () => {
    const r = await toolRegistry.execute('compute_statistics', { values: [120000, 135000, 150000, 148000, 160000, 175000] }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Finance', 'AnalyticsAgent (TREND_ANALYSIS)', async () => {
    const a = new agents.AnalyticsAgent();
    const r = await a.execute({ action: 'TREND_ANALYSIS', query: 'SaaS revenue and growth metrics trends for Q1 2026' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Finance', 'Tool: parse_spreadsheet', async () => {
    const r = await toolRegistry.execute('parse_spreadsheet', {
      data: 'Month,Revenue,Expenses\nJan,100000,80000\nFeb,110000,82000\nMar,125000,85000',
      delimiter: ',',
      hasHeaders: true,
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });
}

// ════════════════════════════════════════════════════════════════
//  6. LEGAL — General Counsel (8 tests)
// ════════════════════════════════════════════════════════════════
async function runLegal() {
  console.log('\n\x1b[1m\u2696\ufe0f  LEGAL (General Counsel)\x1b[0m\n');

  await test('Legal', 'LegalAgent (COMPLIANCE_CHECKLIST)', async () => {
    const a = new agents.LegalAgent();
    const r = await a.execute({ action: 'COMPLIANCE_CHECKLIST', industry: 'SaaS', description: 'GDPR compliance requirements for AI data processing' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Legal', 'LegalAgent (COMPARE_CONTRACTS)', async () => {
    const a = new agents.LegalAgent();
    const r = await a.execute({ action: 'COMPARE_CONTRACTS', description: 'Compare standard SaaS agreement vs enterprise agreement focusing on liability, indemnification, and SLA terms' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Legal', 'Tool: compare_contracts', async () => {
    const r = await toolRegistry.execute('compare_contracts', {
      contractA: 'This Agreement shall commence on January 1, 2026.\n\nThe Vendor shall provide services as described in Exhibit A.\n\nIndemnification: Vendor shall indemnify Client against all claims up to $1,000,000.',
      contractB: 'This Agreement shall commence on January 1, 2026.\n\nThe Vendor shall provide services as described in Exhibit A.\n\nIndemnification: Vendor shall indemnify Client against all claims with no cap on liability.',
      focus: ['indemnification'],
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Legal', 'Tool: extract_obligations', async () => {
    const r = await toolRegistry.execute('extract_obligations', {
      contractText: 'The Vendor shall deliver the initial software build by March 15, 2026. Payment of $50,000 is due upon delivery. The agreement shall auto-renew on December 31, 2026 unless terminated with 30 days written notice. Termination may occur if either party breaches material terms.',
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Legal', 'Tool: monitor_regulations', async () => {
    const r = await toolRegistry.execute('monitor_regulations', { industry: 'AI', jurisdiction: 'EU', topics: ['data privacy', 'model transparency'] }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Legal', 'PRAgent (DRAFT_PRESS_RELEASE)', async () => {
    const a = new agents.PRAgent();
    const r = await a.execute({ action: 'DRAFT_PRESS_RELEASE', topic: 'JAK Technologies achieves SOC 2 Type II compliance', company: 'JAK Technologies' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Legal', 'Tool: web_search (regulatory research)', async () => {
    const r = await toolRegistry.execute('web_search', { query: 'EU AI Act compliance requirements 2026' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Legal', 'Tool: memory_store + memory_retrieve round-trip', async () => {
    const storeR = await toolRegistry.execute('memory_store', {
      key: 'LEGAL_SIM:compliance_notes',
      value: { status: 'reviewed', frameworks: ['GDPR', 'SOC2', 'CCPA'], lastAudit: '2026-03-15' },
    }, toolCtx);
    if (!storeR.success) throw new Error('Store: ' + storeR.error);
    const retrieveR = await toolRegistry.execute('memory_retrieve', { key: 'LEGAL_SIM:compliance_notes' }, toolCtx);
    if (!retrieveR.success && !retrieveR.found) throw new Error('Retrieve failed');
  });
}

// ════════════════════════════════════════════════════════════════
//  7. HR — People Director (8 tests)
// ════════════════════════════════════════════════════════════════
async function runHR() {
  console.log('\n\x1b[1m\ud83d\udc65 HR (People Director)\x1b[0m\n');

  await test('HR', 'HRAgent (ONBOARDING_PLAN)', async () => {
    const a = new agents.HRAgent();
    const r = await a.execute({ action: 'ONBOARDING_PLAN', request: 'Create onboarding plan for a new senior engineer starting Monday' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('HR', 'HRAgent (SCREEN_CANDIDATES)', async () => {
    const a = new agents.HRAgent();
    const r = await a.execute({ action: 'SCREEN_CANDIDATES', request: 'Screen candidates for Senior Full-Stack Engineer role requiring TypeScript, React, Node.js, and AWS experience' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('HR', 'Tool: screen_resume', async () => {
    const r = await toolRegistry.execute('screen_resume', {
      resumeText: 'Jane Developer\n5+ years experience in software engineering.\nSkills: TypeScript, React, Node.js, AWS, Docker, PostgreSQL.\nEducation: BS Computer Science, MIT 2019.\nExperience: Senior Engineer at TechCorp (2019-2024). Built microservices handling 10M requests/day.',
      jobDescription: 'Senior Full-Stack Engineer. Must have TypeScript, React, Node.js, and AWS experience. Bonus: Docker, Kubernetes.',
      requiredSkills: ['typescript', 'react', 'node.js', 'aws'],
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('HR', 'Tool: post_job_listing', async () => {
    const r = await toolRegistry.execute('post_job_listing', {
      title: 'Senior Full-Stack Engineer',
      description: 'Join our growing team building AI-powered automation tools.',
      requirements: ['5+ years TypeScript/JavaScript', 'React and Node.js expertise', 'AWS or GCP experience', 'Strong system design skills'],
      location: 'Remote',
      salary: '$150k-$200k',
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('HR', 'Tool: generate_offer_letter', async () => {
    const r = await toolRegistry.execute('generate_offer_letter', {
      candidateName: 'Jane Developer',
      position: 'Senior Full-Stack Engineer',
      salary: 175000,
      startDate: '2026-05-01',
      benefits: ['Health/dental/vision insurance', '401k matching', 'Unlimited PTO', 'Remote work'],
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('HR', 'SuccessAgent (SCORE_HEALTH)', async () => {
    const a = new agents.SuccessAgent();
    const r = await a.execute({ action: 'SCORE_HEALTH', customerName: 'Acme Corp', industry: 'SaaS' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('HR', 'Tool: track_customer_health', async () => {
    const r = await toolRegistry.execute('track_customer_health', {
      action: 'score',
      customerId: 'acme_corp',
      healthScore: 82,
      factors: { usage: 85, satisfaction: 90, support_tickets: 2 },
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('HR', 'Tool: generate_qbr_deck', async () => {
    const r = await toolRegistry.execute('generate_qbr_deck', {
      customerName: 'Acme Corp',
      period: 'Q1 2026',
      metrics: { nps: 72, adoption: 85, tickets: 12 },
      wins: ['Reduced onboarding time by 40%', 'Achieved 99.9% uptime SLA'],
      challenges: ['API rate limiting during peak hours', 'Need better reporting dashboards'],
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });
}

// ════════════════════════════════════════════════════════════════
//  8. GROWTH — Growth Hacker (8 tests)
// ════════════════════════════════════════════════════════════════
async function runGrowth() {
  console.log('\n\x1b[1m\ud83d\ude80 GROWTH (Growth Hacker)\x1b[0m\n');

  await test('Growth', 'SEOAgent (CONTENT_GAP_ANALYSIS)', async () => {
    const a = new agents.SEOAgent();
    const r = await a.execute({ action: 'CONTENT_GAP_ANALYSIS', keyword: 'AI automation for business' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Growth', 'Tool: audit_seo', async () => {
    const r = await toolRegistry.execute('audit_seo', { url: 'https://example.com' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Growth', 'Tool: research_keywords', async () => {
    const r = await toolRegistry.execute('research_keywords', { seed_keyword: 'AI automation' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Growth', 'Tool: enrich_contact', async () => {
    const r = await toolRegistry.execute('enrich_contact', { name: 'Satya Nadella', company: 'Microsoft' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Growth', 'Tool: auto_engage_reddit', async () => {
    const r = await toolRegistry.execute('auto_engage_reddit', { keywords: ['AI agents', 'automation tools'], productName: 'JAK Swarm', maxThreads: 3 }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Growth', 'Tool: auto_engage_twitter', async () => {
    const r = await toolRegistry.execute('auto_engage_twitter', { keywords: ['AI agents'], productName: 'JAK Swarm' }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Growth', 'Tool: track_lead_pipeline', async () => {
    const r = await toolRegistry.execute('track_lead_pipeline', {
      action: 'add',
      lead: { name: 'Bob Johnson', company: 'GrowthCo', email: 'bob@growthco.com', stage: 'prospect' },
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
  });

  await test('Growth', 'GrowthAgent (basic enrichment)', async () => {
    const a = new agents.GrowthAgent();
    const r = await a.execute({ action: 'ENRICH_LEADS', leads: [{ name: 'Alice Chen', company: 'StartupXYZ' }] }, makeCtx());
    if (!r) throw new Error('No result');
  });
}

// ════════════════════════════════════════════════════════════════
//  9. PRODUCT — Product Manager (8 tests)
// ════════════════════════════════════════════════════════════════
async function runProduct() {
  console.log('\n\x1b[1m\ud83d\udcdd PRODUCT (Product Manager)\x1b[0m\n');

  await test('Product', 'ProductAgent (WRITE_SPEC)', async () => {
    const a = new agents.ProductAgent();
    const r = await a.execute({ action: 'WRITE_SPEC', feature: 'Real-time collaborative editing', targetUser: 'Enterprise teams' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Product', 'ProductAgent (WRITE_USER_STORIES)', async () => {
    const a = new agents.ProductAgent();
    const r = await a.execute({ action: 'WRITE_USER_STORIES', feature: 'Dashboard analytics with custom date ranges', targetUser: 'Marketing managers' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Product', 'ProjectAgent (ESTIMATE_TIMELINE)', async () => {
    const a = new agents.ProjectAgent();
    const r = await a.execute({ action: 'ESTIMATE_TIMELINE', projectName: 'API v2 Migration', description: 'Migrate 15 endpoints from Express to Fastify, add OpenAPI docs, write tests' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Product', 'DesignerAgent (UX_AUDIT)', async () => {
    const a = new agents.DesignerAgent();
    const r = await a.execute({ action: 'UX_AUDIT', brief: 'Audit the onboarding flow for new SaaS users: signup, email verification, first project creation, invite teammates' }, makeCtx());
    if (!r) throw new Error('No result');
  });

  await test('Product', 'Tool: pdf_extract_text', async () => {
    const r = await toolRegistry.execute('pdf_extract_text', {
      source: 'https://www.africau.edu/images/default/sample.pdf',
    }, toolCtx);
    if (!r.success) throw new Error(r.error);
    if (!r.data) throw new Error('No data returned');
  });

  await test('Product', 'Tool: browser_navigate', async () => {
    let navResult;
    try {
      navResult = await toolRegistry.execute('browser_navigate', { url: 'https://example.com' }, toolCtx);
    } catch (e) {
      navResult = { success: false, error: e.message };
    }
    if (!navResult.success) throw new Error(navResult.error || 'Navigation failed');
  });

  await test('Product', 'Tool: browser_screenshot', async () => {
    let r;
    try {
      r = await toolRegistry.execute('browser_screenshot', {}, toolCtx);
    } catch (e) {
      r = { success: false, error: e.message };
    }
    if (!r.success) throw new Error(r.error || 'Screenshot failed');
  });

  await test('Product', 'ContentAgent (WRITE_BLOG)', async () => {
    const a = new agents.ContentAgent();
    const r = await a.execute({ action: 'WRITE_BLOG', topic: 'Why product managers need AI-powered workflow automation', audience: 'Product leaders' }, makeCtx());
    if (!r) throw new Error('No result');
  });
}

// ════════════════════════════════════════════════════════════════
//  10. BROWSER BOT — Full Browser Automation (8 tests)
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
  console.log('\x1b[1m\u2551   10 Users \u00d7 8 Tests = 80 End-to-End Scenarios        \u2551\x1b[0m');
  console.log('\x1b[1m\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d\x1b[0m');

  await runSarah();
  await runDev();
  await runMaya();
  await runAlex();
  await runFinance();
  await runLegal();
  await runHR();
  await runGrowth();
  await runProduct();
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
    { key: 'Finance',    emoji: '\ud83d\udcb0', label: 'Finance   ' },
    { key: 'Legal',      emoji: '\u2696\ufe0f ', label: 'Legal     ' },
    { key: 'HR',         emoji: '\ud83d\udc65', label: 'HR        ' },
    { key: 'Growth',     emoji: '\ud83d\ude80', label: 'Growth    ' },
    { key: 'Product',    emoji: '\ud83d\udcdd', label: 'Product   ' },
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
