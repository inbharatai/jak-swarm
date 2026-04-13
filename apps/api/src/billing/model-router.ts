/**
 * Task-aware model routing for Jaak managed AI.
 *
 * Selects the best model for a task based on:
 * - Task type / complexity
 * - User's plan tier (which model tiers they can access)
 * - Remaining credit budget
 * - Provider availability
 *
 * V1: Simple routing table. No ML, no scoring formula.
 * Each task type maps to a primary + fallback model at each tier.
 */

// ─── Model definitions ─────────────────────────────────────────────────────

export interface ModelCandidate {
  model: string;
  provider: 'openai' | 'anthropic' | 'google';
  tier: 1 | 2 | 3;
  /** Approximate cost per 1K tokens (input + output average) */
  costPer1KTokens: number;
}

export const MODELS: Record<string, ModelCandidate> = {
  // Tier 1: Cheap & fast
  'gemini-2.0-flash':          { model: 'gemini-2.0-flash',          provider: 'google',    tier: 1, costPer1KTokens: 0.00025 },
  'gpt-4o-mini':               { model: 'gpt-4o-mini',               provider: 'openai',    tier: 1, costPer1KTokens: 0.000375 },

  // Tier 2: Balanced
  'gpt-4o':                    { model: 'gpt-4o',                    provider: 'openai',    tier: 2, costPer1KTokens: 0.00625 },
  'claude-sonnet-4-20250514':  { model: 'claude-sonnet-4-20250514',  provider: 'anthropic', tier: 2, costPer1KTokens: 0.009 },
  'gemini-2.0-pro':            { model: 'gemini-2.0-pro',            provider: 'google',    tier: 2, costPer1KTokens: 0.005 },

  // Tier 3: Premium
  'claude-opus-4-20250514':    { model: 'claude-opus-4-20250514',    provider: 'anthropic', tier: 3, costPer1KTokens: 0.045 },
};

// ─── Routing table ──────────────────────────────────────────────────────────

export interface RouteEntry {
  primary: string;   // Model ID from MODELS
  fallback: string;  // Fallback model ID
  tier: 1 | 2 | 3;  // Minimum tier required
}

/**
 * Task type → model routing.
 * Each entry specifies the ideal model and a fallback.
 * The tier determines which plan levels can access this route.
 */
export const ROUTING_TABLE: Record<string, RouteEntry> = {
  // Tier 1 tasks (available on all plans)
  'chat':             { primary: 'gemini-2.0-flash',         fallback: 'gpt-4o-mini',               tier: 1 },
  'classification':   { primary: 'gpt-4o-mini',              fallback: 'gemini-2.0-flash',           tier: 1 },
  'extraction':       { primary: 'gpt-4o-mini',              fallback: 'gemini-2.0-flash',           tier: 1 },
  'summarization':    { primary: 'gemini-2.0-flash',         fallback: 'gpt-4o-mini',               tier: 1 },
  'research':         { primary: 'gpt-4o-mini',              fallback: 'gemini-2.0-flash',           tier: 1 },

  // Tier 2 tasks (Pro and above)
  'coding':           { primary: 'claude-sonnet-4-20250514', fallback: 'gpt-4o',                    tier: 2 },
  'content_writing':  { primary: 'claude-sonnet-4-20250514', fallback: 'gpt-4o',                    tier: 2 },
  'analysis':         { primary: 'gpt-4o',                   fallback: 'claude-sonnet-4-20250514',  tier: 2 },
  'document_analysis':{ primary: 'gemini-2.0-pro',           fallback: 'claude-sonnet-4-20250514',  tier: 2 },
  'multimodal':       { primary: 'gpt-4o',                   fallback: 'gemini-2.0-pro',            tier: 2 },
  'agent_workflow':   { primary: 'gpt-4o',                   fallback: 'claude-sonnet-4-20250514',  tier: 2 },

  // Tier 3 tasks (Pro with premium credits, Team, Enterprise)
  'reasoning':        { primary: 'claude-opus-4-20250514',   fallback: 'gpt-4o',                    tier: 3 },
  'strategy':         { primary: 'claude-opus-4-20250514',   fallback: 'gpt-4o',                    tier: 3 },
  'legal':            { primary: 'claude-opus-4-20250514',   fallback: 'gpt-4o',                    tier: 3 },
  'architecture':     { primary: 'claude-opus-4-20250514',   fallback: 'gpt-4o',                    tier: 3 },
};

// ─── Task type detection ────────────────────────────────────────────────────

