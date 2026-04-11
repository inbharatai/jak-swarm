/**
 * JAK Swarm Verification & Risk Intelligence Engine
 *
 * Public API — the single entry point for all verification requests.
 *
 * Usage:
 *   import { verify } from '@jak-swarm/verification';
 *   const result = await verify({ type: 'EMAIL', content: '...', ... });
 */

import type {
  VerificationRequest,
  VerificationResult,
  Analyzer,
} from './types.js';
import { emailAnalyzer } from './analyzers/email.analyzer.js';
import { documentAnalyzer } from './analyzers/document.analyzer.js';
import { transactionAnalyzer } from './analyzers/transaction.analyzer.js';
import { identityAnalyzer } from './analyzers/identity.analyzer.js';
import { crossEvidenceAnalyzer } from './analyzers/cross-evidence.js';
import { calculateRiskScore, generateActions, generateSummary } from './scoring/risk-scorer.js';
import { generateId } from '@jak-swarm/shared';

// ─── Analyzer Registry ──────────────────────────────────────────────────────

const ANALYZERS: Record<string, Analyzer> = {
  EMAIL: emailAnalyzer,
  DOCUMENT: documentAnalyzer,
  TRANSACTION: transactionAnalyzer,
  IDENTITY: identityAnalyzer,
  CROSS_VERIFY: crossEvidenceAnalyzer,
};

// ─── Main Verify Function ───────────────────────────────────────────────────

/**
 * Run a verification check on any content type.
 *
 * This is the single entry point — consumers (tools, agents, guardrails)
 * call this function and get back a complete VerificationResult.
 */
export async function verify(request: VerificationRequest): Promise<VerificationResult> {
  const startTime = Date.now();
  const requestId = generateId();

  const analyzer = ANALYZERS[request.type];
  if (!analyzer) {
    throw new Error(`Unknown verification type: ${request.type}. Valid types: ${Object.keys(ANALYZERS).join(', ')}`);
  }

  // Run the appropriate analyzer
  const { findings, riskContribution: _riskContribution, confidence } = await analyzer.analyze(request);

  // Calculate unified risk score
  const risk = calculateRiskScore(findings, confidence);

  // Generate recommended actions
  const actions = generateActions(risk, findings);

  // Generate human-readable summary
  const summary = generateSummary(risk, findings);

  // Build audit trail
  const audit = {
    requestId,
    analyzersRun: [analyzer.name],
    modelsUsed: [], // Will be populated when LLM integration is added
    totalCostUsd: 0, // Rule-based analysis is free
    durationMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
    layersActivated: [1], // Layer 1 (rules) always runs
  };

  // Track which layers were activated based on findings
  if (findings.some(f => f.source === 'AI_TIER1')) audit.layersActivated.push(2);
  if (findings.some(f => f.source === 'AI_TIER3')) audit.layersActivated.push(3);
  if (findings.some(f => f.source === 'CROSS_REF')) audit.layersActivated.push(2);

  return { risk, findings, actions, audit, summary };
}

// ─── Re-exports ─────────────────────────────────────────────────────────────

export type {
  VerificationRequest,
  VerificationResult,
  VerificationType,
  RiskLevel,
  RiskScore,
  Finding,
  FindingSeverity,
  FindingSource,
  RecommendedAction,
  RecommendedActionItem,
  VerificationAudit,
  Analyzer,
  Rule,
} from './types.js';

export { runRules } from './rules/rule-engine.js';
export { calculateRiskScore, generateActions, generateSummary } from './scoring/risk-scorer.js';
export { shouldEscalate, selectModel } from './routing/model-router.js';
export { emailAnalyzer } from './analyzers/email.analyzer.js';
export { documentAnalyzer } from './analyzers/document.analyzer.js';
export { transactionAnalyzer } from './analyzers/transaction.analyzer.js';
export { identityAnalyzer } from './analyzers/identity.analyzer.js';
export { crossEvidenceAnalyzer } from './analyzers/cross-evidence.js';
