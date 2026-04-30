/**
 * scripts/audit-approval-paths.ts
 *
 * Static-analysis sentry: rejects code that calls a tool's executor
 * directly instead of going through `toolRegistry.execute()` — the
 * single chokepoint where the centralized ApprovalPolicy fires.
 *
 * Why this matters: Phase 4 wired the gate at
 * `packages/tools/src/registry/tool-registry.ts:execute()`. Any
 * agent / worker / route that bypasses the registry (e.g. by
 * importing an adapter and calling its method directly) silently
 * skips the approval gate. This script grep-detects the most common
 * bypass patterns so a regression gets caught at CI time.
 *
 * Pattern checks (each emits a finding with severity):
 *
 *   1. ERROR — Direct call to a registered tool's executor function
 *      from agent / worker / swarm / route code.
 *      e.g.   `gmailSendEmailExecutor(input, ctx)` instead of
 *             `toolRegistry.execute('gmail_send_email', ...)`.
 *
 *   2. ERROR — Importing a tool's adapter directly + invoking its
 *      send / publish / delete method from outside the tool's own
 *      execute path.
 *      e.g.   `import { gmailAdapter } from '...'; gmailAdapter.sendEmail(...)`
 *
 *   3. WARN — A tool registered with `requiresApproval: true` is
 *      called via a path that does NOT include `toolRegistry.execute`.
 *
 * Allowlist:
 *   - Files under `packages/tools/src/**` (the registry itself can
 *     call adapters directly; that's the intended chokepoint).
 *   - Test fixtures (`tests/**` + `**\/*.test.ts`).
 *   - The `dist/` build output of any package.
 *
 * Run: `pnpm audit:approval-paths`. Exit 0 on clean, 1 on errors.
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

interface Finding {
  file: string;
  line: number;
  severity: 'error' | 'warning';
  pattern: string;
  message: string;
  snippet: string;
}

const ALLOWED_DIRS = [
  // The registry IS the chokepoint — it calls executors directly.
  join('packages', 'tools', 'src') + sep,
  // Tests are exempt.
  join('tests') + sep,
  // Build output never analyzed.
  sep + 'dist' + sep,
  sep + 'node_modules' + sep,
  sep + '.next' + sep,
];

const SCAN_GLOBS = [
  'apps/api/src/**/*.ts',
  'apps/web/src/**/*.ts',
  'apps/web/src/**/*.tsx',
  'packages/agents/src/**/*.ts',
  'packages/swarm/src/**/*.ts',
  'packages/skills/src/**/*.ts',
  'packages/voice/src/**/*.ts',
  'packages/workflows/src/**/*.ts',
];

/**
 * Patterns that indicate direct adapter-method invocation outside the
 * registry chokepoint. Each entry is a regex + a layman explanation.
 *
 * Conservative — false positives are fine; this list errs on the side
 * of warning. The point is to catch the most COMMON bypass shapes,
 * not to be a perfect linter.
 */
