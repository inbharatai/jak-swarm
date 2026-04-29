/**
 * scripts/audit-all-tools.ts
 *
 * Tool registry health audit (Step 4 of OpenClaw extraction-gap close).
 *
 * Iterates every tool in the singleton registry after `registerBuiltinTools()`
 * and validates the metadata that the runtime actually depends on:
 *   - presence of name, description, category, riskClass, requiresApproval
 *   - presence of inputSchema + outputSchema (objects, not undefined)
 *   - if `riskLevel` is present, it's a valid ToolRiskLevel value
 *   - sideEffectLevel coherence (READ_ONLY tool must not declare 'destructive')
 *   - maturity is a recognised string when present
 *
 * Emits two artifacts:
 *   qa/all-tools-audit-report.md      — human-readable table
 *   qa/all-tools-audit-results.json   — machine-readable summary for CI
 *
 * Exit code:
 *   0 if every tool passes; 1 if any tool fails.
 *
 * Run: `pnpm audit:tools`
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  toolRegistry,
  registerBuiltinTools,
} from '../packages/tools/src/index.js';
import {
  ToolRiskLevel,
} from '@jak-swarm/shared';
import type { ToolMetadata, ToolMaturity } from '@jak-swarm/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

interface ToolAuditFinding {
  toolName: string;
  field: string;
  severity: 'error' | 'warning';
  message: string;
}

interface ToolAuditEntry {
  name: string;
  category: string;
  riskClass: string;
  riskLevel: string | null;
  requiresApproval: boolean;
  maturity: ToolMaturity | 'unspecified';
  sideEffectLevel: string | null;
  hasInputSchema: boolean;
  hasOutputSchema: boolean;
  findings: ToolAuditFinding[];
  status: 'pass' | 'warn' | 'fail';
}

const VALID_MATURITIES: ToolMaturity[] = [
  'real_external',
  'config_dependent',
  'heuristic',
  'llm_passthrough',
  'experimental',
  'test_only',
  'unclassified',
];

// Historical alias: a number of registrations use `'real'` as shorthand
// for `'real_external'`. The runtime treats them identically, so the
// audit accepts both. This list exists explicitly so anyone reading the
// script sees the historical drift and can normalize at their leisure.
const HISTORICAL_MATURITY_ALIASES = new Set<string>(['real']);

const VALID_SIDE_EFFECTS = ['read', 'write', 'destructive', 'external'] as const;
type SideEffect = typeof VALID_SIDE_EFFECTS[number];

function auditTool(meta: ToolMetadata): ToolAuditEntry {
  const findings: ToolAuditFinding[] = [];

  // Required fields — these are runtime-fatal if missing.
  if (!meta.name || meta.name.trim() === '') {
    findings.push({ toolName: meta.name ?? '<unnamed>', field: 'name', severity: 'error', message: 'name is required' });
  }
  if (!meta.description || meta.description.trim() === '') {
    findings.push({ toolName: meta.name, field: 'description', severity: 'error', message: 'description is required' });
  }
  if (!meta.category) {
    findings.push({ toolName: meta.name, field: 'category', severity: 'error', message: 'category is required' });
  }
  if (!meta.riskClass) {
    findings.push({ toolName: meta.name, field: 'riskClass', severity: 'error', message: 'riskClass is required' });
  }
  if (typeof meta.requiresApproval !== 'boolean') {
    findings.push({ toolName: meta.name, field: 'requiresApproval', severity: 'error', message: 'requiresApproval must be boolean' });
  }
  if (!meta.inputSchema || typeof meta.inputSchema !== 'object') {
    findings.push({ toolName: meta.name, field: 'inputSchema', severity: 'error', message: 'inputSchema must be an object (use {} for no input)' });
  }
  if (!meta.outputSchema || typeof meta.outputSchema !== 'object') {
    findings.push({ toolName: meta.name, field: 'outputSchema', severity: 'error', message: 'outputSchema must be an object (use {} for no output)' });
  }
  if (!meta.version || meta.version.trim() === '') {
    findings.push({ toolName: meta.name, field: 'version', severity: 'error', message: 'version is required' });
  }

  // Optional but-coherent fields.
  if (meta.riskLevel !== undefined) {
    const validLevels: string[] = Object.values(ToolRiskLevel);
    if (!validLevels.includes(meta.riskLevel as string)) {
      findings.push({
        toolName: meta.name,
        field: 'riskLevel',
        severity: 'error',
        message: `riskLevel must be one of ${validLevels.join(', ')}`,
      });
    }
  }
  if (
    meta.maturity !== undefined &&
    !VALID_MATURITIES.includes(meta.maturity) &&
    !HISTORICAL_MATURITY_ALIASES.has(meta.maturity as unknown as string)
  ) {
    findings.push({
      toolName: meta.name,
      field: 'maturity',
      severity: 'error',
      message: `maturity must be one of ${VALID_MATURITIES.join(', ')}`,
    });
  } else if (
    meta.maturity !== undefined &&
    HISTORICAL_MATURITY_ALIASES.has(meta.maturity as unknown as string)
  ) {
    findings.push({
      toolName: meta.name,
      field: 'maturity',
      severity: 'warning',
      message: `maturity='${meta.maturity}' is a legacy alias — normalize to 'real_external' when convenient`,
    });
  }
  if (meta.sideEffectLevel !== undefined) {
    if (!VALID_SIDE_EFFECTS.includes(meta.sideEffectLevel as SideEffect)) {
      findings.push({
        toolName: meta.name,
        field: 'sideEffectLevel',
        severity: 'error',
        message: `sideEffectLevel must be one of ${VALID_SIDE_EFFECTS.join(', ')}`,
      });
    }
  }

  // Coherence: a READ_ONLY tool can never be 'destructive'. (External
  // is fine — `web_fetch` and `web_search` are READ_ONLY but talk to a
  // third party. The risk class governs *write* posture, side-effect
  // level governs *audit* posture; they are independent axes.)
  if (
    meta.riskClass === 'READ_ONLY' &&
    meta.sideEffectLevel === 'destructive'
  ) {
    findings.push({
      toolName: meta.name,
      field: 'sideEffectLevel',
      severity: 'error',
      message: `READ_ONLY tool declares sideEffectLevel='destructive' — incoherent`,
    });
  }

  // Coherence: a DESTRUCTIVE tool that does NOT require approval is suspicious.
  if (meta.riskClass === 'DESTRUCTIVE' && meta.requiresApproval !== true) {
    findings.push({
      toolName: meta.name,
      field: 'requiresApproval',
      severity: 'warning',
      message: 'DESTRUCTIVE tool does not require approval — review',
    });
  }

  const hasError = findings.some((f) => f.severity === 'error');
  const hasWarning = findings.some((f) => f.severity === 'warning');
  const status: ToolAuditEntry['status'] = hasError ? 'fail' : hasWarning ? 'warn' : 'pass';

  return {
    name: meta.name,
    category: meta.category,
    riskClass: meta.riskClass,
    riskLevel: (meta.riskLevel as string | undefined) ?? null,
    requiresApproval: meta.requiresApproval,
    maturity: meta.maturity ?? 'unspecified',
    sideEffectLevel: (meta.sideEffectLevel as string | undefined) ?? null,
    hasInputSchema: !!meta.inputSchema && typeof meta.inputSchema === 'object',
    hasOutputSchema: !!meta.outputSchema && typeof meta.outputSchema === 'object',
    findings,
    status,
  };
}

function renderMarkdown(entries: ToolAuditEntry[]): string {
  const total = entries.length;
  const passed = entries.filter((e) => e.status === 'pass').length;
  const warned = entries.filter((e) => e.status === 'warn').length;
  const failed = entries.filter((e) => e.status === 'fail').length;

  const lines: string[] = [];
  lines.push(`# Tool Audit Report`);
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`- Total tools: **${total}**`);
  lines.push(`- Passed: **${passed}**`);
  lines.push(`- Warnings: **${warned}**`);
  lines.push(`- Failed: **${failed}**`);
  lines.push('');

  if (failed > 0) {
    lines.push(`## Failures`);
    lines.push('');
    for (const e of entries.filter((x) => x.status === 'fail')) {
      lines.push(`### ${e.name}`);
      for (const f of e.findings.filter((f) => f.severity === 'error')) {
        lines.push(`- **${f.field}**: ${f.message}`);
      }
      lines.push('');
    }
  }

  if (warned > 0) {
    lines.push(`## Warnings`);
    lines.push('');
    for (const e of entries.filter((x) => x.status === 'warn')) {
      lines.push(`### ${e.name}`);
      for (const f of e.findings.filter((f) => f.severity === 'warning')) {
        lines.push(`- **${f.field}**: ${f.message}`);
      }
      lines.push('');
    }
  }

  lines.push(`## All tools`);
  lines.push('');
  lines.push(`| Tool | Category | Risk Class | Risk Level | Maturity | Status |`);
  lines.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(
      `| \`${e.name}\` | ${e.category} | ${e.riskClass} | ${e.riskLevel ?? '-'} | ${e.maturity} | ${e.status === 'pass' ? 'pass' : e.status === 'warn' ? 'WARN' : 'FAIL'} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

async function main(): Promise<void> {
  registerBuiltinTools();
  const allMeta = toolRegistry.list();
  const entries = allMeta.map(auditTool);

  const summary = {
    generatedAt: new Date().toISOString(),
    total: entries.length,
    passed: entries.filter((e) => e.status === 'pass').length,
    warned: entries.filter((e) => e.status === 'warn').length,
    failed: entries.filter((e) => e.status === 'fail').length,
    entries,
  };

  const qaDir = resolve(repoRoot, 'qa');
  mkdirSync(qaDir, { recursive: true });

  const mdPath = resolve(qaDir, 'all-tools-audit-report.md');
  const jsonPath = resolve(qaDir, 'all-tools-audit-results.json');
  writeFileSync(mdPath, renderMarkdown(entries), 'utf8');
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

  // Per-shell summary.
  // eslint-disable-next-line no-console
  console.log(
    `[audit:tools] total=${summary.total} pass=${summary.passed} warn=${summary.warned} fail=${summary.failed}`,
  );
  // eslint-disable-next-line no-console
  console.log(`[audit:tools] wrote ${mdPath}`);
  // eslint-disable-next-line no-console
  console.log(`[audit:tools] wrote ${jsonPath}`);

  if (summary.failed > 0) process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[audit:tools] fatal:', err);
  process.exit(2);
});
