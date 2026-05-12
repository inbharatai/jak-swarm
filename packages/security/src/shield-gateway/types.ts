import type { ToolMetadata, ToolRiskClass } from '@jak-swarm/shared';
import type { InjectionDetectionResult } from '../guardrails/injection-detector.js';
import type { OffensiveDetectionResult } from '../guardrails/offensive-cyber-detector.js';
import type { PIIDetectionResult } from '../guardrails/pii-detector.js';

export type ShieldGatewaySource = 'local' | 'mcp' | 'shadow';

export interface ShieldScanContext {
  tenantId?: string;
  userId?: string;
  workflowId?: string;
  runId?: string;
  source?: 'workflow_goal' | 'agent_user_message' | 'document_ingest' | 'crawler_ingest' | 'tool_input';
  isBrowserContent?: boolean;
}

export interface ShieldBlockReason {
  code: 'prompt_injection' | 'offensive_cyber';
  message: string;
  confidence: number;
}

export interface ShieldInputScanResult {
  source: ShieldGatewaySource;
  injection: InjectionDetectionResult;
  offensiveCyber: OffensiveDetectionResult;
  pii: PIIDetectionResult;
  blocked: boolean;
  blockReasons: ShieldBlockReason[];
}

export interface ShieldToolCallEvaluationRequest {
  toolName: string;
  metadata?: ToolMetadata;
  input?: unknown;
  tenantId?: string;
  userId?: string;
  workflowId?: string;
  runId?: string;
}

export interface ShieldToolCallEvaluation {
  source: ShieldGatewaySource;
  toolName: string;
  riskClass: ToolRiskClass;
  requiresApproval: boolean;
  reason: string;
}

export interface ShieldGatewayStatus {
  source: ShieldGatewaySource;
  mode: 'embedded-local';
  ready: boolean;
  notes: string[];
}

export interface ShieldGateway {
  scanInput(text: string, context?: ShieldScanContext): Promise<ShieldInputScanResult>;
  evaluateToolCall(request: ShieldToolCallEvaluationRequest): Promise<ShieldToolCallEvaluation>;
  getStatus(): ShieldGatewayStatus;
}
