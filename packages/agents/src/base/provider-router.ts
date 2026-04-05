import type { LLMProvider, LLMResponse, MessageContent } from './llm-provider.js';
import { OpenAIProvider } from './providers/openai-provider.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { OllamaProvider } from './providers/ollama-provider.js';
import { DeepSeekProvider } from './providers/deepseek-provider.js';
import { OpenRouterProvider } from './providers/openrouter-provider.js';
import { GeminiProvider } from './providers/gemini-provider.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Tier 1 = cheap/fast workers, Tier 2 = balanced, Tier 3 = premium (Commander/Planner/Verifier) */
export type ProviderTier = 1 | 2 | 3;

/** Controls how the router orders available providers */
export type RoutingStrategy = 'cost_optimized' | 'quality_first' | 'local_first';

// ─── Provider detection helpers ─────────────────────────────────────────────

interface AvailableProviders {
  ollama: boolean;
  deepseek: boolean;
  openrouter: boolean;
  gemini: boolean;
  openai: boolean;
  anthropic: boolean;
}

function detectAvailableProviders(): AvailableProviders {
  return {
    ollama: !!process.env['OLLAMA_URL'] || !!process.env['OLLAMA_MODEL'],
    deepseek: !!process.env['DEEPSEEK_API_KEY'],
    openrouter: !!process.env['OPENROUTER_API_KEY'],
    gemini: !!process.env['GEMINI_API_KEY'],
    openai: !!process.env['OPENAI_API_KEY'],
    anthropic: !!process.env['ANTHROPIC_API_KEY'],
  };
}

function getRoutingStrategy(): RoutingStrategy {
  const env = (process.env['LLM_ROUTING_STRATEGY'] ?? '').toLowerCase();
  if (env === 'quality_first') return 'quality_first';
  if (env === 'local_first') return 'local_first';
  return 'cost_optimized';
}

/**
 * Safely create a provider instance, returning null if construction fails
 * (e.g. missing API key at instantiation time).
 */
function tryCreate(factory: () => LLMProvider): LLMProvider | null {
  try {
    return factory();
  } catch {
    return null;
  }
}

// ─── Tier routing ───────────────────────────────────────────────────────────

/**
 * Get the best available provider for a given tier.
 *
 * Tier 1 (cheap/fast — worker tasks):   Ollama → DeepSeek → OpenRouter
 * Tier 2 (balanced — standard tasks):   OpenAI gpt-4o-mini
 * Tier 3 (premium — Commander/Planner): OpenAI gpt-4o / Anthropic Claude
 *
 * Falls back through adjacent tiers if the preferred tier has no providers.
 */
export function getProviderForTier(tier: ProviderTier): LLMProvider {
  const available = detectAvailableProviders();

  if (tier === 1) {
    // Prefer cheap/local providers
    if (available.ollama) {
      const p = tryCreate(() => new OllamaProvider());
      if (p) return p;
    }
    if (available.deepseek) {
      const p = tryCreate(() => new DeepSeekProvider());
      if (p) return p;
    }
    if (available.openrouter) {
      const p = tryCreate(() => new OpenRouterProvider());
      if (p) return p;
    }
    if (available.gemini) {
      const p = tryCreate(() => new GeminiProvider());
      if (p) return p;
    }
    // Fall through to tier 2
    return getProviderForTier(2);
  }

  if (tier === 2) {
    // Balanced — OpenAI gpt-4o-mini / Gemini Flash
    if (available.openai) {
      const p = tryCreate(() => new OpenAIProvider());
      if (p) return p;
    }
    if (available.gemini) {
      const p = tryCreate(() => new GeminiProvider());
      if (p) return p;
    }
    // Fall through to tier 3 or tier 1
    if (available.anthropic) {
      const p = tryCreate(() => new AnthropicProvider());
      if (p) return p;
    }
    // Try cheap providers as last resort
    if (available.deepseek) {
      const p = tryCreate(() => new DeepSeekProvider());
      if (p) return p;
    }
    if (available.openrouter) {
      const p = tryCreate(() => new OpenRouterProvider());
      if (p) return p;
    }
    if (available.ollama) {
      const p = tryCreate(() => new OllamaProvider());
      if (p) return p;
    }
    // Nothing — return OpenAI which will fail with a helpful error at runtime
    return new OpenAIProvider();
  }

  // Tier 3 — premium (GPT-4o / Claude / Gemini Pro)
  if (available.anthropic) {
    const p = tryCreate(() => new AnthropicProvider());
    if (p) return p;
  }
  if (available.openai) {
    const p = tryCreate(() => new OpenAIProvider());
    if (p) return p;
  }
  if (available.gemini) {
    const p = tryCreate(() => new GeminiProvider());
    if (p) return p;
  }
  // Fall through to tier 2
  return getProviderForTier(2);
}

