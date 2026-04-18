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

/**
 * Classified kind of a provider error. Drives the failover policy below.
 *
 * `auth_error`, `config_error`, `model_not_found`, and `bad_request` are intentionally
 * NOT retryable across providers: bad credentials, malformed requests, and provider-specific
 * model names will not resolve by trying a different provider, and silently failing over
 * on auth errors hides real misconfiguration from operators.
 */
export type ProviderErrorKind =
  | 'rate_limit'
  | 'server_error'
  | 'timeout'
  | 'auth_error'
  | 'config_error'
  | 'model_not_found'
  | 'bad_request'
  | 'unknown';

const FAILOVER_POLICY: Record<ProviderErrorKind, boolean> = {
  rate_limit: true,
  server_error: true,
  timeout: true,
  auth_error: false,
  config_error: false,
  model_not_found: false,
  bad_request: false,
  unknown: false,
};

/** Classify a provider error. Inspects `status` property and message patterns. */
export function classifyProviderError(err: unknown): ProviderErrorKind {
  if (!(err instanceof Error)) return 'unknown';
  const message = err.message.toLowerCase();
  const status = (err as { status?: number }).status;

  if (
    status === 429 ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  ) {
    return 'rate_limit';
  }

  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('etimedout')
  ) {
    return 'timeout';
  }

  if (
    (typeof status === 'number' && status >= 500) ||
    /\b(500|502|503|504)\b/.test(message) ||
    message.includes('internal server error') ||
    message.includes('service unavailable') ||
    message.includes('bad gateway') ||
    message.includes('overloaded') ||
    message.includes('capacity')
  ) {
    return 'server_error';
  }

  if (
    status === 401 ||
    status === 403 ||
    message.includes('401') ||
    message.includes('403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('invalid api key') ||
    message.includes('invalid_api_key') ||
    message.includes('authentication')
  ) {
    return 'auth_error';
  }

  // Model-not-found: a 404 that names a model/deployment, or an explicit "model not found" message.
  if (
    (status === 404 && (message.includes('model') || message.includes('deployment') || message.includes('engine'))) ||
    (message.includes('model') && (message.includes('not found') || message.includes('does not exist') || message.includes('not supported')))
  ) {
    return 'model_not_found';
  }

  // Any other 404 → config error (wrong endpoint / wrong path).
  if (status === 404 || message.includes('404')) {
    return 'config_error';
  }

  if (
    status === 400 ||
    /\b400\b/.test(message) ||
    message.includes('bad request') ||
    message.includes('invalid request')
  ) {
    return 'bad_request';
  }

  return 'unknown';
}

/** Whether the router should try the next provider after receiving this error kind. */
export function shouldFailover(kind: ProviderErrorKind): boolean {
  return FAILOVER_POLICY[kind];
}

// ─── Per-Agent Model Override ───────────────────────────────────────────────

/**
 * Agents can specify which tier and optionally which exact model to use.
 * This is read by BaseAgent when calling the LLM.
 *
 * Usage in an agent constructor:
 *   AGENT_TIER_MAP['WORKER_APP_DEBUGGER'] = 1;  // always use cheap tier
 *   AGENT_MODEL_MAP['WORKER_APP_ARCHITECT'] = 'claude-opus-4-20250514'; // specific model
 */
export const AGENT_TIER_MAP: Record<string, ProviderTier> = {
  // Orchestrators — always premium
  COMMANDER: 3,
  PLANNER: 3,
  VERIFIER: 3,
  GUARDRAIL: 1, // heuristic, no LLM needed
  APPROVAL: 1,

  // Vibe coding — tiered by task cost sensitivity
  WORKER_APP_ARCHITECT: 3,       // Architecture needs best reasoning
  WORKER_APP_GENERATOR: 2,       // Code gen — balanced cost/quality
  WORKER_APP_DEBUGGER: 1,        // Debug loop — high volume, needs speed
  WORKER_APP_DEPLOYER: 1,        // Mostly tool calls
  WORKER_SCREENSHOT_TO_CODE: 3,  // Vision analysis needs best model

  // Executive agents — tier 2 (balanced)
  WORKER_STRATEGIST: 2,
  WORKER_TECHNICAL: 2,
  WORKER_FINANCE: 2,
  WORKER_MARKETING: 2,

  // Core workers — tier 1 (cost-optimized)
  WORKER_EMAIL: 1,
  WORKER_CALENDAR: 1,
  WORKER_CRM: 1,
  WORKER_DOCUMENT: 1,
  WORKER_SPREADSHEET: 1,
  WORKER_BROWSER: 1,
  WORKER_RESEARCH: 2,
  WORKER_KNOWLEDGE: 1,
  WORKER_SUPPORT: 1,
  WORKER_OPS: 1,
  WORKER_VOICE: 1,
  WORKER_CODER: 2,
  WORKER_DESIGNER: 2,
};

/** Optional: force a specific model for an agent role (overrides tier-based selection) */
export const AGENT_MODEL_MAP: Record<string, string> = {
  // Example: WORKER_APP_ARCHITECT: 'claude-opus-4-20250514',
};

/**
 * Get the recommended tier for a given agent role.
 * Falls back to tier 2 if not mapped.
 */
export function getTierForAgent(role: string): ProviderTier {
  return AGENT_TIER_MAP[role] ?? 2;
}

/**
 * Get a specific model override for an agent role, if any.
 */
export function getModelOverride(role: string): string | undefined {
  return AGENT_MODEL_MAP[role];
}

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
        const kind = classifyProviderError(err);
        // Surface the classified kind on the error for downstream telemetry.
        if (err instanceof Error) {
          (err as Error & { providerErrorKind?: ProviderErrorKind }).providerErrorKind = kind;
        }
        if (i < this.chain.length - 1 && shouldFailover(kind)) {
          continue;
        }
        throw err;
      }
    }

    // Should not reach here, but satisfy TypeScript
    throw lastError;
  }
}