const TASK_TYPE_PATTERNS: Array<{ type: string; keywords: RegExp }> = [
  { type: 'coding',           keywords: /\b(code|function|debug|refactor|implement|program|script|api|endpoint|bug|test)\b/i },
  { type: 'legal',            keywords: /\b(contract|legal|compliance|nda|terms|privacy|gdpr|regulation|clause)\b/i },
  { type: 'strategy',         keywords: /\b(strategy|okr|roadmap|vision|competitive|market entry|positioning|swot)\b/i },
  { type: 'architecture',     keywords: /\b(architect|system design|scalab|infrastructure|database design|microservice)\b/i },
  { type: 'analysis',         keywords: /\b(analy|report|compare|evaluate|assess|audit|review|benchmark)\b/i },
  { type: 'content_writing',  keywords: /\b(write|blog|article|copy|content|draft|email sequence|campaign)\b/i },
  { type: 'research',         keywords: /\b(research|find|search|look up|investigate|discover)\b/i },
  { type: 'summarization',    keywords: /\b(summar|condense|tldr|key points|brief)\b/i },
  { type: 'document_analysis',keywords: /\b(document|pdf|extract from|parse|read file)\b/i },
  { type: 'classification',   keywords: /\b(classify|categorize|sort|label|tag|triage)\b/i },
  { type: 'extraction',       keywords: /\b(extract|pull out|get the|find all|list all)\b/i },
];

export function detectTaskType(goal: string): string {
  for (const pattern of TASK_TYPE_PATTERNS) {
    if (pattern.keywords.test(goal)) {
      return pattern.type;
    }
  }
  return 'chat'; // Default to cheapest
}

// ─── Credit estimation ──────────────────────────────────────────────────────

/** Rough token multipliers by task type (output tokens / input tokens) */
const OUTPUT_MULTIPLIERS: Record<string, number> = {
  chat: 1.5,
  classification: 0.5,
  extraction: 1.0,
  summarization: 0.5,
  research: 2.0,
  coding: 3.0,
  content_writing: 3.0,
  analysis: 2.0,
  document_analysis: 1.5,
  multimodal: 2.0,
  agent_workflow: 5.0,
  reasoning: 3.0,
  strategy: 3.0,
  legal: 2.5,
  architecture: 3.0,
};

/**
 * Estimate credits for a task before execution.
 * Returns conservative estimate (includes 30% buffer).
 */
export function estimateCredits(goal: string, taskType: string, maxModelTier: number): {
  estimatedCredits: number;
  model: string;
  tier: number;
} {
  // Approximate input tokens (4 chars per token)
  const inputTokens = Math.ceil(goal.length / 4);
  const multiplier = OUTPUT_MULTIPLIERS[taskType] ?? 2.0;
  const estimatedOutputTokens = Math.ceil(inputTokens * multiplier);
  const totalTokens = inputTokens + estimatedOutputTokens;

  // Get the route for this task type, capped by user's tier
  const route = ROUTING_TABLE[taskType] ?? ROUTING_TABLE['chat']!;
  const effectiveTier = Math.min(route.tier, maxModelTier);

  // Pick model at the effective tier
  let modelId = route.primary;
  const modelInfo = MODELS[modelId];
  if (modelInfo && modelInfo.tier > effectiveTier) {
    // Downgrade to fallback or cheapest available
    modelId = route.fallback;
    const fallbackInfo = MODELS[modelId];
    if (fallbackInfo && fallbackInfo.tier > effectiveTier) {
      // Even fallback is too premium — use cheapest
      modelId = 'gemini-2.0-flash';
    }
  }

  const model = MODELS[modelId] ?? MODELS['gemini-2.0-flash']!;
  const costUsd = totalTokens * model.costPer1KTokens / 1000;
  const credits = Math.max(1, Math.ceil(costUsd * 100 * 1.3)); // $0.01 per credit, 30% buffer

  return { estimatedCredits: credits, model: model.model, tier: model.tier };
}

// ─── Model selection ────────────────────────────────────────────────────────

export interface ModelSelection {
  model: string;
  provider: string;
  tier: number;
  estimatedCredits: number;
  fallback?: { model: string; provider: string };
}

/**
 * Select the best model for a task within the user's plan constraints.
 */
export function selectModel(goal: string, maxModelTier: number): ModelSelection {
  const taskType = detectTaskType(goal);
  const estimate = estimateCredits(goal, taskType, maxModelTier);

  const route = ROUTING_TABLE[taskType] ?? ROUTING_TABLE['chat']!;
  const primary = MODELS[estimate.model] ?? MODELS['gemini-2.0-flash']!;

  // Determine fallback
  let fallback: { model: string; provider: string } | undefined;
  const fallbackModel = MODELS[route.fallback];
  if (fallbackModel && fallbackModel.tier <= maxModelTier && fallbackModel.model !== primary.model) {
    fallback = { model: fallbackModel.model, provider: fallbackModel.provider };
  }

  return {
    model: primary.model,
    provider: primary.provider,
    tier: primary.tier,
    estimatedCredits: estimate.estimatedCredits,
    fallback,
  };
}
