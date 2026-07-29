/**
 * criteria-compiler.ts — HyperAgent accuracy pass: structured-criteria compiler.
 *
 * The spec generator (and hand-authored specs) express acceptance criteria as
 * plain prose strings. `measureAcceptanceSeam` (outcome-evaluator.ts) honestly
 * marks every string criterion `wired=false` — so a spec full of prose criteria
 * can never reach MET, only UNVERIFIABLE. That is the honest behaviour, but it
 * means the closed loop stops PROVING anything for the most common spec shape.
 *
 * This compiler is the deterministic bridge: it converts resolvable prose
 * criteria into STRUCTURED `AcceptanceCriterion` objects bound to the spec's
 * own `agentTaskPlan` — and refuses to bind anything it cannot resolve against
 * the plan. The invariant is the same as every other HyperAgent seam:
 *
 *   NEVER invent a binding. An unresolvable prose criterion stays CUSTOM /
 *   wired=false and the compiler reports exactly WHY it could not bind.
 *
 * Deterministic + pure — no I/O, no LLM, no Date.now. The optional LLM
 * proposal step (a model suggests candidate bindings from prose) lives in the
 * caller; this module is the deterministic VALIDATOR + pattern binder that
 * disposes of those proposals and of direct pattern matches. LLM proposes,
 * deterministic code disposes — same posture as failure-diagnostician.ts.
 */
import {
  AcceptanceCriterionKind,
  type AcceptanceCriterion,
  type MetricOperator,
  type SpecTaskPlan,
} from '@jak-swarm/shared';
import { FailureClass } from '@jak-swarm/shared';

/** How a compiled criterion was bound — carried for audit + review surfaces. */
export type CriterionBindingSource =
  /** Matched a deterministic prose pattern (no LLM involved). */
  | 'pattern'
  /** Proposed by an LLM and accepted after deterministic validation. */
  | 'llm-proposal'
  /** Already structured in the source spec — passed through untouched. */
  | 'passthrough';

export interface CompiledCriterion {
  criterion: AcceptanceCriterion;
  source: CriterionBindingSource;
  /** Human-auditable explanation of how the binding was derived. */
  bindingNote: string;
}

export interface UnboundCriterion {
  /** The original prose text that could not be bound. */
  text: string;
  /** Why no deterministic binding was possible. */
  reason: string;
}

export interface CompileCriteriaResult {
  compiled: CompiledCriterion[];
  unbound: UnboundCriterion[];
  /** compiled.length / (compiled.length + unbound.length); 1 when no prose. */
  coverage: number;
}

// ─── Failure-class vocabulary for NO_FAILURE_CLASS binding ─────────────────

const FAILURE_CLASS_TERMS: Array<{ term: RegExp; failureClass: FailureClass }> = [
  { term: /\b(?:no|without any)\s+(?:prompt[- ]?injection)/i, failureClass: FailureClass.PROMPT_INJECTION },
  { term: /\b(?:no|without any)\s+(?:permission|access)\s+(?:denied|failures?)/i, failureClass: FailureClass.PERMISSION_DENIED },
  { term: /\b(?:no|without any)\s+(?:policy|guardrail)\s+(?:blocks?|violations?)/i, failureClass: FailureClass.POLICY_BLOCK },
  { term: /\b(?:no|without any)\s+(?:timeout|timeouts?)/i, failureClass: FailureClass.TIMEOUT },
  { term: /\b(?:no|without any)\s+(?:rate[- ]?limits?)/i, failureClass: FailureClass.RATE_LIMIT },
  { term: /\b(?:no|without any)\s+(?:provider|api|model)\s+(?:errors?|failures?|outages?)/i, failureClass: FailureClass.TRANSIENT_PROVIDER },
  { term: /\b(?:no|without any)\s+(?:schema|malformed|invalid)\s+(?:outputs?|responses?|errors?)/i, failureClass: FailureClass.OUTPUT_SCHEMA },
  { term: /\b(?:no|without any)\s+(?:hallucinations?|fabricated|made[- ]up)\s/i, failureClass: FailureClass.HALLUCINATION },
  { term: /\b(?:no|without any)\s+(?:grounding)\s+(?:failures?|errors?)/i, failureClass: FailureClass.GROUNDING_FAILURE },
];

