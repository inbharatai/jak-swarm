/**
 * Anti-hallucination utilities for detecting ungrounded claims,
 * fabricated statistics, fake citations, and overconfident statements.
 */

export interface GroundingCheckResult {
  grounded: boolean;
  /** 0.0 = completely ungrounded, 1.0 = fully grounded */
  score: number;
  ungroundedClaims: string[];
  warnings: string[];
}

// ─── Regex patterns ───────────────────────────────────────────────────────────

/** Matches specific statistics: percentages, dollar amounts, specific counts */
const STAT_PATTERNS = [
  // Percentages: "73%", "increased by 45.2%", "a 12% increase"
  /\b\d+(?:\.\d+)?%/g,
  // Dollar amounts: "$1.2 million", "$500", "$3.4B"
  /\$[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|trillion|[MBTKmbtk]))?/gi,
  // Specific large numbers: "1.2 million users", "500,000 people"
  /\b\d[\d,]*(?:\.\d+)?\s*(?:million|billion|trillion|thousand)\b/gi,
  // Specific counts with context: "47 countries", "123 companies"
  /\b\d{2,}\s+(?:countries|companies|users|customers|employees|people|organizations|studies|researchers|papers|reports|cases|incidents|patients|participants)\b/gi,
];

/** Matches citation-like patterns: author names with years, paper titles in quotes */
const CITATION_PATTERNS = [
  // Academic style: "Smith et al. (2023)", "Johnson & Lee, 2022"
  /\b[A-Z][a-z]+(?:\s+(?:et\s+al\.?|&|and)\s+[A-Z][a-z]+)*[,\s]+(?:\(?\d{4}\)?)/g,
  // Quoted paper/study titles
  /"[^"]{20,}"/g,
  // "According to a study by..." or "Research from..."
  /(?:according to|research (?:from|by)|a (?:study|report|paper|survey) (?:by|from|published in))\s+[A-Z][^,.]{5,}/gi,
  // Journal names: "published in Nature", "in the Journal of..."
  /(?:published in|in the)\s+(?:Nature|Science|The Lancet|JAMA|BMJ|Cell|PNAS|Journal of\s+\w+)/gi,
];

/** Matches overconfident language */
const OVERCONFIDENCE_PATTERNS = [
  /\b(?:definitely|certainly|undoubtedly|without(?:\s+a)?\s+doubt|absolutely|unquestionably|indisputably)\b/gi,
  /\b(?:always|never|every single|100%|guaranteed|proven fact)\b/gi,
  /\b(?:it is (?:a )?(?:well-known|established|proven|undeniable) fact)\b/gi,
  /\b(?:there is no (?:doubt|question|debate))\b/gi,
  /\b(?:everyone (?:knows|agrees)|all experts (?:agree|confirm))\b/gi,
];

/** Matches impossible/suspicious claims */
const IMPOSSIBLE_CLAIM_PATTERNS = [
  // Future events stated as fact (years beyond current)
  /\b(?:in|by)\s+20(?:2[7-9]|[3-9]\d)\b[^?]*/gi,
  // "Will definitely" type future claims
  /\bwill\s+(?:definitely|certainly|undoubtedly|always)\b/gi,
  // Self-contradictory hedge + certainty
  /\b(?:probably|maybe|perhaps|might)\b.{0,30}\b(?:definitely|certainly|always)\b/gi,
  // Claims about personal experience (LLM has none)
  /\b(?:I (?:personally|have) (?:seen|experienced|witnessed|tested|used|tried))\b/gi,
  // "As of [future date]"
  /\bas of\s+(?:20(?:2[7-9]|[3-9]\d)|next year)/gi,
];

// ─── Utility helpers ──────────────────────────────────────────────────────────

/**
 * Normalize text for comparison: lowercase, collapse whitespace, strip punctuation.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract significant n-grams (3-word phrases) from text for overlap detection.
 */
function extractNgrams(text: string, n: number): Set<string> {
  const words = normalize(text).split(' ');
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

/**
 * Calculate overlap ratio between two sets.
 */
function overlapRatio(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0) return 0;
  let overlap = 0;
  for (const item of setA) {
    if (setB.has(item)) overlap++;
  }
  return overlap / setA.size;
}

