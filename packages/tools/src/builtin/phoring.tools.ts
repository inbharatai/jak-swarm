import type { ToolExecutionContext } from '@jak-swarm/shared';
import { toolRegistry } from '../registry/tool-registry.js';
import { PhoringAdapter } from '../adapters/phoring/phoring.adapter.js';

/**
 * Get Phoring adapter from integration credentials.
 * Returns null if Phoring is not connected.
 */
async function getPhoringAdapter(context: ToolExecutionContext): Promise<PhoringAdapter | null> {
  // Try environment variables first
  const baseUrl = process.env['PHORING_API_URL'];
  const apiKey = process.env['PHORING_API_KEY'];
  if (baseUrl && apiKey) {
    return new PhoringAdapter(baseUrl, apiKey);
  }

  // Try database integration (if db available)
  const db = (context as unknown as Record<string, unknown>).db;
  if (db && context.tenantId) {
    try {
      const prisma = db as { integration: { findFirst: (args: unknown) => Promise<unknown> } };
      const integration = await prisma.integration.findFirst({
        where: { tenantId: context.tenantId, provider: 'PHORING', status: 'CONNECTED' },
        include: { credentials: true },
      }) as { credentials?: { accessTokenEnc: string }; metadata?: { apiUrl?: string } } | null;

      if (integration?.credentials?.accessTokenEnc && integration?.metadata?.apiUrl) {
        return new PhoringAdapter(
          integration.metadata.apiUrl as string,
          integration.credentials.accessTokenEnc, // In production, decrypt this
        );
      }
    } catch { /* DB not available */ }
  }

  return null;
}

export function registerPhoringTools(): void {
  // Tool 1: Forecast
  toolRegistry.register(
    {
      name: 'phoring_forecast',
      description: 'Generate a forecast/prediction report using Phoring.ai. Requires Phoring integration to be connected.',
      category: 'RESEARCH' as any,
      riskClass: 'READ_ONLY' as any,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          scenario: { type: 'string', description: 'The scenario or question to forecast' },
          documents: { type: 'array', items: { type: 'string' }, description: 'Optional supporting documents' },
        },
        required: ['scenario'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { scenario, documents } = input as { scenario: string; documents?: string[] };
      const adapter = await getPhoringAdapter(context);
      if (!adapter) {
        return {
          success: false,
          error: 'Phoring.ai not connected. Add your Phoring API URL and key in Settings > Integrations, or set PHORING_API_URL and PHORING_API_KEY environment variables.',
        };
      }
      try {
        const result = await adapter.forecast(scenario, documents);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: `Phoring forecast failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // Tool 2: Graph Query
  toolRegistry.register(
    {
      name: 'phoring_graph_query',
      description: 'Query Phoring.ai knowledge graph for entities and relationships. Requires Phoring integration.',
      category: 'RESEARCH' as any,
      riskClass: 'READ_ONLY' as any,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for the knowledge graph' },
          graphId: { type: 'string', description: 'The graph/project ID in Phoring' },
        },
        required: ['query', 'graphId'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { query, graphId } = input as { query: string; graphId: string };
      const adapter = await getPhoringAdapter(context);
      if (!adapter) {
        return { success: false, error: 'Phoring.ai not connected. Connect in Settings > Integrations.' };
      }
      try {
        const result = await adapter.queryGraph(query, graphId);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: `Phoring graph query failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // Tool 3: Validate
  toolRegistry.register(
    {
      name: 'phoring_validate',
      description: 'Validate content using Phoring.ai multi-AI consensus. Requires Phoring integration.',
      category: 'RESEARCH' as any,
      riskClass: 'READ_ONLY' as any,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Content to validate' },
          criteria: { type: 'array', items: { type: 'string' }, description: 'Validation criteria' },
        },
        required: ['content', 'criteria'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { content, criteria } = input as { content: string; criteria: string[] };
      const adapter = await getPhoringAdapter(context);
      if (!adapter) {
        return { success: false, error: 'Phoring.ai not connected. Connect in Settings > Integrations.' };
      }
      try {
        const result = await adapter.validate(content, criteria);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: `Phoring validation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // Tool 4: Simulate
  toolRegistry.register(
    {
      name: 'phoring_simulate',
      description: 'Run a multi-agent social simulation via Phoring.ai. Requires Phoring integration.',
      category: 'RESEARCH' as any,
      riskClass: 'READ_ONLY' as any,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          scenario: { type: 'string', description: 'Simulation scenario' },
          agentCount: { type: 'number', description: 'Number of agents (default 10)' },
          platforms: { type: 'array', items: { type: 'string' }, description: 'Platforms: twitter, reddit' },
          speedMode: { type: 'string', description: 'Speed: normal, fast, express' },
        },
        required: ['scenario'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const config = input as { scenario: string; agentCount?: number; platforms?: string[]; speedMode?: string };
      const adapter = await getPhoringAdapter(context);
      if (!adapter) {
        return { success: false, error: 'Phoring.ai not connected. Connect in Settings > Integrations.' };
      }
      try {
        const result = await adapter.simulate({
          scenario: config.scenario,
          agentCount: config.agentCount,
          platforms: config.platforms as ('twitter' | 'reddit')[],
          speedMode: config.speedMode as 'normal' | 'fast' | 'express',
        });
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: `Phoring simulation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );
}
