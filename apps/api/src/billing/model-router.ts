export interface ModelCandidate {
  model: string;
  provider: 'openai';
  tier: 1 | 2 | 3;
  costPer1KTokens: number;
}

export const MODELS: Record<string, ModelCandidate> = {
  'gpt-5.4': { model: 'gpt-5.4', provider: 'openai', tier: 1, costPer1KTokens: 0.010 },
  'gpt-5.5': { model: 'gpt-5.5', provider: 'openai', tier: 3, costPer1KTokens: 0.020 },
};

export interface RouteEntry {
  primary: string;
  tier: 1 | 2 | 3;
}

const TIER_MODEL: Record<1 | 2 | 3, string> = {
  1: 'gpt-5.4',
  2: 'gpt-5.4',
  3: 'gpt-5.5',
};

export const ROUTING_TABLE: Record<string, RouteEntry> = {
  chat: { primary: 'gpt-5.4', tier: 1 },
  classification: { primary: 'gpt-5.4', tier: 1 },
  extraction: { primary: 'gpt-5.4', tier: 1 },
  summarization: { primary: 'gpt-5.4', tier: 1 },
  research: { primary: 'gpt-5.4', tier: 2 },
  coding: { primary: 'gpt-5.4', tier: 2 },
  content_writing: { primary: 'gpt-5.4', tier: 2 },
  analysis: { primary: 'gpt-5.4', tier: 2 },
  document_analysis: { primary: 'gpt-5.4', tier: 2 },
  multimodal: { primary: 'gpt-5.4', tier: 2 },
  agent_workflow: { primary: 'gpt-5.4', tier: 2 },
  reasoning: { primary: 'gpt-5.5', tier: 3 },
  strategy: { primary: 'gpt-5.5', tier: 3 },
  legal: { primary: 'gpt-5.5', tier: 3 },
  architecture: { primary: 'gpt-5.5', tier: 3 },
};

const TASK_TYPE_PATTERNS: Array<{ type: string; keywords: RegExp }> = [
  { type: 'coding', keywords: /\b(code|function|debug|refactor|implement|program|script|api|endpoint|bug|test)\b/i },
  { type: 'legal', keywords: /\b(contract|legal|compliance|nda|terms|privacy|gdpr|regulation|clause)\b/i },
  { type: 'strategy', keywords: /\b(strategy|okr|roadmap|vision|competitive|market entry|positioning|swot)\b/i },
  { type: 'architecture', keywords: /\b(architect|system design|scalab|infrastructure|database design|microservice)\b/i },
  { type: 'analysis', keywords: /\b(analy|report|compare|evaluate|assess|audit|review|benchmark)\b/i },
  { type: 'content_writing', keywords: /\b(write|blog|article|copy|content|draft|email sequence|campaign)\b/i },
  { type: 'research', keywords: /\b(research|find|search|look up|investigate|discover)\b/i },
  { type: 'summarization', keywords: /\b(summar|condense|tldr|key points|brief)\b/i },
  { type: 'document_analysis', keywords: /\b(document|pdf|extract from|parse|read file)\b/i },
  { type: 'classification', keywords: /\b(classify|categorize|sort|label|tag|triage)\b/i },
  { type: 'extraction', keywords: /\b(extract|pull out|get the|find all|list all)\b/i },
];

export function detectTaskType(goal: string): string {
  for (const pattern of TASK_TYPE_PATTERNS) {
    if (pattern.keywords.test(goal)) return pattern.type;
  }
  return 'chat';
}

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

function clampTier(value: number): 1 | 2 | 3 {
  if (value >= 3) return 3;
  if (value >= 2) return 2;
  return 1;
}

export function estimateCredits(goal: string, taskType: string, maxModelTier: number): {
  estimatedCredits: number;
  model: string;
  tier: number;
} {
  const inputTokens = Math.ceil(goal.length / 4);
  const multiplier = OUTPUT_MULTIPLIERS[taskType] ?? 2.0;
  const estimatedOutputTokens = Math.ceil(inputTokens * multiplier);
  const totalTokens = inputTokens + estimatedOutputTokens;

  const route = ROUTING_TABLE[taskType] ?? ROUTING_TABLE['chat']!;
  const effectiveTier = clampTier(Math.min(route.tier, maxModelTier));
  const model = MODELS[TIER_MODEL[effectiveTier]]!;
  const costUsd = totalTokens * model.costPer1KTokens / 1000;
  const credits = Math.max(1, Math.ceil(costUsd * 100 * 1.3));

  return { estimatedCredits: credits, model: model.model, tier: model.tier };
}

export interface ModelSelection {
  model: string;
  provider: 'openai';
  tier: number;
  estimatedCredits: number;
}

export function selectModel(goal: string, maxModelTier: number): ModelSelection {
  const taskType = detectTaskType(goal);
  const estimate = estimateCredits(goal, taskType, maxModelTier);
  const primary = MODELS[estimate.model] ?? MODELS['gpt-5.4']!;

  return {
    model: primary.model,
    provider: primary.provider,
    tier: primary.tier,
    estimatedCredits: estimate.estimatedCredits,
  };
}
