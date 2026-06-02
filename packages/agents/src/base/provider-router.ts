import type { LLMProvider, LLMResponse, MessageContent } from './llm-provider.js';
import { OpenAIProvider } from './providers/openai-provider.js';
import { GeminiProvider } from './providers/gemini-provider.js';

export type ProviderTier = 1 | 2 | 3;
export type RoutingStrategy = 'openai_only';

export type ProviderErrorKind =
  | 'rate_limit'
  | 'server_error'
  | 'timeout'
  | 'auth_error'
  | 'config_error'
  | 'model_not_found'
  | 'billing_error'
  | 'bad_request'
  | 'unknown';

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

  if (
    (status === 404 && (message.includes('model') || message.includes('deployment') || message.includes('engine'))) ||
    (message.includes('model') && (message.includes('not found') || message.includes('does not exist') || message.includes('not supported')))
  ) {
    return 'model_not_found';
  }

  if (status === 404 || message.includes('404')) return 'config_error';

  if (
    status === 402 ||
    message.includes('credit balance') ||
    message.includes('insufficient_quota') ||
    message.includes('insufficient quota') ||
    message.includes('exceeded your current quota') ||
    message.includes('billing account') ||
    message.includes('payment required') ||
    message.includes('purchase credits') ||
    message.includes('plans & billing') ||
    message.includes('resource_exhausted') ||
    message.includes('quota exceeded')
  ) {
    return 'billing_error';
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

export function shouldFailover(_kind: ProviderErrorKind): boolean {
  return false;
}

export const AGENT_TIER_MAP: Record<string, ProviderTier> = {
  COMMANDER: 3,
  PLANNER: 3,
  ROUTER: 1,
  VERIFIER: 2,
  GUARDRAIL: 1,
  APPROVAL: 1,

  WORKER_APP_ARCHITECT: 3,
  WORKER_APP_GENERATOR: 2,
  WORKER_APP_DEBUGGER: 1,
  WORKER_APP_DEPLOYER: 1,
  WORKER_SCREENSHOT_TO_CODE: 3,

  WORKER_STRATEGIST: 2,
  WORKER_TECHNICAL: 2,
  WORKER_FINANCE: 2,
  WORKER_MARKETING: 2,

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

export const AGENT_MODEL_MAP: Record<string, string> = {};

export function getTierForAgent(role: string): ProviderTier {
  return AGENT_TIER_MAP[role] ?? 2;
}

export function getModelOverride(role: string): string | undefined {
  return AGENT_MODEL_MAP[role];
}

/**
 * Per-tenant provider hints that override the process.env default.
 * Mirrors ProviderHints from runtime/index.ts.
 */
export interface ProviderHints {
  provider?: 'openai' | 'gemini';
  apiKey?: string;
}

export function getProviderForTier(tier: ProviderTier, hints?: ProviderHints): LLMProvider {
  // Per-tenant hints take precedence
  if (hints?.provider === 'gemini') {
    const apiKey = hints.apiKey ?? process.env['GEMINI_API_KEY'];
    if (apiKey) return new GeminiProvider(apiKey, undefined, { tier });
  }
  if (hints?.provider === 'openai') {
    const apiKey = hints.apiKey ?? process.env['OPENAI_API_KEY'];
    if (apiKey) return new OpenAIProvider(apiKey, undefined, { tier });
  }

  const llmProvider = (process.env['LLM_PROVIDER'] ?? 'existing').trim().toLowerCase();
  if (llmProvider === 'gemini' && process.env['GEMINI_API_KEY']) {
    return new GeminiProvider(undefined, undefined, { tier });
  }
  return new OpenAIProvider(undefined, undefined, { tier });
}

export function getDefaultProvider(hints?: ProviderHints): LLMProvider {
  // Per-tenant hints take precedence
  if (hints?.provider === 'gemini') {
    const apiKey = hints.apiKey ?? process.env['GEMINI_API_KEY'];
    if (apiKey) return new GeminiProvider(apiKey);
  }
  if (hints?.provider === 'openai') {
    const apiKey = hints.apiKey ?? process.env['OPENAI_API_KEY'];
    if (apiKey) return new OpenAIProvider(apiKey);
  }

  const llmProvider = (process.env['LLM_PROVIDER'] ?? 'existing').trim().toLowerCase();
  if (llmProvider === 'gemini' && process.env['GEMINI_API_KEY']) {
    return new GeminiProvider();
  }
  return new OpenAIProvider();
}

export class ProviderRouter implements LLMProvider {
  readonly name: string;
  private readonly provider: LLMProvider;

  constructor(primary?: LLMProvider, _ignoredProviders?: LLMProvider[]) {
    this.provider = primary ?? new OpenAIProvider();
    this.name = `router(${this.provider.name})`;
  }

  async chatCompletion(params: {
    messages: Array<{ role: string; content: string | MessageContent[] | unknown }>;
    tools?: unknown[];
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
  }): Promise<LLMResponse> {
    try {
      return await this.provider.chatCompletion(params);
    } catch (err) {
      if (err instanceof Error) {
        (err as Error & { providerErrorKind?: ProviderErrorKind }).providerErrorKind = classifyProviderError(err);
      }
      throw err;
    }
  }
}
