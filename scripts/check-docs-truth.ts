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
const landing = read('apps/web/src/app/page.tsx');
const matrix = read('docs/integration-maturity-matrix.md');

// ─── Tool count ─────────────────────────────────────────────────────────────

// README: "Production_Tools-119"
const readmeToolBadgeMatch = readme.match(/Production_Tools-(\d+)/);
if (readmeToolBadgeMatch) {
  expect({
    claim: 'README production-tools badge count',
    expected: manifest.total,
    actual: Number(readmeToolBadgeMatch[1]),
    source: 'README.md (Production_Tools-N badge)',
  });
}

// README: "119 Production Tools"
const readmeToolHeadlineMatch = readme.match(/(\d+)\s+Production\s+Tools/i);
if (readmeToolHeadlineMatch) {
  expect({
    claim: 'README production-tools headline count',
    expected: manifest.total,
    actual: Number(readmeToolHeadlineMatch[1]),
    source: 'README.md (N Production Tools)',
  });
}

// Landing: { value: 119, label: 'Production Tools' }
const landingToolMatch = landing.match(
  /\{\s*value:\s*(\d+)\s*,\s*label:\s*['"]Production Tools['"]/,
);
if (landingToolMatch) {
  expect({
    claim: 'Landing production-tools stat',
    expected: manifest.total,
    actual: Number(landingToolMatch[1]),
    source: 'apps/web/src/app/page.tsx STATS',
  });
}

// ─── Connector count ────────────────────────────────────────────────────────

// Matrix defines a specific count: 8 production-ready + 4 beta + 3 partial + 9 placeholder = 24
// minus the 3 adapters not surfaced as UI tiles (Gmail, Google Calendar, CRM fallback) = 21.
// We extract the landing-page claim and assert it matches the matrix's summary line.
const landingConnectorMatch = landing.match(
  /\{\s*value:\s*(\d+)\s*,\s*label:\s*['"]Connectors['"]/,
);
const matrixConnectorTotalMatch = matrix.match(/\*\*(\d+)\s+Connectors\*\*/);

if (landingConnectorMatch && matrixConnectorTotalMatch) {
  expect({
    claim: 'Landing Connectors stat matches matrix summary',
    expected: Number(matrixConnectorTotalMatch[1]),
    actual: Number(landingConnectorMatch[1]),
    source: 'apps/web/src/app/page.tsx STATS vs docs/integration-maturity-matrix.md',
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
