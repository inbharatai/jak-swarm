/**
 * config-lifecycle.test.ts — HyperAgent Phase 9 versioned-config lifecycle.
 *
 * Pins the bounded lifecycle:
 *   - canTransition permits only the legal forward/rollback edges;
 *   - createDraft → propose → startShadow → startCanary → promote walks the happy
 *     path, stamping the right timestamps + rollout percentages;
 *   - supersede ARCHIVEs the prior PROMOTED + links parent/successor;
 *   - evaluateStage ADVANCEs only with enough samples, passing rates, lift, and
 *     zero safety incidents; ROLLBACKs on a safety breach; HOLDs otherwise
 *     (never a fake advance — the honest evaluation seam);
 *   - rampCanary steps up the ladder and PROMOTEs at 100%;
 *   - rollback + recordEvent produce the audit trail.
 */
import { describe, it, expect } from 'vitest';
import {
  ConfigKind,
  ConfigVersionStatus,
  PromotionDecision,
  RolloutStage,
  DEFAULT_ROLLOUT_LADDER,
  DEFAULT_ROLLOUT_THRESHOLDS,
} from '../../../packages/shared/src/index.js';
import type { ConfigVersion, RolloutMetrics, RolloutThresholds } from '../../../packages/shared/src/index.js';
import {
  ConfigLifecycleError,
  canTransition,
  createDraft,
  proposeVersion,
  startShadow,
  startCanary,
  promoteVersion,
  rollbackVersion,
  supersede,
  nextRolloutPercent,
  evaluateStage,
  evaluateShadow,
  evaluateCanary,
  rampCanary,
  recordEvent,
  withEvaluation,
} from '../../../packages/swarm/src/hyperagent/config-lifecycle.js';

const T0 = '2026-07-08T12:00:00.000Z';
const T1 = '2026-07-08T12:01:00.000Z';
const T2 = '2026-07-08T12:02:00.000Z';
const T3 = '2026-07-08T12:03:00.000Z';
const T4 = '2026-07-08T12:04:00.000Z';

function draft(version = 1, parent: string | null = null): ConfigVersion {
  return createDraft({
    id: `cfg-${version}`,
    tenantId: 'tenant-1',
    kind: ConfigKind.LEARNING_GATE,
    version,
    spec: { miThreshold: 0.05 },
    parentVersionId: parent,
    now: T0,
  });
}

function goodMetrics(samples = 30): RolloutMetrics {
  return { samples, successRate: 0.95, failureRate: 0.05, safetyIncidentRate: 0 };
}

const goodBaseline: RolloutMetrics = { samples: 100, successRate: 0.9, failureRate: 0.1 };

describe('canTransition — bounded state machine', () => {
  it('permits the forward lifecycle DRAFT→PROPOSED→SHADOW→CANARY→PROMOTED', () => {
    expect(canTransition(ConfigVersionStatus.DRAFT, ConfigVersionStatus.PROPOSED)).toBe(true);
    expect(canTransition(ConfigVersionStatus.PROPOSED, ConfigVersionStatus.SHADOW)).toBe(true);
    expect(canTransition(ConfigVersionStatus.SHADOW, ConfigVersionStatus.CANARY)).toBe(true);
    expect(canTransition(ConfigVersionStatus.CANARY, ConfigVersionStatus.PROMOTED)).toBe(true);
  });

  it('permits rollback from SHADOW / CANARY / PROMOTED', () => {
    expect(canTransition(ConfigVersionStatus.SHADOW, ConfigVersionStatus.ROLLED_BACK)).toBe(true);
    expect(canTransition(ConfigVersionStatus.CANARY, ConfigVersionStatus.ROLLED_BACK)).toBe(true);
    expect(canTransition(ConfigVersionStatus.PROMOTED, ConfigVersionStatus.ROLLED_BACK)).toBe(true);
  });

  it('permits ARCHIVE from ROLLED_BACK and PROMOTED (supersede)', () => {
    expect(canTransition(ConfigVersionStatus.ROLLED_BACK, ConfigVersionStatus.ARCHIVED)).toBe(true);
    expect(canTransition(ConfigVersionStatus.PROMOTED, ConfigVersionStatus.ARCHIVED)).toBe(true);
  });

  it('forbids skips and reversals', () => {
    expect(canTransition(ConfigVersionStatus.DRAFT, ConfigVersionStatus.SHADOW)).toBe(false);
    expect(canTransition(ConfigVersionStatus.PROPOSED, ConfigVersionStatus.PROMOTED)).toBe(false);
    expect(canTransition(ConfigVersionStatus.PROMOTED, ConfigVersionStatus.CANARY)).toBe(false);
    expect(canTransition(ConfigVersionStatus.ARCHIVED, ConfigVersionStatus.PROMOTED)).toBe(false);
    expect(canTransition(ConfigVersionStatus.DRAFT, ConfigVersionStatus.PROMOTED)).toBe(false);
  });
});

