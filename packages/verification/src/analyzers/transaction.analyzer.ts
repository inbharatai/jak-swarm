/**
 * Transaction Risk Analyzer
 *
 * Detects anomalies in invoices, payments, and financial transactions.
 */

import type { Analyzer, Finding, VerificationRequest } from '../types.js';
import { runRules } from '../rules/rule-engine.js';

export const transactionAnalyzer: Analyzer = {
  name: 'TransactionAnalyzer',
  type: 'TRANSACTION',

  async analyze(request: VerificationRequest) {
    const allFindings: Finding[] = [];

    // Layer 1: Rules
    const { findings: ruleFindings, ruleScore } = runRules(
      'TRANSACTION',
      request.content,
      request.metadata,
      request.skipRuleIds,
    );
    allFindings.push(...ruleFindings);

    // Layer 2: Heuristic analysis
    const heuristicFindings = analyzeTransactionContent(request.content, request.metadata);
    allFindings.push(...heuristicFindings);

    let riskContribution = ruleScore;
    for (const f of heuristicFindings) {
      if (f.severity === 'CRITICAL') riskContribution += 35;
      else if (f.severity === 'WARNING') riskContribution += 12;
      else riskContribution += 3;
    }

    const confidence = allFindings.length === 0 ? 0.85 : 0.7;

    return {
      findings: allFindings,
      riskContribution: Math.min(riskContribution, 100),
      confidence,
    };
  },
};

function analyzeTransactionContent(content: string, _metadata?: Record<string, unknown>): Finding[] {
  const findings: Finding[] = [];

  // Duplicate invoice detection
  const invoiceNumbers = Array.from(content.matchAll(/invoice\s*#?\s*:?\s*([A-Z0-9-]{3,20})/gi));
  if (invoiceNumbers.length > 1) {
    const unique = new Set(invoiceNumbers.map(m => m[1]?.toUpperCase()));
    if (unique.size < invoiceNumbers.length) {
      findings.push({
        id: 'txn-duplicate-invoice',
        category: 'DUPLICATE',
        severity: 'WARNING',
        title: 'Duplicate Invoice Number',
        description: 'The same invoice number appears multiple times.',
        evidence: `Invoice numbers: ${Array.from(unique).join(', ')}`,
        source: 'AI_TIER1',
      });
    }
  }

  // Mismatched currency
  const currencies = Array.from(content.matchAll(/(?:USD|EUR|GBP|INR|AED|SGD|\$|€|£|₹)/gi));
  const uniqueCurrencies = new Set(currencies.map(m => m[0]));
  if (uniqueCurrencies.size > 1) {
    findings.push({
      id: 'txn-currency-mismatch',
      category: 'FIELD_ANOMALY',
      severity: 'INFO',
      title: 'Multiple Currencies',
      description: 'The document references multiple currencies.',
      evidence: `Currencies: ${Array.from(uniqueCurrencies).join(', ')}`,
      source: 'AI_TIER1',
    });
  }

  // Unusual payment terms
  if (/payment\s+(?:due\s+)?(?:immediately|upon\s+receipt|within\s+24\s+hours)/i.test(content)) {
    findings.push({
      id: 'txn-urgent-payment',
      category: 'SOCIAL_ENGINEERING',
      severity: 'WARNING',
      title: 'Urgent Payment Terms',
      description: 'Invoice requests immediate payment, which is unusual for legitimate business invoices.',
      evidence: 'Urgent payment language detected',
      source: 'AI_TIER1',
    });
  }

  // Crypto payment request
  if (/(?:bitcoin|btc|ethereum|eth|crypto|wallet\s+address|0x[a-fA-F0-9]{40})/i.test(content)) {
    findings.push({
      id: 'txn-crypto-payment',
      category: 'PAYMENT_FRAUD',
      severity: 'WARNING',
      title: 'Cryptocurrency Payment Requested',
      description: 'Invoice requests cryptocurrency payment, which is irreversible and commonly used in fraud.',
      evidence: 'Cryptocurrency reference detected',
      source: 'AI_TIER1',
    });
  }

  return findings;
}
