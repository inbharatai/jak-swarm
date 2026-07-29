/**
 * rubric/floor-rules.ts — deterministic output-quality floor (accuracy pass).
 *
 * The verification package already scores RISK (rule-engine.ts: phishing,
 * BEC, metadata anomalies) — but nothing scores QUALITY. Two outputs of
 * wildly different quality receive the same verification pass, and the
 * verifier's LLM sees only ad-hoc heuristics, not a structured quality floor.
 *
 * This module is the deterministic half of the rubric layer: zero-cost,
 * reproducible structural checks over a task's output. It answers "did the
 * output actually do what the task asked, at a basic structural level?"
 * before any model judge is consulted — and its result is designed to CAP,
 * never raise, the composite verification confidence (an LLM judge may
 * lower confidence below the floor; it may never rescue a floor failure —
 * the same escalate-only posture jak-shield uses for its GPT analyst).
 *
 * Floor dimensions (each 0..1, deterministic):
 *   - addressCoverage:  does the output engage every sub-ask of the task?
 *   - completeness:     does the output address the task description's content terms?
 *   - citationPresence: when evidence was served, are citations present?
 *   - formatConformity: length within expected bounds; no placeholder/template text.
 *
 * Pure + deterministic — no I/O, no LLM, no Date.now. Fully unit-testable.
 */

export interface RubricTaskContext {
  /** The task's name + description (the instruction being followed). */
  taskName: string;
  taskDescription: string;
  /** True when the task ran with Brain evidence in context (citations expected). */
  evidenceServed?: boolean;
  /** Expected output format hint, when the task declares one. */
  expectedFormat?: 'text' | 'json' | 'markdown' | 'list';
  /** Soft length expectation: minimum meaningful words (default 30). */
  minWords?: number;
  /** Soft length expectation: maximum words before bloat (default 4000). */
  maxWords?: number;
}

export interface RubricDimension {
  name: 'addressCoverage' | 'completeness' | 'citationPresence' | 'formatConformity';
  score: number;
  /** Human-auditable explanation of the score. */
  note: string;
}

export interface RubricFloorResult {
  dimensions: RubricDimension[];
  /** Weighted composite floor score 0..1. */
  floorScore: number;
  /** Specific, actionable issues — folded into VerificationResult.issues. */
  issues: string[];
}

// ─── Text machinery (deterministic, dependency-free) ───────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'by', 'at', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'it', 'its', 'this', 'that', 'these', 'those', 'we', 'our', 'you', 'your',
  'they', 'their', 'not', 'no', 'than', 'then', 'so', 'such', 'do', 'does',
  'did', 'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must',
]);

/** Instruction verbs — the task's imperative frame, not its CONTENT. Excluded
 *  from task terms so completeness measures engagement with the subject
 *  matter, not whether the output parrots the instruction word itself. */
const INSTRUCTION_VERBS = new Set([
  'analyse', 'analyze', 'summarise', 'summarize', 'compare', 'recommend',
  'describe', 'explain', 'list', 'write', 'draft', 'create', 'generate',
  'produce', 'identify', 'review', 'assess', 'evaluate', 'outline', 'detail',
  'provide', 'give', 'show', 'find', 'research', 'investigate', 'report',
]);

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\b(?:lorem ipsum)\b/i,
  /\b(?:todo|fixme|tbd|xxx)\b[:\s]/i,
  /\[(?:insert|placeholder|your [^\]]{1,40})\]/i,
  /\b(?:as an ai (?:language )?model,? i (?:cannot|can't|am unable))\b/i,
  /\b(?:this is (?:a|an) (?:sample|example|dummy|mock))\b/i,
];

const CITATION_MARKER = /\[(?:evidence|source|cite|ref|citation):[^\]]{1,200}\]/i;

function contentTerms(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .match(/[a-z][a-z0-9._-]{2,}/g) ?? [];
  return new Set(
    tokens
      // Strip trailing punctuation stuck to the token ("tickets." → "tickets").
      .map((t) => t.replace(/[._-]+$/, ''))
      .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !INSTRUCTION_VERBS.has(t)),
  );
}

function words(text: string): string[] {
  return text.match(/\S+/g) ?? [];
}

/**
 * Split a task description into sub-asks. Conjunction- and punctuation-led
 * splitting ("summarise X and compare Y", "do A; then B; finally C"),
 * bullet lines, and imperative sentences. Each sub-ask should be a phrase
 * whose engagement can be checked in the output.
 */
export function subAsks(description: string): string[] {
  const lines = description
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 0);
  const parts = lines.flatMap((line) =>
    line
      .split(/[.;]|(?:\s+then\s+)|(?:\s+and also\s+)/i)
      .map((p) => p.trim())
      .filter((p) => p.length >= 12), // shorter fragments aren't checkable asks
  );
  // Cap at 8 sub-asks — beyond that the description is a brief, not a checklist.
  return parts.slice(0, 8);
}

// ─── Dimension scorers (pure) ───────────────────────────────────────────────

