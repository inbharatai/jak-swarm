/**
 * Risk Scorer — Unified risk assessment
 *
 * Combines findings from rules + AI into a single risk score.
 * Score interpretation:
 *   0-20  = LOW    (safe, proceed normally)
 *   21-50 = MEDIUM (flag for awareness, allow with caution)
 *   51-80 = HIGH   (block or require human review)
 *   81-100 = CRITICAL (block immediately, alert admin)
 */

import type { Finding, RiskScore, RiskLevel, RecommendedActionItem } from '../types.js';

function scoreToLevel(score: number): RiskLevel {
  if (score <= 20) return 'LOW';
  if (score <= 50) return 'MEDIUM';
  if (score <= 80) return 'HIGH';
  return 'CRITICAL';
}

/**
 * Calculate a unified risk score from all findings.
 */
export function calculateRiskScore(
  findings: Finding[],
  baseConfidence: number = 0.8,
): RiskScore {
  if (findings.length === 0) {
    return { score: 0, level: 'LOW', confidence: 1.0 };
  }

  let totalScore = 0;
  let ruleCount = 0;
  let aiCount = 0;

  for (const f of findings) {
    const severityWeight = f.severity === 'CRITICAL' ? 35 : f.severity === 'WARNING' ? 15 : 5;
    totalScore += severityWeight;

    if (f.source === 'RULE') ruleCount++;
    else aiCount++;
  }

  const score = Math.min(totalScore, 100);

  // Confidence is higher when rules AND AI agree
  let confidence = baseConfidence;
  if (ruleCount > 0 && aiCount > 0) confidence = Math.min(confidence + 0.1, 1.0); // Both sources agree
  if (findings.length >= 3) confidence = Math.min(confidence + 0.05, 1.0); // Multiple findings
  if (findings.some(f => f.source === 'AI_TIER3')) confidence = Math.min(confidence + 0.05, 1.0); // Premium AI confirmed

  return {
    score,
    level: scoreToLevel(score),
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * Generate recommended actions based on risk score and findings.
 */
export function generateActions(risk: RiskScore, findings: Finding[]): RecommendedActionItem[] {
  const actions: RecommendedActionItem[] = [];

  if (risk.level === 'CRITICAL') {
    actions.push({
      type: 'BLOCK',
      reason: `Risk score ${risk.score}/100 (CRITICAL). ${findings.filter(f => f.severity === 'CRITICAL').length} critical finding(s) detected.`,
      priority: 1,
    });
    actions.push({
      type: 'ESCALATE',
      reason: 'Critical risk requires immediate admin attention.',
      assignTo: 'TENANT_ADMIN',
      priority: 2,
    });
  } else if (risk.level === 'HIGH') {
    actions.push({
      type: 'REVIEW',
      reason: `Risk score ${risk.score}/100 (HIGH). Manual review recommended before proceeding.`,
      assignTo: 'TENANT_ADMIN',
      priority: 1,
    });
  } else if (risk.level === 'MEDIUM') {
    actions.push({
      type: 'FLAG',
      reason: `Risk score ${risk.score}/100 (MEDIUM). Proceed with caution.`,
      priority: 2,
    });
  } else {
    actions.push({
      type: 'ALLOW',
      reason: `Risk score ${risk.score}/100 (LOW). No significant issues detected.`,
      priority: 3,
    });
  }

  return actions;
}

/**
 * Generate a human-readable summary.
 */
export function generateSummary(risk: RiskScore, findings: Finding[]): string {
  if (findings.length === 0) {
    return 'No issues detected. Content appears safe.';
  }

  const criticalCount = findings.filter(f => f.severity === 'CRITICAL').length;
  const warningCount = findings.filter(f => f.severity === 'WARNING').length;
  const infoCount = findings.filter(f => f.severity === 'INFO').length;

  const parts: string[] = [];
  parts.push(`Risk: ${risk.level} (${risk.score}/100, confidence ${Math.round(risk.confidence * 100)}%).`);

  if (criticalCount > 0) parts.push(`${criticalCount} critical issue(s).`);
  if (warningCount > 0) parts.push(`${warningCount} warning(s).`);
  if (infoCount > 0) parts.push(`${infoCount} informational note(s).`);

  return parts.join(' ');
}
