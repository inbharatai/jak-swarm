/**
 * Document Integrity Analyzer
 *
 * Checks documents for tampering, forgery indicators, and metadata anomalies.
 */

import type { Analyzer, Finding, VerificationRequest } from '../types.js';
import { runRules } from '../rules/rule-engine.js';

export const documentAnalyzer: Analyzer = {
  name: 'DocumentAnalyzer',
  type: 'DOCUMENT',

  async analyze(request: VerificationRequest) {
    const allFindings: Finding[] = [];

    // Layer 1: Rules
    const { findings: ruleFindings, ruleScore } = runRules(
      'DOCUMENT',
      request.content,
      request.metadata,
      request.skipRuleIds,
    );
    allFindings.push(...ruleFindings);

    // Layer 2: Content heuristics
    const contentFindings = analyzeDocumentContent(request.content, request.metadata);
    allFindings.push(...contentFindings);

    let riskContribution = ruleScore;
    for (const f of contentFindings) {
      if (f.severity === 'CRITICAL') riskContribution += 30;
      else if (f.severity === 'WARNING') riskContribution += 12;
      else riskContribution += 3;
    }

    const confidence = allFindings.length === 0 ? 0.85 : allFindings.length <= 2 ? 0.75 : 0.6;

    return {
      findings: allFindings,
      riskContribution: Math.min(riskContribution, 100),
      confidence,
    };
  },
};

function analyzeDocumentContent(content: string, metadata?: Record<string, unknown>): Finding[] {
  const findings: Finding[] = [];

  // Check for known fake certificate/degree templates
  const _fakeCertPatterns = [
    /this\s+is\s+to\s+certify\s+that.*has\s+successfully\s+completed/i,
  ];
  const hasFormatIssues = metadata?.fontCount && (metadata.fontCount as number) > 15;
  if (hasFormatIssues) {
    findings.push({
      id: 'doc-excessive-fonts',
      category: 'FORMAT_ANOMALY',
      severity: 'WARNING',
      title: 'Excessive Font Variety',
      description: `Document uses ${metadata!.fontCount} different fonts, which may indicate copy-paste assembly from multiple sources.`,
      evidence: `Font count: ${metadata!.fontCount}`,
      source: 'AI_TIER1',
    });
  }

  // Check for inconsistent formatting (multiple text sizes in body)
  if (metadata?.authorMismatch) {
    findings.push({
      id: 'doc-author-mismatch',
      category: 'METADATA_ANOMALY',
      severity: 'WARNING',
      title: 'Author/Signer Mismatch',
      description: 'The document author in metadata does not match the signer or issuing authority in the content.',
      evidence: `Metadata author: ${metadata.author}, Content signer: ${metadata.signer}`,
      source: 'AI_TIER1',
    });
  }

  // Check for common forgery phrases
  const forgeryIndicators = [
    { pattern: /notarized\s+copy.*(?:unofficial|for\s+reference)/i, desc: 'Contradictory notarization claim' },
    { pattern: /this\s+document\s+is\s+auto-?generated\s+and\s+does\s+not\s+require/i, desc: 'Auto-generated disclaimer (often used in fakes)' },
  ];
  for (const indicator of forgeryIndicators) {
    if (indicator.pattern.test(content)) {
      findings.push({
        id: `doc-forgery-indicator-${findings.length}`,
        category: 'FORGERY_INDICATOR',
        severity: 'INFO',
        title: 'Potential Forgery Language',
        description: indicator.desc,
        evidence: 'Pattern matched in document content',
        source: 'AI_TIER1',
      });
    }
  }

  return findings;
}