function scoreAddressCoverage(output: string, asks: string[], taskTerms: Set<string>): RubricDimension {
  if (asks.length <= 1) {
    // A single-ask task delegates to the completeness dimension.
    return { name: 'addressCoverage', score: 1, note: 'single-ask task (delegated to completeness)' };
  }
  const outputTerms = contentTerms(output);
  let engaged = 0;
  const missed: string[] = [];
  for (const ask of asks) {
    const askTerms = [...contentTerms(ask)].filter((t) => taskTerms.has(t) || t.length > 5);
    if (askTerms.length === 0) {
      engaged++; // an ask with no checkable terms engages vacuously
      continue;
    }
    const hits = askTerms.filter((t) => outputTerms.has(t)).length;
    if (hits / askTerms.length >= 0.4) engaged++;
    else missed.push(ask.slice(0, 80));
  }
  const score = engaged / asks.length;
  return {
    name: 'addressCoverage',
    score,
    note: missed.length === 0
      ? `all ${asks.length} sub-asks engaged`
      : `${missed.length}/${asks.length} sub-asks not engaged: ${missed.join(' | ')}`,
  };
}

function scoreCompleteness(output: string, taskTerms: Set<string>): RubricDimension {
  if (taskTerms.size === 0) {
    return { name: 'completeness', score: 1, note: 'no checkable task terms' };
  }
  const outputTerms = contentTerms(output);
  let hits = 0;
  const missing: string[] = [];
  for (const t of taskTerms) {
    if (outputTerms.has(t)) hits++;
    else if (t.length > 5) missing.push(t);
  }
  const score = hits / taskTerms.size;
  return {
    name: 'completeness',
    score,
    note: `${hits}/${taskTerms.size} task content terms addressed${missing.length > 0 ? ` (missing e.g.: ${missing.slice(0, 5).join(', ')})` : ''}`,
  };
}

function scoreCitationPresence(output: string, evidenceServed: boolean): RubricDimension {
  if (!evidenceServed) {
    return { name: 'citationPresence', score: 1, note: 'no evidence served — citations not required' };
  }
  const markers = output.match(new RegExp(CITATION_MARKER.source, 'gi')) ?? [];
  // ≥1 marker per ~600 words is reasonable grounding form for evidenced tasks.
  const expected = Math.max(1, Math.floor(words(output).length / 600));
  const score = Math.min(1, markers.length / expected);
  return {
    name: 'citationPresence',
    score,
    note: markers.length === 0
      ? 'evidence was served but no citation markers appear in the output'
      : `${markers.length} citation marker(s) present (expected ≥${expected})`,
  };
}

function scoreFormatConformity(output: string, ctx: RubricTaskContext): RubricDimension {
  const issues: string[] = [];
  const w = words(output).length;
  const minWords = ctx.minWords ?? 30;
  const maxWords = ctx.maxWords ?? 4000;
  if (w < minWords) issues.push(`output is ${w} words (below the ${minWords}-word floor for a substantive answer)`);
  if (w > maxWords) issues.push(`output is ${w} words (above the ${maxWords}-word bloat ceiling)`);
  const placeholders = PLACEHOLDER_PATTERNS.filter((p) => p.test(output));
  if (placeholders.length > 0) issues.push('placeholder/template/refusal text detected');
  if (ctx.expectedFormat === 'json') {
    try {
      JSON.parse(output);
    } catch {
      issues.push('expected JSON output but the output does not parse');
    }
  }
  // One structural strike per issue class; score floors at 0.
  const score = Math.max(0, 1 - issues.length * 0.34);
  return {
    name: 'formatConformity',
    score,
    note: issues.length === 0 ? 'format within bounds, no placeholder text' : issues.join('; '),
  };
}

// ─── The floor ──────────────────────────────────────────────────────────────

const WEIGHTS: Record<RubricDimension['name'], number> = {
  addressCoverage: 0.35,
  completeness: 0.3,
  citationPresence: 0.2,
  formatConformity: 0.15,
};

/**
 * Score an output against the deterministic quality floor. Pure.
 *
 * `floorScore` is the confidence CAP for the composite verification result:
 * an LLM judge may lower it, never raise it. Issues are specific and
 * user-actionable, folded into VerificationResult.issues so reviewers see
 * WHY quality scored low — not just a number.
 */
export function scoreRubricFloor(output: string, ctx: RubricTaskContext): RubricFloorResult {
  const taskText = `${ctx.taskName}. ${ctx.taskDescription}`;
  const taskTerms = contentTerms(taskText);
  const asks = subAsks(taskText);

  const dimensions: RubricDimension[] = [
    scoreAddressCoverage(output, asks, taskTerms),
    scoreCompleteness(output, taskTerms),
    scoreCitationPresence(output, ctx.evidenceServed === true),
    scoreFormatConformity(output, ctx),
  ];

  const floorScore = dimensions.reduce((acc, d) => acc + d.score * WEIGHTS[d.name], 0);
  const issues = dimensions
    .filter((d) => d.score < 0.6)
    .map((d) => `quality/${d.name}: ${d.note}`);

  return { dimensions, floorScore, issues };
}