// ─── Default provider (detects ALL available) ───────────────────────────────

/**
 * Get the default LLM provider based on available API keys and routing strategy.
 * Detects ALL available providers and returns the best one according to strategy.
 */
export function getDefaultProvider(): LLMProvider {
  const available = detectAvailableProviders();
  const strategy = getRoutingStrategy();

  // Build ordered list based on strategy
  type ProviderFactory = { key: keyof AvailableProviders; factory: () => LLMProvider };

  const costOptimized: ProviderFactory[] = [
    { key: 'ollama', factory: () => new OllamaProvider() },
    { key: 'deepseek', factory: () => new DeepSeekProvider() },
    { key: 'openrouter', factory: () => new OpenRouterProvider() },
    { key: 'gemini', factory: () => new GeminiProvider() },
    { key: 'openai', factory: () => new OpenAIProvider() },
    { key: 'anthropic', factory: () => new AnthropicProvider() },
  ];

  const qualityFirst: ProviderFactory[] = [
    { key: 'anthropic', factory: () => new AnthropicProvider() },
    { key: 'openai', factory: () => new OpenAIProvider() },
    { key: 'gemini', factory: () => new GeminiProvider() },
    { key: 'deepseek', factory: () => new DeepSeekProvider() },
    { key: 'openrouter', factory: () => new OpenRouterProvider() },
    { key: 'ollama', factory: () => new OllamaProvider() },
  ];

  const localFirst: ProviderFactory[] = [
    { key: 'ollama', factory: () => new OllamaProvider() },
    { key: 'deepseek', factory: () => new DeepSeekProvider() },
    { key: 'gemini', factory: () => new GeminiProvider() },
    { key: 'openai', factory: () => new OpenAIProvider() },
    { key: 'anthropic', factory: () => new AnthropicProvider() },
    { key: 'openrouter', factory: () => new OpenRouterProvider() },
  ];

  const ordered =
    strategy === 'quality_first' ? qualityFirst :
    strategy === 'local_first' ? localFirst :
    costOptimized;

  for (const entry of ordered) {
    if (available[entry.key]) {
      const p = tryCreate(entry.factory);
      if (p) return p;
    }
  }

  // Default to OpenAI — it will fail at runtime with a helpful error
  return new OpenAIProvider();
}

// ─── Build full failover chain ──────────────────────────────────────────────

/**
 * Build a prioritized list of ALL available providers for the failover chain.
 */
