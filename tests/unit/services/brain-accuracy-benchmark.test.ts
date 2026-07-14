/**
 * brain-accuracy-benchmark.test.ts — the Company Brain identity-accuracy
 * regression gate (truth-doc D2). Runs the deterministic benchmark harness and
 * fails CI if identity resolution regresses (F1 below the gate, or any
 * false/missed merge on the trap corpus).
 */
import { describe, it, expect } from 'vitest';
import {
  runBrainAccuracyBenchmark,
  evaluateResolution,
  BRAIN_ACCURACY_GATE,
} from '../../../apps/api/src/services/company-brain/brain-accuracy-benchmark.js';
import { resolveEntities, normalizeIdentifier } from '../../../apps/api/src/services/company-brain/entity-resolver.js';

describe('Company Brain identity-accuracy benchmark (D2 regression gate)', () => {
  it('meets the gate: F1 >= 0.95, zero false merges, zero missed merges', () => {
    const report = runBrainAccuracyBenchmark();
    // Print the measured number so the brain's accuracy is observable, not asserted in prose.
    // eslint-disable-next-line no-console
    console.log('[brain-accuracy] F1=' + report.f1.toFixed(3)
      + ' precision=' + report.precision.toFixed(3)
      + ' recall=' + report.recall.toFixed(3)
      + ' falseMerges=' + report.falseMerges
      + ' missedMerges=' + report.missedMerges
      + ' clusters=' + report.predictedClusterCount + '/' + report.groundTruthClusterCount);
    expect(report.passed).toBe(true);
    expect(report.f1).toBeGreaterThanOrEqual(BRAIN_ACCURACY_GATE.minF1);
    expect(report.falseMerges).toBeLessThanOrEqual(BRAIN_ACCURACY_GATE.maxFalseMerges);
    expect(report.missedMerges).toBeLessThanOrEqual(BRAIN_ACCURACY_GATE.maxMissedMerges);
  });

  it('does NOT merge two different people who share only a name (no fuzzy name matching)', () => {
    const { entities } = resolveEntities([
      { id: 'a', tenantId: 't', name: 'John Smith', identifiers: [{ kind: 'email', normalized: normalizeIdentifier('email', 'john@acme.com') }] },
      { id: 'b', tenantId: 't', name: 'John Smith', identifiers: [{ kind: 'email', normalized: normalizeIdentifier('email', 'john@other.com') }] },
    ]);
    expect(entities).toHaveLength(2);
  });

  it('merges one person seen via email-only and github-only through the shared graph (no missed merge)', () => {
    const { entities } = resolveEntities([
      { id: 'a', tenantId: 't', name: 'Reetu', identifiers: [{ kind: 'email', normalized: normalizeIdentifier('email', 'reetu@inbharat.ai') }] },
      { id: 'b', tenantId: 't', name: 'R.', identifiers: [{ kind: 'github', normalized: normalizeIdentifier('github', 'reetu-dev') }] },
      { id: 'c', tenantId: 't', name: 'Reetu S.', identifiers: [{ kind: 'email', normalized: normalizeIdentifier('email', 'reetu@inbharat.ai') }, { kind: 'github', normalized: normalizeIdentifier('github', 'reetu-dev') }] },
    ]);
    expect(entities).toHaveLength(1);
    expect(entities[0].memberIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('isolates by tenant: same email in two tenants stays two entities', () => {
    const { entities } = resolveEntities([
      { id: 'a', tenantId: 'tA', name: 'Sam', identifiers: [{ kind: 'email', normalized: normalizeIdentifier('email', 'same@x.com') }] },
      { id: 'b', tenantId: 'tB', name: 'Sam', identifiers: [{ kind: 'email', normalized: normalizeIdentifier('email', 'same@x.com') }] },
    ]);
    expect(entities).toHaveLength(2);
  });

  it('scopes external_id by source: same value, different source does NOT merge', () => {
    const { entities } = resolveEntities([
      { id: 'a', tenantId: 't', name: 'sf', identifiers: [{ kind: 'external_id', source: 'salesforce', normalized: 'c-100' }] },
      { id: 'b', tenantId: 't', name: 'hs', identifiers: [{ kind: 'external_id', source: 'hubspot', normalized: 'c-100' }] },
    ]);
    expect(entities).toHaveLength(2);
  });

  it('evaluates a deliberately-broken predictor as failing the gate (gate has teeth)', () => {
    // A predictor that merges everything into one cluster: high recall, zero precision -> fails.
    const everythingMerged = [{ memberIds: ['a', 'b', 'c', 'd'], tenantId: 't', identifierKeys: [] }];
    const rep = evaluateResolution(everythingMerged, { a: 'x', b: 'x', c: 'y', d: 'y' });
    expect(rep.f1).toBeLessThan(BRAIN_ACCURACY_GATE.minF1);
    expect(rep.falseMerges).toBeGreaterThan(0);
  });
});
