/**
 * learning-persist.test.ts — HyperAgent self-learning LIVE persist service.
 *
 * Pins the invariants the audit found "not implemented":
 *   - **Dedup** — a repeated observation of the same (tenantId, key) folds into
 *     the existing row's contingency table; no duplicate rows are created.
 *   - **Information-theoretic accrual** — a config trial accrues a present cell
 *     (a/b) AND every other known config of the same task type accrues the
 *     matching absent cell (c/d). Without absent cells, mutual information is 0
 *     and promotion is unreachable — so this accrual is what makes the gate able
 *     to fire from the live path.
 *   - **Promotion** — once accumulated MI ≥ threshold + enough samples + ≥1
 *     present-success, status flips CANDIDATE → PROMOTED.
 *   - **Conflict resolution (MI-truth)** — a promoted learning whose measured
 *     MI later collapses below the gate is DEPRECATED, never silently kept.
 *   - **Scoping** — scope lives in the key namespace; recall is by key prefix.
 *
 * The stub Prisma is an in-memory map; no real DB is touched.
 */
import { describe, it, expect } from 'vitest';
import { LearningKind, LearningSource, LearningStatus } from '../../../packages/shared/src/index.js';
import type { LearningCandidate } from '../../../packages/shared/src/index.js';
import {
  persistLearningCandidates,
  type LearningPersistPrismaClient,
} from '../../../packages/swarm/src/hyperagent/learning-persist.js';

interface Row {
  tenantId: string;
  key: string;
  kind: string;
  source: string;
  status: string;
  value: unknown;
  summary: string;
  tags: string[];
  failureClass: string | null;
  outcomeVerdict: string | null;
  taskVerdict: string | null;
  contingency: { a: number; b: number; c: number; d: number };
  mutualInformation: number | null;
  confidence: number;
  createdAt: string;
  promotedAt: string | null;
  expiredAt: string | null;
}

interface FindWhere {
  tenantId?: string;
  key?: string | { startsWith?: string };
}

function stubDb(): LearningPersistPrismaClient & { rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const key = (tenantId: string, k: string) => `${tenantId}|${k}`;
  const matches = (w: FindWhere, r: Row): boolean => {
    if (w.tenantId !== undefined && w.tenantId !== r.tenantId) return false;
    if (w.key !== undefined) {
      if (typeof w.key === 'string') {
        if (w.key !== r.key) return false;
      } else if (w.key.startsWith !== undefined) {
        if (!r.key.startsWith(w.key.startsWith)) return false;
      }
    }
    return true;
  };
  const db: LearningPersistPrismaClient = {
    learningRecord: {
      async findMany(args: unknown) {
        const a = args as { where: FindWhere };
        return [...rows.values()].filter((r) => matches(a.where, r));
      },
      async create(args: unknown) {
        const a = args as { data: Row };
        rows.set(key(a.data.tenantId, a.data.key), a.data);
        return a.data;
      },
      async update(args: unknown) {
        const a = args as { where: { tenantId_key: { tenantId: string; key: string } }; data: Partial<Row> };
        const k = key(a.where.tenantId_key.tenantId, a.where.tenantId_key.key);
        const cur = rows.get(k);
        if (!cur) throw new Error(`update missing row ${k}`);
        rows.set(k, { ...cur, ...a.data });
        return rows.get(k);
      },
    },
  };
  return { ...db, rows };
}

/** A WORKFLOW candidate: config `cfg` for task type `T` that passed+verified. */
function passedCandidate(taskType: string, cfg: string): LearningCandidate {
  return {
    key: `cfg:${taskType}:${cfg}`,
    kind: LearningKind.WORKFLOW,
    source: LearningSource.OUTCOME,
    value: { taskType, preferredConfig: cfg, verificationConfidence: 0.9 },
    summary: `Config ${cfg} for ${taskType} passed.`,
    tags: [`task:${taskType}`, 'verified'],
    contingency: { a: 1, b: 0, c: 0, d: 0 },
    confidence: 0.9,
  };
}

/** A WORKFLOW candidate: config `cfg` for task type `T` that FAILED. */
function failedCandidate(taskType: string, cfg: string): LearningCandidate {
  return {
    key: `cfg:${taskType}:${cfg}`,
    kind: LearningKind.POLICY,
    source: LearningSource.OUTCOME,
    value: { taskType, failureClass: 'UNKNOWN' },
    summary: `Config ${cfg} for ${taskType} failed.`,
    tags: [`task:${taskType}`, 'failure:UNKNOWN'],
    failureClass: 'UNKNOWN',
    contingency: { a: 0, b: 1, c: 0, d: 0 },
    confidence: 0.5,
  };
}

const TENANT = 'tenant-1';
const NOW = '2026-07-09T00:00:00.000Z';

