/**
 * scripts/check-docs-truth.ts
 *
 * Machine-enforced truth check (Phase 0b).
 *
 * Asserts that quantitative claims in README.md and the landing page
 * (apps/web/src/app/page.tsx) agree with the live ToolRegistry manifest
 * and the integration maturity matrix. Exits non-zero on any drift.
 *
 * Emits a structured report to docs/_generated/truth-report.json on success.
 *
 * Run: `pnpm check:truth`
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolRegistry, registerBuiltinTools } from '../packages/tools/src/index.js';
import { AgentRole } from '@jak-swarm/shared';
import { listIndustries } from '@jak-swarm/industry-packs';
import {
  computeSession7Counts,
  EXPECTED_SESSION_7_BUCKETS,
} from './verify-session7-counts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

interface Mismatch {
  claim: string;
  expected: string | number;
  actual: string | number;
  source: string;
}

const mismatches: Mismatch[] = [];

function expect(opts: {
  claim: string;
  expected: string | number;
  actual: string | number;
  source: string;
}): void {
  if (String(opts.expected) !== String(opts.actual)) {
    mismatches.push(opts);
  }
}

// ─── Populate registry ──────────────────────────────────────────────────────

if (toolRegistry.list().length === 0) {
  registerBuiltinTools();
}
const manifest = toolRegistry.getManifest();

// ─── Read docs ──────────────────────────────────────────────────────────────

const readme = read('README.md');
// `landing` is still read for the marketing-copy guards further down
// (no-fake claims, MIT-license honesty, etc.) — those are still
// verified against the actual rendered landing page.
const landing = read('apps/web/src/app/page.tsx');
// `productTruth` is the canonical source-of-truth registry that survived
// the 2026-04-28 landing simplification (commit d7bbf71). The homepage
// no longer surfaces stat cards or integration chips, but the registry
// stays accurate so this CI gate keeps catching drift between marketing
// claims and the live ToolRegistry/AgentRole truth.
const productTruth = read('apps/web/src/lib/product-truth.ts');
const matrix = read('docs/integration-maturity-matrix.md');

// ─── Tool count ─────────────────────────────────────────────────────────────

// README badge: "Classified_Tools-119" (or legacy "Production_Tools-N")
const readmeToolBadgeMatch = readme.match(/(?:Classified_Tools|Production_Tools)-(\d+)/);
if (readmeToolBadgeMatch) {
  expect({
    claim: 'README tools badge count',
    expected: manifest.total,
    actual: Number(readmeToolBadgeMatch[1]),
    source: 'README.md tools badge',
  });
}

// README headline: "119 Classified Tools" (or legacy "119 Production Tools")
const readmeToolHeadlineMatch = readme.match(/(\d+)\s+(?:Classified|Production)\s+Tools/i);
if (readmeToolHeadlineMatch) {
  expect({
    claim: 'README tools headline count',
    expected: manifest.total,
    actual: Number(readmeToolHeadlineMatch[1]),
    source: 'README.md (N Classified/Production Tools)',
  });
}

// Tools stat: { value: 122, label: 'Classified Tools' }
// Reads from product-truth registry (post-2026-04-28 simplification).
const landingToolMatch = productTruth.match(
  /\{\s*value:\s*(\d+)\s*,\s*label:\s*['"](?:Classified|Production) Tools['"]/,
);
if (landingToolMatch) {
  expect({
    claim: 'product-truth tools stat',
    expected: manifest.total,
    actual: Number(landingToolMatch[1]),
    source: 'apps/web/src/lib/product-truth.ts STATS',
  });
}

// ─── Agent count ────────────────────────────────────────────────────────────
// Session 9: the README + landing both claim a number of AI agents. Assert it
// matches the actual `AgentRole` enum size so the claim can't drift when new
// roles are added or removed.
const agentCount = Object.values(AgentRole).filter((v) => typeof v === 'string').length;

const readmeAgentMatch = readme.match(/(\d+)\s+AI\s+[Aa]gents/);
if (readmeAgentMatch) {
  expect({
    claim: 'README AI agents count matches AgentRole enum',
    expected: agentCount,
    actual: Number(readmeAgentMatch[1]),
    source: 'README.md (N AI Agents) vs packages/shared/src/types/agent.ts',
  });
}

const landingAgentMatch = productTruth.match(
  /\{\s*value:\s*(\d+)\s*,\s*label:\s*['"](?:AI\s+|Specialist\s+)?Agents['"]/,
);
if (landingAgentMatch) {
  expect({
    claim: 'product-truth Agents stat matches AgentRole enum',
    expected: agentCount,
    actual: Number(landingAgentMatch[1]),
    source: 'apps/web/src/lib/product-truth.ts STATS vs packages/shared/src/types/agent.ts',
  });
}

// Also check any "N Agents Live" style badge
const landingAgentBadgeMatch = landing.match(/>(\d+)\s+Agents\s+Live</);
if (landingAgentBadgeMatch) {
  expect({
    claim: 'Landing "N Agents Live" badge matches AgentRole enum',
    expected: agentCount,
    actual: Number(landingAgentBadgeMatch[1]),
    source: 'apps/web/src/app/page.tsx (N Agents Live badge)',
  });
}

// ─── Connector count ────────────────────────────────────────────────────────

// Matrix defines a specific count: 8 production-ready + 4 beta + 3 partial + 9 placeholder = 24
// minus the 3 adapters not surfaced as UI tiles (Gmail, Google Calendar, CRM fallback) = 21.
// Extract the registry claim and assert it matches the matrix summary.
const landingConnectorMatch = productTruth.match(
  /\{\s*value:\s*(\d+)\s*,\s*label:\s*['"]Connectors['"]/,
);
const matrixConnectorTotalMatch = matrix.match(/\*\*(\d+)\s+Connectors\*\*/);

