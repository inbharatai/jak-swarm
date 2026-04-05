import { AgentRole, RiskLevel } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export interface GuardrailResult {
  safe: boolean;
  violations: string[];
  piiDetected: boolean;
  injectionAttempted: boolean;
  blockedAction?: string;
}

export interface GuardrailInput {
  content: string;
  action?: string;
  riskLevel?: RiskLevel;
  toolsToExecute?: string[];
  checkType: 'INPUT' | 'OUTPUT' | 'ACTION';
}

// PII patterns
const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'EMAIL', pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g },
  {
    name: 'PHONE',
    pattern: /(\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b/g,
  },
  {
    name: 'SSN',
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  },
  {
    name: 'CREDIT_CARD',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
  },
  {
    name: 'DOB',
    pattern:
      /\b(0[1-9]|1[0-2])[\/\-\.](0[1-9]|[12][0-9]|3[01])[\/\-\.](19|20)\d{2}\b|\b(19|20)\d{2}[\/\-\.](0[1-9]|1[0-2])[\/\-\.](0[1-9]|[12][0-9]|3[01])\b/g,
  },
  {
    name: 'MRN',
    pattern: /\bMRN[#:\s]?\s*\d{6,10}\b/gi,
  },
  {
    name: 'PASSPORT',
    pattern: /\b[A-Z]{1,2}\d{6,9}\b/g,
  },
];

// Prompt injection patterns
const INJECTION_PATTERNS: Array<{ pattern: RegExp; risk: 'LOW' | 'HIGH' }> = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, risk: 'HIGH' },
  { pattern: /ignore\s+your\s+(system\s+)?prompt/i, risk: 'HIGH' },
  { pattern: /you\s+are\s+now\s+(a\s+)?(\w+\s+)?(?:assistant|bot|ai|model)/i, risk: 'HIGH' },
  { pattern: /new\s+instructions:/i, risk: 'HIGH' },
  { pattern: /\bSYSTEM:\s/m, risk: 'HIGH' },
  { pattern: /```\s*system/i, risk: 'HIGH' },
  { pattern: /act\s+as\s+(a\s+)?(?:different|new|unrestricted|unfiltered)/i, risk: 'HIGH' },
  { pattern: /pretend\s+(you\s+are|to\s+be)\s+/i, risk: 'HIGH' },
  { pattern: /disregard\s+(all\s+)?(?:previous|your|the)\s+/i, risk: 'HIGH' },
  { pattern: /forget\s+everything\s+(you\s+know|i\s+said|above)/i, risk: 'HIGH' },
  { pattern: /\[\[.*?\]\]/s, risk: 'LOW' },
  { pattern: /\bDAN\s+mode\b/i, risk: 'HIGH' },
  { pattern: /jailbreak/i, risk: 'HIGH' },
  { pattern: /<\|system\|>/i, risk: 'HIGH' },
  { pattern: /override\s+(safety|policy|restriction|rule)/i, risk: 'HIGH' },
];

// Destructive action patterns
const DESTRUCTIVE_ACTIONS = new Set([
  'delete_record',
  'submit_payment',
  'send_email',
  'browser_submit',
  'send_webhook',
  'drop_database',
  'purge_data',
  'revoke_access',
]);

const HIGH_RISK_TOOLS = new Set([
  'delete_record',
  'submit_payment',
  'send_email',
  'browser_submit',
  'send_webhook',
  'browser_fill_form',
  'update_crm_record',
]);

// Forbidden tool combinations (pairs that should never execute together)
const FORBIDDEN_TOOL_COMBOS: Array<[string, string]> = [
  ['read_email', 'send_webhook'], // scraping + exfiltrating
  ['extract_document_data', 'send_webhook'], // extracting PHI + exfiltrating
  ['lookup_crm_contact', 'browser_fill_form'], // CRM data + browser form fill
];

export class GuardrailAgent extends BaseAgent {
  constructor(apiKey?: string) {
    // GuardrailAgent is purely heuristic — pass a placeholder key so BaseAgent
    // can initialize without throwing. The OpenAI client is never actually called.
    super(AgentRole.GUARDRAIL, apiKey ?? 'not-used');
  }

  // Pure heuristic — no LLM calls for speed
  async execute(input: unknown, context: AgentContext): Promise<GuardrailResult> {
    const startedAt = new Date();
    const guardrailInput = input as GuardrailInput;

    this.logger.info(
      { runId: context.runId, checkType: guardrailInput.checkType },
      'Guardrail running safety checks',
    );

    const violations: string[] = [];
    let piiDetected = false;
    let injectionAttempted = false;
    let blockedAction: string | undefined;

    // 1. PII detection
    const piiResults = this.detectPII(guardrailInput.content);
    if (piiResults.length > 0) {
      piiDetected = true;
      violations.push(
        `PII detected in ${guardrailInput.checkType.toLowerCase()}: ${piiResults.join(', ')}`,
      );
    }

    // 2. Prompt injection detection
    const injectionResults = this.detectInjection(guardrailInput.content);
    if (injectionResults.detected) {
      injectionAttempted = true;
      violations.push(
        `Prompt injection attempt detected (risk: ${injectionResults.risk}): ${injectionResults.patterns.join(', ')}`,
      );
    }

    // 3. Destructive action check
    if (guardrailInput.action) {
      const actionLower = guardrailInput.action.toLowerCase().replace(/\s+/g, '_');
      if (DESTRUCTIVE_ACTIONS.has(actionLower)) {
        const riskOk =
          guardrailInput.riskLevel &&
          (guardrailInput.riskLevel === RiskLevel.HIGH || guardrailInput.riskLevel === RiskLevel.CRITICAL);
        if (riskOk) {
          blockedAction = guardrailInput.action;
          violations.push(
            `Destructive action '${guardrailInput.action}' blocked — requires explicit approval at risk level ${guardrailInput.riskLevel ?? 'unknown'}`,
          );
        }
      }
    }

    // 4. High-risk tool detection
    if (guardrailInput.toolsToExecute) {
      for (const tool of guardrailInput.toolsToExecute) {
        if (HIGH_RISK_TOOLS.has(tool)) {
          violations.push(
            `Tool '${tool}' is in the high-risk category — ensure approval gate is active`,
          );
        }
      }

      // 5. Forbidden tool combination check
      for (const [toolA, toolB] of FORBIDDEN_TOOL_COMBOS) {
        const hasA = guardrailInput.toolsToExecute.includes(toolA);
        const hasB = guardrailInput.toolsToExecute.includes(toolB);
        if (hasA && hasB) {
          violations.push(
            `Forbidden tool combination detected: '${toolA}' + '${toolB}' — potential data exfiltration risk`,
          );
          blockedAction = `${toolA}+${toolB}`;
        }
      }
    }

    // 6. Check for content that signals intent to exfiltrate data
    if (
      /send.*to.*(external|outside|personal|private|gmail|hotmail|yahoo)/i.test(
        guardrailInput.content,
      )
    ) {
      violations.push('Possible data exfiltration intent detected in content');
    }

    const result: GuardrailResult = {
      safe: violations.length === 0,
      violations,
      piiDetected,
      injectionAttempted,
      blockedAction,
    };

    this.recordTrace(context, input, result, [], startedAt);

    this.logger.info(
      { safe: result.safe, violationCount: violations.length, piiDetected, injectionAttempted },
      'Guardrail check complete',
    );

    return result;
  }

  detectPII(text: string): string[] {
    const found = new Set<string>();
    for (const { name, pattern } of PII_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        found.add(name);
      }
    }
    return [...found];
  }

  detectInjection(text: string): {
    detected: boolean;
    patterns: string[];
    risk: 'LOW' | 'HIGH';
  } {
    const matched: string[] = [];
    let highRisk = false;

    for (const { pattern, risk } of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        matched.push(pattern.source.slice(0, 50));
        if (risk === 'HIGH') highRisk = true;
      }
    }

    return {
      detected: matched.length > 0,
      patterns: matched,
      risk: highRisk ? 'HIGH' : 'LOW',
    };
  }
}