const FAILURE_CLASS_SET = new Set<string>(Object.values(FailureClass));

// ─── Metric vocabulary for METRIC_THRESHOLD binding ─────────────────────────
//
// The metrics the runtime actually harvests into RunEvidence.metrics (cost,
// duration) plus the accuracy metrics this pass introduces (citation_coverage,
// quality_score, task_pass_rate). A METRIC_THRESHOLD criterion may only
// reference a name in this set — a threshold on a metric nothing reports can
// never be measured, so binding it would be a silent UNMET-by-omission. Both
// the pattern path and the LLM-proposal path are held to this vocabulary
// (validateProposal rejects unknown names with an explicit reason).

const KNOWN_METRICS: ReadonlySet<string> = new Set([
  'accumulated_cost_usd',
  'total_cost_usd',
  'citation_coverage',
  'quality_score',
  'task_pass_rate',
  'duration_ms',
]);

interface MetricPattern {
  regex: RegExp;
  name: string;
  operator: MetricOperator;
  /** Extracts the threshold from the regex match; unit-aware (dollars, %). */
  threshold: (m: RegExpMatchArray) => number;
}

const METRIC_PATTERNS: MetricPattern[] = [
  {
    regex: /\b(?:cost|spend|budget)\b(?:(?!\bcost|spend|budget\b).){0,40}?\b(?:under|below|less than|at most|not exceed(?:ing)?|<=?)\s*\$?\s*(\d+(?:\.\d+)?)/i,
    name: 'accumulated_cost_usd',
    operator: 'lte',
    threshold: (m) => Number(m[1]),
  },
  {
    // "under/below $X" with the unit BEFORE the metric word ("under $2 cost").
    regex: /\b(?:under|below|less than|at most|<=?)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:in\s+)?(?:total\s+)?(?:cost|spend|budget)\b/i,
    name: 'accumulated_cost_usd',
    operator: 'lte',
    threshold: (m) => Number(m[1]),
  },
  {
    regex: /\b(?:citation|evidence|grounding)\s+(?:coverage|density)\b(?:(?!\bcoverage|density\b).){0,30}?\b(?:at least|>=?|minimum(?: of)?|no less than)\s*(\d+(?:\.\d+)?)\s*%/i,
    name: 'citation_coverage',
    operator: 'gte',
    threshold: (m) => Number(m[1]) / 100,
  },
  {
    regex: /\b(?:citation|evidence|grounding)\s+(?:coverage|density)\b(?:(?!\bcoverage|density\b).){0,30}?\b(?:at least|>=?|minimum(?: of)?|no less than)\s*(0?\.\d+|1(?:\.0+)?)\b/i,
    name: 'citation_coverage',
    operator: 'gte',
    threshold: (m) => Number(m[1]),
  },
  {
    regex: /\b(?:quality|rubric)\s+score\b(?:(?!\bscore\b).){0,30}?\b(?:at least|>=?|minimum(?: of)?|no less than)\s*(\d+(?:\.\d+)?)\s*%/i,
    name: 'quality_score',
    operator: 'gte',
    threshold: (m) => Number(m[1]) / 100,
  },
  {
    regex: /\b(?:quality|rubric)\s+score\b(?:(?!\bscore\b).){0,30}?\b(?:at least|>=?|minimum(?: of)?|no less than)\s*(0?\.\d+|1(?:\.0+)?)\b/i,
    name: 'quality_score',
    operator: 'gte',
    threshold: (m) => Number(m[1]),
  },
  {
    regex: /\b(?:all|every)\s+tasks?\s+(?:must\s+)?pass/i,
    name: 'task_pass_rate',
    operator: 'eq',
    threshold: () => 1,
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function slugify(text: string, max = 48): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'criterion';
}

/** Normalise for matching: case-fold, collapse whitespace, strip punctuation. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9%$.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a task reference in prose to a plan task id. Accepts (in priority
 * order): an exact task id, an exact (case-insensitive) task name, then a
 * unique substring of a task name. Returns undefined when the reference is
 * absent or ambiguous — ambiguity must NEVER bind (a wrong binding measures
 * the wrong task, which is worse than no binding).
 */
