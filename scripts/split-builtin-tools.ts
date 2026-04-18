/**
 * scripts/split-builtin-tools.ts — PARTIAL PREP FOR P2b-split
 *
 * Splits packages/tools/src/builtin/index.ts (5.8k lines, 119 registrations in
 * one function) into one category file per ToolCategory. The block-parse +
 * by-category grouping is correct and deterministic (all 119 blocks accounted
 * for across 9 categories when run).
 *
 * ⚠️  NOT YET USABLE END-TO-END. Running this script in isolation produces
 * category files that FAIL typecheck because tool bodies have two additional
 * dependencies the script does not yet rewrite:
 *
 *   1. Dynamic imports — ~36 `await import('../adapters/...)` call sites
 *      inside tool bodies use paths relative to builtin/index.ts. When moved
 *      into builtin/categories/<cat>.ts they need to become
 *      `await import('../../adapters/...)`.
 *
 *   2. Function-scope helpers — `searchDuckDuckGo` and `fetchPageContent` are
 *      declared inside registerBuiltinTools() (around lines 598 + 672 of the
 *      pre-split file) and used by multiple research tools. They need to be
 *      extracted to module scope (either a shared helpers file or inlined into
 *      categories/research.ts since only research tools consume them).
 *
 *   3. `buildIdempotencyKey` — trailing helper after registerBuiltinTools,
 *      consumed only by knowledge tools. Inline into categories/knowledge.ts.
 *
 * When finishing this script: add a post-processing pass that rewrites
 * dynamic imports and emits shared helpers before writing category files.
 * The existing block-parse logic can stay as-is.
 *
 * Run (once the above is fixed):
 *   `pnpm --filter @jak-swarm/tests exec tsx ../scripts/split-builtin-tools.ts`
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const monolith = resolve(repoRoot, 'packages/tools/src/builtin/index.ts');
const categoriesDir = resolve(repoRoot, 'packages/tools/src/builtin/categories');
const sharedFile = resolve(repoRoot, 'packages/tools/src/builtin/_shared.ts');

// ─── Read source ──────────────────────────────────────────────────────────

const src = readFileSync(monolith, 'utf8');
const lines = src.split(/\r?\n/);

// ─── Find registerBuiltinTools function boundaries ────────────────────────

const regStartIdx = lines.findIndex((l) => /^export function registerBuiltinTools\(/.test(l));
if (regStartIdx === -1) throw new Error('registerBuiltinTools not found');

// Naïve brace counting trips on regex literals / template strings inside tool
// bodies. The function is top-level, so its closing brace is the first line
// matching `^}$` after regStartIdx — unambiguous.
const bodyStart = regStartIdx; // open brace `{` is on this same line
let bodyEnd = -1;
for (let i = regStartIdx + 1; i < lines.length; i++) {
  if (/^\}\s*$/.test(lines[i] ?? '')) {
    bodyEnd = i;
    break;
  }
}
if (bodyEnd === -1) throw new Error('Could not locate registerBuiltinTools closing brace');

// Header = everything before `export function registerBuiltinTools...`
const header = lines.slice(0, regStartIdx).join('\n');
// Trailing content AFTER the function's closing brace (module-scope helpers
// declared after registerBuiltinTools, e.g. buildIdempotencyKey).
const trailer = lines.slice(bodyEnd + 1).join('\n');
// Function-body content (between the opening `{` and the closing `}`)
const bodyLines = lines.slice(bodyStart + 1, bodyEnd);

// ─── Parse register blocks inside the body ────────────────────────────────

interface Block {
  startLineInBody: number; // first line of the block (may include leading comments)
  endLineInBody: number;   // line of the closing `);`
  category: string;
  text: string;
}

const blocks: Block[] = [];

for (let i = 0; i < bodyLines.length; i++) {
  const line = bodyLines[i] ?? '';
  if (!/^\s*toolRegistry\.register\(\s*$/.test(line)) continue;

  // The register call closes at an indent-4 `  );` (two-space function indent +
  // two-space arg indent in this codebase). Use that as the unambiguous end
  // marker rather than paren depth, which trips on parens inside regex / string
  // literals in tool bodies.
  let endLine = -1;
  for (let j = i + 1; j < bodyLines.length; j++) {
    if (/^\s{2,4}\);\s*$/.test(bodyLines[j] ?? '')) {
      endLine = j;
      break;
    }
  }
  if (endLine === -1) continue;

  const blockText = bodyLines.slice(i, endLine + 1).join('\n');
  // Category can be declared as `ToolCategory.X` (typed) or `'X' as any` (the
  // 5 tools that pre-dated proper typing). Support both forms.
  const catEnumMatch = blockText.match(/category:\s*ToolCategory\.(\w+)/);
  const catStringMatch = !catEnumMatch && blockText.match(/category:\s*['"](\w+)['"]\s+as\s+any/);
  const category = catEnumMatch?.[1] ?? catStringMatch?.[1] ?? 'UNCATEGORIZED';

  // Walk backwards from i to include preceding comment/blank lines that
  // describe THIS block and aren't shared with the previous block.
  let start = i;
  while (start > 0) {
    const prev = bodyLines[start - 1] ?? '';
    if (/^\s*\/\/[^─]/.test(prev)) {
      // Single-line comment (but not a section divider starting with ───)
      start--;
    } else {
      break;
    }
  }

  blocks.push({
    startLineInBody: start,
    endLineInBody: endLine,
    category,
    text: bodyLines.slice(start, endLine + 1).join('\n'),
  });

  i = endLine;
}

// ─── Group by category ────────────────────────────────────────────────────

const byCategory = new Map<string, Block[]>();
for (const b of blocks) {
  const arr = byCategory.get(b.category) ?? [];
  arr.push(b);
  byCategory.set(b.category, arr);
}

// ─── Emit _shared.ts (header imports + helpers) ──────────────────────────

const sharedPreamble = `/**
 * Auto-generated by scripts/split-builtin-tools.ts (P2b-split).
 *
 * Module-scope imports, adapters, and helpers used by the per-category
 * register<Cat>Tools() functions under ./categories/.
 */
