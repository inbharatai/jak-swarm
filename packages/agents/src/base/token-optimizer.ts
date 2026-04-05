/**
 * Token optimization utilities for cost-efficient LLM usage.
 * Includes token estimation, context compression, and model selection.
 */

import { getModelPricing } from '@jak-swarm/shared';

// ─── Token estimation ─────────────────────────────────────────────────────────

/**
 * Estimate token count without calling a tokenizer.
 *
 * Heuristics:
 *   - English prose: ~4 characters per token
 *   - Code: ~2.5 characters per token (more symbols, short identifiers)
 *   - Mixed content: ~3.5 characters per token
 *
 * This intentionally over-estimates slightly to avoid budget overruns.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  // Detect if content is mostly code by checking for common code indicators
  const codeIndicators = [
    /[{}();]/g,        // Braces, parens, semicolons
    /\b(?:function|const|let|var|class|import|export|return|if|else|for|while)\b/g,
    /[=<>!]+/g,        // Operators
    /\/\//g,           // Comments
  ];

  let codeScore = 0;
  for (const pattern of codeIndicators) {
    const matches = text.match(pattern);
    codeScore += matches ? matches.length : 0;
  }

  // Ratio of code tokens to total length
  const codeRatio = Math.min(codeScore / (text.length / 20), 1);

  // Blend between prose rate (4 chars/token) and code rate (2.5 chars/token)
  const charsPerToken = 4 - codeRatio * 1.5; // 4 for pure prose, 2.5 for pure code

  // Count whitespace-separated words as a floor estimate (tokens >= words for English)
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;

  // Character-based estimate
  const charEstimate = Math.ceil(text.length / charsPerToken);

  // Return the higher of word count and char estimate, plus a small buffer
  return Math.max(wordCount, charEstimate) + 5;
}

// ─── Context compression ──────────────────────────────────────────────────────

/**
 * Compress conversation history to fit within a token budget.
 *
 * Strategy:
 *   1. Always keep the system message(s) and the last user message intact
 *   2. Keep the last assistant message intact (for continuity)
 *   3. Summarize/truncate middle messages from oldest to newest
 *   4. Drop tool results first (they are bulkiest and least reusable)
 */
export function compressContext(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
): Array<{ role: string; content: string }> {
  if (messages.length === 0) return [];

  // Calculate current total
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (totalTokens <= maxTokens) return messages;

  // Separate protected messages from compressible ones
  const systemMessages: Array<{ role: string; content: string }> = [];
  const conversationMessages: Array<{ role: string; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push(msg);
    } else {
      conversationMessages.push(msg);
    }
  }

  // Always protect: system messages + last user message + last assistant message
  const protectedTail: Array<{ role: string; content: string }> = [];

  // Walk backward to find last user and last assistant messages
  let lastUserIdx = -1;
  let lastAssistantIdx = -1;
  for (let i = conversationMessages.length - 1; i >= 0; i--) {
    if (conversationMessages[i]!.role === 'user' && lastUserIdx === -1) {
      lastUserIdx = i;
    }
    if (conversationMessages[i]!.role === 'assistant' && lastAssistantIdx === -1) {
      lastAssistantIdx = i;
    }
    if (lastUserIdx !== -1 && lastAssistantIdx !== -1) break;
  }

  // Protect from the earlier of the two indices onward
  const protectFrom = Math.min(
    lastUserIdx === -1 ? conversationMessages.length : lastUserIdx,
    lastAssistantIdx === -1 ? conversationMessages.length : lastAssistantIdx,
  );

  for (let i = protectFrom; i < conversationMessages.length; i++) {
    protectedTail.push(conversationMessages[i]!);
  }

  const compressibleMessages = conversationMessages.slice(0, protectFrom);

  // Calculate budget for compressible section
  const systemTokens = systemMessages.reduce((s, m) => s + estimateTokens(m.content), 0);
  const tailTokens = protectedTail.reduce((s, m) => s + estimateTokens(m.content), 0);
  let remainingBudget = maxTokens - systemTokens - tailTokens;

  if (remainingBudget <= 0) {
    // Not even enough for system + tail; truncate system messages
    return [...systemMessages, ...protectedTail];
  }

  // Phase 1: Drop tool messages first (they are bulkiest)
  let compressed = compressibleMessages.filter((m) => {
    if (m.role === 'tool') {
      return false; // drop tool results first
    }
    return true;
  });

  // Phase 2: If still over budget, summarize old messages
  let compressedTokens = compressed.reduce((s, m) => s + estimateTokens(m.content), 0);

  if (compressedTokens > remainingBudget && compressed.length > 0) {
    // Summarize older messages into a single context message
    const oldMessages = compressed.slice(0, -1);
    const recentMessage = compressed[compressed.length - 1];

    if (oldMessages.length > 0) {
      const summaryParts: string[] = [];
      for (const msg of oldMessages) {
        const truncated =
          msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content;
        summaryParts.push(`[${msg.role}]: ${truncated}`);
      }

      const summaryText = `[Earlier conversation summary]\n${summaryParts.join('\n')}`;
      const summaryTokens = estimateTokens(summaryText);

      if (summaryTokens < remainingBudget) {
        compressed = [{ role: 'user', content: summaryText }];
        if (recentMessage) {
          compressed.push(recentMessage);
        }
      } else {
        // Even summary is too long; just keep the most recent compressible message
        compressed = recentMessage ? [recentMessage] : [];
      }
    }
  }

  // Phase 3: If a single message is still too long, hard-truncate it
  const finalCompressed: Array<{ role: string; content: string }> = [];
  remainingBudget = maxTokens - systemTokens - tailTokens;

  for (const msg of compressed) {
    const msgTokens = estimateTokens(msg.content);
    if (msgTokens <= remainingBudget) {
      finalCompressed.push(msg);
      remainingBudget -= msgTokens;
    } else if (remainingBudget > 50) {
      // Truncate to fit
      const charBudget = remainingBudget * 3; // conservative chars per token
      finalCompressed.push({
        role: msg.role,
        content: msg.content.slice(0, charBudget) + '\n[...truncated]',
      });
      remainingBudget = 0;
    }
  }

  return [...systemMessages, ...finalCompressed, ...protectedTail];
}

