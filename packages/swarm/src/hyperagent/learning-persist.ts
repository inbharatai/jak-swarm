/**
 * learning-persist.ts — HyperAgent self-learning persist service (LIVE I/O core).
 *
 * The pure cores (learning-extractor.ts, learning-gate.ts) are deterministic and
 * side-effect free. This module is the thin I/O layer that durably accrues
 * extracted learning candidates into the `learning_records` table and applies
 * the information-theoretic gate to decide promotion. It is the seam the live
 * graph's learning node (Phase 2) calls — the only place a LearningRecord row
 * is written from the execution path.
 *
 * Responsibilities (the three things the audit found "not implemented"):
 *   - **Dedup** — upsert by the natural key `@@unique([tenantId, key])`. A
 *     repeated observation of the same learning folds into the existing row's
 *     contingency table; no duplicate rows are ever created.
 *   - **Conflict resolution** — MI-truth policy. A learning that stops
 *     correlating with success (its measured MI collapses below the gate
 *     threshold after being promoted) is DEPRECATED, never silently
 *     overwritten. Latest evidence wins on `value` / `summary` / `tags` (the
 *     human-readable content); the measured correlation is the arbiter of
 *     whether the learning still governs behaviour.
 *   - **Promotion** — after merging, run `gateLearning` over the accumulated
 *     contingency. Promote CANDIDATE → PROMOTED when MI ≥ threshold + enough
 *     samples + ≥1 present-success.
 *   - **Scoping** — scope is baked into the `key` string namespace produced by
 *     learning-extractor.ts (`cfg:<taskType>:…`). Recall queries by key prefix
 *     (Phase 3). No schema change is needed.
 *
 * Information-theoretic accrual (the part that makes promotion reachable):
 * mutual information I(learning_present; success) is only nonzero when both the
 * "present" and "absent" cells of the 2×2 table are populated. A candidate from
 * the extractor carries only the *present* observation (a if the trial
 * succeeded, b if it failed). To make the gate able to fire, this service
 * accrues the *absent* observation against every OTHER known config of the same
 * task type: when config X runs task type T and succeeds, every other known
 * `cfg:T:*` key gets a `c` (absent + success); when X fails, they get a `d`.
 * Over many runs with different configs, each key accrues a/b (present) and
 * c/d (absent), and MI becomes a real measured correlation — not "the LLM said
 * this is better". This is the honest information-theoretic loop the pure cores
 * were designed for; wiring it live is exactly the gap this pass closes.
 *
 * Non-fatal: the caller (learning-node.ts) wraps persist in try/catch so a DB
 * error never fails a completed workflow. This module itself throws on
 * programmer error (bad input) but the live node treats any thrown error as
 * best-effort-skip.
 *
 * Pure-core reuse only — no LLM, no Date.now (the caller stamps `now`).
 */
import { LearningStatus } from '@jak-swarm/shared';
import type { BanditArm, ContingencyTable, LearningCandidate } from '@jak-swarm/shared';
import { gateLearning, mergeContingency, DEFAULT_GATE } from './learning-gate.js';

/**
 * Minimal Prisma seam — only the `learningRecord` model, only the operations
 * the persist path needs. Mirrors the `CheckpointPrismaClient` pattern
 * (postgres-checkpointer.ts:62) so the live graph can inject the real Prisma
 * client while tests inject an in-memory stub.
 */