export function resolveTaskId(reference: string, plan: SpecTaskPlan): string | undefined {
  const ref = normalise(reference);
  if (!ref) return undefined;
  const tasks = plan.tasks;
  const exactId = tasks.find((t) => t.id === reference.trim());
  if (exactId) return exactId.id;
  const exactName = tasks.filter((t) => normalise(t.name) === ref);
  if (exactName.length === 1) return exactName[0]!.id;
  const substring = tasks.filter((t) => {
    const name = normalise(t.name);
    return name.includes(ref) || ref.includes(name);
  });
  if (substring.length === 1) return substring[0]!.id;
  return undefined;
}

/** Candidate structured binding — from a pattern match or an LLM proposal. */
export interface CriterionProposal {
  kind: AcceptanceCriterionKind;
  taskId?: string;
  artifactId?: string;
  metric?: { name: string; operator: MetricOperator; threshold: number };
  failureClass?: FailureClass;
}

/**
 * Deterministically validate a proposed binding against the spec's plan.
 * Returns the validated AcceptanceCriterion fields, or a rejection reason.
 * Validation is plan-relative: task ids must exist, failure classes must be
 * real, metric operators/thresholds must be well-formed, artifact ids must be
 * non-empty. The LLM-proposal and pattern paths BOTH go through this — no
 * proposal reaches the compiled set unvalidated.
 */
export function validateProposal(
  proposal: CriterionProposal,
  plan: SpecTaskPlan,
): { ok: true } | { ok: false; reason: string } {
  switch (proposal.kind) {
    case AcceptanceCriterionKind.TASK_COMPLETED:
    case AcceptanceCriterionKind.TASK_VERIFIED: {
      if (!proposal.taskId) return { ok: false, reason: 'missing taskId' };
      const resolved = resolveTaskId(proposal.taskId, plan);
      if (!resolved) return { ok: false, reason: `task reference '${proposal.taskId}' does not resolve to a unique plan task` };
      proposal.taskId = resolved;
      return { ok: true };
    }
    case AcceptanceCriterionKind.ARTIFACT_PRESENT: {
      if (!proposal.artifactId || proposal.artifactId.trim().length === 0) {
        return { ok: false, reason: 'missing artifactId' };
      }
      return { ok: true };
    }
    case AcceptanceCriterionKind.METRIC_THRESHOLD: {
      const m = proposal.metric;
      if (!m) return { ok: false, reason: 'missing metric config' };
      if (!/^[a-z][a-z0-9_]{1,63}$/.test(m.name)) return { ok: false, reason: `metric name '${m.name}' is not a valid harvested-metric identifier` };
      if (!KNOWN_METRICS.has(m.name)) return { ok: false, reason: `metric '${m.name}' is not in the harvested-metric vocabulary (nothing reports it, so it could never be measured)` };
      if (!Number.isFinite(m.threshold)) return { ok: false, reason: 'metric threshold is not finite' };
      if (!['gte', 'lte', 'gt', 'lt', 'eq'].includes(m.operator)) return { ok: false, reason: `unknown metric operator '${m.operator}'` };
      return { ok: true };
    }
    case AcceptanceCriterionKind.NO_FAILURE_CLASS: {
      if (!proposal.failureClass || !FAILURE_CLASS_SET.has(proposal.failureClass)) {
        return { ok: false, reason: `unknown failure class '${proposal.failureClass}'` };
      }
      return { ok: true };
    }
    case AcceptanceCriterionKind.CUSTOM:
    default:
      return { ok: false, reason: 'CUSTOM criteria have no deterministic binding' };
  }
}

// ─── Pattern binder ─────────────────────────────────────────────────────────

/**
 * Try to bind one prose criterion deterministically. Returns a validated
 * proposal + note, or undefined when no pattern applies. Conservative by
 * design: a prose string that merely MENTIONS a task name without a
 * completion/verification intent is not bound — intent words gate the match.
 */