if (landingConnectorMatch && matrixConnectorTotalMatch) {
  expect({
    claim: 'product-truth Connectors stat matches matrix summary',
    expected: Number(matrixConnectorTotalMatch[1]),
    actual: Number(landingConnectorMatch[1]),
    source: 'apps/web/src/lib/product-truth.ts STATS vs docs/integration-maturity-matrix.md',
  });
}

// Also assert the Connectors stat matches INTEGRATIONS_CORE +
// INTEGRATIONS_INFRA tile counts in the registry itself. This catches
// drift where the number is updated but the tiles aren't (or vice versa).
const coreTilesMatch = productTruth.match(/INTEGRATIONS_CORE\s*=\s*\[([\s\S]*?)\n\] as const;/);
const infraTilesMatch = productTruth.match(/INTEGRATIONS_INFRA\s*=\s*\[([\s\S]*?)\n\] as const;/);
if (coreTilesMatch && infraTilesMatch && landingConnectorMatch) {
  const coreCount = (coreTilesMatch[1].match(/name:\s*'/g) ?? []).length;
  const infraCount = (infraTilesMatch[1].match(/name:\s*'/g) ?? []).length;
  const tileTotal = coreCount + infraCount;
  expect({
    claim: 'product-truth Connectors stat matches INTEGRATIONS_CORE + INTEGRATIONS_INFRA tile count',
    expected: tileTotal,
    actual: Number(landingConnectorMatch[1]),
    source: 'apps/web/src/lib/product-truth.ts (Connectors stat vs tile arrays)',
  });
}

// ─── PremiumCTA stat counters ──────────────────────────────────────────────
// The `CTA_STATS` array in PremiumCTA.tsx once drifted to "113" tools after
// a toolRegistry change bumped the live count to 119. Pin each stat card
// value so that drift fails CI.

const premiumCta = read('apps/web/src/components/landing/PremiumCTA.tsx');
const ctaToolsMatch = premiumCta.match(/\{\s*value:\s*['"](\d+)['"]\s*,\s*label:\s*['"]Tools['"]/);
const ctaIntegMatch = premiumCta.match(/\{\s*value:\s*['"](\d+)['"]\s*,\s*label:\s*['"]Integrations['"]/);
const ctaAgentsMatch = premiumCta.match(/\{\s*value:\s*['"](\d+)['"]\s*,\s*label:\s*['"]Agents['"]/);

if (ctaToolsMatch) {
  expect({
    claim: 'PremiumCTA Tools counter matches toolRegistry.register() calls',
    expected: manifest.total,
    actual: Number(ctaToolsMatch[1]),
    source: 'apps/web/src/components/landing/PremiumCTA.tsx (CTA_STATS)',
  });
}
if (ctaIntegMatch && landingConnectorMatch) {
  expect({
    claim: 'PremiumCTA Integrations counter matches landing Connectors stat',
    expected: Number(landingConnectorMatch[1]),
    actual: Number(ctaIntegMatch[1]),
    source: 'apps/web/src/components/landing/PremiumCTA.tsx vs apps/web/src/app/page.tsx',
  });
}
if (ctaAgentsMatch) {
  expect({
    claim: 'PremiumCTA Agents counter matches AgentRole enum',
    expected: agentCount,
    actual: Number(ctaAgentsMatch[1]),
    source: 'apps/web/src/components/landing/PremiumCTA.tsx vs packages/shared/src/types/agent.ts',
  });
}

// ─── WhatsApp on landing (real route, real tile) ───────────────────────────
// Invariant: if apps/api/src/routes/whatsapp.routes.ts is non-trivial (>1KB)
// then the landing MUST surface WhatsApp as an integration. Hiding a working
// integration from marketing copy is still a truth-drift — under-claiming is
// as bad as over-claiming for this check.

try {
  const whatsappRoute = read('apps/api/src/routes/whatsapp.routes.ts');
  if (whatsappRoute.length > 1000 && !productTruth.includes("name: 'WhatsApp'")) {
    mismatches.push({
      claim: 'WhatsApp is implemented but missing from product-truth integration tiles',
      expected: "WhatsApp tile in INTEGRATIONS_CORE",
      actual: 'absent',
      source: 'apps/api/src/routes/whatsapp.routes.ts vs apps/web/src/lib/product-truth.ts',
    });
  }
} catch {
  // If whatsapp.routes.ts doesn't exist, this check is a no-op
}

// ─── Sentry tile honesty ───────────────────────────────────────────────────
// The Sentry tile on the landing page implies SDK-level observability. Only
// true if @sentry/node is imported in the API. Otherwise the tile must be
// labeled "Sentry MCP" to make clear it's only the agent-callable MCP server.

try {
  const apiIndex = read('apps/api/src/index.ts');
  const sentrySDKWired = apiIndex.includes('@sentry/node');
  // Bare `name: 'Sentry'` (without "MCP") implies SDK-level observability.
  // Use a strict regex so the "Sentry MCP" tile doesn't false-match.
  const truthHasBareSentry = /name:\s*'Sentry'/.test(productTruth);
  const truthHasSentryMCP = productTruth.includes("name: 'Sentry MCP'");
  if (!sentrySDKWired && truthHasBareSentry && !truthHasSentryMCP) {
    mismatches.push({
      claim: 'Sentry tile implies SDK but @sentry/node is not wired',
      expected: "tile labeled 'Sentry MCP' (agent-query only)",
      actual: "tile labeled 'Sentry' (implies SDK observability)",
      source: 'apps/web/src/lib/product-truth.ts vs apps/api/src/index.ts',
    });
  }
} catch {
  // If apps/api/src/index.ts is missing, this check is a no-op
}

// ─── Voice mock token footgun ──────────────────────────────────────────────
// voice.routes.ts used to emit a synthesized placeholder token + isMock flag
// when OPENAI_API_KEY was unset. Any frontend that forgot to check the flag
// would open a broken WebRTC session. Guard against regression.

try {
  const voiceRoute = read('apps/api/src/routes/voice.routes.ts');
  const badPatterns = [/clientToken:\s*[`'"]mock_token_/, /isMock:\s*true/];
  for (const p of badPatterns) {
    if (p.test(voiceRoute)) {
      mismatches.push({
        claim: 'voice.routes.ts must not emit a mock token in any response',
        expected: '503 VOICE_NOT_CONFIGURED when OPENAI_API_KEY unset',
        actual: `found match for ${p}`,
        source: 'apps/api/src/routes/voice.routes.ts',
      });
    }
  }
} catch {
  // skip if file doesn't exist
}

// ─── Paddle placeholder price IDs ──────────────────────────────────────────
// Placeholder defaults masked Paddle misconfig in dev. Guard against
// regression.

try {
  const paddleRoute = read('apps/api/src/routes/paddle.routes.ts');
  const badDefaults = ['pri_pro_placeholder', 'pri_team_placeholder', 'pri_enterprise_placeholder'];
  for (const bad of badDefaults) {
    if (paddleRoute.includes(bad)) {
      mismatches.push({
        claim: 'paddle.routes.ts must not default to placeholder price IDs',
        expected: 'plan map built only from real PADDLE_PRICE_* env vars',
        actual: `found '${bad}'`,
        source: 'apps/api/src/routes/paddle.routes.ts',
      });
    }
  }
} catch {
  // skip
}

// ─── Industry pack count ───────────────────────────────────────────────────
// Architecture doc claims a specific number of industry packs. Assert it
// matches the live `listIndustries()` output so a new pack (or a removed
// one) can't silently drift from the claim.
const industryPackCount = listIndustries().length;
const archDoc = read('docs/architecture.md');
const archPackCountMatch = archDoc.match(/(\d+)\s+industry\s+packs:/i);
if (archPackCountMatch) {
  expect({
    claim: 'docs/architecture.md industry pack count matches listIndustries()',
    expected: industryPackCount,
    actual: Number(archPackCountMatch[1]),
    source: 'packages/industry-packs/src/registry.ts (listIndustries)',
  });
}

// ─── Matrix maturity totals ────────────────────────────────────────────────

const matrixCounts = {
  productionReady: matrix.match(/\*\*production-ready\*\*:.*\((\d+)\)/)?.[1],
  beta: matrix.match(/\*\*beta\*\*:.*\((\d+)\)/)?.[1],
  partial: matrix.match(/\*\*partial\*\*:.*\((\d+)\)/)?.[1],
  placeholder: matrix.match(/\*\*placeholder\*\*:.*\((\d+)\)/)?.[1],
};

// ─── No-longer-current claims: flag prohibited strings ─────────────────────

const prohibitedInMarketing: Array<{ pattern: RegExp; sourceFile: 'README.md' | 'landing'; why: string }> = [
  {
    pattern: /\bHono\b/,
    sourceFile: 'README.md',
    why: 'API is Fastify, not Hono — all Hono claims were removed in b6ea08b',
  },
  {
    pattern: /no\s+api\s+keys?\s+required/i,
    sourceFile: 'README.md',
    why: 'External LLM/integration providers require keys — corrected in b6ea08b',
  },
  {
    // Wave 1: no branded crawler product named "Ducky Duck" / "DuckyDuck" exists.
    // The DDG HTML scrape is the free-tier fallback inside web_search, not a product.
    pattern: /\b(ducky[\s-]?duck|duckyduck)\b/i,
    sourceFile: 'README.md',
    why: 'No branded "Ducky Duck" crawler product exists; the DDG scrape is the free fallback inside web_search. Wave 1 recommends Serper primary.',
  },
  {
    pattern: /\b(ducky[\s-]?duck|duckyduck)\b/i,
    sourceFile: 'landing',
    why: 'No branded "Ducky Duck" crawler product exists; the DDG scrape is the free fallback inside web_search. Wave 1 recommends Serper primary.',
  },
  {
    // Wave 4 preview: block "10x cheaper" until there's a linked benchmark file.
    // When owner-run `pnpm bench:search` produces docs/_generated/search-bench.json
    // with the required comparison, this check can be relaxed — for now we block
    // any un-sourced "N-times cheaper" claim in marketing copy.
    pattern: /\b\d+x\s+cheaper\b/i,
    sourceFile: 'README.md',
    why: 'Cost-multiplier claims require a linked benchmark — run `pnpm bench:search` with real keys and link the report, or drop the claim.',
  },
  {
    pattern: /\b\d+x\s+cheaper\b/i,
    sourceFile: 'landing',
    why: 'Cost-multiplier claims require a linked benchmark — run `pnpm bench:search` with real keys and link the report, or drop the claim.',
  },
  // ─── Strict-truth pass: hero / stats / footer overclaims ───────────────
  {
    pattern: /Your\s+Entire\s+Company,?\s+Automated/i,
    sourceFile: 'landing',
    why: '"Your Entire Company, Automated" implies end-to-end autonomy that does not exist — every high-risk action goes through a HITL approval gate. Use "Specialist AI Agents, Operator-Grade Control Plane" or similar.',
  },
  {
    pattern: /autonomous\s+multi-agent\s+AI\s+platform/i,
    sourceFile: 'landing',
    why: '"Autonomous multi-agent AI platform" is stronger than runtime truth. Workflows are operator-grade with approval gates, not fully autonomous. Use "operator-grade multi-agent control plane".',
  },
  {
    pattern: /autonomous\s+multi-agent\s+AI\s+platform/i,
    sourceFile: 'README.md',
    why: 'Same as landing — "autonomous multi-agent AI platform" is stronger than runtime truth.',
  },
  {
    // "Production Tools" in marketing context blanket-claims every tool is
    // production-grade. In reality only ~47% (56/119) are `real`; the rest
    // are heuristic / llm_passthrough / config_dependent / experimental.
    // Use "Classified Tools" which points at the honest maturity labels.
    pattern: /\bproduction\s+tools\b/i,
    sourceFile: 'landing',
    why: '"Production Tools" blanket-implies all 119 are production-grade. Real breakdown: ~56 real, ~30 config_dependent, ~19 llm_passthrough, ~13 heuristic, 1 experimental. Use "Classified Tools" or "119 Tools · Honest Maturity Labels".',
  },
  {
    pattern: /\bproduction\s+tools\b/i,
    sourceFile: 'README.md',
    why: '"Production Tools" blanket-implies all 119 are production-grade. Use "Classified Tools" and link to `GET /tools/manifest` for the runtime breakdown.',
  },
];

for (const check of prohibitedInMarketing) {
  const haystack = check.sourceFile === 'README.md' ? readme : landing;
  const match = haystack.match(check.pattern);
  if (match) {
    mismatches.push({
      claim: `Prohibited phrase "${match[0]}" in ${check.sourceFile}`,
      expected: '(should not be present)',
      actual: match[0],
      source: `${check.sourceFile}: ${check.why}`,
    });
  }
}

// ─── Session 7 subset bucket counts ────────────────────────────────────────
// The 40 tools classified in commit faad80d carry expected per-bucket counts.
// If any of them silently flips maturity, or one is removed, this block fires
// and CI blocks the merge.
//
// Counts: real=17, heuristic=12, llm_passthrough=8, config_dependent=2, experimental=1.
const session7 = computeSession7Counts();
for (const [bucket, expected] of Object.entries(EXPECTED_SESSION_7_BUCKETS)) {
  const actual = session7.byMaturity[bucket] ?? 0;
  if (actual !== expected) {
    mismatches.push({
      claim: `Session 7 subset bucket ${bucket}`,
      expected,
      actual,
      source: 'scripts/verify-session7-counts.ts (update EXPECTED_SESSION_7_BUCKETS or revert the maturity change)',
    });
  }
}
if (session7.missing.length > 0) {
  mismatches.push({
    claim: 'Session 7 subset tools missing from registry',
    expected: '0',
    actual: session7.missing.join(', '),
    source: 'packages/tools/src/builtin/index.ts',
  });
}

// ─── Phase 1 invariant: approval-gate default is blocking ──────────────────
// The landing page claims "human approval on every high-risk action". That's
// only structurally true if the approval node requires an explicit tenant
// opt-in before auto-approving. If someone ever reverts approval-node.ts to
// "threshold alone is enough to bypass", this guard fires.

try {
  const approvalNode = read('packages/swarm/src/graph/nodes/approval-node.ts');
  if (!/state\.autoApproveEnabled\s*===\s*true/.test(approvalNode)) {
    mismatches.push({
      claim: 'Approval-node must require explicit autoApproveEnabled=true opt-in',
      expected: 'state.autoApproveEnabled === true guard in auto-approve branch',
      actual: 'guard missing — auto-approval silently runs on threshold alone',
      source: 'packages/swarm/src/graph/nodes/approval-node.ts',
    });
  }
} catch {
  mismatches.push({
    claim: 'approval-node.ts must exist',
    expected: 'present',
    actual: 'missing',
    source: 'packages/swarm/src/graph/nodes/approval-node.ts',
  });
}

// Prisma schema: new-tenant default stays at `autoApproveEnabled Boolean @default(false)`.
// A change to `@default(true)` would re-open the honesty gap; the migration
// back-fill is a one-time operation, NOT a new-tenant policy.
try {
  const prismaSchema = read('packages/db/prisma/schema.prisma');
  if (!/autoApproveEnabled\s+Boolean\s+@default\(false\)/.test(prismaSchema)) {
    mismatches.push({
      claim: 'Tenant.autoApproveEnabled must default to FALSE for new tenants',
      expected: 'autoApproveEnabled Boolean @default(false)',
      actual: 'default missing, removed, or set to true',
      source: 'packages/db/prisma/schema.prisma',
    });
  }
  if (!/model\s+ApprovalAuditLog\s*\{/.test(prismaSchema)) {
    mismatches.push({
      claim: 'ApprovalAuditLog model must exist in Prisma schema',
      expected: 'model ApprovalAuditLog defined with decision + approverId + decidedAt',
      actual: 'model missing — every-decision audit trail was removed',
      source: 'packages/db/prisma/schema.prisma',
    });
  }
} catch {
  // If the schema file is missing, a different failure (typecheck) will catch it
}

// ─── Phase 3 invariant: circuit-breaker threshold is 5 ────────────────────
// The landing page claims "After 5 consecutive failures, the circuit opens".
// If the default failureThreshold drifts away from 5 (or the comment says one
// thing while the code does another), observability docs become lies.

try {
  const breaker = read('apps/api/src/coordination/distributed-circuit-breaker.ts');
  if (!/failureThreshold\s*\?\?\s*5\b/.test(breaker)) {
    mismatches.push({
      claim: 'DistributedCircuitBreaker default failureThreshold must be 5',
      expected: '`this.failureThreshold = options.failureThreshold ?? 5;`',
      actual: 'default threshold changed or removed',
      source: 'apps/api/src/coordination/distributed-circuit-breaker.ts',
    });
  }
  if (!/resetTimeoutMs\s*\?\?\s*30_000\b/.test(breaker)) {
    mismatches.push({
      claim: 'DistributedCircuitBreaker default resetTimeoutMs must be 30_000',
      expected: '`this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;`',
      actual: 'default reset timeout changed or removed',
      source: 'apps/api/src/coordination/distributed-circuit-breaker.ts',
    });
  }
} catch {
  // skip
}

// ─── Phase 2 invariant: SECURITY.md + Dependabot + dual-use notes exist ────
try {
  read('SECURITY.md');
} catch {
  mismatches.push({
    claim: 'SECURITY.md must exist at repo root',
    expected: 'present',
    actual: 'missing',
    source: 'SECURITY.md (vulnerability disclosure policy)',
  });
}
try {
  read('.github/dependabot.yml');
} catch {
  mismatches.push({
    claim: '.github/dependabot.yml must exist',
    expected: 'present',
    actual: 'missing',
    source: '.github/dependabot.yml (weekly dep updates)',
  });
}
try {
  read('docs/SECURITY-NOTES.md');
} catch {
  mismatches.push({
    claim: 'docs/SECURITY-NOTES.md must exist',
    expected: 'present',
    actual: 'missing',
    source: 'docs/SECURITY-NOTES.md (dual-use surface inventory)',
  });
}

// ─── Report ────────────────────────────────────────────────────────────────

const report = {
  generatedAt: new Date().toISOString(),
  toolManifest: {
    total: manifest.total,
    byMaturity: manifest.byMaturity,
    byCategory: manifest.byCategory,
    requiresApproval: manifest.requiresApproval,
    liveTested: manifest.liveTested,
    unclassifiedCount: manifest.byMaturity.unclassified,
  },
  session7Subset: {
    total: session7.total,
    byMaturity: session7.byMaturity,
    expected: EXPECTED_SESSION_7_BUCKETS,
  },
  integrationMatrix: matrixCounts,
  mismatches,
};

mkdirSync(resolve(repoRoot, 'docs/_generated'), { recursive: true });
writeFileSync(
  resolve(repoRoot, 'docs/_generated/truth-report.json'),
  JSON.stringify(report, null, 2) + '\n',
  'utf8',
);

// Session 7 invariant: no tool may ship without a maturity classification.
// A new unclassified tool would silently inflate the "production tools" count
// without any claim about what it actually does — we gate CI against that.
if (manifest.byMaturity.unclassified > 0) {
  mismatches.push({
    claim: 'All built-in tools must carry a maturity classification',
    expected: 0,
    actual: manifest.byMaturity.unclassified,
    source: `unclassified tools: ${manifest.unclassifiedNames.slice(0, 10).join(', ')}${manifest.unclassifiedNames.length > 10 ? ', …' : ''}`,
  });
}

if (mismatches.length === 0) {
  // eslint-disable-next-line no-console
  console.log(
    `[truth-check] OK — ${manifest.total} tools registered, ${manifest.byMaturity.unclassified} unclassified. Report: docs/_generated/truth-report.json`,
  );
  process.exit(0);
}

// eslint-disable-next-line no-console
console.error(`[truth-check] FAIL — ${mismatches.length} drift(s) detected:`);
for (const m of mismatches) {
  // eslint-disable-next-line no-console
  console.error(`  • ${m.claim}`);
  // eslint-disable-next-line no-console
  console.error(`    expected: ${m.expected}`);
  // eslint-disable-next-line no-console
  console.error(`    actual:   ${m.actual}`);
  // eslint-disable-next-line no-console
  console.error(`    source:   ${m.source}`);
}
process.exit(1);
