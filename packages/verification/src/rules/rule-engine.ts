/**
 * Rule Engine — Layer 1 (Deterministic)
 *
 * Cost: $0 | Latency: ~10ms | Always runs first
 *
 * Pure regex and logic-based checks. No LLM calls.
 * If rules produce a score >= 80, we skip AI entirely (certain threat).
 */

import type { Finding, Rule, VerificationType } from '../types.js';

// ─── Email Rules ────────────────────────────────────────────────────────────

const EMAIL_RULES: Rule[] = [
  {
    id: 'email-spf-fail',
    name: 'SPF Authentication Failed',
    description: 'Email SPF record check failed',
    category: 'EMAIL_AUTH',
    severity: 'CRITICAL',
    check: (content, metadata) => {
      const headers = String(metadata?.headers ?? content);
      if (/spf=fail/i.test(headers)) {
        return [{
          id: 'email-spf-fail',
          category: 'EMAIL_AUTH',
          severity: 'CRITICAL',
          title: 'SPF Authentication Failed',
          description: 'The sending server is not authorized to send email for this domain. This is a strong indicator of spoofing.',
          evidence: 'SPF record returned FAIL',
          source: 'RULE',
          ruleId: 'email-spf-fail',
        }];
      }
      return [];
    },
  },
  {
    id: 'email-dkim-fail',
    name: 'DKIM Signature Invalid',
    description: 'Email DKIM signature verification failed',
    category: 'EMAIL_AUTH',
    severity: 'CRITICAL',
    check: (content, metadata) => {
      const headers = String(metadata?.headers ?? content);
      if (/dkim=fail/i.test(headers)) {
        return [{
          id: 'email-dkim-fail',
          category: 'EMAIL_AUTH',
          severity: 'CRITICAL',
          title: 'DKIM Signature Invalid',
          description: 'The email DKIM signature does not match. The message may have been tampered with in transit.',
          evidence: 'DKIM verification returned FAIL',
          source: 'RULE',
          ruleId: 'email-dkim-fail',
        }];
      }
      return [];
    },
  },
  {
    id: 'email-known-phishing-domain',
    name: 'Known Phishing Domain',
    description: 'Sender domain matches known phishing patterns',
    category: 'PHISHING',
    severity: 'CRITICAL',
    check: (_content, metadata) => {
      const from = String(metadata?.from ?? '');
      const phishingPatterns = [
        /paypal.*security.*@(?!paypal\.com)/i,
        /apple.*support.*@(?!apple\.com)/i,
        /microsoft.*account.*@(?!microsoft\.com)/i,
        /google.*alert.*@(?!google\.com)/i,
        /amazon.*verify.*@(?!amazon\.com)/i,
        /@.*\.tk$/i, /@.*\.ml$/i, /@.*\.ga$/i, /@.*\.cf$/i, // Free TLD abuse
      ];

      const matches = phishingPatterns.filter(p => p.test(from));
      if (matches.length > 0) {
        return [{
          id: 'email-known-phishing-domain',
          category: 'PHISHING',
          severity: 'CRITICAL',
          title: 'Known Phishing Domain Pattern',
          description: `Sender address matches a known phishing pattern. The domain impersonates a legitimate service.`,
          evidence: `From: ${from}`,
          source: 'RULE',
          ruleId: 'email-known-phishing-domain',
        }];
      }
      return [];
    },
  },
  {
    id: 'email-urgency-language',
    name: 'Urgency/Fear Language',
    description: 'Email contains urgency or fear-inducing language',
    category: 'SOCIAL_ENGINEERING',
    severity: 'WARNING',
    check: (content) => {
      const urgencyPatterns = [
        /your\s+account\s+(will\s+be|has\s+been)\s+(suspended|locked|closed|disabled)/i,
        /immediate\s+action\s+required/i,
        /verify\s+your\s+(identity|account|payment)\s+within\s+\d+\s+hours?/i,
        /failure\s+to\s+(respond|verify|confirm)\s+will\s+result/i,
        /unauthorized\s+(access|transaction|activity)\s+(was\s+)?detected/i,
        /click\s+here\s+(immediately|now|urgently)/i,
      ];

      const matches = urgencyPatterns.filter(p => p.test(content));
      if (matches.length >= 2) {
        return [{
          id: 'email-urgency-language',
          category: 'SOCIAL_ENGINEERING',
          severity: 'WARNING',
          title: 'Multiple Urgency/Fear Patterns Detected',
          description: `Email contains ${matches.length} urgency/fear-inducing phrases, a common phishing tactic.`,
          evidence: `${matches.length} urgency patterns matched`,
          source: 'RULE',
          ruleId: 'email-urgency-language',
        }];
      }
      return [];
    },
  },
  {
    id: 'email-suspicious-link',
    name: 'Suspicious URL Pattern',
    description: 'Email contains URLs with suspicious patterns',
    category: 'PHISHING',
    severity: 'WARNING',
    check: (content) => {
      const suspiciousUrlPatterns = [
        /https?:\/\/\d+\.\d+\.\d+\.\d+/i, // IP address URLs
        /https?:\/\/[^\/]*bit\.ly/i,        // URL shorteners
        /https?:\/\/[^\/]*tinyurl/i,
        /https?:\/\/[^\/]*t\.co(?!m)/i,     // Twitter shortener (but not .com)
        /https?:\/\/[^\/]*\.xyz\//i,         // Suspicious TLDs
        /https?:\/\/[^\/]*login[^\/]*\./i,   // login in subdomain
      ];

      const findings: Finding[] = [];
      for (const pattern of suspiciousUrlPatterns) {
        const match = content.match(pattern);
        if (match) {
          findings.push({
            id: `email-suspicious-link-${findings.length}`,
            category: 'PHISHING',
            severity: 'WARNING',
            title: 'Suspicious URL Detected',
            description: 'Email contains a URL with suspicious characteristics (IP address, URL shortener, or suspicious TLD).',
            evidence: match[0]!,
            source: 'RULE',
            ruleId: 'email-suspicious-link',
          });
        }
      }
      return findings;
    },
  },
];