describe('lifecycle happy path', () => {
  it('walks DRAFT → PROMOTED stamping timestamps + rollout percentages', () => {
    const d = draft();
    expect(d.status).toBe(ConfigVersionStatus.DRAFT);
    expect(d.rolloutPercent).toBe(0);

    const proposed = proposeVersion(d, T1, 'proposed');
    expect(proposed.status).toBe(ConfigVersionStatus.PROPOSED);
    expect(proposed.proposedAt).toBe(T1);
    expect(proposed.changeReason).toBe('proposed');

    const shadow = startShadow(proposed, T2);
    expect(shadow.status).toBe(ConfigVersionStatus.SHADOW);
    expect(shadow.shadowStartedAt).toBe(T2);

    const canary = startCanary(shadow, T3);
    expect(canary.status).toBe(ConfigVersionStatus.CANARY);
    expect(canary.canaryStartedAt).toBe(T3);
    expect(canary.rolloutPercent).toBe(DEFAULT_ROLLOUT_LADDER[0]);

    const promoted = promoteVersion(canary, T4);
    expect(promoted.status).toBe(ConfigVersionStatus.PROMOTED);
    expect(promoted.promotedAt).toBe(T4);
    expect(promoted.rolloutPercent).toBe(100);
  });

  it('refuses to skip a stage', () => {
    const d = draft();
    expect(() => startShadow(d, T1)).toThrow(ConfigLifecycleError);
    expect(() => startCanary(proposeVersion(d, T1), T2)).toThrow(ConfigLifecycleError);
    expect(() => promoteVersion(startShadow(proposeVersion(d, T1), T2), T3)).toThrow(ConfigLifecycleError);
  });
});

describe('rollback + supersede', () => {
  it('rolls back a CANARY version to ROLLED_BACK with zero rollout', () => {
    const v = startCanary(startShadow(proposeVersion(draft(), T1), T2), T3);
    const rb = rollbackVersion(v, T4, 'canary metrics degraded');
    expect(rb.status).toBe(ConfigVersionStatus.ROLLED_BACK);
    expect(rb.rolledBackAt).toBe(T4);
    expect(rb.rolloutPercent).toBe(0);
    expect(rb.changeReason).toBe('canary metrics degraded');
  });

  it('refuses to roll back a DRAFT (abandon via ARCHIVED instead)', () => {
    expect(() => rollbackVersion(draft(), T1, 'abandon')).toThrow(ConfigLifecycleError);
  });

  it('supersede ARCHIVEs the prior PROMOTED + links parent/successor', () => {
    const old = promoteVersion(startCanary(startShadow(proposeVersion(draft(1), T1), T2), T3), T4);
    const nextDraft = draft(2, old.id);
    const nextPromoted = promoteVersion(startCanary(startShadow(proposeVersion(nextDraft, T1), T2), T3), T4);
    const { archived, promoted } = supersede(old, nextPromoted, T4);
    expect(archived.status).toBe(ConfigVersionStatus.ARCHIVED);
    expect(archived.supersededById).toBe(nextPromoted.id);
    expect(promoted.parentVersionId).toBe(old.id);
  });

  it('supersede requires both versions to be PROMOTED', () => {
    const old = startCanary(startShadow(proposeVersion(draft(1), T1), T2), T3); // CANARY, not PROMOTED
    const next = promoteVersion(startCanary(startShadow(proposeVersion(draft(2), T1), T2), T3), T4);
    expect(() => supersede(old, next, T4)).toThrow(ConfigLifecycleError);
    expect(() => supersede(next, old, T4)).toThrow(ConfigLifecycleError);
  });
});

