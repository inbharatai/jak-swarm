/**
 * citation-coverage.ts — HyperAgent accuracy pass: citation-coverage gate.
 *
 * Company Brain builds cited, permission-filtered claims and drops source-less
 * entities — but once a context packet is handed to a worker, NOTHING checks
 * the worker's output prose against the claims it was served. A worker can
 * hallucinate confidently and the acceptance checker never sees it, because
 * grounding is a quality dimension with no metric.
 *
 * This module closes the loop deterministically, extending two existing
 * pieces of machinery rather than adding a new engine:
 *
 *   1. The verifier's citation-density heuristic (verifier.agent.ts) checks
 *      that claims carry SOME citation marker. This module checks the stronger
 *      property: that the claims' content is actually SUPPORTED by the Brain
 *      claims served in the task's context — citation form is necessary but
 *      not sufficient (a worker can cite `[evidence:x]` and still invent the
 *      fact).
 *
 *   2. The acceptance checker's METRIC_THRESHOLD binding (acceptance-checker.ts)
 *      already measures any named harvested metric. This module emits
 *      `citation_coverage` (0..1) into `RunEvidence.metrics`, so a spec can
 *      write a wired criterion:
 *        { kind: METRIC_THRESHOLD, metric: { name: 'citation_coverage', operator: 'gte', threshold: 0.8 } }
 *      — no new acceptance machinery needed.
 *
 * The matching is deliberately deterministic + transparent (token-overlap
 * against served claim text), NOT an embedding model: the score must be
 * reproducible from the run's data alone, auditable claim-by-claim, and free
 * of a second model's opinion about "support". A lexical matcher has false
 * negatives (paraphrase) — that is the honest trade-off, and the uncovered
 * claims are surfaced verbatim so a human/judge can review them.
 *
 * Pure + deterministic — no I/O, no LLM, no Date.now. Fully unit-testable.
 */

/** A claim the Brain served into a task's context packet. */
export interface ServedClaim {
  /** Stable claim id (provenance). */
  id: string;
  /** The claim text as served. */
  text: string;
  /** Optional entity/artifact provenance (carried for reporting). */
  entityId?: string;
  artifactId?: string;
}

/** One atomic claim extracted from the worker's output. */
export interface OutputClaim {
  /** The claim sentence verbatim. */
  sentence: string;
  /** True when this sentence carries a citation marker (form check). */
  hasCitationMarker: boolean;
  /** Id of the served claim this output claim is supported by, when matched. */
  supportedByClaimId?: string;
  /** Token-overlap score of the best served-claim match (0..1). */
  supportScore: number;
}

export interface CitationCoverageReport {
  /** Output sentences that make a factual claim. */
  claims: OutputClaim[];
  /** Claims supported by at least one served claim above the match threshold. */
  supportedCount: number;
  /** Claims carrying a citation marker (form-level grounding). */
  citedCount: number;
  /** supportedCount / claims.length (1 when there are no claims). */
  coverage: number;
  /** citedCount / claims.length (1 when there are no claims). */
  citationFormDensity: number;
  /** Verbatim sentences of unsupported claims — for review + diagnosis. */
  unsupportedClaims: string[];
  /**
   * False when the Brain served NO claims for this task: coverage cannot be
   * meaningfully measured against an empty evidence set, and the caller must
   * keep any acceptance criterion unwired (UNVERIFIABLE) rather than read a
   * vacuous 1.0 as "fully grounded" — the same never-fake posture as the
   * acceptance checker's wired=false seam.
   */
  measurable: boolean;
}

// ─── Text machinery (deterministic, dependency-free) ───────────────────────

const CITATION_MARKER = /\[(?:evidence|source|cite|ref|citation):[^\]]{1,200}\]/i;

/** Factual-claim verb signal (kept in sync with verifier.agent.ts). */
const CLAIM_VERB = /\b(is|are|has|have|will|equals|contains|was|were|showed|shows|found|finds|states|reports|measures|measured|increased|decreased|grew|fell|achieves|achieved|enables|caused|launched|released|raised|acquired|acquires|hired|fired|owns|costs|priced)\b/i;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'by', 'at', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'it', 'its', 'this', 'that', 'these', 'those', 'we', 'our', 'you', 'your',
  'they', 'their', 'he', 'she', 'his', 'her', 'not', 'no', 'than', 'then',
  'so', 'such', 'into', 'over', 'under', 'per', 'via', 'has', 'have', 'had',
]);

/** Split output into sentences (abbreviation-protected, like the verifier's).
 *  Sentences may also split before an opening bracket/paren/quote (citation
 *  markers often start their own segment) and on newlines. */
export function splitSentences(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const protectedText = text
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|Co|Corp|Sr|Jr|St|vs|etc|e\.g|i\.e)\.\s/g, '$1<DOT> ')
    .replace(/(\d)\.(\d)/g, '$1<DOT>$2');
  return protectedText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/<DOT>/g, '.').trim())
    .filter((s) => s.length > 0);
}

