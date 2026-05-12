interface ProviderHealth {
  provider: string;
  status: 'healthy' | 'degraded' | 'down';
  healthScore: number;
  avgLatencyMs: number;
  lastCheckAt: string;
  lastError?: string;
  consecutiveFailures: number;
}

const healthState = new Map<string, ProviderHealth>();
let healthInterval: ReturnType<typeof setInterval> | null = null;

const OPENAI_PROVIDER = {
  name: 'openai',
  url: 'https://api.openai.com/v1/models',
  keyEnv: 'OPENAI_API_KEY',
  authHeader: (key: string) => `Bearer ${key}`,
};

async function checkProvider(): Promise<ProviderHealth> {
  const existing = healthState.get(OPENAI_PROVIDER.name) ?? {
    provider: OPENAI_PROVIDER.name,
    status: 'healthy' as const,
    healthScore: 100,
    avgLatencyMs: 0,
    lastCheckAt: new Date().toISOString(),
    consecutiveFailures: 0,
  };

  const apiKey = process.env[OPENAI_PROVIDER.keyEnv];
  if (!apiKey) {
    return {
      ...existing,
      status: 'down',
      healthScore: 0,
      lastError: 'OPENAI_API_KEY not configured',
      lastCheckAt: new Date().toISOString(),
    };
  }

  const start = Date.now();
  try {
    const response = await fetch(OPENAI_PROVIDER.url, {
      method: 'GET',
      headers: {
        'User-Agent': 'JAK-Swarm-HealthCheck',
        Authorization: OPENAI_PROVIDER.authHeader(apiKey),
      },
      signal: AbortSignal.timeout(10_000),
    });

    const latencyMs = Date.now() - start;

    if (response.ok) {
      const newScore = Math.min(100, existing.healthScore + 10);
      return {
        provider: OPENAI_PROVIDER.name,
        status: newScore >= 50 ? 'healthy' : 'degraded',
        healthScore: newScore,
        avgLatencyMs: Math.round((existing.avgLatencyMs + latencyMs) / 2),
        lastCheckAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
    }

    const consecutiveFailures = existing.consecutiveFailures + 1;
    const newScore = Math.max(0, existing.healthScore - 20);
    return {
      provider: OPENAI_PROVIDER.name,
      status: newScore >= 50 ? 'degraded' : 'down',
      healthScore: newScore,
      avgLatencyMs: Math.round((existing.avgLatencyMs + latencyMs) / 2),
      lastCheckAt: new Date().toISOString(),
      lastError: `HTTP ${response.status}`,
      consecutiveFailures,
    };
  } catch (err) {
    const consecutiveFailures = existing.consecutiveFailures + 1;
    const newScore = Math.max(0, existing.healthScore - 30);
    return {
      provider: OPENAI_PROVIDER.name,
      status: newScore >= 50 ? 'degraded' : 'down',
      healthScore: newScore,
      avgLatencyMs: existing.avgLatencyMs,
      lastCheckAt: new Date().toISOString(),
      lastError: err instanceof Error ? err.message : String(err),
      consecutiveFailures,
    };
  }
}

export function startProviderHealthChecks(): void {
  if (healthInterval) return;
  void runAllChecks();
  healthInterval = setInterval(() => {
    void runAllChecks();
  }, 60_000);
}

async function runAllChecks(): Promise<void> {
  const result = await checkProvider();
  healthState.set(OPENAI_PROVIDER.name, result);
}

export function stopProviderHealthChecks(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

export function getProviderHealth(provider: string): ProviderHealth | undefined {
  return healthState.get(provider);
}

export function getAllProviderHealth(): ProviderHealth[] {
  return Array.from(healthState.values());
}

export function isProviderAvailable(provider: string): boolean {
  if (provider !== OPENAI_PROVIDER.name) return false;
  const health = healthState.get(provider);
  if (!health) return true;
  return health.status !== 'down';
}