// ─── Document Rules ─────────────────────────────────────────────────────────

const DOCUMENT_RULES: Rule[] = [
  {
    id: 'doc-metadata-mismatch',
    name: 'Metadata Date Mismatch',
    description: 'Document creation date is after modification date',
    category: 'METADATA_ANOMALY',
    severity: 'WARNING',
    check: (_content, metadata) => {
      const created = metadata?.createdDate ? new Date(String(metadata.createdDate)) : null;
      const modified = metadata?.modifiedDate ? new Date(String(metadata.modifiedDate)) : null;
      if (created && modified && created > modified) {
        return [{
          id: 'doc-metadata-mismatch',
          category: 'METADATA_ANOMALY',
          severity: 'WARNING',
          title: 'Document Metadata Date Anomaly',
          description: 'The document creation date is after the modification date, which is physically impossible. This suggests the metadata has been tampered with.',
          evidence: `Created: ${created.toISOString()}, Modified: ${modified.toISOString()}`,
          source: 'RULE',
          ruleId: 'doc-metadata-mismatch',
        }];
      }
      return [];
    },
  },
  {
    id: 'doc-future-date',
    name: 'Future Date in Document',
    description: 'Document contains dates in the future',
    category: 'METADATA_ANOMALY',
    severity: 'INFO',
    check: (_content, metadata) => {
      const created = metadata?.createdDate ? new Date(String(metadata.createdDate)) : null;
      const now = new Date();
      if (created && created > now) {
        return [{
          id: 'doc-future-date',
          category: 'METADATA_ANOMALY',
          severity: 'INFO',
          title: 'Document Has Future Date',
          description: 'The document metadata contains a date in the future.',
          evidence: `Date: ${created.toISOString()}`,
          source: 'RULE',
          ruleId: 'doc-future-date',
        }];
      }
      return [];
    },
  },
];

// ─── Transaction Rules ──────────────────────────────────────────────────────