/** Significant tokens: lowercase alphanumerics, stopwords removed, numbers kept. */
function significantTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(CITATION_MARKER, ' ')
    .match(/[a-z0-9][a-z0-9._%$-]*/g) ?? [];
  return new Set(tokens.filter((t) => t.length > 1 && !STOPWORDS.has(t)));
}

/**
 * Containment score: |output ∩ served| / |output|. A claim is "supported" when
 * most of its significant content appears in the served claim — numbers and
 * named entities in particular must come from evidence. Served-side dilution
 * (a long claim containing the fact plus more) does not penalise support.
 */
function containment(outputTokens: Set<string>, servedTokens: Set<string>): number {
  if (outputTokens.size === 0) return 0;
  let hit = 0;
  for (const t of outputTokens) if (servedTokens.has(t)) hit++;
  return hit / outputTokens.size;
}

/** The support threshold: ≥60% of an output claim's significant tokens must be
 *  evidenced by a single served claim. Tunable; deliberately strict enough to
 *  catch invented facts (which introduce unevidenced numbers/entities). */
export const SUPPORT_THRESHOLD = 0.6;

/**
 * Measure citation coverage of a worker's output against the Brain claims it
 * was served. Pure.
 *
 * - claims with zero factual content are ignored (nothing to ground);
 * - when servedClaims is empty, `measurable=false` (the caller keeps criteria
 *   unwired) and coverage is 1 vacuously — never read it as proven grounded;
 * - unsupported claims are returned verbatim for the failure diagnostician's
 *   GROUNDING_FAILURE/HALLUCINATION channel and the user-facing review.
 */
export function measureCitationCoverage(input: {
  outputText: string;
  servedClaims: ServedClaim[];
  supportThreshold?: number;
}): CitationCoverageReport {
  const threshold = input.supportThreshold ?? SUPPORT_THRESHOLD;
  const sentences = splitSentences(input.outputText);
  const claimSentences = sentences.filter((s) => CLAIM_VERB.test(s) && !s.trimEnd().endsWith('?'));

  const servedIndex = input.servedClaims.map((c) => ({
    claim: c,
    tokens: significantTokens(c.text),
  }));

  const claims: OutputClaim[] = claimSentences.map((sentence) => {
    const tokens = significantTokens(sentence);
    let best: { id: string; score: number } | undefined;
    for (const { claim, tokens: servedTokens } of servedIndex) {
      const score = containment(tokens, servedTokens);
      if (!best || score > best.score) best = { id: claim.id, score };
    }
    const supported = best !== undefined && best.score >= threshold;
    // Citation form: the marker may live in the claim sentence itself, or in
    // an immediately-adjacent trailing marker sentence ("... in Q2 2026.
    // [evidence:x]") — a standalone citation sentence grounds the claim it
    // follows, matching how a writer actually appends a reference.
    const sentenceIdx = sentences.indexOf(sentence);
    const next = sentences[sentenceIdx + 1];
    const hasMarker =
      CITATION_MARKER.test(sentence) ||
      (next !== undefined && CITATION_MARKER.test(next) && !CLAIM_VERB.test(next));
    return {
      sentence,
      hasCitationMarker: hasMarker,
      ...(supported ? { supportedByClaimId: best!.id } : {}),
      supportScore: best?.score ?? 0,
    };
  });

  const supportedCount = claims.filter((c) => c.supportedByClaimId !== undefined).length;
  const citedCount = claims.filter((c) => c.hasCitationMarker).length;
  const measurable = input.servedClaims.length > 0;

  return {
    claims,
    supportedCount,
    citedCount,
    coverage: claims.length === 0 ? 1 : supportedCount / claims.length,
    citationFormDensity: claims.length === 0 ? 1 : citedCount / claims.length,
    unsupportedClaims: claims.filter((c) => c.supportedByClaimId === undefined).map((c) => c.sentence),
    measurable,
  };
}

/** The metric names this module contributes to RunEvidence.metrics. */
export const CITATION_COVERAGE_METRIC = 'citation_coverage';
export const CITATION_FORM_DENSITY_METRIC = 'citation_form_density';

/**
 * Fold a coverage report into harvested run metrics. Returns the entries to
 * merge into `RunEvidence.metrics` — or an empty object when the report is
 * not measurable (no served claims), so the acceptance checker's
 * METRIC_THRESHOLD binding on `citation_coverage` correctly reports
 * "metric not reported by run" (wired, unsatisfied... unless the caller
 * chooses to treat unmeasurable as unwired — either way, never faked).
 */
export function coverageMetrics(report: CitationCoverageReport): Record<string, number> {
  if (!report.measurable) return {};
  return {
    [CITATION_COVERAGE_METRIC]: report.coverage,
    [CITATION_FORM_DENSITY_METRIC]: report.citationFormDensity,
  };
}
