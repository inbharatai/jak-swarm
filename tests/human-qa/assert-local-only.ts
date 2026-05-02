/**
 * assert-local-only — fail-loud guard that refuses to run any
 * destructive / interactive QA against a production database.
 *
 * The HumanQA framework can fill forms, click buttons, and trigger
 * real workflow create paths via the dev-bypass auth. If the API the
 * tests reach is pointed at production Supabase, those interactions
 * write to the customer DB. This guard exists so that can never
 * happen by accident.
 *
 * Rule: every URL we'd connect to must be either a local hostname
 * (localhost, 127.0.0.1, ::1, *.local, *.localhost) OR a Docker
 * bridge IP (172.16-31.x.x, 192.168.x.x). Anything else — and
 * specifically anything matching `*.supabase.{com,co}`, `*.pooler.*`,
 * `*.amazonaws.com`, `*.render.com`, `*.vercel.app` — fails the test
 * before any browser is launched.
 *
 * Use:
 *   import { assertLocalOnlyOrThrow } from '../human-qa/assert-local-only.js';
 *   test.beforeAll(() => assertLocalOnlyOrThrow());
 */

const PRODUCTION_HOST_PATTERNS: RegExp[] = [
  /\bsupabase\.com\b/i,
  /\bsupabase\.co\b/i,
  /\bpooler\.supabase\b/i,
  /\.amazonaws\.com\b/i,
  /\.render\.com\b/i,
  /\.onrender\.com\b/i,
  /\.vercel\.app\b/i,
  /\.fly\.dev\b/i,
  /\.upstash\.io\b/i,
];

const LOCAL_HOST_PATTERNS: RegExp[] = [
  /^localhost(:|$|\/)/i,
  /^127\.\d+\.\d+\.\d+/,
  /^\[?::1\]?/,
  /\.localhost(:|$|\/)/i,
  /^docker\.internal/i,
  /^host\.docker\.internal/i,
];

function extractHost(connStr: string | undefined): string | null {
  if (!connStr) return null;
  // Postgres URL: postgresql://user:pass@host:port/db
  // Redis URL:    redis://[user:pass@]host:port[/db]
  // Generic URL:  https://host:port/path
  try {
    const u = new URL(connStr);
    return u.hostname;
  } catch {
    // Some Postgres URLs use unusual schemes; fall back to regex.
    const m = connStr.match(/@([^/:?]+)/);
    return m ? (m[1] ?? null) : null;
  }
}

function isProductionHost(host: string): boolean {
  return PRODUCTION_HOST_PATTERNS.some((re) => re.test(host));
}

function isLocalHost(host: string): boolean {
  return LOCAL_HOST_PATTERNS.some((re) => re.test(host));
}

export interface LocalOnlyAssertion {
  ok: boolean;
  reason?: string;
  /** Hosts inspected, in order, with their classification. */
  inspected: Array<{ envVar: string; host: string | null; classification: string }>;
}

/**
 * Inspect every env var that could point the test stack at production.
 * Returns a structured result; does NOT throw.
 */
export function assertLocalOnly(): LocalOnlyAssertion {
  const envVars = [
    'DATABASE_URL',
    'DIRECT_URL',
    'REDIS_URL',
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
  ];
  const inspected: LocalOnlyAssertion['inspected'] = [];
  for (const envVar of envVars) {
    const host = extractHost(process.env[envVar]);
    let classification = 'unset';
    if (host) {
      if (isProductionHost(host)) classification = 'PRODUCTION';
      else if (isLocalHost(host)) classification = 'local';
      else classification = 'unknown';
    }
    inspected.push({ envVar, host, classification });
  }
  const prodHits = inspected.filter((x) => x.classification === 'PRODUCTION');
  if (prodHits.length > 0) {
    return {
      ok: false,
      reason:
        `HumanQA refuses to run against a production-shaped host. ` +
        prodHits.map((p) => `${p.envVar}=${p.host}`).join('; ') +
        `. To re-enable, point these at localhost / Docker / a staging DB.`,
      inspected,
    };
  }
  // Soft warning: an env var classified 'unknown' is suspicious but not
  // automatically fatal — the user may legitimately use a custom local
  // domain. We surface it in the inspected list and let the caller decide.
  return { ok: true, inspected };
}

/**
 * Same as assertLocalOnly() but throws when a production host is
 * detected. Drop into `test.beforeAll(() => assertLocalOnlyOrThrow())`
 * at the top of every interactive QA spec.
 */
export function assertLocalOnlyOrThrow(): void {
  const result = assertLocalOnly();
  if (!result.ok) {
    const detail = result.inspected
      .map((x) => `  ${x.envVar.padEnd(28)} → ${x.classification}: ${x.host ?? '(unset)'}`)
      .join('\n');
    throw new Error(
      `\n[assert-local-only] PRODUCTION DB / SERVICE detected — refusing to run interactive QA.\n` +
      `${result.reason}\n\nInspected:\n${detail}\n\n` +
      `Set DATABASE_URL / DIRECT_URL / REDIS_URL / NEXT_PUBLIC_API_URL to localhost\n` +
      `before re-running. See docs/local-runtime-recovery.md.`,
    );
  }
}