describe('nextRolloutPercent', () => {
  it('steps up the ladder', () => {
    expect(nextRolloutPercent(0)).toBe(DEFAULT_ROLLOUT_LADDER[0]);
    expect(nextRolloutPercent(1)).toBe(5);
    expect(nextRolloutPercent(5)).toBe(25);
    expect(nextRolloutPercent(50)).toBe(100);
  });

  it('returns null at the top (⇒ promote)', () => {
    expect(nextRolloutPercent(100)).toBeNull();
  });
});

describe('evaluateStage — honest evaluation seam', () => {
  const thresholds: RolloutThresholds = DEFAULT_ROLLOUT_THRESHOLDS;

  it('ADVANCEs when all thresholds met + lift over baseline', () => {
    const e = evaluateStage(goodMetrics(30), goodBaseline, thresholds);
    expect(e.decision).toBe(PromotionDecision.ADVANCE);
    expect(e.reasons).toEqual(['all thresholds met']);
  });

  it('ROLLBACKs immediately on a safety-incident breach (zero tolerance)', () => {
    const e = evaluateStage(
      { ...goodMetrics(30), safetyIncidentRate: 0.01 },
      goodBaseline,
      { ...thresholds, maxSafetyIncidentRate: 0 },
    );
    expect(e.decision).toBe(PromotionDecision.ROLLBACK);
    expect(e.summary).toMatch(/safety threshold breached/);
  });

  it('HOLDs when samples are insufficient (no fake advance)', () => {
    const e = evaluateStage(goodMetrics(5), goodBaseline, thresholds);
    expect(e.decision).toBe(PromotionDecision.HOLD);
    expect(e.reasons.some((r) => r.includes('samples 5'))).toBe(true);
  });

  it('HOLDs when success rate is below the minimum', () => {
    const e = evaluateStage({ samples: 30, successRate: 0.8, failureRate: 0.2 }, goodBaseline, thresholds);
    expect(e.decision).toBe(PromotionDecision.HOLD);
    expect(e.reasons.some((r) => r.includes('success rate'))).toBe(true);
  });

  it('HOLDs when failure rate exceeds the maximum', () => {
    const e = evaluateStage({ samples: 30, successRate: 0.95, failureRate: 0.15 }, goodBaseline, thresholds);
    expect(e.decision).toBe(PromotionDecision.HOLD);
    expect(e.reasons.some((r) => r.includes('failure rate'))).toBe(true);
  });

  it('HOLDs when lift over baseline is below the minimum', () => {
    // baseline success 0.93, candidate 0.94 ⇒ lift 0.01 < 0.02.
    const e = evaluateStage(
      { samples: 30, successRate: 0.94, failureRate: 0.06 },
      { ...goodBaseline, successRate: 0.93 },
      thresholds,
    );
    expect(e.decision).toBe(PromotionDecision.HOLD);
    expect(e.reasons.some((r) => r.includes('lift'))).toBe(true);
  });

  it('evaluateShadow + evaluateCanary are evaluateStage aliases', () => {
    expect(evaluateShadow(goodMetrics(30), goodBaseline).decision).toBe(PromotionDecision.ADVANCE);
    expect(evaluateCanary(goodMetrics(30), goodBaseline).decision).toBe(PromotionDecision.ADVANCE);
  });
});

