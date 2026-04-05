/**
 * Phoring.ai API adapter — connects to an external Phoring instance
 * for forecasting, knowledge graph queries, and consensus validation.
 */

export interface PhoringForecastResult {
  report: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  citations: string[];
  validatorAgreement?: string;
  riskFactors?: string[];
}

export interface PhoringGraphResult {
  entities: Array<{ name: string; type: string; attributes: Record<string, unknown> }>;
  relationships: Array<{ source: string; target: string; type: string }>;
  totalEntities: number;
}

export interface PhoringValidationResult {
  passed: boolean;
  agreement: 'full_consensus' | 'majority' | 'split' | 'dissent';
  scores: Array<{ validator: string; score: number; reasoning: string }>;
  riskFactors: string[];
}

export interface PhoringSimConfig {
  scenario: string;
  agentCount?: number;
  platforms?: ('twitter' | 'reddit')[];
  speedMode?: 'normal' | 'fast' | 'express';
}

export interface PhoringSimResult {
  status: string;
  actions: Array<{ agent: string; action: string; content: string; platform: string }>;
  summary: string;
}

export class PhoringAdapter {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'X-Request-ID': `jak-${Date.now()}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`Phoring API error (${res.status}): ${text.slice(0, 200)}`);
    }

    return res.json();
  }

  async forecast(scenario: string, documents?: string[]): Promise<PhoringForecastResult> {
    const result = await this.request('/api/report/generate', {
      scenario,
      documents,
      format: 'markdown',
    }) as { report?: string; confidence?: string; citations?: string[]; consensus?: unknown };

    return {
      report: (result.report as string) ?? 'No forecast generated.',
      confidence: ((result.confidence as string) ?? 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
      citations: (result.citations as string[]) ?? [],
    };
  }

  async queryGraph(query: string, graphId: string): Promise<PhoringGraphResult> {
    const result = await this.request(`/api/graph/data/${graphId}`, { query }) as {
      entities?: unknown[];
      relationships?: unknown[];
    };

    return {
      entities: (result.entities ?? []) as PhoringGraphResult['entities'],
      relationships: (result.relationships ?? []) as PhoringGraphResult['relationships'],
      totalEntities: (result.entities ?? []).length,
    };
  }

  async validate(content: string, criteria: string[]): Promise<PhoringValidationResult> {
    const result = await this.request('/api/report/chat', {
      message: `Validate the following content against these criteria: ${criteria.join(', ')}\n\nContent:\n${content}`,
      mode: 'validation',
    }) as Record<string, unknown>;

    return {
      passed: (result.passed as boolean) ?? true,
      agreement: ((result.agreement as string) ?? 'majority') as PhoringValidationResult['agreement'],
      scores: (result.scores as PhoringValidationResult['scores']) ?? [],
      riskFactors: (result.riskFactors as string[]) ?? [],
    };
  }

  async simulate(config: PhoringSimConfig): Promise<PhoringSimResult> {
    const result = await this.request('/api/simulation/start', {
      scenario: config.scenario,
      agent_count: config.agentCount ?? 10,
      platforms: config.platforms ?? ['twitter', 'reddit'],
      speed_mode: config.speedMode ?? 'fast',
    }) as Record<string, unknown>;

    return {
      status: (result.status as string) ?? 'completed',
      actions: (result.actions as PhoringSimResult['actions']) ?? [],
      summary: (result.summary as string) ?? 'Simulation completed.',
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/api/health');
      return true;
    } catch {
      return false;
    }
  }
}
