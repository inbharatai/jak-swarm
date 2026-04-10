/**
 * JAK Swarm Verification & Risk Intelligence Engine — Core Types
 *
 * These types define the contract between the verification engine and
 * all consumers (tools, agents, guardrails, UI).
 */

// ─── Request Types ──────────────────────────────────────────────────────────

export type VerificationType = 'DOCUMENT' | 'EMAIL' | 'TRANSACTION' | 'IDENTITY' | 'CROSS_VERIFY';

export interface VerificationRequest {
  /** What type of verification to perform */
  type: VerificationType;

  /** The primary content to verify (text, base64 for binary) */
  content: string;

  /** MIME type of the content */
  contentType: string;

  /** Additional metadata (headers, file properties, sender info, etc.) */
  metadata?: Record<string, unknown>;

  /** For CROSS_VERIFY: related items to correlate across */
  relatedItems?: Array<{
    type: VerificationType;
    content: string;
    contentType: string;
    metadata?: Record<string, unknown>;
  }>;

  /** Tenant context */
  tenantId: string;
  userId: string;
  workflowId?: string;

  /** Cost/analysis controls */
  maxModelTier?: 1 | 2 | 3;
  forceDeepAnalysis?: boolean;
  skipRuleIds?: string[];
}

// ─── Result Types ───────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FindingSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type FindingSource = 'RULE' | 'AI_TIER1' | 'AI_TIER2' | 'AI_TIER3' | 'CROSS_REF';
export type RecommendedAction = 'ALLOW' | 'FLAG' | 'REVIEW' | 'BLOCK' | 'ESCALATE';

export interface RiskScore {
  /** Numeric score 0-100 (0 = safe, 100 = certain fraud/threat) */
  score: number;

  /** Categorical risk level derived from score */
  level: RiskLevel;

  /** Confidence in the assessment (0.0 - 1.0) */
  confidence: number;
}

export interface Finding {
  /** Unique finding ID */
  id: string;

  /** Category of the finding */
  category: string;

  /** How severe is this finding? */
  severity: FindingSeverity;

  /** Human-readable title */
  title: string;

  /** Detailed explanation */
  description: string;

  /** What specific evidence was found */
  evidence: string;

  /** Where this finding came from (rule, AI tier, cross-ref) */
  source: FindingSource;

  /** Rule ID if from rule engine */
  ruleId?: string;
}

export interface RecommendedActionItem {
  /** What action to take */
  type: RecommendedAction;

  /** Why this action is recommended */
  reason: string;

  /** For REVIEW: who should review */
  assignTo?: string;

  /** Priority (1 = highest) */
  priority: number;
}

export interface VerificationAudit {
  /** Unique request ID */
  requestId: string;

  /** Which analyzers were invoked */
  analyzersRun: string[];

  /** Which models were used and their costs */
  modelsUsed: Array<{
    provider: string;
    model: string;
    tier: number;
    tokenCount: number;
    costUsd: number;
  }>;

  /** Total cost of this verification */
  totalCostUsd: number;

  /** How long it took */
  durationMs: number;

  /** When this verification was performed */
  timestamp: string;

  /** Which layers were activated (1=rules, 2=AI tier1, 3=AI tier3, 4=human) */
  layersActivated: number[];
}

export interface VerificationResult {
  /** Overall risk assessment */
  risk: RiskScore;

  /** Individual findings */
  findings: Finding[];

  /** Recommended actions */
  actions: RecommendedActionItem[];

  /** Full audit trail */
  audit: VerificationAudit;

  /** Summary for UI display */
  summary: string;
}

// ─── Rule Engine Types ──────────────────────────────────────────────────────

export interface Rule {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: FindingSeverity;
  /** Returns findings if the rule triggers, empty array if clean */
  check: (content: string, metadata?: Record<string, unknown>) => Finding[];
}

// ─── Analyzer Interface ─────────────────────────────────────────────────────

export interface Analyzer {
  name: string;
  type: VerificationType;
  analyze: (request: VerificationRequest) => Promise<{
    findings: Finding[];
    riskContribution: number; // 0-100 contribution to overall score
    confidence: number;
  }>;
}
