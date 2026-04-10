/**
 * Model Router — Smart LLM Escalation for Verification
 *
 * Layer 1: Rules (free, ~10ms) — always runs
 * Layer 2: AI Tier 1 (Gemini Flash / DeepSeek) — $0.001-0.01, ~2s
 * Layer 3: AI Tier 3 (GPT-4.1 / Claude Opus) — $0.05-0.50, ~10s
 * Layer 4: Human review — via ApprovalRequest
 *
 * Escalation triggers:
 * - Rule score 40-80 (ambiguous zone)
 * - Tier 1 confidence < 0.85
 * - Cross-verify type (always needs AI)
 * - forceDeepAnalysis flag
 */

export type EscalationDecision = 'STOP' | 'TIER1' | 'TIER3' | 'HUMAN_REVIEW';

export interface EscalationContext {
  ruleScore: number;
  tier1Confidence?: number;
  tier3Confidence?: number;
  verificationType: string;
  forceDeepAnalysis?: boolean;
  maxModelTier?: 1 | 2 | 3;
  findingCount: number;
  hasCriticalFindings: boolean;
}

/**
 * Decide whether to escalate to the next analysis tier.
 */
export function shouldEscalate(ctx: EscalationContext): EscalationDecision {
  const maxTier = ctx.maxModelTier ?? 3;

  // If rules already caught something definitive (score >= 80), stop
  if (ctx.ruleScore >= 80 && ctx.hasCriticalFindings) {
    return 'STOP';
  }

  // If rules found nothing and type is simple, minimal AI needed
  if (ctx.ruleScore === 0 && ctx.verificationType !== 'CROSS_VERIFY' && !ctx.forceDeepAnalysis) {
    // Still run Tier 1 for basic AI classification
    if (ctx.tier1Confidence === undefined && maxTier >= 1) {
      return 'TIER1';
    }
    // If Tier 1 is confident enough, stop
    if (ctx.tier1Confidence !== undefined && ctx.tier1Confidence >= 0.85) {
      return 'STOP';
    }
  }

  // Ambiguous zone: rule score 20-80, need AI analysis
  if (ctx.ruleScore > 0 && ctx.ruleScore < 80) {
    if (ctx.tier1Confidence === undefined && maxTier >= 1) {
      return 'TIER1';
    }
    if (ctx.tier1Confidence !== undefined && ctx.tier1Confidence < 0.85 && maxTier >= 3) {
      return 'TIER3';
    }
  }

  // Cross-verify always needs at least Tier 1
  if (ctx.verificationType === 'CROSS_VERIFY') {
    if (ctx.tier1Confidence === undefined && maxTier >= 1) {
      return 'TIER1';
    }
    if (ctx.tier1Confidence !== undefined && ctx.tier1Confidence < 0.75 && maxTier >= 3) {
      return 'TIER3';
    }
  }

  // Force deep analysis
  if (ctx.forceDeepAnalysis && ctx.tier3Confidence === undefined && maxTier >= 3) {
    return 'TIER3';
  }

  // If we've run Tier 1 but haven't run Tier 3, and results are unclear
  if (ctx.tier1Confidence !== undefined && ctx.tier1Confidence < 0.70) {
    if (ctx.tier3Confidence === undefined && maxTier >= 3) {
      return 'TIER3';
    }
    // If even Tier 3 is unsure, escalate to human
    if (ctx.tier3Confidence !== undefined && ctx.tier3Confidence < 0.70) {
      return 'HUMAN_REVIEW';
    }
  }

  return 'STOP';
}

/**
 * Select the best model for a given tier and task.
 */
export function selectModel(tier: 1 | 2 | 3, taskType: string): { provider: string; model: string } {
  if (tier === 1) {
    // Cheapest: fast classification
    return { provider: 'gemini', model: 'gemini-2.5-flash' };
  }

  if (tier === 3) {
    // Premium: deep analysis
    if (taskType === 'DOCUMENT' || taskType === 'IMAGE_ANALYSIS') {
      return { provider: 'openai', model: 'gpt-4.1' }; // Best for multimodal
    }
    if (taskType === 'CROSS_VERIFY' || taskType === 'LONG_CONTEXT') {
      return { provider: 'anthropic', model: 'claude-opus-4-20250514' }; // Best for long-context reasoning
    }
    return { provider: 'openai', model: 'gpt-4.1' }; // Default premium
  }

  // Tier 2 fallback
  return { provider: 'openai', model: 'gpt-4o-mini' };
}