`;

const sharedContent = `${sharedPreamble}${header}\n`;
writeFileSync(sharedFile, sharedContent, 'utf8');

// ─── Emit category files ──────────────────────────────────────────────────

if (existsSync(categoriesDir)) rmSync(categoriesDir, { recursive: true, force: true });
mkdirSync(categoriesDir, { recursive: true });

function toPascal(cat: string): string {
  // EMAIL -> Email; CRM -> Crm; SPREADSHEET -> Spreadsheet
  if (cat.length === 0) return '';
  if (cat === cat.toUpperCase()) {
    return cat[0] + cat.slice(1).toLowerCase();
  }
  return cat;
}

const categoryFnNames: Array<{ cat: string; file: string; fnName: string; count: number }> = [];
const sortedCats = [...byCategory.keys()].sort();

for (const cat of sortedCats) {
  const catBlocks = byCategory.get(cat)!;
  const fnName = `register${toPascal(cat)}Tools`;
  const fileBasename = cat.toLowerCase() + '.ts';
  const filePath = resolve(categoriesDir, fileBasename);

  const body = catBlocks.map((b) => b.text).join('\n\n');

  // We re-export every identifier the main block may reference from _shared.
  // A blanket `import * as shared` would work but obscures names and breaks
  // typechecking of unused identifiers. Simplest + safest: import every name
  // referenced from the original header. Since we preserved the header verbatim
  // in _shared.ts, and we don't know which names each category uses, we
  // re-export them all from _shared as a named list.
  //
  // BUT: `export *` would require _shared to itself `export` those, which it
  // already does for `toolRegistry` etc via the original imports being plain
  // imports (not exports). So instead we re-use the canonical imports.

  const content = `/**
 * Auto-generated by scripts/split-builtin-tools.ts (P2b-split).
 *
 * Category: ${cat}
 * Tool count: ${catBlocks.length}
 *
 * Do not edit this file directly unless you're adding/modifying a tool in
 * this category. Cross-category helpers live in ../_shared.ts.
 */