// ─── Model selection ──────────────────────────────────────────────────────────

interface ModelSelection {
  model: string;
  provider: string;
  estimatedCostPer1KTokens: number;
}

/**
 * Model candidates ranked by cost (cheapest first) within each complexity tier.
 */
const MODEL_TIERS: Record<string, Array<{ model: string; provider: string }>> = {
  simple: [
    { model: 'llama3.1', provider: 'ollama' },
    { model: 'meta-llama/llama-3.1-8b-instruct', provider: 'openrouter' },
    { model: 'gpt-4o-mini', provider: 'openai' },
    { model: 'claude-3-5-haiku-20241022', provider: 'anthropic' },
    { model: 'deepseek-chat', provider: 'deepseek' },
  ],
  medium: [
    { model: 'deepseek-chat', provider: 'deepseek' },
    { model: 'llama3.1', provider: 'ollama' },
    { model: 'meta-llama/llama-3.1-70b-instruct', provider: 'openrouter' },
    { model: 'gpt-4o-mini', provider: 'openai' },
    { model: 'claude-3-5-haiku-20241022', provider: 'anthropic' },
    { model: 'gpt-4o', provider: 'openai' },
  ],
  complex: [
    { model: 'deepseek-chat', provider: 'deepseek' },
    { model: 'gpt-4o', provider: 'openai' },
    { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
    { model: 'gpt-4-turbo', provider: 'openai' },
    { model: 'claude-opus-4-20250514', provider: 'anthropic' },
  ],
  reasoning: [
    { model: 'deepseek-reasoner', provider: 'deepseek' },
    { model: 'o3-mini', provider: 'openai' },
    { model: 'o1-mini', provider: 'openai' },
    { model: 'o1', provider: 'openai' },
    { model: 'claude-opus-4-20250514', provider: 'anthropic' },
  ],
};

/**
 * Select the cheapest model that can handle a task based on complexity.
 *
 * @param taskComplexity - How complex the task is
 * @param availableProviders - Which providers are available (e.g., ['openai', 'ollama'])
 * @param maxBudgetUsd - Optional maximum budget per 1K tokens
 * @returns The selected model, provider, and estimated cost
 */
export function selectModel(
  taskComplexity: 'simple' | 'medium' | 'complex' | 'reasoning',
  availableProviders: string[],
  maxBudgetUsd?: number,
): ModelSelection {
  const candidates = MODEL_TIERS[taskComplexity] ?? MODEL_TIERS['medium']!;

  for (const candidate of candidates) {
    // Check if the provider is available
    if (!availableProviders.includes(candidate.provider)) continue;

    const pricing = getModelPricing(candidate.model);

    // Estimate cost per 1K tokens (assume 50/50 input/output split)
    const costPer1K =
      (500 * pricing.inputPer1M + 500 * pricing.outputPer1M) / 1_000_000;

    // Check budget constraint
    if (maxBudgetUsd !== undefined && costPer1K > maxBudgetUsd) continue;

    return {
      model: candidate.model,
      provider: candidate.provider,
      estimatedCostPer1KTokens: Math.round(costPer1K * 1_000_000) / 1_000_000,
    };
  }

  // Fallback: if nothing matches, try any free model from available providers
  if (availableProviders.includes('ollama')) {
    return {
      model: 'llama3.1',
      provider: 'ollama',
      estimatedCostPer1KTokens: 0,
    };
  }

  // Last resort: return the first candidate regardless of provider availability
  const fallback = candidates[0]!;
  const pricing = getModelPricing(fallback.model);
  const costPer1K = (500 * pricing.inputPer1M + 500 * pricing.outputPer1M) / 1_000_000;

  return {
    model: fallback.model,
    provider: fallback.provider,
    estimatedCostPer1KTokens: Math.round(costPer1K * 1_000_000) / 1_000_000,
  };
}
