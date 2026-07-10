/**
 * learning-extractor.ts — HyperAgent Phase 5 self-learning (PURE core).
 *
 * Spec §13 Phase 5: a Learning Extractor reads the structured OutcomeEvaluation
 * (Phase 3) + FailureDiagnosis records (Phase 2/4) from a finished run and
 * emits TYPED learning candidates. It is deterministic + pure — no I/O, no
 * LLM, no Date.now — so promotion decisions are reproducible and auditable.
 *
 * What it extracts:
 *   - From a PASSED task: a "this agent+tool combination worked for this task
 *     type" WORKFLOW learning (contingency a+=1).
 *   - From a FAILED task with a diagnosis: a "this failure class hit this
 *     task type; the counterfactual isolated dimension X" POLICY learning that
 *     the replanner can recall next time (contingency b+=1 for the failing
 *     config; the repair preference is the candidate value).
 *   - From a BLOCKED run: a KNOWLEDGE learning that the guardrail blocked this
 *     goal shape (so the planner can avoid it).
 *
 * An optional LLM extractor (LearningExtractorAgent) may refine `summary` /
 * `value` for ambiguous cases; it NEVER sets confidence above what the
 * contingency table justifies — the gate (learning-gate.ts) is the final arbiter.
 */
import { FailureClass, LearningKind, LearningSource, OutcomeVerdict, TaskVerdict } from '@jak-swarm/shared';
import type {
  LearningCandidate,
  ContingencyTable,
  OutcomeEvaluation,
  TaskOutcome,
  FailureDiagnosis,
} from '@jak-swarm/shared';

export interface ExtractLearningsInput {
  outcome: OutcomeEvaluation;
  /** Diagnoses keyed by taskId (Phase 2/4 records). Optional. */
  diagnoses?: Record<string, FailureDiagnosis>;
  /** ISO timestamp — caller stamps it (no Date.now in the pure path). */
  now: string;
  /** Tenant id for the candidates (carried onto persisted records). */
  tenantId: string;
}

/** A single-cell contingency: one observation where the learning was present. */
function singlePresent(success: boolean): ContingencyTable {
  return { a: success ? 1 : 0, b: success ? 0 : 1, c: 0, d: 0 };
}

/**
 * Sorted, de-duplicated tool set joined by '+' — order-invariant. '' when no
 * tools. Two tasks whose only difference is the ORDER of `toolsRequired` therefore
 * produce the SAME key (the audit's "fragile keys" defect: the prior key used
 * `toolsRequired[0]`, so reordering tools silently sharded a learning).
 */
export function normalizeToolSet(tools?: readonly string[]): string {
  if (!tools || tools.length === 0) return '';
  return [...new Set(tools.filter(Boolean))].sort().join('+');
}

export interface ConfigKeyDimensions {
  taskType: string;
  agentRole?: string;
  toolSet?: readonly string[];
  industry?: string;
  modelFamily?: string;
  riskLevel?: string;
}

/**
 * Phase 7 composite learning key. Order-invariant (tool set sorted + de-duped)
 * and dimensioned by industry / model family / risk level so learnings do not
 * cross-generalise across configs, industries, models, or risk tiers they were
 * not observed on.
 *
 * Format: `cfg:<taskType>:<agentRole>:<sortedTools>` + labelled extras
 * `:industry=<x>:model=<y>:risk=<z>` appended only when present. The
 * `cfg:<taskType>:` prefix is preserved so recall-by-prefix (learning-persist)
 * and `cfgTaskType` keep working byte-for-byte.
 *
 * Human-readable + auditable by design. The plan suggested an opaque sha1; we
 * deliberately keep the key readable because HyperAgent promotion decisions must
 * be reproducible and INSPECTABLE — a hashed key hides which config a row tracks
 * and would break the existing pinned-key fixtures without a correctness gain.
 * The order-invariance + richer dimensioning (the actual defect) is what matters.
 *
 * `failureClass` and the counterfactual `dimension` are INTENTIONALLY NOT part
 * of the key. They are candidate METADATA, not config dimensions. Keeping them
 * out means a config's present-success (a) and present-failure (b) observations
 * accrue into ONE contingency row, so the information-theoretic gate
 * (learning-gate.ts) can measure a real DIRECTIONAL lift. Keying by failure
 * class/dimension would shard a/b across rows (success has no dimension; failure
 * does) and the gate could never fire — defeating the Phase 6 fix.
 */
export function composeConfigKey(dims: ConfigKeyDimensions): string {
  const taskType = dims.taskType;
  const role = dims.agentRole ?? '';
  const tools = normalizeToolSet(dims.toolSet);
  const segs = [role, tools].filter((s) => s !== '');
  let key = `cfg:${taskType}`;
  if (segs.length > 0) key += `:${segs.join(':')}`;
  const extras: string[] = [];
  if (dims.industry) extras.push(`industry=${dims.industry}`);
  if (dims.modelFamily) extras.push(`model=${dims.modelFamily}`);
  if (dims.riskLevel) extras.push(`risk=${dims.riskLevel}`);
  if (extras.length > 0) key += `:${extras.join(':')}`;
  return key;
}

/**
 * Stable key for a "this config worked / failed for this task type" learning.
 *
 * Dimensions by config (agent role + sorted tool set) so competing configs of
 * the same task type accrue into SEPARATE contingency tables — that contrast
 * is what lets the information-theoretic gate (learning-gate.ts) measure mutual
 * information and promote. Industry / model family / risk level are appended as
 * labelled extras when present so learnings don't cross-generalise across those
 * tiers. `failureClass` / counterfactual `dimension` are candidate metadata,
 * NOT key dimensions (see `composeConfigKey`).
 */