function buildFailoverChain(strategy: RoutingStrategy): LLMProvider[] {
  const available = detectAvailableProviders();

  type ProviderFactory = { key: keyof AvailableProviders; factory: () => LLMProvider };

  const costOptimized: ProviderFactory[] = [
    { key: 'ollama', factory: () => new OllamaProvider() },
    { key: 'deepseek', factory: () => new DeepSeekProvider() },
    { key: 'openrouter', factory: () => new OpenRouterProvider() },
    { key: 'gemini', factory: () => new GeminiProvider() },
    { key: 'openai', factory: () => new OpenAIProvider() },
    { key: 'anthropic', factory: () => new AnthropicProvider() },
  ];

  const qualityFirst: ProviderFactory[] = [
    { key: 'anthropic', factory: () => new AnthropicProvider() },
    { key: 'openai', factory: () => new OpenAIProvider() },
    { key: 'gemini', factory: () => new GeminiProvider() },
    { key: 'deepseek', factory: () => new DeepSeekProvider() },
    { key: 'openrouter', factory: () => new OpenRouterProvider() },
    { key: 'ollama', factory: () => new OllamaProvider() },
  ];

  const localFirst: ProviderFactory[] = [
    { key: 'ollama', factory: () => new OllamaProvider() },
    { key: 'deepseek', factory: () => new DeepSeekProvider() },
    { key: 'gemini', factory: () => new GeminiProvider() },
    { key: 'openai', factory: () => new OpenAIProvider() },
    { key: 'anthropic', factory: () => new AnthropicProvider() },
    { key: 'openrouter', factory: () => new OpenRouterProvider() },
  ];

  const ordered =
    strategy === 'quality_first' ? qualityFirst :
    strategy === 'local_first' ? localFirst :
    costOptimized;

  const chain: LLMProvider[] = [];
  for (const entry of ordered) {
    if (available[entry.key]) {
      const p = tryCreate(entry.factory);
      if (p) chain.push(p);
    }
  }

  return chain;
}

// ─── ProviderRouter ─────────────────────────────────────────────────────────

/**
 * Provider router with full failover chain across ALL available providers.
 * On 429 (rate limit) or 5xx errors, retries with the next provider in the chain.
 * The chain order is determined by LLM_ROUTING_STRATEGY env var.
 */
export class ProviderRouter implements LLMProvider {
  readonly name: string;
  private readonly chain: LLMProvider[];

  constructor(primary?: LLMProvider, fallbacks?: LLMProvider[]) {
    if (primary && fallbacks) {
      // Explicit configuration
      this.chain = [primary, ...fallbacks];
    } else if (primary) {
      // Primary provided, auto-detect fallbacks
      const strategy = getRoutingStrategy();
      const autoChain = buildFailoverChain(strategy);
      // Ensure primary is first, remove duplicates by provider name
      const seen = new Set<string>([primary.name]);
      this.chain = [primary];
      for (const p of autoChain) {
        if (!seen.has(p.name)) {
          seen.add(p.name);
          this.chain.push(p);
        }
      }
    } else {
      // Fully automatic — build the entire chain from env
      const strategy = getRoutingStrategy();
      const autoChain = buildFailoverChain(strategy);
      this.chain = autoChain.length > 0 ? autoChain : [new OpenAIProvider()];
    }

    this.name = `router(${this.chain.map(p => p.name).join('+')})`;
  }

  async chatCompletion(params: {
    messages: Array<{ role: string; content: string | MessageContent[] | unknown }>;
    tools?: unknown[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<LLMResponse> {
    let lastError: unknown;

    for (let i = 0; i < this.chain.length; i++) {
      const provider = this.chain[i]!;
      try {
        return await provider.chatCompletion(params);
      } catch (err) {
        lastError = err;
        // Only failover on retryable errors; throw immediately on auth/client errors
        if (i < this.chain.length - 1 && this.isRetryableError(err)) {
          continue;
        }
        throw err;
      }
    }

    // Should not reach here, but satisfy TypeScript
    throw lastError;
  }

  private isRetryableError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;

    const message = err.message.toLowerCase();

    // Check for rate limit (429) or server errors (5xx)
    if (message.includes('429') || message.includes('rate limit')) return true;
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) return true;
    if (message.includes('internal server error') || message.includes('service unavailable')) return true;
    if (message.includes('overloaded') || message.includes('capacity')) return true;

    // Check status property if available
    const errWithStatus = err as { status?: number };
    if (errWithStatus.status) {
      return errWithStatus.status === 429 || errWithStatus.status >= 500;
    }

    return false;
  }
}