export interface LearningPersistPrismaClient {
  learningRecord: {
    findMany(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
}

/** Optional per-tenant gate overrides (otherwise DEFAULT_GATE applies). */
export interface LearningGateOverrides {
  miThreshold?: number;
  minSamples?: number;
  minPresentSuccesses?: number;
}

export interface PersistLearningCandidatesInput {
  db: LearningPersistPrismaClient;
  tenantId: string;
  candidates: LearningCandidate[];
  /** ISO timestamp — caller stamps it (no Date.now in the persist hot path). */
  now: string;
  /** Per-tenant gate thresholds; default DEFAULT_GATE. */
  gate?: LearningGateOverrides;
  /**
   * Whether promotion (and deprecation) is permitted this call. The live
   * learning node sets this from `evaluateForConfig(..., PROMOTE_CONFIG)` so
   * that a tenant below L4 — or OBSERVE mode, which is read-only — accrues
   * candidates (CANDIDATE) and measures MI but never flips a row to PROMOTED
   * or DEPRECATED. Default true (pure-core / tests preserve prior behaviour).
   */
  promoteEnabled?: boolean;
}

/** The per-candidate outcome the caller can observe (for audit + cockpit). */
export interface PersistOutcome {
  key: string;
  status: LearningStatus;
  promoted: boolean;
  deprecated: boolean;
  contingency: ContingencyTable;
  mutualInformation: number;
  reason: string;
  /** True when this call created a brand-new row (vs. merged into an existing one). */
  created: boolean;
}

/** The persisted row shape (only the fields the persist path writes/reads). */
interface LearningRecordRow {
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
  contingency: ContingencyTable;
  mutualInformation: number | null;
  confidence: number;
  createdAt: string;
  promotedAt: string | null;
  expiredAt: string | null;
}

/** A config-learning key is `cfg:<taskType>:…`. Returns the taskType or null. */
function cfgTaskType(key: string): string | null {
  if (!key.startsWith('cfg:')) return null;
  const parts = key.split(':');
  return parts[1] ?? null;
}

/** A trial's outcome: success if the present-success cell is set, else failure. */
function trialOutcome(contingency: ContingencyTable): 'success' | 'failure' {
  return contingency.a > 0 ? 'success' : 'failure';
}

const ZERO: ContingencyTable = { a: 0, b: 0, c: 0, d: 0 };

function presentDelta(o: 'success' | 'failure'): ContingencyTable {
  return o === 'success' ? { a: 1, b: 0, c: 0, d: 0 } : { a: 0, b: 1, c: 0, d: 0 };
}
function absentDelta(o: 'success' | 'failure'): ContingencyTable {
  return o === 'success' ? { a: 0, b: 0, c: 1, d: 0 } : { a: 0, b: 0, c: 0, d: 1 };
}

/**
 * Persist + gate one batch of learning candidates for a tenant. Each config
 * candidate accrues a present cell; every OTHER known config of the same task
 * type accrues the matching absent cell (the information-theoretic contrast
 * that lets mutual information be nonzero). Each affected row is then re-gated
 * to decide promotion / deprecation. Returns the per-candidate outcome.
 */
export async function persistLearningCandidates(
  input: PersistLearningCandidatesInput,
): Promise<PersistOutcome[]> {
  const { db, tenantId, candidates, now } = input;
  const overrides = input.gate ?? {};
  // When the autonomy policy denies PROMOTE_CONFIG (OBSERVE mode, or below L4),
  // the caller sets promoteEnabled=false: candidates still accrue + MI is still
  // measured, but no row flips to PROMOTED or DEPRECATED. OBSERVE is read-only;
  // promotion is an L4 capability, not an MI-only side effect.
  const canPromote = input.promoteEnabled !== false;
  const gateOpts = {
    threshold: overrides.miThreshold ?? DEFAULT_GATE.miThreshold,
    minSamples: overrides.minSamples ?? DEFAULT_GATE.minSamples,
    minPresentSuccesses: overrides.minPresentSuccesses ?? DEFAULT_GATE.minPresentSuccesses,
  };

  // 1. Group candidates by task type (cfg keys only). Non-cfg candidates
  //    (block:, goal-block:) are singletons — accrued present-only, no siblings.
  const byTaskType = new Map<string, LearningCandidate[]>();
  const nonCfg: LearningCandidate[] = [];
  for (const c of candidates) {
    const tt = cfgTaskType(c.key);
    if (tt) {
      const arr = byTaskType.get(tt) ?? [];
      arr.push(c);
      byTaskType.set(tt, arr);
    } else {
      nonCfg.push(c);
    }
  }

  const outcomes: PersistOutcome[] = [];

  // 2. Per task type: load known sibling rows, compute the merged contingency
  //    for every affected key (present for the trial's own key, absent for the
  //    other known configs of the same task type), then re-gate + write.
  for (const [taskType, trials] of byTaskType) {
    const prefix = `cfg:${taskType}:`;
    const knownRows = (await db.learningRecord.findMany({
      where: { tenantId, key: { startsWith: prefix } },
    })) as LearningRecordRow[];
    const knownByKey = new Map<string, LearningRecordRow>();
    for (const r of knownRows) knownByKey.set(r.key, r);

    const presentKeys = new Set(trials.map((t) => t.key));
    // All keys touched this call: known + any brand-new present keys.
    const allKeys = new Set<string>([...knownByKey.keys(), ...presentKeys]);

    // Accumulate the contingency delta per key across all trials of this task type.
    const deltas = new Map<string, ContingencyTable>();
    const addDelta = (key: string, delta: ContingencyTable) => {
      const cur = deltas.get(key) ?? ZERO;
      deltas.set(key, mergeContingency(cur, delta));
    };

    for (const trial of trials) {
      const o = trialOutcome(trial.contingency);
      addDelta(trial.key, presentDelta(o));
      // Absent accrual: every other known config of this task type that was NOT
      // present this call. (A config present in another trial this run was used,
      // so it is not "absent" for this trial.)
      for (const key of allKeys) {
        if (key === trial.key) continue;
        if (presentKeys.has(key)) continue;
        addDelta(key, absentDelta(o));
      }
    }

    // 3. Apply each delta: merge into the existing row (or create), re-gate,
    //    decide promotion / deprecation, and write.
    for (const [key, delta] of deltas) {
      const existing = knownByKey.get(key);
      const trial = trials.find((t) => t.key === key); // undefined for absent-only keys
      // For absent-only keys (a known config not used this run) there's no new
      // candidate content; carry forward the existing row's human-readable fields.
      const contentCandidate = trial;
      const merged = mergeContingency(existing?.contingency ?? ZERO, delta);

      const promotion = gateLearning({
        key,
        contingency: merged,
        threshold: gateOpts.threshold,
        minSamples: gateOpts.minSamples,
        minPresentSuccesses: gateOpts.minPresentSuccesses,
      });

      const wasPromoted = existing?.status === LearningStatus.PROMOTED;
      let status: LearningStatus;
      if (promotion.promoted && canPromote) {
        status = LearningStatus.PROMOTED;
      } else if (wasPromoted && promotion.promoted) {
        // Still above the gate — keep governing (canPromote only affects the
        // CANDIDATE→PROMOTED flip, not an already-promoted row's tenure).
        status = LearningStatus.PROMOTED;
      } else if (wasPromoted && canPromote) {
        // Was promoted, but the accumulated MI has now collapsed below the gate.
        // MI-truth conflict resolution: deprecate, never silently keep governing.
        status = LearningStatus.DEPRECATED;
      } else {
        // Still a candidate (or freshly created) — keep accruing observations.
        status = existing ? (existing.status as LearningStatus) : LearningStatus.CANDIDATE;
      }

      const confidence = promotion.promoted
        ? promotion.mutualInformation
        : (existing?.confidence ?? contentCandidate?.confidence ?? 0);

      // Latest evidence wins on human-readable content; absent-only updates keep existing content.
      const value = contentCandidate?.value ?? existing?.value ?? {};
      const summary = contentCandidate?.summary ?? existing?.summary ?? '';
      const tags = contentCandidate?.tags ?? existing?.tags ?? [];
      const kind = contentCandidate?.kind ?? (existing?.kind as LearningCandidate['kind'] | undefined) ?? 'WORKFLOW';
      const source = contentCandidate?.source ?? (existing?.source as LearningCandidate['source'] | undefined) ?? 'OUTCOME';
      const failureClass = contentCandidate?.failureClass ?? existing?.failureClass ?? null;
      const outcomeVerdict = contentCandidate?.outcomeVerdict ?? existing?.outcomeVerdict ?? null;
      const taskVerdict = contentCandidate?.taskVerdict ?? existing?.taskVerdict ?? null;

      const data = {
        tenantId,
        key,
        kind,
        source,
        status,
        value,
        summary,
        tags,
        failureClass,
        outcomeVerdict,
        taskVerdict,
        contingency: merged,
        mutualInformation: promotion.mutualInformation,
        confidence,
      };

      if (!existing) {
        await db.learningRecord.create({
          data: {
            ...data,
            createdAt: now,
            promotedAt: status === LearningStatus.PROMOTED ? now : null,
            expiredAt: null,
          },
        });
      } else {
        const promotedAt =
          status === LearningStatus.PROMOTED ? (existing.promotedAt ?? now) : existing.promotedAt;
        const expiredAt =
          status === LearningStatus.DEPRECATED ? (existing.expiredAt ?? now) : existing.expiredAt;
        await db.learningRecord.update({
          where: { tenantId_key: { tenantId, key } },
          data: { ...data, promotedAt, expiredAt },
        });
      }

      // Report an outcome only for the keys that had a present trial this call
      // (the candidates). Absent-only updates are side effects, not reported.
      if (presentKeys.has(key)) {
        outcomes.push({
          key,
          status,
          promoted: status === LearningStatus.PROMOTED,
          deprecated: status === LearningStatus.DEPRECATED,
          contingency: merged,
          mutualInformation: promotion.mutualInformation,
          reason: promotion.reason,
          created: !existing,
        });
      }
    }
  }

  // 4. Non-cfg candidates (block:, goal-block:) — present-only accrual.
  for (const candidate of nonCfg) {
    const existingRow = (await db.learningRecord.findMany({
      where: { tenantId, key: candidate.key },
    })) as LearningRecordRow[];
    const existing = existingRow[0];
    const merged = mergeContingency(existing?.contingency ?? ZERO, candidate.contingency);
    const promotion = gateLearning({ key: candidate.key, contingency: merged, ...gateOpts });
    const wasPromoted = existing?.status === LearningStatus.PROMOTED;
    let status: LearningStatus;
    if (promotion.promoted && canPromote) status = LearningStatus.PROMOTED;
    else if (wasPromoted && promotion.promoted) status = LearningStatus.PROMOTED;
    else if (wasPromoted && canPromote) status = LearningStatus.DEPRECATED;
    else status = existing ? (existing.status as LearningStatus) : LearningStatus.CANDIDATE;
    const confidence = promotion.promoted ? promotion.mutualInformation : (existing?.confidence ?? candidate.confidence);
    const data = {
      tenantId,
      key: candidate.key,
      kind: candidate.kind,
      source: candidate.source,
      status,
      value: candidate.value,
      summary: candidate.summary,
      tags: candidate.tags,
      failureClass: candidate.failureClass ?? null,
      outcomeVerdict: candidate.outcomeVerdict ?? null,
      taskVerdict: candidate.taskVerdict ?? null,
      contingency: merged,
      mutualInformation: promotion.mutualInformation,
      confidence,
    };
    if (!existing) {
      await db.learningRecord.create({
        data: { ...data, createdAt: now, promotedAt: status === LearningStatus.PROMOTED ? now : null, expiredAt: null },
      });
    } else {
      await db.learningRecord.update({
        where: { tenantId_key: { tenantId, key: candidate.key } },
        data: { ...data, promotedAt: existing.promotedAt, expiredAt: existing.expiredAt },
      });
    }
    outcomes.push({
      key: candidate.key,
      status,
      promoted: status === LearningStatus.PROMOTED,
      deprecated: status === LearningStatus.DEPRECATED,
      contingency: merged,
      mutualInformation: promotion.mutualInformation,
      reason: promotion.reason,
      created: !existing,
    });
  }

  return outcomes;
}

// ─── Recall (Phase 3) ────────────────────────────────────────────────────────

/**
 * A recalled learning — a PROMOTED row projected to the fields the live
 * execution path (planner recall + bandit selection) consumes. Carries the
 * config dimension (agentRole + primaryTool) so the planner can match a
 * recalled config against a planned task and the bandit can build arms.
 */
export interface RecalledLearning {
  key: string;
  kind: string;
  taskType: string;
  agentRole?: string;
  primaryTool?: string;
  summary: string;
  confidence: number;
  contingency: ContingencyTable;
  mutualInformation: number;
}

export interface RecallLearningsInput {
  db: LearningPersistPrismaClient;
  tenantId: string;
  /** Task types to recall PROMOTED WORKFLOW/POLICY learnings for (plan task ids' prefix). */
  taskTypes: string[];
  /** Cap on rows returned (defensive). Default 50. */
  limit?: number;
}

/**
 * Recall PROMOTED learnings for a set of task types. The live planner node
 * (Phase 3) calls this after it has a plan, keyed by the plan's task-type
 * prefixes, so prior promotions inform the replanner (`state.relevantLearnings`)
 * and the bandit can select among competing configs of the same task type.
 *
 * Pure I/O — no clock, no LLM. Returns PROMOTED rows only (candidates haven't
 * earned governing behaviour yet), sorted by mutual information descending so
 * the strongest correlations surface first. Non-fatal callers wrap in try/catch.
 */
export async function recallLearnings(input: RecallLearningsInput): Promise<RecalledLearning[]> {
  const { db, tenantId, taskTypes } = input;
  const limit = input.limit ?? 50;
  const out: RecalledLearning[] = [];
  for (const taskType of new Set(taskTypes)) {
    const prefix = `cfg:${taskType}:`;
    const rows = (await db.learningRecord.findMany({
      where: { tenantId, key: { startsWith: prefix } },
    })) as LearningRecordRow[];
    for (const r of rows) {
      if (r.status !== LearningStatus.PROMOTED) continue;
      const value = (r.value ?? {}) as { agentRole?: string; primaryTool?: string };
      out.push({
        key: r.key,
        kind: r.kind,
        taskType,
        agentRole: value.agentRole,
        primaryTool: value.primaryTool,
        summary: r.summary,
        confidence: r.confidence,
        contingency: r.contingency ?? ZERO,
        mutualInformation: r.mutualInformation ?? 0,
      });
    }
  }
  out.sort((a, b) => b.mutualInformation - a.mutualInformation);
  return out.slice(0, limit);
}

/**
 * Build bandit arms from recalled WORKFLOW learnings for one task type.
 * Each PROMOTED config becomes one arm: successes = contingency.a (present +
 * success), failures = contingency.b (present + failure). The arm id is the
 * learning key; `configVersionId` is the `${agentRole}/${primaryTool}` string
 * the planner matches against a planned task's current config. Pure.
 *
 * Only WORKFLOW learnings are config-arms (POLICY learnings are repair
 * preferences the replanner recalls, not competing configs the bandit picks
 * between). Returns arms in the order they were recalled (MI desc).
 */
export function armsForTaskType(recalled: ReadonlyArray<RecalledLearning>, taskType: string): BanditArm[] {
  return recalled
    .filter((r) => r.taskType === taskType && r.kind === 'WORKFLOW')
    .map((r) => ({
      id: r.key,
      configVersionId: r.agentRole && r.primaryTool ? `${r.agentRole}/${r.primaryTool}` : undefined,
      successes: r.contingency.a,
      failures: r.contingency.b,
      lastSelectedAt: null,
    }));
}