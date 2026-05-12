import { ToolRiskClass } from '@jak-swarm/shared';
import { detectInjection } from '../guardrails/injection-detector.js';
import { detectOffensiveCyberRequest } from '../guardrails/offensive-cyber-detector.js';
import { detectPII } from '../guardrails/pii-detector.js';
import { classifyToolRisk } from '../tool-risk/risk-classifier.js';
import type {
  ShieldGateway,
  ShieldGatewayStatus,
  ShieldInputScanResult,
  ShieldScanContext,
  ShieldToolCallEvaluation,
  ShieldToolCallEvaluationRequest,
} from './types.js';

const BLOCK_CONFIDENCE = 0.7;

function localToolPolicyRequiresApproval(
  toolName: string,
  riskClass: ToolRiskClass,
  metadata?: ShieldToolCallEvaluationRequest['metadata'],
): boolean {
  if (metadata?.requiresApproval === true) return true;
  if (riskClass === ToolRiskClass.EXTERNAL_SIDE_EFFECT || riskClass === ToolRiskClass.DESTRUCTIVE) return true;
  if (metadata?.sideEffectLevel === 'external' || metadata?.sideEffectLevel === 'destructive') return true;

  const lower = toolName.toLowerCase();
  return (
    /^install[_:-]/.test(lower) ||
    lower.includes('oauth') ||
    lower.includes('credential') ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('publish') ||
    lower.includes('send_') ||
    lower.includes('delete') ||
    lower.includes('destroy') ||
    lower.includes('purge') ||
    lower.includes('refund')
  );
}

export class LocalShieldGateway implements ShieldGateway {
  async scanInput(text: string, context?: ShieldScanContext): Promise<ShieldInputScanResult> {
    const injection = detectInjection(text, context?.isBrowserContent === true);
    const offensiveCyber = detectOffensiveCyberRequest(text);
    const pii = detectPII(text);

    const blockReasons: ShieldInputScanResult['blockReasons'] = [];
    if (injection.detected && injection.risk === 'HIGH' && injection.confidence >= BLOCK_CONFIDENCE) {
      blockReasons.push({
        code: 'prompt_injection',
        confidence: injection.confidence,
        message: `Prompt-injection patterns detected (${injection.patterns.slice(0, 3).join('; ')}).`,
      });
    }
    if (offensiveCyber.detected && offensiveCyber.confidence >= BLOCK_CONFIDENCE) {
      blockReasons.push({
        code: 'offensive_cyber',
        confidence: offensiveCyber.confidence,
        message:
          `Request appears to involve ${offensiveCyber.reason ?? 'offensive cyber behavior'} ` +
          `(category: ${offensiveCyber.category ?? 'unknown'}).`,
      });
    }

    return {
      source: 'local',
      injection,
      offensiveCyber,
      pii,
      blocked: blockReasons.length > 0,
      blockReasons,
    };
  }

  async evaluateToolCall(
    request: ShieldToolCallEvaluationRequest,
  ): Promise<ShieldToolCallEvaluation> {
    const riskClass = classifyToolRisk(request.toolName, request.metadata);
    const requiresApproval = localToolPolicyRequiresApproval(
      request.toolName,
      riskClass,
      request.metadata,
    );

    return {
      source: 'local',
      toolName: request.toolName,
      riskClass,
      requiresApproval,
      reason: requiresApproval
        ? `Tool '${request.toolName}' requires approval before execution.`
        : `Tool '${request.toolName}' is allowed by the embedded local Shield policy.`,
    };
  }

  getStatus(): ShieldGatewayStatus {
    return {
      source: 'local',
      mode: 'embedded-local',
      ready: true,
      notes: [
        'Using existing JAK Swarm embedded detectors and risk classifier.',
        'Standalone JAK Shield can replace this through the ShieldGateway interface without touching callers.',
      ],
    };
  }
}