describe('learning-persist — dedup + accrual + promotion + conflict + scope', () => {
  it('creates a CANDIDATE row on first observation (single observation never promotes — MI = 0)', async () => {
    const db = stubDb();
    const [outcome] = await persistLearningCandidates({
      db,
      tenantId: TENANT,
      now: NOW,
      candidates: [passedCandidate('email', 'WORKER_A')],
    });
    expect(outcome.created).toBe(true);
    expect(outcome.status).toBe(LearningStatus.CANDIDATE);
    expect(outcome.promoted).toBe(false);
    expect(outcome.mutualInformation).toBe(0); // no absent cells yet → MI = 0
    expect(outcome.contingency).toEqual({ a: 1, b: 0, c: 0, d: 0 });
    expect(db.rows.size).toBe(1);
  });

  it('dedups: a second observation of the same key merges into the existing row (no duplicate rows)', async () => {
    const db = stubDb();
    await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [passedCandidate('email', 'WORKER_A')] });
    const [outcome] = await persistLearningCandidates({
      db,
      tenantId: TENANT,
      now: NOW,
      candidates: [passedCandidate('email', 'WORKER_A')],
    });
    expect(outcome.created).toBe(false);
    expect(db.rows.size).toBe(1); // still one row — merged, not duplicated
    expect(outcome.contingency.a).toBe(2);
    // Still CANDIDATE: with only present-success cells (no absent contrast) MI is 0.
    expect(outcome.promoted).toBe(false);
  });

  it('accrues absent cells against sibling configs so MI becomes measurable (information-theoretic contrast)', async () => {
    const db = stubDb();
    // Run A (success) → WORKER_A present-success (a). No siblings yet → no absent accrual.
    await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [passedCandidate('email', 'WORKER_A')] });
    // Run B (failure) → WORKER_B present-failure (b). WORKER_A is a sibling, absent this run, trial failed → WORKER_A gets d.
    await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [failedCandidate('email', 'WORKER_B')] });
    const a = db.rows.get(`${TENANT}|cfg:email:WORKER_A`)!;
    expect(a.contingency).toEqual({ a: 1, b: 0, c: 0, d: 1 });
    // MI is now > 0 (present+absent contrast exists) but n=2 < minSamples(5) → still CANDIDATE.
    expect(a.status).toBe(LearningStatus.CANDIDATE);
    expect(a.mutualInformation).toBeGreaterThan(0);
  });

  it('promotes CANDIDATE → PROMOTED once MI ≥ threshold over enough contrasting samples', async () => {
    const db = stubDb();
    // 6 successful WORKER_A runs interleaved with 6 failed WORKER_B runs.
    for (let i = 0; i < 6; i++) {
      await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [passedCandidate('email', 'WORKER_A')] });
      await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [failedCandidate('email', 'WORKER_B')] });
    }
    const a = db.rows.get(`${TENANT}|cfg:email:WORKER_A`)!;
    // WORKER_A: a=6 (present successes), d=6 (absent when WORKER_B failed). MI=1.0 bits.
    expect(a.contingency).toEqual({ a: 6, b: 0, c: 0, d: 6 });
    expect(a.mutualInformation).toBeGreaterThanOrEqual(0.05);
    expect(a.status).toBe(LearningStatus.PROMOTED);
    expect(a.promotedAt).toBe(NOW);
    expect(a.confidence).toBe(a.mutualInformation); // promoted confidence = measured MI
  });

  it('deprecates a promoted learning when its MI later collapses (MI-truth conflict resolution)', async () => {
    const db = stubDb();
    // Promote WORKER_A: 6 A-success vs 6 B-failure.
    for (let i = 0; i < 6; i++) {
      await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [passedCandidate('email', 'WORKER_A')] });
      await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [failedCandidate('email', 'WORKER_B')] });
    }
    let a = db.rows.get(`${TENANT}|cfg:email:WORKER_A`)!;
    expect(a.status).toBe(LearningStatus.PROMOTED);

    // Now collapse the correlation: WORKER_A starts failing (b grows) AND WORKER_B
    // starts succeeding (WORKER_A absent + success → c grows), until present and
    // absent success rates equalise → MI → 0.
    for (let i = 0; i < 6; i++) {
      await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [failedCandidate('email', 'WORKER_A')] });
      await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [passedCandidate('email', 'WORKER_B')] });
    }
    a = db.rows.get(`${TENANT}|cfg:email:WORKER_A`)!;
    // a=6,b=6,c=6,d=6 → no variation → MI = 0. Was promoted → now DEPRECATED (not silently kept).
    expect(a.contingency).toEqual({ a: 6, b: 6, c: 6, d: 6 });
    expect(a.mutualInformation).toBe(0);
    expect(a.status).toBe(LearningStatus.DEPRECATED);
    expect(a.expiredAt).toBe(NOW);
  });

  it('quarantines a failure-only learning (never promotes — no present-successes)', async () => {
    const db = stubDb();
    // WORKER_C only ever fails; WORKER_D only ever succeeds (the contrast).
    for (let i = 0; i < 6; i++) {
      await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [failedCandidate('email', 'WORKER_C')] });
      await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [passedCandidate('email', 'WORKER_D')] });
    }
    const c = db.rows.get(`${TENANT}|cfg:email:WORKER_C`)!;
    // WORKER_C has b>0 but a=0 → gate rejects with "no observed present-successes".
    expect(c.contingency.a).toBe(0);
    expect(c.status).not.toBe(LearningStatus.PROMOTED);
  });

  it('scopes by key prefix: configs of different task types never accrue against each other', async () => {
    const db = stubDb();
    await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [passedCandidate('email', 'WORKER_A')] });
    await persistLearningCandidates({ db, tenantId: TENANT, now: NOW, candidates: [passedCandidate('slack', 'WORKER_X')] });
    // email:WORKER_A should not have accrued any absent cell from the slack trial.
    const a = db.rows.get(`${TENANT}|cfg:email:WORKER_A`)!;
    expect(a.contingency).toEqual({ a: 1, b: 0, c: 0, d: 0 });
    expect(db.rows.size).toBe(2);
  });
});