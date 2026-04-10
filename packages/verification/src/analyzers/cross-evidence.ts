/**
 * Cross-Evidence Analyzer
 *
 * Correlates findings across multiple verification types to detect
 * coordinated fraud patterns that single-type analysis would miss.
 */

import type { Analyzer, Finding, VerificationRequest } from '../types.js';
import { emailAnalyzer } from './email.analyzer.js';
import { documentAnalyzer } from './document.analyzer.js';
import { transactionAnalyzer } from './transaction.analyzer.js';
import { identityAnalyzer } from './identity.analyzer.js';

const ANALYZER_MAP: Record<string, Analyzer> = {
  EMAIL: emailAnalyzer,
  DOCUMENT: documentAnalyzer,
  TRANSACTION: transactionAnalyzer,
  IDENTITY: identityAnalyzer,
};

export const crossEvidenceAnalyzer: Analyzer = {
  name: 'CrossEvidenceAnalyzer',
  type: 'CROSS_VERIFY',

  async analyze(request: VerificationRequest) {
    const allFindings: Finding[] = [];
    const relatedItems = request.relatedItems ?? [];

    if (relatedItems.length === 0) {
      return { findings: [], riskContribution: 0, confidence: 0.5 };
    }

    // Run individual analyzers on each related item
    const itemResults: Array<{ type: string; findings: Finding[] }> = [];

    // Analyze the primary content
    const primaryAnalyzer = ANALYZER_MAP[request.type];
    if (primaryAnalyzer) {
      const result = await primaryAnalyzer.analyze(request);
      itemResults.push({ type: request.type, findings: result.findings });
      allFindings.push(...result.findings);
    }

    // Analyze each related item
    for (const item of relatedItems) {
      const analyzer = ANALYZER_MAP[item.type];
      if (analyzer) {
        const subRequest: VerificationRequest = {
          ...request,
          type: item.type,
          content: item.content,
          contentType: item.contentType,
          metadata: item.metadata,
        };
        const result = await analyzer.analyze(subRequest);
        itemResults.push({ type: item.type, findings: result.findings });
        allFindings.push(...result.findings);
      }
    }

    // Cross-correlate findings
    const crossFindings = correlateFindings(itemResults);
    allFindings.push(...crossFindings);

    // Calculate combined risk
    let riskContribution = 0;
    for (const f of allFindings) {
      if (f.severity === 'CRITICAL') riskContribution += 25;
      else if (f.severity === 'WARNING') riskContribution += 10;
      else riskContribution += 3;
    }

    // Cross-evidence correlation boosts risk if patterns align
    if (crossFindings.length > 0) {
      riskContribution += crossFindings.length * 15;
    }

    return {
      findings: allFindings,
      riskContribution: Math.min(riskContribution, 100),
      confidence: crossFindings.length > 0 ? 0.85 : 0.7,
    };
  },
};

/**
 * Look for correlated patterns across different data types.
 */
function correlateFindings(
  itemResults: Array<{ type: string; findings: Finding[] }>,
): Finding[] {
  const crossFindings: Finding[] = [];

  const emailFindings = itemResults.filter(r => r.type === 'EMAIL').flatMap(r => r.findings);
  const transactionFindings = itemResults.filter(r => r.type === 'TRANSACTION').flatMap(r => r.findings);
  const documentFindings = itemResults.filter(r => r.type === 'DOCUMENT').flatMap(r => r.findings);

  // Pattern: phishing email + bank detail change in transaction
  const hasPhishing = emailFindings.some(f => f.category === 'PHISHING' || f.category === 'BEC_FRAUD');
  const hasBankChange = transactionFindings.some(f => f.category === 'PAYMENT_FRAUD');
  if (hasPhishing && hasBankChange) {
    crossFindings.push({
      id: 'cross-phishing-plus-bank-change',
      category: 'COORDINATED_FRAUD',
      severity: 'CRITICAL',
      title: 'Coordinated BEC Attack Pattern',
      description: 'A suspicious email AND a bank detail change were detected together. This is the classic Business Email Compromise (BEC) attack pattern: attacker sends a phishing email impersonating an executive or vendor, then requests a change in payment details.',
      evidence: 'Phishing email + payment detail change in same context',
      source: 'CROSS_REF',
    });
  }

  // Pattern: document anomaly + identity anomaly
  const hasDocAnomaly = documentFindings.some(f => f.severity !== 'INFO');
  const identityFindings = itemResults.filter(r => r.type === 'IDENTITY').flatMap(r => r.findings);
  const hasIdAnomaly = identityFindings.some(f => f.severity !== 'INFO');
  if (hasDocAnomaly && hasIdAnomaly) {
    crossFindings.push({
      id: 'cross-doc-identity-mismatch',
      category: 'IDENTITY_FRAUD',
      severity: 'WARNING',
      title: 'Document + Identity Anomaly Correlation',
      description: 'Both the document and the identity/credential show anomalies. These may be related — a tampered document supporting a fabricated credential.',
      evidence: 'Document anomaly + credential anomaly in same context',
      source: 'CROSS_REF',
    });
  }

  // Pattern: multiple critical findings across different types
  const criticalCount = itemResults.reduce(
    (count, r) => count + r.findings.filter(f => f.severity === 'CRITICAL').length,
    0,
  );
  const typesWithCritical = new Set(
    itemResults.filter(r => r.findings.some(f => f.severity === 'CRITICAL')).map(r => r.type),
  );
  if (typesWithCritical.size >= 2) {
    crossFindings.push({
      id: 'cross-multi-type-critical',
      category: 'MULTI_VECTOR_THREAT',
      severity: 'CRITICAL',
      title: 'Multi-Vector Threat Detected',
      description: `Critical findings detected across ${typesWithCritical.size} different data types (${Array.from(typesWithCritical).join(', ')}). This suggests a coordinated threat rather than an isolated issue.`,
      evidence: `${criticalCount} critical findings across ${typesWithCritical.size} types`,
      source: 'CROSS_REF',
    });
  }

  return crossFindings;
}
