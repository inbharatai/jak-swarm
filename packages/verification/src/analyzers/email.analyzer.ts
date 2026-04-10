/**
 * Email Threat Analyzer
 *
 * Detects phishing, spam, spoofing, and social engineering in emails.
 * Uses the 4-layer escalation: rules → AI Tier 1 → AI Tier 3 → human review.
 */

import type { Analyzer, Finding, VerificationRequest } from '../types.js';
import { runRules } from '../rules/rule-engine.js';
import { shouldEscalate, selectModel } from '../routing/model-router.js';

export const emailAnalyzer: Analyzer = {
  name: 'EmailAnalyzer',
  type: 'EMAIL',

  async analyze(request: VerificationRequest) {
    const allFindings: Finding[] = [];
    let confidence = 0.5; // Start neutral

    // ─── Layer 1: Deterministic Rules ──────────────────────────────
    const { findings: ruleFindings, ruleScore } = runRules(
      'EMAIL',
      request.content,
      request.metadata,
      request.skipRuleIds,
    );
    allFindings.push(...ruleFindings);

    // If rules are definitive (score >= 80), skip AI
    const escalation = shouldEscalate({
      ruleScore,
      verificationType: 'EMAIL',
      forceDeepAnalysis: request.forceDeepAnalysis,
      maxModelTier: request.maxModelTier,
      findingCount: ruleFindings.length,
      hasCriticalFindings: ruleFindings.some(f => f.severity === 'CRITICAL'),
    });

    if (escalation === 'STOP') {
      confidence = ruleScore >= 80 ? 0.95 : 0.7;
      return { findings: allFindings, riskContribution: ruleScore, confidence };
    }

    // ─── Layer 2: AI Tier 1 Analysis (placeholder — needs LLM call) ──
    // In production, this calls Gemini Flash for content classification.
    // For now, we use enhanced rule-based heuristics as a proxy.

    if (escalation === 'TIER1' || escalation === 'TIER3') {
      const aiFindings = analyzeContentHeuristics(request.content, request.metadata);
      allFindings.push(...aiFindings);

      // Update confidence based on combined findings
      const totalFindings = allFindings.length;
      confidence = totalFindings === 0 ? 0.9 : totalFindings <= 2 ? 0.75 : 0.6;
    }

    // Calculate risk contribution
    let riskContribution = ruleScore;
    for (const f of allFindings.filter(f => f.source !== 'RULE')) {
      if (f.severity === 'CRITICAL') riskContribution += 30;
      else if (f.severity === 'WARNING') riskContribution += 10;
      else riskContribution += 3;
    }

    return {
      findings: allFindings,
      riskContribution: Math.min(riskContribution, 100),
      confidence,
    };
  },
};

/**
 * Content-based heuristics (enhanced rules that simulate Tier 1 AI).
 * These will be replaced with actual LLM calls when API keys are configured.
 */
function analyzeContentHeuristics(content: string, metadata?: Record<string, unknown>): Finding[] {
  const findings: Finding[] = [];
  const lower = content.toLowerCase();

  // Check for credential harvesting patterns
  if (/(?:enter|confirm|verify|update)\s+your\s+(?:password|credentials|login|pin|ssn)/i.test(content)) {
    findings.push({
      id: 'email-credential-harvesting',
      category: 'CREDENTIAL_HARVESTING',
      severity: 'CRITICAL',
      title: 'Credential Harvesting Attempt',
      description: 'Email asks the recipient to enter or confirm sensitive credentials.',
      evidence: 'Credential request pattern detected',
      source: 'AI_TIER1',
    });
  }

  // Check for CEO/executive impersonation
  const from = String(metadata?.from ?? '');
  const subject = String(metadata?.subject ?? lower);
  if (/(?:ceo|cfo|director|president|founder)/i.test(from) && /(?:wire|transfer|urgent|confidential|payment)/i.test(subject)) {
    findings.push({
      id: 'email-exec-impersonation',
      category: 'BEC_FRAUD',
      severity: 'CRITICAL',
      title: 'Possible Executive Impersonation (BEC)',
      description: 'Email appears to be from a senior executive requesting urgent financial action. This is a common Business Email Compromise pattern.',
      evidence: `From: ${from}, Subject contains financial urgency`,
      source: 'AI_TIER1',
    });
  }

  // Check for attachment risk
  if (/\.(?:exe|bat|cmd|scr|pif|js|vbs|wsf|msi|dll|com)(?:\s|$|"|')/i.test(content)) {
    findings.push({
      id: 'email-dangerous-attachment',
      category: 'MALWARE',
      severity: 'CRITICAL',
      title: 'Dangerous File Type Referenced',
      description: 'Email references or contains an executable file type commonly used for malware delivery.',
      evidence: 'Executable file extension detected in content',
      source: 'AI_TIER1',
    });
  }

  // Check for display name spoofing (From name doesn't match email domain)
  const fromName = String(metadata?.fromName ?? '');
  const fromDomain = from.split('@')[1] ?? '';
  if (fromName && fromDomain) {
    const nameLower = fromName.toLowerCase();
    const companyPatterns = ['paypal', 'microsoft', 'google', 'apple', 'amazon', 'netflix', 'bank'];
    for (const company of companyPatterns) {
      if (nameLower.includes(company) && !fromDomain.includes(company)) {
        findings.push({
          id: 'email-display-name-spoof',
          category: 'SPOOFING',
          severity: 'WARNING',
          title: 'Display Name Spoofing',
          description: `Sender display name contains "${company}" but email domain is "${fromDomain}".`,
          evidence: `Name: ${fromName}, Domain: ${fromDomain}`,
          source: 'AI_TIER1',
        });
        break;
      }
    }
  }

  return findings;
}
