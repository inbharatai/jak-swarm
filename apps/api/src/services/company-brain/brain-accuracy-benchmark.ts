/**
 * brain-accuracy-benchmark.ts — the Company Brain identity-accuracy benchmark
 * (truth-doc D2: the brain's accuracy becomes a measured number with a
 * regression gate, like every other system in the repo).
 *
 * Runs a held-out fixture corpus (artifacts with ground-truth entity clusters)
 * through the pure stable-identifier resolver (entity-resolver.ts) and scores
 * it with pairwise cluster evaluation: precision, recall, F1, false-merge rate,
 * missed-merge rate. The fixture deliberately traps the failure modes the old
 * `properties::TEXT ILIKE` resolver had:
 *   - name collision: two different "John Smith" shares must NOT merge;
 *   - external_id source scoping: same external_id value from different
 *     source systems must NOT merge;
 *   - cross-tenant isolation: the same email in two tenants must NOT merge;
 *   - missed merge: one person seen via email-only and github-only records
 *     must still merge through the shared identifier graph.
 *
 * Pure + deterministic. The CI test (brain-accuracy-benchmark.test.ts) fails
 * if F1 drops below the gate or any false/missed merge appears — so a regression
 * to fuzzy name matching is caught mechanically.
 */
import {
  resolveEntities,
  normalizeIdentifier,
  type EntityCandidate,
  type IdentifierKind,
  type ResolvedEntity,
} from './entity-resolver.js';

export interface BenchmarkReport {
  candidateCount: number;
  predictedClusterCount: number;
  groundTruthClusterCount: number;
  pairwiseCorrectMerges: number;
  pairwisePredictedMerges: number;
  pairwiseGroundTruthMerges: number;
  falseMerges: number;
  missedMerges: number;
  precision: number;
  recall: number;
  f1: number;
  falseMergeRate: number;
  missedMergeRate: number;
  passed: boolean;
}

function id(kind: IdentifierKind, value: string, source?: string) {
  return { kind, source, normalized: normalizeIdentifier(kind, value) };
}

/** A candidate plus the ground-truth cluster id it belongs to. */
interface FixtureCandidate extends EntityCandidate {
  truthCluster: string;
}

function buildFixture(): { candidates: EntityCandidate[]; truth: Record<string, string> } {
  const raw: FixtureCandidate[] = [
    // One person (Reetu) seen three ways: email-only, github-only, both.
    { id: 'r1', tenantId: 'tA', name: 'Reetu', identifiers: [id('email', 'reetu@inbharat.ai')], truthCluster: 'reetu' },
    { id: 'r2', tenantId: 'tA', name: 'R. Sharma', identifiers: [id('github', 'reetu-dev')], truthCluster: 'reetu' },
    { id: 'r3', tenantId: 'tA', name: 'Reetu Sharma', identifiers: [id('email', 'reetu@inbharat.ai'), id('github', 'reetu-dev')], truthCluster: 'reetu' },
    // Name collision: two DIFFERENT people both called John Smith. Must NOT merge.
    { id: 'js1', tenantId: 'tA', name: 'John Smith', identifiers: [id('email', 'john@acme.com')], truthCluster: 'jsA' },
    { id: 'js2', tenantId: 'tA', name: 'John Smith', identifiers: [id('email', 'john@other.com')], truthCluster: 'jsB' },
    // Same external_id value, SAME source -> merge.
    { id: 'sf1', tenantId: 'tA', name: 'Lead 100', identifiers: [id('external_id', 'C-100', 'salesforce')], truthCluster: 'sflead' },
    { id: 'sf1b', tenantId: 'tA', name: 'Contact 100', identifiers: [id('external_id', 'C-100', 'salesforce')], truthCluster: 'sflead' },
    // Same external_id value, DIFFERENT source -> must NOT merge.
    { id: 'hs1', tenantId: 'tA', name: 'HubSpot 100', identifiers: [id('external_id', 'C-100', 'hubspot')], truthCluster: 'hslead' },
    // Cross-tenant isolation: same email, two tenants -> must NOT merge.
    { id: 'ctA', tenantId: 'tA', name: 'Sam', identifiers: [id('email', 'same@x.com')], truthCluster: 'samA' },
    { id: 'ctB', tenantId: 'tB', name: 'Sam', identifiers: [id('email', 'same@x.com')], truthCluster: 'samB' },
    // A pure singleton (no identifiers).
    { id: 'sing', tenantId: 'tA', name: 'Anonymous Note', identifiers: [], truthCluster: 'anon' },
  ];
  const truth: Record<string, string> = {};
  for (const c of raw) truth[c.id] = c.truthCluster;
  return { candidates: raw.map(({ truthCluster: _t, ...rest }) => rest), truth };
}

/** Pairwise cluster evaluation of predicted vs ground-truth partitions. */
export function evaluateResolution(predicted: ResolvedEntity[], truth: Record<string, string>): Omit<BenchmarkReport, 'passed'> {
  const predIndex = new Map<string, number>();
  predicted.forEach((e, i) => { for (const m of e.memberIds) predIndex.set(m, i); });
  const ids = [...predIndex.keys()];
  let correctMerges = 0, predMerges = 0, gtMerges = 0, falseMerges = 0, missedMerges = 0;
  for (let a = 0; a < ids.length; a++) {
    const ia = ids[a]!;
    for (let b = a + 1; b < ids.length; b++) {
      const ib = ids[b]!;
      const predSame = predIndex.get(ia) === predIndex.get(ib);
      const gtSame = truth[ia] === truth[ib];
      if (gtSame) {
        gtMerges++;
        if (predSame) correctMerges++; else missedMerges++;
      }
      if (predSame) {
        predMerges++;
        if (!gtSame) falseMerges++;
      }
    }
  }
  const precision = predMerges > 0 ? correctMerges / predMerges : 1;
  const recall = gtMerges > 0 ? correctMerges / gtMerges : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 1;
  return {
    candidateCount: ids.length,
    predictedClusterCount: predicted.length,
    groundTruthClusterCount: new Set(Object.values(truth)).size,
    pairwiseCorrectMerges: correctMerges,
    pairwisePredictedMerges: predMerges,
    pairwiseGroundTruthMerges: gtMerges,
    falseMerges,
    missedMerges,
    precision,
    recall,
    f1,
    falseMergeRate: predMerges > 0 ? falseMerges / predMerges : 0,
    missedMergeRate: gtMerges > 0 ? missedMerges / gtMerges : 0,
  };
}

/** The regression gate. Tighten (raise) as the resolver improves. */
export const BRAIN_ACCURACY_GATE = { minF1: 0.95, maxFalseMerges: 0, maxMissedMerges: 0 };

export function runBrainAccuracyBenchmark(): BenchmarkReport {
  const { candidates, truth } = buildFixture();
  const { entities } = resolveEntities(candidates);
  const base = evaluateResolution(entities, truth);
  const passed = base.f1 >= BRAIN_ACCURACY_GATE.minF1
    && base.falseMerges <= BRAIN_ACCURACY_GATE.maxFalseMerges
    && base.missedMerges <= BRAIN_ACCURACY_GATE.maxMissedMerges;
  return { ...base, passed };
}