function configKey(task: TaskOutcome): string {
  return composeConfigKey({
    taskType: task.taskId.split('_')[0] ?? task.taskId,
    agentRole: task.agentRole,
    toolSet: task.toolSet ?? (task.primaryTool ? [task.primaryTool] : []),
    industry: task.industry,
    modelFamily: task.modelFamily,
    riskLevel: task.riskLevel !== undefined ? String(task.riskLevel) : undefined,
  });
}

/** Tags for a task-derived learning. */
function taskTags(task: TaskOutcome): string[] {
  const tags = [`task:${task.taskId.split('_')[0]}`];
  if (task.failureClass) tags.push(`failure:${task.failureClass}`);
  if (task.verified) tags.push('verified');
  return tags;
}

/**
 * Extract learning candidates from a finished run. Pure.
 *
 * Note: each candidate starts from a single observation (contingency with one
 * cell = 1). The gate accumulates these across runs (via the persisted
 * LearningRecord.contingency) before deciding promotion — a single observation
 * never promotes on its own (its mutual information is 0).
 */
export function extractLearnings(input: ExtractLearningsInput): LearningCandidate[] {
  const { outcome, diagnoses, now, tenantId } = input;
  void tenantId; // carried onto persisted records by the service layer
  void now; // timestamped by the service layer on persist
  const candidates: LearningCandidate[] = [];

  for (const task of outcome.taskOutcomes) {
    // PASSED + verified → a "this config worked" WORKFLOW learning.
    if (task.verdict === TaskVerdict.TASK_PASSED && task.verified) {
      const taskType = task.taskId.split('_')[0];
      const preferredConfig = task.agentRole && task.primaryTool ? `${task.agentRole}/${task.primaryTool}` : 'current';
      candidates.push({
        key: configKey(task),
        kind: LearningKind.WORKFLOW,
        source: LearningSource.OUTCOME,
        value: {
          taskType,
          verdict: task.verdict,
          preferredConfig,
          agentRole: task.agentRole,
          primaryTool: task.primaryTool,
          verificationConfidence: task.verificationConfidence,
        },
        summary:
          task.agentRole && task.primaryTool
            ? `Config '${task.agentRole}/${task.primaryTool}' for task type '${taskType}' passed verification.`
            : `Config for task type '${taskType}' passed verification.`,
        tags: taskTags(task),
        taskVerdict: task.verdict,
        contingency: singlePresent(true),
        confidence: task.verificationConfidence ?? 1,
      });
      continue;
    }

    // FAILED with a diagnosis → a POLICY learning (repair preference).
    if (task.verdict === TaskVerdict.TASK_FAILED) {
      const diag = diagnoses?.[task.taskId];
      const dimension = diag?.evidence?.isolatedDimension as string | undefined;
      const failureClass = diag?.failureClass ?? task.failureClass ?? FailureClass.UNKNOWN;
      candidates.push({
        key: configKey(task),
        kind: LearningKind.POLICY,
        source: diag ? LearningSource.FAILURE_DIAGNOSIS : LearningSource.OUTCOME,
        value: {
          taskType: task.taskId.split('_')[0],
          failureClass,
          isolatedDimension: dimension,
          recommendedRepairLevel: diag?.recommendedRepairLevel,
          recommendedChanges: diag?.recommendedChanges,
          rootCause: diag?.rootCause,
        },
        summary: diag
          ? `Task type '${task.taskId.split('_')[0]}' failed with ${failureClass}${dimension ? ` (counterfactual isolated: ${dimension})` : ''}; recall repair preference.`
          : `Task type '${task.taskId.split('_')[0]}' failed (${failureClass}).`,
        tags: taskTags(task),
        failureClass,
        taskVerdict: task.verdict,
        contingency: singlePresent(false),
        confidence: diag?.confidence ?? 0.5,
      });
    }

    // BLOCKED task → a KNOWLEDGE learning that this task shape was blocked.
    if (task.verdict === TaskVerdict.TASK_BLOCKED) {
      candidates.push({
        key: `block:${task.taskId.split('_')[0]}`,
        kind: LearningKind.KNOWLEDGE,
        source: LearningSource.OUTCOME,
        value: { taskType: task.taskId.split('_')[0], error: task.error },
        summary: `Task type '${task.taskId.split('_')[0]}' was blocked by a guardrail.`,
        tags: taskTags(task),
        taskVerdict: task.verdict,
        contingency: singlePresent(false),
        confidence: 1,
      });
    }
  }

  // Run-level BLOCKED → a KNOWLEDGE learning the planner can avoid.
  if (outcome.verdict === OutcomeVerdict.OUTCOME_BLOCKED) {
    candidates.push({
      key: `goal-block:${outcome.workflowId.split('_')[0]}`,
      kind: LearningKind.KNOWLEDGE,
      source: LearningSource.OUTCOME,
      value: { workflowId: outcome.workflowId, summary: outcome.summary },
      summary: `Run blocked at the guardrail: ${outcome.summary}`,
      tags: ['goal-shape:blocked'],
      outcomeVerdict: outcome.verdict,
      contingency: singlePresent(false),
      confidence: 1,
    });
  }

  return candidates;
}