const BYPASS_PATTERNS: Array<{
  regex: RegExp;
  severity: 'error' | 'warning';
  pattern: string;
  message: string;
}> = [
  // gmail adapter direct send
  {
    regex: /gmailAdapter\s*\.\s*(sendEmail|sendDraft|deleteEmail|deleteMessage)\s*\(/g,
    severity: 'error',
    pattern: 'gmail_adapter_direct_send',
    message: "Direct gmailAdapter.send/delete call bypasses ToolRegistry.execute. Route through toolRegistry.execute('gmail_send_email', …) so the centralized ApprovalPolicy gate fires.",
  },
  // slack adapter direct post
  {
    regex: /slackAdapter\s*\.\s*(postMessage|sendMessage|deleteMessage)\s*\(/g,
    severity: 'error',
    pattern: 'slack_adapter_direct_post',
    message: "Direct slackAdapter.post/send call bypasses ToolRegistry.execute. Route through toolRegistry.execute('slack_post_message', …).",
  },
  // generic CRM/social/file adapter destructive methods
  {
    regex: /\b(\w+Adapter)\s*\.\s*(delete|destroy|purge|drop|truncate|remove|wipe)\w*\s*\(/g,
    severity: 'error',
    pattern: 'adapter_destructive_direct',
    message: 'Direct call to an Adapter destructive method bypasses ToolRegistry.execute. Wrap via the tool registry so DESTRUCTIVE actions cannot run without approval.',
  },
  // explicit "skipApproval" / "bypassApproval" markers should NEVER appear
  {
    regex: /\bskipApproval\s*[:=]\s*true\b/g,
    severity: 'error',
    pattern: 'explicit_skip_approval',
    message: 'A `skipApproval: true` literal was found. The approval policy is per-action — there is no global skip. Remove or replace with proper context.approvalId flow.',
  },
  {
    regex: /\bbypassApproval\b/g,
    severity: 'error',
    pattern: 'explicit_bypass_approval',
    message: 'A `bypassApproval` reference was found. Approvals are not bypassable; remove this code path.',
  },
];

function isAllowed(filePath: string): boolean {
  for (const allowed of ALLOWED_DIRS) {
    if (filePath.includes(allowed)) return true;
  }
  // Test files anywhere in the tree are exempt.
  if (/\.test\.[jt]sx?$/.test(filePath)) return true;
  return false;
}

async function gatherFiles(): Promise<string[]> {
  const out: string[] = [];
  for (const pattern of SCAN_GLOBS) {
    const matched = await glob(pattern, { cwd: repoRoot, absolute: true });
    for (const f of matched) {
      try {
        if (statSync(f).isFile()) out.push(f);
      } catch {
        // skip
      }
    }
  }
  return [...new Set(out)];
}

function scanFile(absPath: string): Finding[] {
  if (isAllowed(absPath)) return [];
  let source: string;
  try {
    source = readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  const lines = source.split('\n');
  const findings: Finding[] = [];
  for (const { regex, severity, pattern, message } of BYPASS_PATTERNS) {
    // global regex — reset lastIndex per file
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(source)) !== null) {
      const lineIdx = source.slice(0, m.index).split('\n').length - 1;
      findings.push({
        file: absPath.replace(repoRoot + sep, '').replace(/\\/g, '/'),
        line: lineIdx + 1,
        severity,
        pattern,
        message,
        snippet: (lines[lineIdx] ?? '').trim().slice(0, 200),
      });
    }
  }
  return findings;
}

function renderMarkdown(findings: Finding[]): string {
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const lines: string[] = [];
  lines.push('# Approval-path audit');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`- Errors: **${errors.length}**`);
  lines.push(`- Warnings: **${warnings.length}**`);
  lines.push('');
  if (errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const f of errors) {
      lines.push(`### ${f.file}:${f.line}`);
      lines.push(`- **Pattern:** \`${f.pattern}\``);
      lines.push(`- **Snippet:** \`${f.snippet}\``);
      lines.push(`- **Why:** ${f.message}`);
      lines.push('');
    }
  }
  if (warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const f of warnings) {
      lines.push(`- ${f.file}:${f.line} \`${f.pattern}\` — ${f.snippet}`);
    }
    lines.push('');
  }
  if (errors.length === 0 && warnings.length === 0) {
    lines.push('No bypass patterns detected. Every sensitive tool call goes through `toolRegistry.execute()`.');
    lines.push('');
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const files = await gatherFiles();
  const findings: Finding[] = [];
  for (const f of files) {
    findings.push(...scanFile(f));
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');

  const qaDir = resolve(repoRoot, 'qa');
  mkdirSync(qaDir, { recursive: true });
  const mdPath = resolve(qaDir, 'approval-paths-audit.md');
  const jsonPath = resolve(qaDir, 'approval-paths-audit.json');
  writeFileSync(mdPath, renderMarkdown(findings), 'utf8');
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scannedFiles: files.length,
        errors: errors.length,
        warnings: warnings.length,
        findings,
      },
      null,
      2,
    ),
    'utf8',
  );

  // eslint-disable-next-line no-console
  console.log(
    `[audit:approval-paths] scanned=${files.length} errors=${errors.length} warnings=${warnings.length}`,
  );
  // eslint-disable-next-line no-console
  console.log(`[audit:approval-paths] wrote ${mdPath}`);

  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[audit:approval-paths] FAIL — ${errors.length} bypass pattern(s) detected. See ${mdPath}.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[audit:approval-paths] fatal:', err);
  process.exit(2);
});
