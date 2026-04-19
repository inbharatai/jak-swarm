/**
 * scripts/verify-session7-counts.ts
 *
 * Asserts that the Session 7 subset (40 tools that were previously unclassified
 * and received honest maturity labels) matches the expected per-bucket counts.
 * Invoked by `pnpm check:truth` and CI — fails if any tool in the subset silently
 * changes maturity without the doc tables being updated.
 */
import { toolRegistry, registerBuiltinTools } from '../packages/tools/src/index.js';

const SESSION_7_SUBSET = [
  'ingest_document', 'summarize_document', 'extract_document_data', 'parse_spreadsheet',
  'compute_statistics', 'generate_report', 'browser_analyze_page', 'gmail_read_inbox',
  'audit_seo', 'research_keywords', 'analyze_serp', 'monitor_rankings',
  'create_email_sequence', 'personalize_email', 'schedule_email', 'track_email_engagement',
  'analyze_engagement', 'predict_churn', 'generate_winback', 'monitor_company_signals',
  'generate_seo_report', 'track_content_performance', 'track_okrs', 'monitor_competitors',
  'generate_board_report', 'check_dependencies', 'estimate_tech_debt', 'parse_financial_csv',
  'track_budget', 'forecast_cashflow', 'screen_resume', 'post_job_listing',
  'generate_offer_letter', 'compare_contracts', 'extract_obligations', 'monitor_regulations',
  'track_lead_pipeline', 'track_customer_health', 'generate_qbr_deck', 'compile_executive_summary',
] as const;

export interface Session7CountReport {
  total: number;
  byMaturity: Record<string, number>;
  missing: string[];
  unexpectedMaturity: string[];
}

export function computeSession7Counts(): Session7CountReport {
  if (toolRegistry.list().length === 0) registerBuiltinTools();
  const byMaturity: Record<string, number> = {};
  const missing: string[] = [];
  const unexpectedMaturity: string[] = [];

  for (const name of SESSION_7_SUBSET) {
    const t = toolRegistry.get(name);
    if (!t) {
      missing.push(name);
      continue;
    }
    const m = t.metadata.maturity ?? 'unclassified';
    byMaturity[m] = (byMaturity[m] ?? 0) + 1;
    if (m === 'unclassified') unexpectedMaturity.push(name);
  }
  return { total: SESSION_7_SUBSET.length, byMaturity, missing, unexpectedMaturity };
}

/**
 * Expected bucket counts — fixed in this file because they reflect a design
 * decision, not a measurement. If a tool's maturity changes intentionally,
 * update this table in the same PR as the classification change.
 */
export const EXPECTED_SESSION_7_BUCKETS = {
  real: 17,
  heuristic: 12,
  llm_passthrough: 8,
  config_dependent: 2,
  experimental: 1,
} as const;

// CLI mode — gated on a sentinel env var set only when the script is the
// direct entry point. check-docs-truth.ts imports computeSession7Counts
// directly and does its own mismatch handling, so we MUST NOT process.exit
// when imported.
function runCli(): void {
  const report = computeSession7Counts();
  const mismatches: string[] = [];
  for (const [bucket, expected] of Object.entries(EXPECTED_SESSION_7_BUCKETS)) {
    const actual = report.byMaturity[bucket] ?? 0;
    if (actual !== expected) {
      mismatches.push(`  ${bucket}: expected ${expected}, got ${actual}`);
    }
  }
  if (report.missing.length > 0) {
    mismatches.push(`  missing from registry: ${report.missing.join(', ')}`);
  }
  if (report.unexpectedMaturity.length > 0) {
    mismatches.push(
      `  still unclassified: ${report.unexpectedMaturity.join(', ')}`,
    );
  }
  /* eslint-disable no-console */
  if (mismatches.length > 0) {
    console.error('[verify-session7-counts] FAILED — Session 7 subset maturity drift detected:');
    for (const m of mismatches) console.error(m);
    console.error('\nFix either the tool metadata or update EXPECTED_SESSION_7_BUCKETS in the same PR.');
    process.exit(1);
  }
  console.log(
    `[verify-session7-counts] OK — ${report.total} tools, buckets: ${JSON.stringify(report.byMaturity)}`,
  );
  /* eslint-enable no-console */
}

// Only run when the script is invoked directly (not via dynamic import from
// check-docs-truth.ts). We detect this by comparing the realpath-normalized
// forms of the module URL and the entry argv path — this works on Windows
// despite drive-letter casing and slash differences.
function invokedDirectly(): boolean {
  try {
    const entry = process.argv[1] ?? '';
    // Normalize both: strip file://, lowercase drive, unify slashes.
    const norm = (s: string) =>
      s.replace(/^file:\/\/\//, '').replace(/^\/?([a-zA-Z]):/, (_, d: string) => `${d.toLowerCase()}:`).replace(/\\/g, '/');
    return norm(import.meta.url).endsWith(norm(entry).replace(/^[^/]*:/, ''))
      || norm(entry).endsWith('verify-session7-counts.ts');
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  runCli();
}
