/**
 * LLM provider health monitoring.
 *
 * Pings each configured provider every 60 seconds with a minimal request.
 * Tracks health score (0-100), latency, and error rate.
 * Used by the routing engine to avoid sending traffic to degraded providers.
 */

interface ProviderHealth {
  provider: string;
  status: 'healthy' | 'degraded' | 'down';
  healthScore: number; // 0-100
  avgLatencyMs: number;
  lastCheckAt: string;
  lastError?: string;
  consecutiveFailures: number;
}

const healthState = new Map<string, ProviderHealth>();
let healthInterval: ReturnType<typeof setInterval> | null = null;

const PROVIDERS_TO_CHECK = [
  {
    name: 'openai',
    url: 'https://api.openai.com/v1/models',
    keyEnv: 'OPENAI_API_KEY',
    authHeader: (key: string) => `Bearer ${key}`,
  },
  {
    name: 'anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    keyEnv: 'ANTHROPIC_API_KEY',
    // Anthropic doesn't have a lightweight health endpoint — use /models
    authHeader: (key: string) => key,
    headers: { 'x-api-key': '', 'anthropic-version': '2023-06-01' },
  },
  {
    name: 'google',
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    keyEnv: 'GEMINI_API_KEY',
    authHeader: () => '', // Uses query param
    queryParam: true,
  },
];

async function checkProvider(provider: typeof PROVIDERS_TO_CHECK[number]): Promise<ProviderHealth> {
  const existing = healthState.get(provider.name) ?? {
    provider: provider.name,
    status: 'healthy' as const,
    healthScore: 100,
    avgLatencyMs: 0,
    lastCheckAt: new Date().toISOString(),
    consecutiveFailures: 0,
  };

  const apiKey = process.env[provider.keyEnv];
  if (!apiKey) {
    return { ...existing, status: 'down', healthScore: 0, lastError: 'API key not configured', lastCheckAt: new Date().toISOString() };
  }

  const start = Date.now();
  try {
    let url = provider.url;
    const headers: Record<string, string> = { 'User-Agent': 'JAK-Swarm-HealthCheck' };

    if (provider.queryParam) {
      url = `${url}?key=${apiKey}`;
    } else if (provider.headers) {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = provider.authHeader(apiKey);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    const latencyMs = Date.now() - start;

    if (response.ok || response.status === 405) {
      // 405 is OK for Anthropic — it doesn't support GET on /messages
      const newScore = Math.min(100, existing.healthScore + 10); // Recover gradually
      return {
        provider: provider.name,
        status: newScore >= 50 ? 'healthy' : 'degraded',
        healthScore: newScore,
        avgLatencyMs: Math.round((existing.avgLatencyMs + latencyMs) / 2),
        lastCheckAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
    } else {
      const consecutiveFailures = existing.consecutiveFailures + 1;
      const newScore = Math.max(0, existing.healthScore - 20);
      return {
        provider: provider.name,
        status: newScore >= 50 ? 'degraded' : 'down',
        healthScore: newScore,
        avgLatencyMs: Math.round((existing.avgLatencyMs + latencyMs) / 2),
        lastCheckAt: new Date().toISOString(),
        lastError: `HTTP ${response.status}`,
        consecutiveFailures,
      };
    }
  } catch (err) {
    const consecutiveFailures = existing.consecutiveFailures + 1;
    const newScore = Math.max(0, existing.healthScore - 30);
    return {
      provider: provider.name,
      status: newScore >= 50 ? 'degraded' : 'down',
      healthScore: newScore,
      avgLatencyMs: existing.avgLatencyMs,
      lastCheckAt: new Date().toISOString(),
      lastError: err instanceof Error ? err.message : String(err),
      consecutiveFailures,
    };
  }
}

/**
 * Start periodic health checks (every 60 seconds).
 */
export function startProviderHealthChecks(): void {
  if (healthInterval) return;

  // Initial check
  void runAllChecks();

  healthInterval = setInterval(() => {
    void runAllChecks();
  }, 60_000);
}

async function runAllChecks(): Promise<void> {
  for (const provider of PROVIDERS_TO_CHECK) {
    const result = await checkProvider(provider);
    healthState.set(provider.name, result);
  }
}

/**
 * Stop health checks (for shutdown).
 */
export function stopProviderHealthChecks(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

/**
 * Get health for a specific provider.
 */
export function getProviderHealth(provider: string): ProviderHealth | undefined {
  return healthState.get(provider);
}

/**
 * Get all provider health states.
 */
export function getAllProviderHealth(): ProviderHealth[] {
  return Array.from(healthState.values());
}

/**
 * Check if a provider is available for routing.
 */
export function isProviderAvailable(provider: string): boolean {
  const health = healthState.get(provider);
  if (!health) return true; // Unknown = assume healthy (first check hasn't run yet)
  return health.status !== 'down';
}
