/**
 * learning-node.ts — HyperAgent Phase 5 self-learning graph node (LIVE).
 *
 * Reached from the validator AFTER a terminal run (COMPLETED or FAILED) when
 * the HyperAgent layer is ON (see `afterValidator` in edges.ts). It is the
 * live execution-path call site for the self-learning pure cores that were
 * previously pure-core-tested only:
 *   - `evaluateOutcome` (outcome-evaluator.ts) — the deterministic verdict +
 *     per-task triage for the finished run.
 *   - `extractLearnings` (learning-extractor.ts) — typed learning candidates
 *     (WORKFLOW / POLICY / KNOWLEDGE) derived from the outcome + diagnoses.
 *   - `persistLearningCandidates` (learning-persist.ts) — durable accrual into
 *     `learning_records` with information-theoretic promotion gating.
 *
 * This is the node that closes the gap the audit found: "no live graph node
 * calls evaluateOutcome / extractLearnings / gateLearning / persist". After
 * this node, a finished HyperAgent-on run has durably recorded what it learned,
 * and a later run (Phase 3 recall) can recall promoted learnings into the
 * planner.
 *
 * Non-fatal by design: the run is ALREADY terminal when this node runs, so a
 * persist error (DB down, bad row) MUST NOT flip it to FAILED. Every I/O step
 * is wrapped so the worst case is "this run didn't durably learn" — never
 * "this run's outcome changed". The node still writes the in-memory
 * `outcomeEvaluation` + `learningCandidates` to state even when persist is
 * skipped/fails, so the cockpit + SwarmResult surface them.
 *
 * OFF-gated: `afterValidator` only routes here when `hyperAgentActive(state)`,
 * so legacy (HyperAgent OFF) workflows are byte-for-byte unchanged and this
 * node is unreachable.
 */

import type { FailureClass, OutcomeEvaluation } from '@jak-swarm/shared';
import type { SwarmState } from '../../state/swarm-state.js';
import { evaluateOutcome } from '../../hyperagent/outcome-evaluator.js';
import { extractLearnings } from '../../hyperagent/learning-extractor.js';
import {
  persistLearningCandidates,
  type LearningPersistPrismaClient,
  type LearningGateOverrides,
  type PersistOutcome,
} from '../../hyperagent/learning-persist.js';

export interface LearningNodeDeps {
  /**
   * Durable persist seam. When omitted, the node evaluates + extracts into
   * state but does NOT write to the DB (useful for shadow/dry runs + unit
   * tests that don't want a Prisma client). When provided, candidates are
   * upserted + gated + promoted through learning-persist.ts.
   */
  db?: LearningPersistPrismaClient;
  /** Optional per-tenant gate thresholds (otherwise DEFAULT_GATE applies). */
  gate?: LearningGateOverrides;
  /**
   * Optional observer the host wires so the cockpit / audit can see which
   * learnings were promoted as a side effect of this run. Pure side effect —
   * never affects state.
   */
  onPersisted?: (outcomes: PersistOutcome[]) => void;
}

/** Build the failureClass-by-task map from the run's diagnoses (if any). */
function failureClassByTask(state: SwarmState): Record<string, FailureClass> | undefined {
  const diagnoses = state.failureDiagnoses;
  if (!diagnoses || Object.keys(diagnoses).length === 0) return undefined;
  const map: Record<string, FailureClass> = {};
  for (const [taskId, diag] of Object.entries(diagnoses)) {
    if (diag?.failureClass) map[taskId] = diag.failureClass;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

export async function learningNode(
  state: SwarmState,
  deps: LearningNodeDeps = {},
): Promise<Partial<SwarmState>> {
  // Nothing to learn from if there's no plan (shouldn't happen post-validator,
  // but guard so the node is a no-op rather than a crash).
  if (!state.plan) return {};

  const now = new Date().toISOString();
  const outcome: OutcomeEvaluation = evaluateOutcome({
    workflowId: state.workflowId,
    tenantId: state.tenantId,
    plan: state.plan,
    verificationResults: state.verificationResults,
    failedTaskIds: state.failedTaskIds,
    completedTaskIds: state.completedTaskIds,
    blocked: state.blocked,
    accumulatedCostUsd: state.accumulatedCostUsd,
    // The live runtime does not currently carry run startedAt/completedAt on
    // SwarmState; the evaluator handles missing/zero timestamps gracefully
    // (durationMs = 0). durationMs is not used by the learning extractor.
    startedAt: now,
    completedAt: now,
    failureClassByTask: failureClassByTask(state),
  });

  const candidates = extractLearnings({
    outcome,
    diagnoses: state.failureDiagnoses,
    now,
    tenantId: state.tenantId,
  });

  // Durable persist — non-fatal. A DB error here never changes the run outcome.
  if (deps.db && candidates.length > 0) {
    try {
      const outcomes = await persistLearningCandidates({
        db: deps.db,
        tenantId: state.tenantId,
        candidates,
        now,
        gate: deps.gate,
      });
      // Surface promotions as state side-effect data (cockpit/audit), without
      // letting a persist error propagate.
      const promoted = outcomes
        .filter((o) => o.promoted)
        .map((o) => ({ key: o.key, mutualInformation: o.mutualInformation }));
      if (deps.onPersisted) {
        try {
          deps.onPersisted(outcomes);
        } catch {
          /* observer failure is non-fatal */
        }
      }
      return {
        outcomeEvaluation: outcome,
        learningCandidates: candidates,
        promotedLearnings: promoted,
      };
    } catch {
      // Persist failed — still surface the in-memory evaluation + candidates.
      return { outcomeEvaluation: outcome, learningCandidates: candidates };
    }
  }

  // No DB injected (shadow/dry run) — evaluate + extract into state only.
  return { outcomeEvaluation: outcome, learningCandidates: candidates };
}