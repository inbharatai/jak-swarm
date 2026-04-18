/**
 * scripts/classify-builtin-tools.ts
 *
 * One-shot bulk classifier for packages/tools/src/builtin/index.ts.
 *
 * For each `toolRegistry.register({ ... }, async ...)` block that does NOT
 * already declare a `maturity:` field, inspects the executor body and inserts
 * maturity + sideEffectLevel + requiredEnvVars + liveTested based on
 * conservative pattern detection. Unknown / ambiguous tools are left
 * unclassified — this classifier never guesses.
 *
 * Run: `pnpm --filter @jak-swarm/tests exec tsx ../scripts/classify-builtin-tools.ts`
 * Emits a summary of how many tools moved out of 'unclassified'.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, '..', 'packages/tools/src/builtin/index.ts');

type Maturity = 'real' | 'config_dependent' | 'heuristic' | 'llm_passthrough';
type SideEffect = 'read' | 'write' | 'destructive' | 'external';

interface Classification {
  maturity: Maturity;
  sideEffectLevel: SideEffect;
  requiredEnvVars?: string[];
  reason: string;
}

/**
 * Classify a tool's executor body text. Returns null for ambiguous cases
 * so they remain unclassified rather than getting a wrong label.
 */
function classify(name: string, body: string, riskHint: string): Classification | null {
  const b = body;

  // LLM passthrough: explicit marker or the "X not connected" stub pattern.
  if (/toolType:\s*['"]llm_passthrough['"]/.test(b)) {
    return { maturity: 'llm_passthrough', sideEffectLevel: 'read', reason: 'explicit toolType marker' };
  }
  if (/connected:\s*false/.test(b) && /message:\s*['"][^'"]*not connected/i.test(b)) {
    return { maturity: 'llm_passthrough', sideEffectLevel: 'read', reason: 'stub returning connected=false' };
  }

  // Email / Gmail adapter — config-dependent with known env vars.
  if (/emailAdapter\.|gmailAdapter\.|gmail_/.test(b) || /emailAdapter\./.test(b)) {
    const sideEffect: SideEffect = /send|createDraft|deleteMessage/.test(b)
      ? 'external'
      : /draft|create/i.test(name) ? 'write' : 'read';
    return {
      maturity: 'config_dependent',
      sideEffectLevel: sideEffect,
      requiredEnvVars: ['GMAIL_EMAIL', 'GMAIL_APP_PASSWORD'],
      reason: 'emailAdapter call',
    };
  }

  // Calendar / CalDAV adapter.
  if (/calendarAdapter\.|calDav|CALDAV/i.test(b)) {
    const sideEffect: SideEffect = /create|update|delete/i.test(name) ? 'external' : 'read';
    return {
      maturity: 'config_dependent',
      sideEffectLevel: sideEffect,
      requiredEnvVars: ['CALDAV_USERNAME', 'CALDAV_PASSWORD', 'CALDAV_URL'],
      reason: 'CalDAV adapter call',
    };
  }

  // MCP-based tool — depends on connected MCP providers.
  if (/mcpClientManager\.|getTenantMcpManager|tenantMcp\./.test(b)) {
    return {
      maturity: 'config_dependent',
      sideEffectLevel: riskHint === 'EXTERNAL_SIDE_EFFECT' ? 'external' : /write|update|create|send/i.test(name) ? 'write' : 'read',
      reason: 'MCP tool call',
    };
  }

  // Playwright / browser automation.
  if (/getBrowserPool|page\.goto|page\.click|page\.fill|page\.screenshot|browserPool\.|chromium\./.test(b)) {
    const isSocial = /post_to_twitter|post_to_linkedin|post_to_reddit/.test(name);
    return {
      maturity: isSocial ? 'config_dependent' : 'real',
      sideEffectLevel: /post|fill|click|submit|publish/.test(name) ? 'external' : 'read',
      reason: isSocial ? 'browser automation requiring login' : 'Playwright browser automation',
    };
  }

  // GitHub API — fetch + GITHUB_PAT.
  if (/github_/.test(name) && /process\.env\[?['"]?GITHUB_PAT/.test(b)) {
    return {
      maturity: 'config_dependent',
      sideEffectLevel: /create|push|commit|delete/.test(name) ? 'external' : 'read',
      requiredEnvVars: ['GITHUB_PAT'],
      reason: 'GitHub REST with PAT',
    };
  }

  // Vercel deploy — VERCEL_TOKEN.
  if (/VERCEL_TOKEN/.test(b)) {
    return {
      maturity: 'config_dependent',
      sideEffectLevel: 'external',
      requiredEnvVars: ['VERCEL_TOKEN'],
      reason: 'Vercel API',
    };
  }

  // Sandbox-backed execution.
  if (/getSandboxAdapter|adapter\.execCommand|adapter\.create\(|adapter\.destroy\(/.test(b)) {
    return {
      maturity: 'real',
      sideEffectLevel: /exec|run|install/.test(name) ? 'write' : 'read',
      reason: 'Docker / E2B sandbox',
    };
  }

  // Memory / vector store round-trip.
  if (/memory_store|memory_retrieve|vectorStore\./.test(b) || /memory_/.test(name)) {
    return {
      maturity: 'real',
      sideEffectLevel: /store|write|create/.test(name) ? 'write' : 'read',
      reason: 'scoped-memory v2 store',
    };
  }

  // Verification module — routes to @jak-swarm/verification.
  if (/import\(['"]@jak-swarm\/verification['"]\)|from ['"]@jak-swarm\/verification['"]/.test(b)) {
    return {
      maturity: 'config_dependent',
      sideEffectLevel: 'read',
      reason: '@jak-swarm/verification module',
    };
  }

  // DNS-backed checks (deliverability, domain lookup).
  if (/dns\.promises|resolveMx|resolve4|resolveTxt/.test(b)) {
    return {
      maturity: 'real',
      sideEffectLevel: 'read',
      reason: 'DNS lookup',
    };
  }

  // PDF / document local processing.
  if (/pdf-parse|pdfjs|sharp\.|pdfkit|docxGenerator/.test(b)) {
    return {
      maturity: 'real',
      sideEffectLevel: 'read',
      reason: 'local document processing library',
    };
  }

  // File system read/write (sandboxed).
  if (/file_read|file_write|list_directory/.test(name)) {
    return {
      maturity: 'real',
      sideEffectLevel: /write|delete/.test(name) ? 'write' : 'read',
      reason: 'tenant-scoped filesystem',
    };
  }

  // web_fetch / generic HTTP.
  if (/^web_fetch$|^web_scrape$/.test(name)) {
    return {
      maturity: 'real',
      sideEffectLevel: 'external',
      reason: 'generic HTTP fetch',
    };
  }

  // Ambiguous — don't guess.
  return null;
}

// ─── Block parser ──────────────────────────────────────────────────────────

const src = readFileSync(target, 'utf8');
const lines = src.split(/\r?\n/);

interface Block {
  startLine: number;   // line of `toolRegistry.register(`
  metaStart: number;   // line of `{` — metadata object open
  metaEnd: number;     // line of `},` — metadata object close
  executorEnd: number; // line of `  );` — register call close
  name: string;
  hasMaturity: boolean;
  requiresApprovalLine: number; // line where `requiresApproval:` sits (for inserting after)
  body: string;        // executor body text between metaEnd and executorEnd
  riskHint: string;    // riskClass value
}

const blocks: Block[] = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]!;
  if (!/^\s*toolRegistry\.register\(\s*$/.test(line)) continue;

  const startLine = i;
  // Expect `{` on next line
  const metaStart = i + 1;
  if (!/^\s*\{\s*$/.test(lines[metaStart] ?? '')) continue;

  // Walk forward, tracking brace depth, until we hit `    },` at depth 0 closing the metadata object.
  let depth = 1;
  let metaEnd = -1;
  for (let j = metaStart + 1; j < lines.length; j++) {
    const l = lines[j] ?? '';
    for (const ch of l) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0) {
      metaEnd = j;
      break;
    }
  }
  if (metaEnd === -1) continue;

  // Extract metadata slice
  const metaSlice = lines.slice(metaStart, metaEnd + 1).join('\n');
  const nameMatch = metaSlice.match(/name:\s*['"]([^'"]+)['"]/);
  if (!nameMatch) continue;
  const name = nameMatch[1]!;
  const hasMaturity = /maturity:\s*['"]/.test(metaSlice);
  const requiresApprovalLineIdx = lines
    .slice(metaStart, metaEnd)
    .findIndex((l) => /^\s*requiresApproval:/.test(l));
  if (requiresApprovalLineIdx === -1) continue;
  const requiresApprovalLine = metaStart + requiresApprovalLineIdx;

  const riskMatch = metaSlice.match(/riskClass:\s*ToolRiskClass\.(\w+)/);
  const riskHint = riskMatch?.[1] ?? 'READ_ONLY';

  // Now walk forward from metaEnd through the executor until the matching `  );`.
  // Depth-track `(` `)` starting from 1 (the open paren on line `toolRegistry.register(`).
  let parenDepth = 1;
  let executorEnd = -1;
  for (let j = metaEnd + 1; j < lines.length; j++) {
    const l = lines[j] ?? '';
    for (const ch of l) {
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
    }
    if (parenDepth === 0) {
      executorEnd = j;
      break;
    }
  }
  if (executorEnd === -1) continue;

  const body = lines.slice(metaEnd + 1, executorEnd).join('\n');

  blocks.push({
    startLine,
    metaStart,
    metaEnd,
    executorEnd,
    name,
    hasMaturity,
    requiresApprovalLine,
    body,
    riskHint,
  });

  i = executorEnd;
}

// ─── Classify + patch ──────────────────────────────────────────────────────

interface Plan {
  name: string;
  classification: Classification;
  insertAfterLine: number;
  indent: string;
}

const plans: Plan[] = [];
const skipped: Array<{ name: string; reason: string }> = [];

for (const block of blocks) {
  if (block.hasMaturity) {
    skipped.push({ name: block.name, reason: 'already classified' });
    continue;
  }
  const classification = classify(block.name, block.body, block.riskHint);
  if (!classification) {
    skipped.push({ name: block.name, reason: 'ambiguous body — left unclassified' });
    continue;
  }
  const requiresApprovalText = lines[block.requiresApprovalLine] ?? '';
  const indent = (requiresApprovalText.match(/^(\s*)/)?.[1] ?? '      ');
  plans.push({
    name: block.name,
    classification,
    insertAfterLine: block.requiresApprovalLine,
    indent,
  });
}

// Apply plans in REVERSE order so earlier line numbers don't shift.
const patched = [...lines];
plans.sort((a, b) => b.insertAfterLine - a.insertAfterLine);

for (const plan of plans) {
  const c = plan.classification;
  const envLine =
    c.requiredEnvVars && c.requiredEnvVars.length > 0
      ? `${plan.indent}requiredEnvVars: [${c.requiredEnvVars.map((e) => `'${e}'`).join(', ')}],`
      : null;
  const newLines: string[] = [
    `${plan.indent}maturity: '${c.maturity}',`,
    ...(envLine ? [envLine] : []),
    `${plan.indent}liveTested: false,`,
    `${plan.indent}sideEffectLevel: '${c.sideEffectLevel}',`,
  ];
  patched.splice(plan.insertAfterLine + 1, 0, ...newLines);
}

writeFileSync(target, patched.join('\n'), 'utf8');

// ─── Report ────────────────────────────────────────────────────────────────

const byMaturity: Record<string, number> = {};
for (const p of plans) {
  byMaturity[p.classification.maturity] = (byMaturity[p.classification.maturity] ?? 0) + 1;
}

/* eslint-disable no-console */
console.log(`[classify-builtin-tools] Patched ${plans.length} tool(s):`);
for (const [m, n] of Object.entries(byMaturity)) {
  console.log(`  ${m.padEnd(18)} ${n}`);
}
console.log(`[classify-builtin-tools] Skipped ${skipped.length}:`);
const skipByReason: Record<string, number> = {};
for (const s of skipped) {
  skipByReason[s.reason] = (skipByReason[s.reason] ?? 0) + 1;
}
for (const [r, n] of Object.entries(skipByReason)) {
  console.log(`  ${r.padEnd(40)} ${n}`);
}
/* eslint-enable no-console */
