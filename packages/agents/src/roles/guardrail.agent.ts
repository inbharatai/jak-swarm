import { AgentRole, RiskLevel } from '@jak-swarm/shared';
import { getShieldGateway } from '@jak-swarm/security';
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
  async _executeImpl(input: unknown, context: AgentContext): Promise<GuardrailResult> {
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

    const shieldScan = await getShieldGateway().scanInput(guardrailInput.content, {
      tenantId: context.tenantId,
      userId: context.userId,
      workflowId: context.workflowId,
      runId: context.runId,
      source: guardrailInput.checkType === 'ACTION' ? 'tool_input' : 'agent_user_message',
    });

    // 1. PII detection
    const piiResults = shieldScan.pii.found.map(String);
    if (piiResults.length > 0) {
      piiDetected = true;
      violations.push(
        `PII detected in ${guardrailInput.checkType.toLowerCase()}: ${piiResults.join(', ')}`,
      );
    }

    // 2. Prompt injection detection
    const injectionResults = shieldScan.injection;
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
}
