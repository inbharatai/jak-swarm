/**
 * Landing claim → code truth-lock.
 *
 * Every visible promise on the JAK Swarm landing page must point at a
 * real, existing piece of code or content. This test walks the page
 * section-by-section and asserts that:
 *   - the file the claim implies actually exists
 *   - the symbol or pattern the file is supposed to contain is there
 *
 * If any claim drifts away from code (file moved, function renamed,
 * feature removed), CI fails here. That's the contract: the backend
 * accurately supports the landing page.
 *
 * The truth-check `pnpm check:truth` already enforces COUNT consistency
 * (122 tools, 38 agents, 22 connectors). This test enforces SHAPE +
 * IMPLEMENTATION consistency for the qualitative claims.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../../..');

function exists(rel: string): boolean {
  return existsSync(join(REPO_ROOT, rel));
}
function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}
function contains(rel: string, pattern: RegExp | string): boolean {
  if (!exists(rel)) return false;
  const src = read(rel);
  return typeof pattern === 'string' ? src.includes(pattern) : pattern.test(src);
}

describe('Landing — Hero', () => {
  it('"Turn company context into approved agent work" hero copy is in the page', () => {
    const page = read('apps/web/src/app/page.tsx');
    expect(page).toContain('Turn company context');
    expect(page).toContain('into approved');
    expect(page).toContain('agent work');
    expect(page).toContain('Closed-loop company operating layer');
  });

  it('hero subheadline names the Company OS loop AND every security pillar', () => {
    const src = read('apps/web/src/app/page.tsx');
    for (const term of [
      'evidence',
      'decisions',
      'tasks',
      'risks',
      'owners',
      'deadlines',
      'code changes',
      'drift',
      'specs',
      'permission',
      'approval',
      'sandbox',
      'risk',
      'defensive',
      'audit',
    ]) {
      expect(src.toLowerCase(), `subheadline missing term "${term}"`).toMatch(new RegExp(term, 'i'));
    }
  });

  it('JAK Shield chip in nav (desktop) AND mobile', () => {
    const src = read('apps/web/src/app/page.tsx');
    // Two distinct mentions: desktop nav + mobile menu
    const matches = src.match(/JAK Shield/g) ?? [];
    expect(matches.length, 'expected ≥ 2 occurrences (desktop + mobile nav)').toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/href="#jak-shield"/);
  });
});

describe('Landing — Company OS wedge (YC thesis, beta-honest)', () => {
  const COMPANY = 'apps/web/src/components/landing/WhatJakDoes.tsx';

  it('WhatJakDoes is exported and rendered on the live homepage', () => {
    expect(contains('apps/web/src/components/landing/index.ts', /export \{ default as WhatJakDoes \}/)).toBe(true);
    expect(contains('apps/web/src/app/page.tsx', /<WhatJakDoes\s*\/>/)).toBe(true);
    expect(contains(COMPANY, /id="company-os"/)).toBe(true);
  });

  it('company operating layer evidence paths exist on disk', () => {
    const src = read(COMPANY);
    const paths = Array.from(src.matchAll(/evidencePath:\s*'([^']+)'/g)).map((m) => m[1]!);
    expect(paths.length).toBe(3);
    for (const p of paths) {
      expect(exists(p), `evidencePath ${p} missing on disk`).toBe(true);
    }
  });

  it('claims evidence -> graph -> drift -> spec, backed by real routes and service logic', () => {
    const routes = read('apps/api/src/routes/company-operating-layer.routes.ts');
    const service = read('apps/api/src/services/company-brain/company-operating-layer.service.ts');
    expect(routes).toContain('/company/artifacts');
    expect(routes).toContain('/company/entities');
    expect(routes).toContain('/company/alignment/drift');
    expect(routes).toContain('/company/specs/generate');
    expect(routes).toContain('/company/specs/:id/decide');
    expect(service).toContain('buildDriftCandidates');
    expect(service).toContain('customer_signal_unaddressed');
    expect(service).toContain('decision_not_operationalized');
    expect(service).toContain('ungrounded_execution');
    expect(service).toContain('stale_high_priority_task');
  });

  it('copy is honest that full connector auto-sync is not complete yet', () => {
    const src = read(COMPANY);
    expect(src).toMatch(/Connector sync is setup-dependent/i);
    expect(src).toMatch(/still needs deeper connector auto-sync/i);
    expect(src).not.toMatch(/complete company-wide operating system/i);
  });
});

describe('Landing — HowItWorks (7-step pipeline)', () => {
  const HOW = 'apps/web/src/components/landing/HowItWorks.tsx';

  it('seven steps are declared', () => {
    const src = read(HOW);
    const steps = src.match(/n:\s*[1-7],\s+label:/g) ?? [];
    expect(steps.length, 'expected 7 steps with n: 1..7 + label').toBe(7);
  });

  // Each step's `status:` line names a real subsystem in the code.
  it('Step 1 (Command) is backed by CommanderAgent', () => {
    expect(contains(HOW, /commander\./)).toBe(true);
    expect(exists('packages/agents/src/roles/commander.agent.ts')).toBe(true);
  });

  it('Step 2 (Plan) is backed by PlannerAgent + decomposeGoal', () => {
    expect(contains(HOW, /planner\.decompose/)).toBe(true);
    expect(exists('packages/agents/src/roles/planner.agent.ts')).toBe(true);
    expect(contains('packages/agents/src/roles/planner.agent.ts', /decomposeGoal/)).toBe(true);
  });

  it('Step 3 (Route) is backed by RouterAgent', () => {
    expect(contains(HOW, /router\./)).toBe(true);
    expect(exists('packages/agents/src/roles/router.agent.ts')).toBe(true);
  });

  it('Step 4 (Execute) is backed by BaseAgent.executeWithTools', () => {
    expect(contains(HOW, /worker\.run/)).toBe(true);
    expect(contains('packages/agents/src/base/base-agent.ts', /executeWithTools/)).toBe(true);
  });

  it('Step 5 (Approve) is backed by DefaultApprovalPolicy + payload binding', () => {
    expect(contains(HOW, /approval\.gate/)).toBe(true);
    expect(contains('packages/tools/src/registry/approval-policy.ts', /DefaultApprovalPolicy/)).toBe(true);
    expect(contains('packages/db/prisma/schema.prisma', /proposedDataHash/)).toBe(true);
  });

  it('Step 6 (Verify) is backed by VerifierAgent', () => {
    expect(contains(HOW, /verifier\.check/)).toBe(true);
    expect(exists('packages/agents/src/roles/verifier.agent.ts')).toBe(true);
  });

  it('Step 7 (Deliver) — signed audit trail backed by bundle-signing.service.ts', () => {
    expect(exists('apps/api/src/services/bundle.service.ts')).toBe(true);
    expect(exists('apps/api/src/services/bundle-signing.service.ts')).toBe(true);
  });
});

describe('Landing — ShowTheWork (4 outcome cards)', () => {
  const SHOW = 'apps/web/src/components/landing/ShowTheWork.tsx';

  it('Execution drift brief → Company Operating Layer drift detector exists', () => {
    expect(contains(SHOW, /Execution drift brief/i)).toBe(true);
    expect(contains('apps/api/src/services/company-brain/company-operating-layer.service.ts', /buildDriftCandidates/)).toBe(true);
  });

  it('Agent-executable product spec → spec generation + decision routes exist', () => {
    expect(contains(SHOW, /Agent-executable product spec/i)).toBe(true);
    expect(contains('apps/api/src/routes/company-operating-layer.routes.ts', '/company/specs/generate')).toBe(true);
    expect(contains('apps/api/src/routes/company-operating-layer.routes.ts', '/company/specs/:id/decide')).toBe(true);
  });

  it('Browser QA + source-linked fixes → browser operator exists', () => {
    expect(contains(SHOW, /Browser QA/i)).toBe(true);
    expect(exists('packages/tools/src/browser-operator/playwright-browser-operator.ts')).toBe(true);
  });

  it('Audit-ready evidence pack → audit-runs route + bundle service exist', () => {
    expect(contains(SHOW, /Audit-ready evidence/i)).toBe(true);
    expect(exists('apps/api/src/routes/audit-runs.routes.ts')).toBe(true);
    expect(exists('apps/api/src/services/bundle.service.ts')).toBe(true);
  });
});

describe('Landing — TrustLayer (6 grep-able guarantees)', () => {
  const TRUST = 'apps/web/src/components/landing/TrustLayer.tsx';

  it('Human approval gates → DefaultApprovalPolicy + ApprovalRequest model', () => {
    expect(contains(TRUST, /Human approval gates/)).toBe(true);
    expect(contains('packages/tools/src/registry/approval-policy.ts', /DefaultApprovalPolicy/)).toBe(true);
    expect(contains('packages/db/prisma/schema.prisma', /model ApprovalRequest/)).toBe(true);
  });

  it('Source-grounded outputs → verifier citation-density check', () => {
    expect(contains(TRUST, /Source-grounded/)).toBe(true);
    expect(contains('packages/agents/src/roles/verifier.agent.ts', /citationDensity/)).toBe(true);
  });

  it('Tool maturity labels → ToolMaturity enum', () => {
    expect(contains(TRUST, /Tool maturity labels/)).toBe(true);
    expect(contains('packages/shared/src/types/tool.ts', /ToolMaturity/)).toBe(true);
  });

  it('Tamper-evident audit trail → bundle-signing HMAC service', () => {
    expect(contains(TRUST, /Tamper-evident audit trail/)).toBe(true);
    expect(contains('apps/api/src/services/bundle-signing.service.ts', /createHmac/i)).toBe(true);
  });

  it('Self-hostable open-source core → MIT LICENSE file present', () => {
    expect(contains(TRUST, /Self-hostable open-source core/)).toBe(true);
    expect(exists('LICENSE')).toBe(true);
    expect(contains('LICENSE', /MIT/i)).toBe(true);
  });

  it('Agent-first runtime → runtime files exist', () => {
    expect(contains(TRUST, /Agent-first runtime/)).toBe(true);
    expect(contains(TRUST, /structured orchestration/)).toBe(true);
    expect(contains(TRUST, /enforced execution path/)).toBe(false);
    expect(exists('packages/agents/src/runtime/openai-runtime.ts')).toBe(true);
  });
});

describe('Landing — JAK Shield (6 defenses) — the new front-and-center section', () => {
  const SHIELD = 'apps/web/src/components/landing/JAKShield.tsx';

  it('JAKShield component file exists + exports default', () => {
    expect(exists(SHIELD)).toBe(true);
    expect(contains(SHIELD, /export default function JAKShield/)).toBe(true);
  });

  it('all 6 evidencePath attributes exist on disk', () => {
    const src = read(SHIELD);
    const paths = Array.from(src.matchAll(/evidencePath:\s*'([^']+)'/g)).map((m) => m[1]!);
    expect(paths.length).toBe(6);
    for (const p of paths) {
      expect(exists(p), `evidencePath ${p} missing on disk`).toBe(true);
    }
  });

  it('safety-boundary copy is present (defensive ALLOWED + offensive REFUSED)', () => {
    expect(contains(SHIELD, /defensive (security|review|work|automation)/i)).toBe(true);
    expect(contains(SHIELD, /(malware|exploit|phish|credential theft)/i)).toBe(true);
    expect(contains(SHIELD, /(refuse|not support|blocked|does not)/i)).toBe(true);
  });

  it('JAK Shield IS wired into the live landing page (not just an unused component)', () => {
    const page = read('apps/web/src/app/page.tsx');
    expect(page).toMatch(/<JAKShield\s*\/>/);
    expect(page).toMatch(/href="#jak-shield"/);
  });

  it('offensive-cyber-detector + injection-detector + persistence-redactor all exported from @jak-swarm/security', () => {
    const idx = read('packages/security/src/index.ts');
    expect(idx).toMatch(/detectOffensiveCyberRequest/);
    expect(idx).toMatch(/detectInjection/);
    expect(idx).toMatch(/redactJsonForPersistence/);
    expect(idx).toMatch(/encryptString/);   // field-cipher
    expect(idx).toMatch(/decryptString/);
  });

  it('BaseAgent wires the JAK Shield offensive guard before the LLM call', () => {
    const toolExec = read('packages/agents/src/base/tool-execution.service.ts');
    expect(toolExec).toMatch(/JAK_SHIELD_OFFENSIVE_GUARD_DISABLED/);
    expect(toolExec).toMatch(/getShieldGateway/);
    expect(toolExec).toMatch(/offensiveCyber/);
  });

  it('PlaywrightBrowserOperator implements the SSRF + DNS-rebind + disk-quota defenses', () => {
    const op = read('packages/tools/src/browser-operator/playwright-browser-operator.ts');
    expect(op).toMatch(/defaultIsUrlAllowed/);
    expect(op).toMatch(/resolveAndCheckHost/);              // DNS-rebind
    expect(op).toMatch(/tenantQuotaBytes/);                  // disk quota
    expect(op).toMatch(/BROWSER_REQUEST_BLOCKED/);
    expect(op).toMatch(/BROWSER_DNS_REBIND_BLOCKED/);
    expect(op).toMatch(/BROWSER_QUOTA_EXCEEDED/);
  });
});

describe('Landing — top-line counts', () => {
  // The pnpm check:truth gate already enforces these against the live
  // tool registry + AgentRole enum. We mirror the strictest checks here
  // so a broken truth-check is caught even before the full vitest run.

  it('product-truth.ts STATS array contains the expected count cards', () => {
    const truth = read('apps/web/src/lib/product-truth.ts');
    expect(truth).toMatch(/value:\s*38,\s*label:\s*'Agents'/);
    expect(truth).toMatch(/value:\s*122,\s*label:\s*'Classified Tools'/);
    expect(truth).toMatch(/value:\s*22,\s*label:\s*'Connectors'/);
  });

  it('PremiumCTA stat strip matches the truth registry', () => {
    const cta = read('apps/web/src/components/landing/PremiumCTA.tsx');
    expect(cta).toMatch(/value:\s*'?38'?,\s*label:\s*'(?:Agents|Specialist Agents)'/);
    expect(cta).toMatch(/value:\s*'?122'?,\s*label:\s*'(?:Tools|Classified Tools)'/);
    expect(cta).toMatch(/value:\s*'?20\+'?,\s*label:\s*'?Connectors'?/);
    expect(cta).toMatch(/value:\s*'?MIT'?/);
  });

  it('README front matter declares the same counts', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/AI_Agents-38/);
    expect(readme).toMatch(/Classified_Tools-122/);
    expect(readme).toMatch(/Connectors-23/);
    expect(readme).toMatch(/JAK_Shield-Defensive_Only/);
  });

  it('README declares challenge build status and current local verification evidence', () => {
    const readme = read('README.md');
    const beta = read('docs/beta-release.md');
    const page = read('apps/web/src/app/page.tsx');
    expect(readme).toMatch(/Release-Beta_0\.1\.0--beta\.0/);
    expect(readme).toContain('working challenge build');
    expect(readme).toMatch(/Tests-2154_blocking_CI/);
    expect(page).toContain('Beta 0.1.0-beta.0');
    expect(page).toContain('Controlled beta');
    expect(beta).toContain('Status: beta release candidate');
    expect(beta).toContain('2154 blocking CI');
    expect(beta).toMatch(/not an enterprise-SLA release/i);
  });
});

describe('Landing — public marketing copy stays honest', () => {
  it('NO "certified" / "HIPAA-ready" / "SOC 2-ready" claims on the landing or README', () => {
    const sources = [
      'apps/web/src/app/page.tsx',
      'apps/web/src/components/landing/JAKShield.tsx',
      'apps/web/src/components/landing/WhatJakDoes.tsx',
      'apps/web/src/components/landing/ShowTheWork.tsx',
      'apps/web/src/components/landing/TrustLayer.tsx',
      'apps/web/src/components/landing/PremiumCTA.tsx',
      'README.md',
    ];
    const banned = /\b(certified|HIPAA[\s-]ready|SOC ?2[\s-]ready|ISO[\s-]?ready|fully compliant)\b/i;
    for (const s of sources) {
      const src = read(s);
      expect(banned.test(src), `forbidden compliance claim in ${s}`).toBe(false);
    }
  });

  it('safety boundary mentions both defensive (allowed) AND offensive (refused)', () => {
    const shield = read('apps/web/src/components/landing/JAKShield.tsx');
    expect(shield).toMatch(/defensive/i);
    expect(shield).toMatch(/offensive|malware|phish|exploit/i);
    expect(shield).toMatch(/(refuse|does not|not support|blocked)/i);
  });

  it('Agent-first runtime claims are enforced by config, docs, and deploy templates', () => {
    const config = read('apps/api/src/config.ts');
    const runtimeFactory = read('packages/agents/src/runtime/index.ts');
    const executionDoc = read('docs/architecture/execution-engines.md');
    const envExample = read('.env.example');
    const railwayApiEnv = read('scripts/automation/env-templates/railway-api.env.example');
    const railwayWorkerEnv = read('scripts/automation/env-templates/railway-worker.env.example');
    const cloudbuildApi = read('cloudbuild-api.yaml');
    const cloudbuildWorker = read('cloudbuild-worker.yaml');
    const doctor = read('scripts/doctor.ps1');
    const truth = read('apps/web/src/lib/product-truth.ts');

    expect(config).toContain("JAK_EXECUTION_ENGINE must be unset or 'openai-first'");
    expect(config).toContain("JAK_WORKFLOW_RUNTIME must be unset or 'langgraph'");
    expect(runtimeFactory).toContain('OpenAI-only');
    expect(runtimeFactory).toContain('JAK_EXECUTION_ENGINE=legacy -> ignored');
    expect(executionDoc).toContain('two LLM providers');
    expect(truth).toMatch(/label:\s*'Agent Runtime'/);
    expect(truth).toMatch(/suffix:\s*''/);

    const activeDeploySurfaces = [railwayApiEnv, railwayWorkerEnv, cloudbuildApi, cloudbuildWorker, doctor].join('\n');
    expect(activeDeploySurfaces).not.toMatch(/ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|OPENROUTER_API_KEY|OLLAMA_(URL|BASE_URL|MODEL)|OPENAI_FALLBACK_MODEL|LLM_ROUTING_STRATEGY/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Migration 106 — Free 30-day trial truth-lock.
// Every visible claim about the trial CTA on the landing page must be
// backed by real code. If a future edit weakens a cap, hides the
// "no credit card" note, or renames the trial route, CI fails here.
// ─────────────────────────────────────────────────────────────────────────
describe('Landing — Free trial CTA (Migration 106)', () => {
  it('hero CTA is "Start 30-Day Free Trial" pointing at /trial', () => {
    const page = read('apps/web/src/app/page.tsx');
    expect(page).toMatch(/Start 30-Day Free Trial/);
    expect(page).toMatch(/href="\/trial"/);
    expect(page).toMatch(/data-cta="hero-trial"/);
  });

  it('hero trust line declares "No credit card" + "daily caps" + "30 days"', () => {
    const page = read('apps/web/src/app/page.tsx');
    expect(page).toMatch(/no credit card/i);
    expect(page).toMatch(/daily caps?/i);
    expect(page).toMatch(/30\s*day/i);
  });

  it('/trial signup page exists and lists the four daily caps with the right numbers', () => {
    const path = 'apps/web/src/app/(auth)/trial/page.tsx';
    expect(exists(path)).toBe(true);
    const src = read(path);
    expect(src).toMatch(/20\s*\/\s*day/);          // agent runs cap
    expect(src).toMatch(/5\s*\/\s*day/);            // approvals cap
    expect(src).toMatch(/120\s*min\s*\/\s*day/);    // tool minutes cap
    expect(src).toMatch(/200,?000\s*\/\s*day/);     // tokens cap
  });

  it('backend trial route + usage-counter service both exist', () => {
    expect(exists('apps/api/src/routes/trial.routes.ts')).toBe(true);
    expect(exists('apps/api/src/services/trial/usage-counter.service.ts')).toBe(true);
    expect(contains('apps/api/src/services/trial/usage-counter.service.ts', 'startTrial')).toBe(true);
    expect(contains('apps/api/src/services/trial/usage-counter.service.ts', /trialEndsAt/)).toBe(true);
  });

  it('migration 106 declares the trial fields on Subscription', () => {
    const sql = read('packages/db/prisma/migrations/106_team_and_trial/migration.sql');
    expect(sql).toMatch(/dailyAgentRunsCap.*DEFAULT 20/i);
    expect(sql).toMatch(/dailyApprovalsCap.*DEFAULT 5/i);
    expect(sql).toMatch(/dailyToolMinutesCap.*DEFAULT 120/i);
    expect(sql).toMatch(/dailyTokensCap.*DEFAULT 200000/i);
    expect(sql).toMatch(/trialStartedAt/);
    expect(sql).toMatch(/trialEndsAt/);
  });

  it('workflow creation service wires the trial-cap guard before credit check', () => {
    const svc = read('apps/api/src/services/workflow-creation.service.ts');
    expect(svc).toMatch(/UsageCounterService/);
    expect(svc).toMatch(/TRIAL_DAILY_CAP_HIT/);
    expect(svc).toMatch(/TRIAL_EXPIRED/);
  });

  it('Migration 106 also adds the team primitives (Department, TaskAssignment, Notification)', () => {
    const sql = read('packages/db/prisma/migrations/106_team_and_trial/migration.sql');
    expect(sql).toMatch(/CREATE TABLE "departments"/);
    expect(sql).toMatch(/CREATE TABLE "task_assignments"/);
    expect(sql).toMatch(/CREATE TABLE "notifications"/);
    expect(sql).toMatch(/CREATE TABLE "trial_signups"/);
  });

  it('/trial/verify/[token] page exists and stores the JWT via the shared auth helper', () => {
    const path = 'apps/web/src/app/(auth)/trial/verify/[token]/page.tsx';
    expect(exists(path)).toBe(true);
    const src = read(path);
    expect(src).toMatch(/trialApi\.verify/);
    expect(src).toMatch(/import \{ setToken \} from '@\/lib\/auth'/);
    expect(src).toMatch(/setToken\(resp\.data\.token/);
    expect(src).toMatch(/initialPassword/);
  });

  it('TrialPromotionService creates Tenant + admin User + trialing Subscription atomically', () => {
    const path = 'apps/api/src/services/trial/trial-promotion.service.ts';
    expect(exists(path)).toBe(true);
    const src = read(path);
    expect(src).toMatch(/\$transaction/);
    expect(src).toMatch(/role:\s*'TENANT_ADMIN'/);
    expect(src).toMatch(/planId:\s*'trial_30d'/);
    expect(src).toMatch(/status:\s*'trialing'/);
    expect(src).toMatch(/setUTCDate.*\+\s*30/s);
  });

  it('TrialEmailService is wired with three transparent backends (gmail/file/noop)', () => {
    const path = 'apps/api/src/services/trial/trial-email.service.ts';
    expect(exists(path)).toBe(true);
    const src = read(path);
    expect(src).toMatch(/GMAIL_EMAIL/);
    expect(src).toMatch(/JAK_TRIAL_EMAIL_LOG_DIR/);
    expect(src).toMatch(/backend:\s*'noop'/);
    expect(src).toMatch(/NO BACKEND CONFIGURED/);
  });

  it('approvals route enforces dailyApprovalsCap on APPROVED decisions', () => {
    const route = read('apps/api/src/routes/approvals.routes.ts');
    expect(route).toMatch(/UsageCounterService/);
    expect(route).toMatch(/'approvals'/);
    expect(route).toMatch(/TRIAL_DAILY_CAP_HIT/);
    expect(route).toMatch(/decision === 'APPROVED'/);
  });

  // Audit hardening — 2026-05-08 P0 fixes (8 items)
  it('P0-1 schema declares onDelete on Workflow.userId + TaskAssignment.assignedByUserId', () => {
    const schema = read('packages/db/prisma/schema.prisma');
    expect(schema).toMatch(/User\s+@relation\(fields:\s*\[userId\][^)]*onDelete:\s*Restrict/);
    expect(schema).toMatch(/TaskAssignmentAssigner[^)]*onDelete:\s*NoAction/);
  });

  it('P0-2 + P0-3 /trial/verify sets no-store + has timing floor', () => {
    const route = read('apps/api/src/routes/trial.routes.ts');
    expect(route).toMatch(/Cache-Control/);
    expect(route).toMatch(/no-store/);
    expect(route).toMatch(/VERIFY_FLOOR_MS/);
    expect(route).toMatch(/padToFloor/);
  });

  it('P0-4 trial-email validates JAK_TRIAL_EMAIL_LOG_DIR against allowlist', () => {
    const svc = read('apps/api/src/services/trial/trial-email.service.ts');
    expect(svc).toMatch(/validateLogDir/);
    expect(svc).toMatch(/JAK_ALLOWED_DATA_ROOT/);
    expect(svc).toMatch(/path-escape-refused|rejected by allowlist/);
  });

  it('P0-5 trial route declares per-IP + per-email rate limits', () => {
    const route = read('apps/api/src/routes/trial.routes.ts');
    expect(route).toMatch(/rateLimit:\s*{/);
    expect(route).toMatch(/checkEmailRateLimit/);
    expect(route).toMatch(/trial-signup-ip:/);
    expect(route).toMatch(/trial-verify-ip:/);
  });

  it('P0-6 fingerprint() honours X-Forwarded-For only when JAK_TRUST_PROXY=true', () => {
    const route = read('apps/api/src/routes/trial.routes.ts');
    expect(route).toMatch(/JAK_TRUST_PROXY/);
    expect(route).toMatch(/trustProxy/);
  });

  it('P0-7 scheduler enforces trial cap before executeWorkflow', () => {
    const svc = read('apps/api/src/services/scheduler.service.ts');
    expect(svc).toMatch(/UsageCounterService/);
    expect(svc).toMatch(/SKIPPED_TRIAL_CAP_HIT/);
    expect(svc).toMatch(/SKIPPED_TRIAL_EXPIRED/);
  });

  it('P0-8 team route walks ancestor chain for indirect-cycle detection', () => {
    const route = read('apps/api/src/routes/team.routes.ts');
    expect(route).toMatch(/Reparenting would create a cycle/);
    expect(route).toMatch(/parent chain already contains a cycle/);
    expect(route).toMatch(/cursor.*parentId/s);
  });

  it('P1-1 unbounded findMany routes have take: 500 cap', () => {
    const ext = read('apps/api/src/routes/external-auditor.routes.ts');
    expect(ext).toMatch(/take:\s*500/);
    const compl = read('apps/api/src/routes/compliance.routes.ts');
    expect(compl).toMatch(/take:\s*500/);
  });

  it('P1-2 web no longer uses standalone Math.random() ID generators', () => {
    const useVoice = read('apps/web/src/hooks/useVoice.ts');
    const convStore = read('apps/web/src/store/conversation-store.ts');
    expect(useVoice).toMatch(/from\s+'@\/lib\/id'/);
    expect(convStore).toMatch(/from\s+'@\/lib\/id'/);
    expect(useVoice).not.toMatch(/from\s+'@jak-swarm\/shared'/);
    expect(convStore).not.toMatch(/from\s+'@jak-swarm\/shared'/);
    expect(useVoice).toMatch(/generateBrowserId/);
    expect(convStore).toMatch(/generateBrowserId/);
    // The bare `Math.random().toString(36).slice(2, 11)` collision-prone
    // pattern must be gone:
    expect(useVoice).not.toMatch(/Math\.random\(\)\.toString\(36\)\.slice\(2,\s*11\)/);
  });
});