/**
 * Extract all sentences from text.
 */
function extractSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

/**
 * Check if a claim/sentence has support in the provided source material.
 */
function isSupportedBySources(claim: string, sources: string[]): boolean {
  const claimNgrams = extractNgrams(claim, 3);
  if (claimNgrams.size === 0) return true; // trivially short claims pass

  const allSourceNgrams = new Set<string>();
  for (const source of sources) {
    for (const ngram of extractNgrams(source, 3)) {
      allSourceNgrams.add(ngram);
    }
  }

  return overlapRatio(claimNgrams, allSourceNgrams) > 0.15;
}

// ─── Exported detection functions ─────────────────────────────────────────────

/**
 * Check output text against tool results for factual grounding.
 * Returns a grounding score and a list of ungrounded claims.
 */
export function groundingCheck(output: string, toolResults: string[]): GroundingCheckResult {
  const sentences = extractSentences(output);
  const ungroundedClaims: string[] = [];
  const warnings: string[] = [];

  if (sentences.length === 0) {
    return { grounded: true, score: 1.0, ungroundedClaims: [], warnings: [] };
  }

  // If there are no tool results but the output contains specific factual claims,
  // that is inherently suspicious
  if (toolResults.length === 0) {
    const stats = detectInventedStatistics(output);
    if (stats.length > 0) {
      warnings.push('Output contains specific statistics with no tool results to ground them');
    }
  }

  let groundedCount = 0;

  for (const sentence of sentences) {
    // Skip meta-commentary, questions, hedged statements
    if (/^(?:I |Let me |Here |Note |Please )/i.test(sentence)) {
      groundedCount++;
      continue;
    }
    if (/\?$/.test(sentence.trim())) {
      groundedCount++;
      continue;
    }
    if (/\b(?:might|could|may|possibly|perhaps|I think|I believe)\b/i.test(sentence)) {
      groundedCount++;
      continue;
    }

    // Check if the factual sentence is supported by sources
    if (toolResults.length > 0 && !isSupportedBySources(sentence, toolResults)) {
      // Only flag sentences that contain specific claims (numbers, names, etc.)
      const hasSpecificClaim =
        /\b\d+\b/.test(sentence) ||
        /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/.test(sentence);

      if (hasSpecificClaim) {
        ungroundedClaims.push(sentence);
      } else {
        groundedCount++;
      }
    } else {
      groundedCount++;
    }
  }

  const score = sentences.length > 0 ? groundedCount / sentences.length : 1.0;

  return {
    grounded: score >= 0.7 && ungroundedClaims.length === 0,
    score: Math.round(score * 100) / 100,
    ungroundedClaims,
    warnings,
  };
}

/**
 * Detect invented statistics in text: percentages, dollar amounts, and
 * specific counts that have no apparent source.
 */
export function detectInventedStatistics(text: string): string[] {
  const found: string[] = [];

  for (const pattern of STAT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      // Get surrounding context (the sentence containing the stat)
      const start = Math.max(0, text.lastIndexOf('.', match.index) + 1);
      const end = text.indexOf('.', match.index + match[0].length);
      const context = text
        .slice(start, end === -1 ? undefined : end + 1)
        .trim();

      if (context.length > 0 && !found.includes(context)) {
        found.push(context);
      }
    }
  }

  return found;
}

/**
 * Detect fabricated citations: academic-style references, quoted paper titles,
 * and attribution claims not found in the provided search results.
 */
export function detectFabricatedSources(text: string, searchResults: string[]): string[] {
  const fabricated: string[] = [];
  const normalizedResults = searchResults.map((r) => normalize(r));

  for (const pattern of CITATION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const citation = match[0].trim();
      const normalizedCitation = normalize(citation);

      // Check if citation appears in any search result
      const isSupported = normalizedResults.some(
        (result) =>
          result.includes(normalizedCitation) ||
          normalizedCitation.split(' ').filter((w) => w.length > 3).every((word) => result.includes(word)),
      );

      if (!isSupported && !fabricated.includes(citation)) {
        fabricated.push(citation);
      }
    }
  }

  return fabricated;
}

/**
 * Detect overconfident statements: absolute certainty language used without
 * tool-backed evidence (fewer than expected tool calls).
 */
