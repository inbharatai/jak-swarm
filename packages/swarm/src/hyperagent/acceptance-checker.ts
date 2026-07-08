/**
 * acceptance-checker.ts — HyperAgent Phase 6 deterministic acceptance checker.
 *
 * Spec §13 Phase 6: measure a finished run's evidence against an approved
 * AgentExecutableSpec's `acceptanceCriteria` — deterministically, never faking
 * a satisfied criterion. This is the binding that flips the outcome-evaluator's
 * honest `wired=false` seam (audit §0) to `wired=true` with real evidence.
 *
 * Each criterion kind binds to a concrete runtime evidence source:
 *   TASK_COMPLETED   → taskOutcomes[taskId].verdict === TASK_PASSED
 *   TASK_VERIFIED    → taskOutcomes[taskId].verified && verdict === TASK_PASSED
 *   ARTIFACT_PRESENT → artifacts.includes(artifactId)
 *   METRIC_THRESHOLD → metrics[name] <op> threshold
 *   NO_FAILURE_CLASS → no taskOutcome.failureClass === failureClass
 *   CUSTOM           → no deterministic binding ⇒ wired=false (UNVERIFIABLE)
 *
 * The verdict is tri-state: MET / UNMET / UNVERIFIABLE. A spec whose every
 * criterion is CUSTOM cannot be auto-accepted — it surfaces UNVERIFIABLE so a
 * human signs off, instead of the system pretending it passed.
 *
 * Pure + deterministic — no I/O, no LLM, no Date.now. Fully unit-testable.
 */
import { AcceptanceCriterionKind, AcceptanceVerdict, TaskVerdict } from '@jak-swarm/shared';
import type {
  AcceptanceCriterion,
  AcceptanceCriterionResult,
  MetricOperator,
  RunEvidence,
} from '@jak-swarm/shared';

/** Apply a metric comparison operator. */
function compare(value: number, op: MetricOperator, threshold: number): boolean {
  switch (op) {
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    case 'gt': return value > threshold;
    case 'lt': return value < threshold;
    case 'eq': return value === threshold;
    default: return false;
  }
}

/**
 * Check a single criterion against the run evidence. Pure.
 * Returns an AcceptanceCriterionResult with `wired=true` for every kind that has
 * a deterministic binding (even when the check fails — a failed wired check is
 * still wired, just unsatisfied). CUSTOM criteria return `wired=false`.
 */
export function checkCriterion(
  criterion: AcceptanceCriterion,
  evidence: RunEvidence,
): AcceptanceCriterionResult {
  const desc = criterion.description;
  switch (criterion.kind) {
    case AcceptanceCriterionKind.TASK_COMPLETED: {
      if (!criterion.taskId) {
        return { criterion: desc, satisfied: false, evidence: 'TASK_COMPLETED criterion missing taskId', wired: true };
      }
      const t = evidence.taskOutcomes.find((o) => o.taskId === criterion.taskId);
      if (!t) {
        return { criterion: desc, satisfied: false, evidence: `task ${criterion.taskId} not present in run`, wired: true };
      }
      const ok = t.verdict === TaskVerdict.TASK_PASSED;
      return { criterion: desc, satisfied: ok, evidence: `task ${criterion.taskId} verdict=${t.verdict}`, wired: true };
    }

    case AcceptanceCriterionKind.TASK_VERIFIED: {
      if (!criterion.taskId) {
        return { criterion: desc, satisfied: false, evidence: 'TASK_VERIFIED criterion missing taskId', wired: true };
      }
      const t = evidence.taskOutcomes.find((o) => o.taskId === criterion.taskId);
      if (!t) {
        return { criterion: desc, satisfied: false, evidence: `task ${criterion.taskId} not present in run`, wired: true };
      }
      const ok = t.verified === true && t.verdict === TaskVerdict.TASK_PASSED;
      return {
        criterion: desc,
        satisfied: ok,
        evidence: `task ${criterion.taskId} verdict=${t.verdict} verified=${t.verified}`,
        wired: true,
      };
    }

    case AcceptanceCriterionKind.ARTIFACT_PRESENT: {
      if (!criterion.artifactId) {
        return { criterion: desc, satisfied: false, evidence: 'ARTIFACT_PRESENT criterion missing artifactId', wired: true };
      }
      const ok = evidence.artifacts.includes(criterion.artifactId);
      return {
        criterion: desc,
        satisfied: ok,
        evidence: `artifact ${criterion.artifactId} ${ok ? 'present' : 'absent'}`,
        wired: true,
      };
    }

    case AcceptanceCriterionKind.METRIC_THRESHOLD: {
      const m = criterion.metric;
      if (!m) {
        return { criterion: desc, satisfied: false, evidence: 'METRIC_THRESHOLD criterion missing metric config', wired: true };
      }
      const v = evidence.metrics[m.name];
      if (v === undefined || Number.isNaN(v)) {
        return { criterion: desc, satisfied: false, evidence: `metric ${m.name} not reported by run`, wired: true };
      }
      const ok = compare(v, m.operator, m.threshold);
      return {
        criterion: desc,
        satisfied: ok,
        evidence: `metric ${m.name}=${v} ${m.operator} ${m.threshold} ⇒ ${ok}`,
        wired: true,
      };
    }

    case AcceptanceCriterionKind.NO_FAILURE_CLASS: {
      const fc = criterion.failureClass;
      if (!fc) {
        return { criterion: desc, satisfied: false, evidence: 'NO_FAILURE_CLASS criterion missing failureClass', wired: true };
      }
      const offenders = evidence.taskOutcomes.filter((o) => o.failureClass === fc);
      const ok = offenders.length === 0;
      return {
        criterion: desc,
        satisfied: ok,
        evidence: ok ? `no ${fc} failures observed` : `${offenders.length} task(s) failed with ${fc}`,
        wired: true,
      };
    }

    case AcceptanceCriterionKind.CUSTOM:
    default:
      // No deterministic binding — never fake satisfaction. Stays unwired; the
      // verdict surfaces UNVERIFIABLE so a human must sign off.
      return { criterion: desc, satisfied: false, evidence: null, wired: false };
  }
}

/** Measure every criterion against the evidence. Pure. */
export function measureAcceptance(
  criteria: AcceptanceCriterion[],
  evidence: RunEvidence,
): AcceptanceCriterionResult[] {
  return criteria.map((c) => checkCriterion(c, evidence));
}

/**
 * Reduce criterion results to a tri-state verdict. Pure.
 *   - MET:          ≥1 wired criterion AND every wired criterion satisfied.
 *   - UNMET:        some wired criterion unsatisfied.
 *   - UNVERIFIABLE: zero wired criteria (all CUSTOM).
 */
export function acceptanceVerdict(results: AcceptanceCriterionResult[]): AcceptanceVerdict {
  const wired = results.filter((r) => r.wired);
  if (wired.length === 0) return AcceptanceVerdict.UNVERIFIABLE;
  return wired.every((r) => r.satisfied) ? AcceptanceVerdict.MET : AcceptanceVerdict.UNMET;
}