import { ToolCategory, ToolRiskClass } from '@jak-swarm/shared';
import type { ToolExecutionContext } from '@jak-swarm/shared';
import { toolRegistry } from '../../registry/tool-registry.js';
import { UnconfiguredCRMAdapter } from '../../adapters/unconfigured.js';
import { getMemoryAdapter } from '../../adapters/memory/db-memory.adapter.js';
import { getEmailAdapter, getCalendarAdapter, getCRMAdapterFromEnv } from '../../adapters/adapter-factory.js';

const emailAdapter = getEmailAdapter();
const calendarAdapter = getCalendarAdapter();
const crmAdapter = getCRMAdapterFromEnv() ?? new UnconfiguredCRMAdapter();

function normalizeAllowedDomain(domain: string): string | null {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) return null;
  const withoutScheme = trimmed.replace(/^[a-z]+:\\/\\//, '');
  const withoutPath = withoutScheme.split('/')[0] ?? '';
  const withoutPort = withoutPath.split(':')[0] ?? '';
  const withoutWildcard = withoutPort.startsWith('*.') ? withoutPort.slice(2) : withoutPort;
  return withoutWildcard || null;
}

function isHostAllowed(host: string, allowedDomains: string[]): boolean {
  const normalizedHost = host.toLowerCase();
  for (const domain of allowedDomains) {
    const normalized = normalizeAllowedDomain(domain);
    if (!normalized) continue;
    if (normalizedHost === normalized || normalizedHost.endsWith(\`.\${normalized}\`)) return true;
  }
  return false;
}

function checkBrowserAllowlist(
  url: string,
  context: ToolExecutionContext,
): { error: string; code: string } | null {
  const allowedDomains = context.allowedDomains ?? [];
  if (allowedDomains.length === 0) {
    return {
      error: 'Browser domain allowlist is empty for this tenant. Configure allowedDomains to enable browser navigation.',
      code: 'DOMAIN_BLOCKED',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: \`Invalid URL: \${url}\`, code: 'INVALID_URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: \`Unsupported URL scheme: \${parsed.protocol}\`, code: 'INVALID_URL' };
  }
  const host = parsed.hostname.toLowerCase();
  if (!isHostAllowed(host, allowedDomains)) {
    return {
      error: \`Domain '\${host}' is not in the allowedDomains list for this tenant.\`,
      code: 'DOMAIN_BLOCKED',
    };
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
void checkBrowserAllowlist;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
void emailAdapter;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
void calendarAdapter;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
void crmAdapter;

export function ${fnName}(): void {
${body}
}
`;

  writeFileSync(filePath, content, 'utf8');
  categoryFnNames.push({ cat, file: fileBasename, fnName, count: catBlocks.length });
}

// ─── Emit new index.ts orchestrator ───────────────────────────────────────

const importLines = categoryFnNames
  .map((c) => `import { ${c.fnName} } from './categories/${c.file.replace('.ts', '.js')}';`)
  .join('\n');

const callLines = categoryFnNames
  .map((c) => `  ${c.fnName}();`)
  .join('\n');

const newIndex = `/**
 * Built-in tool registration — category-split by P2b-split.
 *
 * Each ./categories/<cat>.ts registers the tools for one ToolCategory and
 * exports a single register<Cat>Tools() function. This file just composes
 * them in a fixed order at startup.
 *
 * registerBuiltinTools() is idempotent — bails out if the registry is already
 * populated — so test beforeAll patterns continue to work even though the
 * registry now throws on individual duplicate registrations.
 */
import { toolRegistry } from '../registry/tool-registry.js';
${importLines}

export function registerBuiltinTools(): void {
  if (toolRegistry.list().length > 0) return;
${callLines}
}
${trailer ? '\n' + trailer : ''}`;

writeFileSync(monolith, newIndex, 'utf8');

// ─── Report ──────────────────────────────────────────────────────────────

/* eslint-disable no-console */
console.log(`[split-builtin-tools] Wrote ${categoryFnNames.length} category files:`);
for (const c of categoryFnNames) {
  console.log(`  categories/${c.file.padEnd(20)}  ${String(c.count).padStart(3)} tools   ${c.fnName}()`);
}
console.log(`[split-builtin-tools] New index.ts is ${newIndex.split('\n').length} lines`);
console.log(`[split-builtin-tools] _shared.ts written (preserved for future cross-category helpers)`);
/* eslint-enable no-console */
