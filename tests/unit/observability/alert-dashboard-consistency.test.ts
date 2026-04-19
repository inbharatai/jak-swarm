/**
 * Observability consistency tests.
 *
 * Every metric name referenced in ops/prometheus/alerts.yml and
 * ops/grafana/dashboards/jak-swarm.json MUST exist in the live prom-client
 * registry. Without this test, a rename in metrics.ts silently breaks an
 * alert rule or a dashboard panel and nobody notices until the alert
 * doesn't fire.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { metrics } from '../../../apps/api/src/observability/metrics.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');

/**
 * Extract every `jak_*` metric name referenced in a text file.
 * Matches the prom-client naming convention (word chars + underscore).
 */
function extractMetricNames(text: string): Set<string> {
  const found = new Set<string>();
  // Match jak_foo_bar_baz — stop at any non-word char.
  const re = /\bjak_[a-zA-Z0-9_]+/g;
  for (const m of text.matchAll(re)) {
    found.add(m[0]);
  }
  return found;
}

async function registeredMetricNames(): Promise<Set<string>> {
  const all = await metrics.registry.getMetricsAsJSON();
  return new Set(all.map((m) => m.name));
}

/**
 * Metric names that appear in PromQL histogram_quantile expressions get a
 * `_bucket` / `_sum` / `_count` suffix — those aren't standalone registered
 * metrics but they ARE valid to reference if the base metric is a Histogram.
 * We strip those suffixes before checking.
 */
function stripHistogramSuffix(name: string): string {
  return name.replace(/_(bucket|sum|count)$/, '');
}

describe('Observability — metric-name consistency', () => {
  it('every metric referenced in ops/prometheus/alerts.yml is registered', async () => {
    const alertsPath = resolve(repoRoot, 'ops/prometheus/alerts.yml');
    const alertsText = readFileSync(alertsPath, 'utf8');
    const referenced = extractMetricNames(alertsText);
    const registered = await registeredMetricNames();

    const missing: string[] = [];
    for (const name of referenced) {
      const base = stripHistogramSuffix(name);
      if (!registered.has(base)) missing.push(name);
    }

    expect(missing, `Alert rules reference metrics that do not exist in the registry: ${missing.join(', ')}`).toEqual([]);
  });

  it('every metric referenced in ops/grafana/dashboards/jak-swarm.json is registered', async () => {
    const dashPath = resolve(repoRoot, 'ops/grafana/dashboards/jak-swarm.json');
    const dashText = readFileSync(dashPath, 'utf8');
    const referenced = extractMetricNames(dashText);
    const registered = await registeredMetricNames();

    const missing: string[] = [];
    for (const name of referenced) {
      const base = stripHistogramSuffix(name);
      if (!registered.has(base)) missing.push(name);
    }

    expect(missing, `Grafana dashboard references metrics that do not exist: ${missing.join(', ')}`).toEqual([]);
  });

  it('every metric referenced in ops/runbooks/on-call.md is real', async () => {
    // Runbook sections cite metric names in backticks. Catches renames
    // that would leave the runbook pointing at dead metrics.
    const rbPath = resolve(repoRoot, 'ops/runbooks/on-call.md');
    const rbText = readFileSync(rbPath, 'utf8');
    const referenced = extractMetricNames(rbText);
    const registered = await registeredMetricNames();

    const missing: string[] = [];
    for (const name of referenced) {
      const base = stripHistogramSuffix(name);
      if (!registered.has(base)) missing.push(name);
    }

    expect(missing, `On-call runbook references metrics that do not exist: ${missing.join(', ')}`).toEqual([]);
  });

  it('every alert rule has a runbook: annotation and a matching section in the runbook', () => {
    const alertsText = readFileSync(resolve(repoRoot, 'ops/prometheus/alerts.yml'), 'utf8');
    const runbookText = readFileSync(resolve(repoRoot, 'ops/runbooks/on-call.md'), 'utf8');

    // Every `runbook: "path#anchor"` in alerts.yml must find a matching
    // Markdown anchor in on-call.md. We only verify the `#anchor` suffix.
    const anchorRefs = [...alertsText.matchAll(/runbook:\s*"[^"]*#([^"]+)"/g)].map((m) => m[1]);
    expect(anchorRefs.length).toBeGreaterThan(0);

    // Markdown anchors: a `## heading` renders to `#heading` (lowercase, dashes).
    const sections = [...runbookText.matchAll(/^##\s+(.+)$/gm)].map((m) =>
      m[1]!.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-'),
    );
    const sectionSet = new Set(sections);

    const missingSections = anchorRefs.filter((a) => a !== undefined && !sectionSet.has(a!));
    expect(
      missingSections,
      `Alert rules reference runbook anchors that do not exist in on-call.md: ${missingSections.join(', ')}`,
    ).toEqual([]);
  });
});
