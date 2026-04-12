/**
 * Identity / Credential Analyzer
 *
 * Verifies resumes, credentials, and identity-related documents.
 */

import type { Analyzer, Finding, VerificationRequest } from '../types.js';
import { runRules } from '../rules/rule-engine.js';

export const identityAnalyzer: Analyzer = {
  name: 'IdentityAnalyzer',
  type: 'IDENTITY',

  async analyze(request: VerificationRequest) {
    const allFindings: Finding[] = [];

    // Layer 1: Rules
    const { findings: ruleFindings, ruleScore } = runRules(
      'IDENTITY',
      request.content,
      request.metadata,
      request.skipRuleIds,
    );
    allFindings.push(...ruleFindings);

    // Layer 2: AI analysis (LLM when available, heuristics as fallback)
    let heuristicFindings: Finding[] = [];
    try {
      const { callVerificationLLM } = await import('./llm-analyzer.js');
      const llmResult = await callVerificationLLM(1, 'IDENTITY', request.content);
      if (llmResult && llmResult.findings.length > 0) {
        heuristicFindings = llmResult.findings.map((f) => ({
          id: f.id, severity: f.severity, category: f.category, title: f.description.slice(0, 80),
          description: f.description, evidence: f.evidence,
          source: (f.source === 'AI_TIER1' || f.source === 'AI_TIER3' ? f.source : 'AI_TIER1') as 'AI_TIER1' | 'AI_TIER3',
          ruleId: f.id,
        }));
      }
    } catch { /* LLM not available */ }
    if (heuristicFindings.length === 0) {
      heuristicFindings = analyzeIdentityContent(request.content);
    }
    allFindings.push(...heuristicFindings);

    let riskContribution = ruleScore;
    for (const f of heuristicFindings) {
      if (f.severity === 'CRITICAL') riskContribution += 30;
      else if (f.severity === 'WARNING') riskContribution += 12;
      else riskContribution += 3;
    }

    return {
      findings: allFindings,
      riskContribution: Math.min(riskContribution, 100),
      confidence: allFindings.length === 0 ? 0.8 : 0.65,
    };
  },
};

function analyzeIdentityContent(content: string): Finding[] {
  const findings: Finding[] = [];

  // Impossible experience claims (e.g., "10 years experience" but graduated 2 years ago)
  const gradYear = content.match(/(?:graduated|degree|class\s+of)\s+(\d{4})/i);
  const expYears = content.match(/(\d{1,2})\+?\s+years?\s+(?:of\s+)?experience/i);
  if (gradYear && expYears) {
    const grad = parseInt(gradYear[1]!);
    const exp = parseInt(expYears[1]!);
    const currentYear = new Date().getFullYear();
    if (grad + exp > currentYear + 1) {
      findings.push({
        id: 'id-impossible-experience',
        category: 'CREDENTIAL_ANOMALY',
        severity: 'WARNING',
        title: 'Impossible Experience Claim',
        description: `Claims ${exp} years experience but graduated in ${grad}. The math doesn't add up.`,
        evidence: `Graduation: ${grad}, Experience claimed: ${exp} years, Current year: ${currentYear}`,
        source: 'AI_TIER1',
      });
    }
  }

  // Generic/template resume content
  const genericPatterns = [
    /hard-?working\s+team\s+player\s+with\s+excellent\s+communication\s+skills/i,
    /results-?driven\s+professional\s+with\s+proven\s+track\s+record/i,
    /seeking\s+a\s+challenging\s+position\s+in\s+a\s+dynamic\s+organization/i,
  ];
  const genericCount = genericPatterns.filter(p => p.test(content)).length;
  if (genericCount >= 2) {
    findings.push({
      id: 'id-generic-content',
      category: 'QUALITY',
      severity: 'INFO',
      title: 'Generic Template Content',
      description: 'Resume contains multiple generic template phrases, suggesting low effort or possible template abuse.',
      evidence: `${genericCount} generic phrases detected`,
      source: 'AI_TIER1',
    });
  }

  // Skill inflation (claiming expertise in too many unrelated fields)
  const skillSections = content.match(/(?:skills|expertise|proficiency|competenc)\s*:?\s*([^\n]{50,500})/gi);
  if (skillSections) {
    const totalSkills = skillSections.join(' ').split(/[,;|•·]/).length;
    if (totalSkills > 30) {
      findings.push({
        id: 'id-skill-inflation',
        category: 'CREDENTIAL_ANOMALY',
        severity: 'INFO',
        title: 'Excessive Skill Claims',
        description: `Resume lists ${totalSkills} skills, which is unusually high and may indicate inflation.`,
        evidence: `${totalSkills} skills listed`,
        source: 'AI_TIER1',
      });
    }
  }

  return findings;
}