export function detectOverconfidence(text: string, toolCallCount: number): string[] {
  const issues: string[] = [];

  // If the model made tool calls, it has some evidence -- allow moderate confidence
  const confidenceThreshold = toolCallCount > 0 ? 3 : 1;
  let matchCount = 0;

  for (const pattern of OVERCONFIDENCE_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matchCount++;
      if (matchCount >= confidenceThreshold) {
        // Get sentence context
        const start = Math.max(0, text.lastIndexOf('.', match.index) + 1);
        const end = text.indexOf('.', match.index + match[0].length);
        const context = text
          .slice(start, end === -1 ? undefined : end + 1)
          .trim();

        if (context.length > 0 && !issues.includes(context)) {
          issues.push(context);
        }
      }
    }
  }

  if (matchCount > 0 && toolCallCount === 0) {
    issues.unshift(
      `Found ${matchCount} overconfident statement(s) with no tool calls to back them up`,
    );
  }

  return issues;
}

/**
 * Detect impossible claims: future events presented as fact, self-contradictions,
 * and claims of personal experience from an LLM.
 */
export function detectImpossibleClaims(text: string): string[] {
  const claims: string[] = [];

  for (const pattern of IMPOSSIBLE_CLAIM_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const start = Math.max(0, text.lastIndexOf('.', match.index) + 1);
      const end = text.indexOf('.', match.index + match[0].length);
      const context = text
        .slice(start, end === -1 ? undefined : end + 1)
        .trim();

      if (context.length > 0 && !claims.includes(context)) {
        claims.push(context);
      }
    }
  }

  return claims;
}

/**
 * Master hallucination check that runs all detection functions and returns
 * a combined result with severity scoring.
 */
export function fullHallucinationCheck(
  output: string,
  toolResults: string[],
  toolCallCount: number,
): {
  passed: boolean;
  score: number;
  issues: string[];
  severity: 'none' | 'minor' | 'major' | 'critical';
} {
  const allIssues: string[] = [];

  // 1. Grounding check
  const grounding = groundingCheck(output, toolResults);
  if (!grounding.grounded) {
    for (const claim of grounding.ungroundedClaims) {
      allIssues.push(`[ungrounded] ${claim}`);
    }
  }
  for (const warning of grounding.warnings) {
    allIssues.push(`[warning] ${warning}`);
  }

  // 2. Invented statistics
  const stats = detectInventedStatistics(output);
  // Only flag stats if there are no tool results containing them
  const unsupportedStats = stats.filter(
    (stat) => !toolResults.some((r) => normalize(r).includes(normalize(stat).slice(0, 20))),
  );
  for (const stat of unsupportedStats) {
    allIssues.push(`[invented-stat] ${stat}`);
  }

  // 3. Fabricated sources
  const fabricated = detectFabricatedSources(output, toolResults);
  for (const source of fabricated) {
    allIssues.push(`[fabricated-source] ${source}`);
  }

  // 4. Overconfidence
  const overconfident = detectOverconfidence(output, toolCallCount);
  for (const issue of overconfident) {
    allIssues.push(`[overconfident] ${issue}`);
  }

  // 5. Impossible claims
  const impossible = detectImpossibleClaims(output);
  for (const claim of impossible) {
    allIssues.push(`[impossible] ${claim}`);
  }

  // Calculate composite score
  // Start at grounding score, then penalize for each issue found
  const issuePenalty = Math.min(allIssues.length * 0.1, 0.5);
  const compositeScore = Math.max(0, Math.round((grounding.score - issuePenalty) * 100) / 100);

  // Determine severity
  let severity: 'none' | 'minor' | 'major' | 'critical';
  if (allIssues.length === 0) {
    severity = 'none';
  } else if (allIssues.length <= 2 && fabricated.length === 0 && impossible.length === 0) {
    severity = 'minor';
  } else if (fabricated.length > 0 || impossible.length > 0 || allIssues.length > 4) {
    severity = 'critical';
  } else {
    severity = 'major';
  }

  return {
    passed: severity === 'none' || severity === 'minor',
    score: compositeScore,
    issues: allIssues,
    severity,
  };
}