const TRANSACTION_RULES: Rule[] = [
  {
    id: 'txn-invalid-tax-id',
    name: 'Invalid Tax ID Format',
    description: 'Tax ID does not match expected format',
    category: 'FIELD_VALIDATION',
    severity: 'WARNING',
    check: (content) => {
      // Check for tax IDs that are all zeros, all same digit, or sequential
      const taxIdMatch = content.match(/(?:tax\s*id|tin|ein|gst(?:in)?|pan)\s*[:#]?\s*([A-Z0-9-]{5,20})/i);
      if (taxIdMatch) {
        const id = taxIdMatch[1]!.replace(/[-\s]/g, '');
        if (/^(.)\1+$/.test(id) || id === '000000000' || id === '123456789') {
          return [{
            id: 'txn-invalid-tax-id',
            category: 'FIELD_VALIDATION',
            severity: 'WARNING',
            title: 'Suspicious Tax ID',
            description: 'The tax identification number appears to be a placeholder or invalid value.',
            evidence: `Tax ID: ${taxIdMatch[1]}`,
            source: 'RULE',
            ruleId: 'txn-invalid-tax-id',
          }];
        }
      }
      return [];
    },
  },
  {
    id: 'txn-round-number',
    name: 'Suspiciously Round Amount',
    description: 'Transaction amount is an exact round number in thousands',
    category: 'AMOUNT_ANOMALY',
    severity: 'INFO',
    check: (content) => {
      const amountMatch = content.match(/(?:amount|total|due|payment)\s*[:#]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
      if (amountMatch) {
        const amount = parseFloat(amountMatch[1]!.replace(/,/g, ''));
        if (amount >= 10000 && amount % 1000 === 0) {
          return [{
            id: 'txn-round-number',
            category: 'AMOUNT_ANOMALY',
            severity: 'INFO',
            title: 'Round Transaction Amount',
            description: 'The transaction amount is an exact round number, which may warrant additional review for large transactions.',
            evidence: `Amount: $${amount.toLocaleString()}`,
            source: 'RULE',
            ruleId: 'txn-round-number',
          }];
        }
      }
      return [];
    },
  },
  {
    id: 'txn-bank-detail-change',
    name: 'Bank Detail Change Request',
    description: 'Content mentions changing bank/payment details',
    category: 'PAYMENT_FRAUD',
    severity: 'CRITICAL',
    check: (content) => {
      const changePatterns = [
        /(?:new|updated|changed?)\s+bank\s+(?:account|details|information)/i,
        /please\s+(?:update|change)\s+(?:our|the)\s+(?:payment|bank|account)\s+(?:details|information)/i,
        /wire\s+(?:transfer|payment)\s+to\s+(?:a\s+)?(?:new|different)\s+account/i,
      ];
      const matches = changePatterns.filter(p => p.test(content));
      if (matches.length > 0) {
        return [{
          id: 'txn-bank-detail-change',
          category: 'PAYMENT_FRAUD',
          severity: 'CRITICAL',
          title: 'Bank Detail Change Request Detected',
          description: 'The content requests a change in payment/banking details. This is the #1 pattern in business email compromise (BEC) fraud.',
          evidence: 'Bank/payment detail change language detected',
          source: 'RULE',
          ruleId: 'txn-bank-detail-change',
        }];
      }
      return [];
    },
  },
];

// ─── Identity Rules ─────────────────────────────────────────────────────────

const IDENTITY_RULES: Rule[] = [
  {
    id: 'id-timeline-overlap',
    name: 'Employment Timeline Overlap',
    description: 'Resume shows overlapping full-time positions',
    category: 'TIMELINE_ANOMALY',
    severity: 'WARNING',
    check: (content) => {
      // Simple check: look for date range patterns that overlap
      const dateRanges = Array.from(content.matchAll(/(\d{4})\s*[-–]\s*(\d{4}|present)/gi));
      if (dateRanges.length >= 2) {
        for (let i = 0; i < dateRanges.length - 1; i++) {
          const end1 = dateRanges[i]![2]!.toLowerCase() === 'present' ? 2099 : parseInt(dateRanges[i]![2]!);
          const start2 = parseInt(dateRanges[i + 1]![1]!);
          if (end1 > start2) {
            return [{
              id: 'id-timeline-overlap',
              category: 'TIMELINE_ANOMALY',
              severity: 'WARNING',
              title: 'Employment Timeline Overlap',
              description: 'The resume shows overlapping employment periods, which may indicate inaccuracy.',
              evidence: `Period ending ${end1} overlaps with period starting ${start2}`,
              source: 'RULE',
              ruleId: 'id-timeline-overlap',
            }];
          }
        }
      }
      return [];
    },
  },
];

// ─── Rule Registry ──────────────────────────────────────────────────────────

const ALL_RULES: Record<VerificationType, Rule[]> = {
  EMAIL: EMAIL_RULES,
  DOCUMENT: DOCUMENT_RULES,
  TRANSACTION: TRANSACTION_RULES,
  IDENTITY: IDENTITY_RULES,
  CROSS_VERIFY: [], // Cross-verify uses other analyzers, not standalone rules
};

/**
 * Run all deterministic rules for a given verification type.
 * Returns findings and a rule-based risk score contribution.
 */
export function runRules(
  type: VerificationType,
  content: string,
  metadata?: Record<string, unknown>,
  skipRuleIds?: string[],
): { findings: Finding[]; ruleScore: number } {
  const rules = ALL_RULES[type] ?? [];
  const skipSet = new Set(skipRuleIds ?? []);
  const findings: Finding[] = [];

  for (const rule of rules) {
    if (skipSet.has(rule.id)) continue;
    try {
      const ruleFindings = rule.check(content, metadata);
      findings.push(...ruleFindings);
    } catch {
      // Rule errors should never crash the engine — skip silently
    }
  }

  // Calculate rule score: CRITICAL=40, WARNING=15, INFO=5
  let ruleScore = 0;
  for (const f of findings) {
    if (f.severity === 'CRITICAL') ruleScore += 40;
    else if (f.severity === 'WARNING') ruleScore += 15;
    else ruleScore += 5;
  }

  return { findings, ruleScore: Math.min(ruleScore, 100) };
}

export { ALL_RULES, EMAIL_RULES, DOCUMENT_RULES, TRANSACTION_RULES, IDENTITY_RULES };