function bindByPattern(text: string, plan: SpecTaskPlan): { proposal: CriterionProposal; note: string } | undefined {
  const t = normalise(text);

  // NO_FAILURE_CLASS: "no prompt injection", "without any timeouts" ...
  // Tolerate modal verbs between "no" and the class noun ("no timeouts").
  for (const { term, failureClass } of FAILURE_CLASS_TERMS) {
    if (term.test(t)) {
      return {
        proposal: { kind: AcceptanceCriterionKind.NO_FAILURE_CLASS, failureClass },
        note: `matched no-failure pattern for ${failureClass}`,
      };
    }
  }

  // METRIC_THRESHOLD: known metric vocabulary.
  for (const mp of METRIC_PATTERNS) {
    const m = t.match(mp.regex);
    if (m) {
      return {
        proposal: {
          kind: AcceptanceCriterionKind.METRIC_THRESHOLD,
          metric: { name: mp.name, operator: mp.operator, threshold: mp.threshold(m) },
        },
        note: `matched metric pattern '${mp.name} ${mp.operator} ${mp.threshold(m)}'`,
      };
    }
  }

  // "run complete with zero failures" → every task passes (task_pass_rate = 1).
  if (/\b(?:zero|no)\s+failures?\b/i.test(t) || /\bwithout\s+(?:any\s+)?failures?\b/i.test(t)) {
    return {
      proposal: {
        kind: AcceptanceCriterionKind.METRIC_THRESHOLD,
        metric: { name: 'task_pass_rate', operator: 'eq', threshold: 1 },
      },
      note: 'matched zero-failures intent → task_pass_rate == 1',
    };
  }

  // TASK_VERIFIED: "task X is verified / passes verification / verified output".
  const verifiedIntent = /\b(?:verified|passes? verification|verification[- ]passed)\b/i.test(t);
  // TASK_COMPLETED: "task X completes / is done / finishes successfully".
  const completedIntent = /\b(?:completes?|completed|done|finishes?|succeeds?|successful|runs? to completion)\b/i.test(t);

  if (verifiedIntent || completedIntent) {
    // Find the task reference: quoted name, "task <ref>", or bare plan-name mention.
    const quoted = text.match(/["'“”]([^"'“”]{2,80})["'“”]/);
    const taskKw = t.match(/\btask\s+([a-z0-9][a-z0-9 _-]{1,60}?)(?:\s+(?:is|must|should|shall|to)\b|$)/);
    const reference = quoted?.[1] ?? taskKw?.[1] ?? undefined;
    if (reference) {
      const resolved = resolveTaskId(reference, plan);
      if (resolved) {
        return {
          proposal: {
            kind: verifiedIntent ? AcceptanceCriterionKind.TASK_VERIFIED : AcceptanceCriterionKind.TASK_COMPLETED,
            taskId: resolved,
          },
          note: `matched ${verifiedIntent ? 'verified' : 'completion'} intent + resolved task '${reference}' → ${resolved}`,
        };
      }
    }
    // No explicit reference: try every plan task name as a mention.
    const mentions = plan.tasks.filter((task) => normalise(task.name).length >= 4 && t.includes(normalise(task.name)));
    if (mentions.length === 1) {
      return {
        proposal: {
          kind: verifiedIntent ? AcceptanceCriterionKind.TASK_VERIFIED : AcceptanceCriterionKind.TASK_COMPLETED,
          taskId: mentions[0]!.id,
        },
        note: `matched ${verifiedIntent ? 'verified' : 'completion'} intent + unique task-name mention '${mentions[0]!.name}'`,
      };
    }
  }

  // ARTIFACT_PRESENT: "produces/generates the <artifact> artifact/report" with
  // an artifact id present in the prose in id form (kebab/snake). Only binds
  // when the id token is explicit — never invent an artifact id from a noun.
  const artifactMention = t.match(/\bartifact\s+["']?([a-z][a-z0-9_-]{2,63})["']?/i);
  if (artifactMention && /\b(?:produces?|generates?|creates?|outputs?|delivers?|presents?)\b/i.test(t)) {
    return {
      proposal: { kind: AcceptanceCriterionKind.ARTIFACT_PRESENT, artifactId: artifactMention[1] },
      note: `matched artifact-production intent with explicit artifact id '${artifactMention[1]}'`,
    };
  }

  return undefined;
}

// ─── The compiler ───────────────────────────────────────────────────────────

export interface CompileCriteriaInput {
  /** Prose (string) criteria from the spec. */
  proseCriteria: string[];
  /** The spec's task plan — bindings resolve against it. */
  plan: SpecTaskPlan;
  /**
   * Optional LLM-proposed bindings, one array per prose criterion (same
   * indexing). Each proposal is validated deterministically; invalid ones are
   * rejected with their reason recorded. Pattern binding is attempted FIRST —
   * an LLM proposal is only consulted when the deterministic binder finds
   * nothing, so a model can never override a binding the rules already made.
   */
  llmProposals?: Array<CriterionProposal[] | undefined>;
}

/**
 * Compile prose acceptance criteria into validated structured criteria.
 * Pure + deterministic (the LLM proposals arrive as data; this module decides).
 */
export function compileCriteria(input: CompileCriteriaInput): CompileCriteriaResult {
  const compiled: CompiledCriterion[] = [];
  const unbound: UnboundCriterion[] = [];

  input.proseCriteria.forEach((text, idx) => {
    const trimmed = text.trim();
    if (!trimmed) {
      unbound.push({ text, reason: 'empty criterion text' });
      return;
    }

    // 1. Deterministic pattern binding wins first.
    const pattern = bindByPattern(trimmed, input.plan);
    if (pattern) {
      const validation = validateProposal(pattern.proposal, input.plan);
      if (validation.ok) {
        compiled.push({
          criterion: {
            id: `compiled:${slugify(trimmed)}`,
            description: trimmed,
            ...pattern.proposal,
          },
          source: 'pattern',
          bindingNote: pattern.note,
        });
        return;
      }
      // A pattern match that fails validation is a compiler bug signal — but
      // still never bind it. Fall through to record unbound with the reason.
      unbound.push({ text: trimmed, reason: `pattern match failed validation: ${validation.reason}` });
      return;
    }

    // 2. LLM proposals — validated one by one; first valid proposal binds.
    const proposals = input.llmProposals?.[idx] ?? [];
    let bound = false;
    for (const proposal of proposals) {
      const validation = validateProposal(proposal, input.plan);
      if (validation.ok) {
        compiled.push({
          criterion: {
            id: `compiled:${slugify(trimmed)}`,
            description: trimmed,
            ...proposal,
          },
          source: 'llm-proposal',
          bindingNote: 'LLM-proposed binding accepted after deterministic validation',
        });
        bound = true;
        break;
      }
    }
    if (!bound) {
      unbound.push({
        text: trimmed,
        reason: proposals.length > 0
          ? 'no deterministic pattern matched and every LLM proposal failed validation'
          : 'no deterministic pattern matched and no LLM proposal supplied',
      });
    }
  });

  const total = compiled.length + unbound.length;
  return {
    compiled,
    unbound,
    coverage: total === 0 ? 1 : compiled.length / total,
  };
}

/**
 * Merge a spec's criteria into a single ordered list: structured criteria pass
 * through untouched; prose criteria run through the compiler; anything still
 * unbound is preserved as an explicit CUSTOM criterion (so the reviewer sees
 * it and the checker keeps it honestly unwired) — never dropped silently.
 */
export function compileSpecCriteria(
  criteria: Array<AcceptanceCriterion | string>,
  plan: SpecTaskPlan,
  llmProposals?: Array<CriterionProposal[] | undefined>,
): { criteria: AcceptanceCriterion[]; report: CompileCriteriaResult } {
  const structured = criteria.filter((c): c is AcceptanceCriterion => typeof c !== 'string');
  const prose = criteria.filter((c): c is string => typeof c === 'string');
  const report = compileCriteria({ proseCriteria: prose, plan, llmProposals });

  const merged: AcceptanceCriterion[] = [
    ...structured.map((c) => c),
    ...report.compiled.map((r) => r.criterion),
    ...report.unbound.map((u, i) => ({
      id: `custom:${slugify(u.text)}-${i}`,
      description: u.text,
      kind: AcceptanceCriterionKind.CUSTOM,
    })),
  ];

  return { criteria: merged, report };
}