describe('rampCanary', () => {
  it('steps up the ladder on ADVANCE (still CANARY)', () => {
    const canary = startCanary(startShadow(proposeVersion(draft(), T1), T2), T3); // 1%
    const r = rampCanary(canary, goodMetrics(30), goodBaseline, T4);
    expect(r.decision).toBe(PromotionDecision.ADVANCE);
    expect(r.nextVersion?.status).toBe(ConfigVersionStatus.CANARY);
    expect(r.nextVersion?.rolloutPercent).toBe(5);
  });

  it('PROMOTEs when the next step would be 100%', () => {
    const canary = startCanary(startShadow(proposeVersion(draft(), T1), T2), T3, [1, 5, 25, 50, 100]); // 1%
    let v = canary;
    // Ramp through the ladder manually to 50%.
    v = rampCanary(v, goodMetrics(30), goodBaseline, T4, { ladder: [1, 5, 25, 50, 100] }).nextVersion!;
    expect(v.rolloutPercent).toBe(5);
    v = rampCanary(v, goodMetrics(30), goodBaseline, T4, { ladder: [1, 5, 25, 50, 100] }).nextVersion!;
    expect(v.rolloutPercent).toBe(25);
    v = rampCanary(v, goodMetrics(30), goodBaseline, T4, { ladder: [1, 5, 25, 50, 100] }).nextVersion!;
    expect(v.rolloutPercent).toBe(50);
    const final = rampCanary(v, goodMetrics(30), goodBaseline, T4, { ladder: [1, 5, 25, 50, 100] });
    expect(final.decision).toBe(PromotionDecision.ADVANCE);
    expect(final.nextVersion?.status).toBe(ConfigVersionStatus.PROMOTED);
    expect(final.nextVersion?.rolloutPercent).toBe(100);
  });

  it('returns nextVersion=null on HOLD (wait for more evidence)', () => {
    const canary = startCanary(startShadow(proposeVersion(draft(), T1), T2), T3);
    const r = rampCanary(canary, goodMetrics(5), goodBaseline, T4); // insufficient samples
    expect(r.decision).toBe(PromotionDecision.HOLD);
    expect(r.nextVersion).toBeNull();
  });

  it('returns nextVersion=null + ROLLBACK on a safety breach', () => {
    const canary = startCanary(startShadow(proposeVersion(draft(), T1), T2), T3);
    const r = rampCanary(canary, { ...goodMetrics(30), safetyIncidentRate: 0.05 }, goodBaseline, T4);
    expect(r.decision).toBe(PromotionDecision.ROLLBACK);
    expect(r.nextVersion).toBeNull();
  });

  it('refuses to ramp a non-CANARY version', () => {
    const shadow = startShadow(proposeVersion(draft(), T1), T2);
    expect(() => rampCanary(shadow, goodMetrics(30), goodBaseline, T4)).toThrow(ConfigLifecycleError);
  });
});

describe('recordEvent + withEvaluation', () => {
  it('records an immutable audit event for a transition', () => {
    const canary = startCanary(startShadow(proposeVersion(draft(), T1), T2), T3);
    const ev = recordEvent(canary, {
      id: 'evt-1',
      fromStatus: ConfigVersionStatus.SHADOW,
      toStatus: ConfigVersionStatus.CANARY,
      stage: RolloutStage.CANARY,
      decision: PromotionDecision.ADVANCE,
      rolloutPercent: canary.rolloutPercent,
      reason: 'shadow passed — canary started',
      now: T3,
    });
    expect(ev.configVersionId).toBe(canary.id);
    expect(ev.tenantId).toBe('tenant-1');
    expect(ev.fromStatus).toBe(ConfigVersionStatus.SHADOW);
    expect(ev.toStatus).toBe(ConfigVersionStatus.CANARY);
    expect(ev.stage).toBe(RolloutStage.CANARY);
    expect(ev.decision).toBe(PromotionDecision.ADVANCE);
    expect(ev.rolloutPercent).toBe(canary.rolloutPercent);
    expect(ev.occurredAt).toBe(T3);
  });

  it('withEvaluation attaches a summary without changing status', () => {
    const v = startShadow(proposeVersion(draft(), T1), T2);
    const tagged = withEvaluation(v, 'hold: samples 5 < min 20');
    expect(tagged.status).toBe(v.status);
    expect(tagged.evaluationSummary).toBe('hold: samples 5 < min 20');
  });
});

describe('determinism', () => {
  it('same inputs ⇒ identical lifecycle walk', () => {
    const a = promoteVersion(startCanary(startShadow(proposeVersion(draft(), T1), T2), T3), T4);
    const b = promoteVersion(startCanary(startShadow(proposeVersion(draft(), T1), T2), T3), T4);
    expect(a).toEqual(b);
  });
});