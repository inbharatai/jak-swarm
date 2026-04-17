import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { mcpClientManager, MCP_PROVIDERS } from '@jak-swarm/tools';
import { encrypt as encryptCredentials } from '../utils/crypto.js';
import { ok, err } from '../types.js';

type IntegrationMaturity = 'production-ready' | 'beta' | 'partial' | 'placeholder';

const INTEGRATION_MATURITY: Record<string, { maturity: IntegrationMaturity; note: string }> = {
  // ── Anthropic-published MCP servers ──
  SLACK: {
    maturity: 'production-ready',
    note: 'MCP-backed, webhook-verified in API runtime. Anthropic-published package.',
  },
  GITHUB: {
    maturity: 'beta',
    note: 'MCP-backed tools via Anthropic package. Reliability depends on GitHub API and MCP server availability.',
  },
  FILESYSTEM: {
    maturity: 'beta',
    note: 'Anthropic-published MCP server. Sandboxed to configured directories.',
  },
  FETCH: {
    maturity: 'beta',
    note: 'Anthropic-published MCP server for HTTP fetching.',
  },
  MEMORY: {
    maturity: 'beta',
    note: 'Anthropic-published MCP server for knowledge graph memory.',
  },
  PUPPETEER: {
    maturity: 'beta',
    note: 'Anthropic-published MCP server. Requires headless Chrome.',
  },
  POSTGRES: {
    maturity: 'beta',
    note: 'Anthropic-published MCP server. Read-only by default for safety.',
  },
  BRAVE_SEARCH: {
    maturity: 'beta',
    note: 'Anthropic-published MCP server. Requires Brave Search API key.',
  },
  SEQUENTIAL_THINKING: {
    maturity: 'beta',
    note: 'Anthropic-published experimental reasoning server.',
  },
  // ── Official vendor MCP servers ──
  NOTION: {
    maturity: 'beta',
    note: 'Official Notion MCP server. Coverage depends on provider implementation.',
  },
  HUBSPOT: {
    maturity: 'beta',
    note: 'Official HubSpot MCP server. Comprehensive CRM tool coverage.',
  },
  STRIPE: {
    maturity: 'beta',
    note: 'Official Stripe MCP server. Payment/subscription management tools.',
  },
  SALESFORCE: {
    maturity: 'partial',
    note: 'Official Salesforce MCP server. Adapter depth varies; verify per-tenant before production.',
  },
  LINEAR: {
    maturity: 'beta',
    note: 'Official Linear MCP server. Issue/project management tools.',
  },
  SUPABASE: {
    maturity: 'beta',
    note: 'Official Supabase MCP server. Database and auth management tools.',
  },
  SENTRY: {
    maturity: 'beta',
    note: 'Official Sentry MCP server. Error tracking and project management.',
  },
  // ── Community-maintained MCP servers ──
  AIRTABLE: {
    maturity: 'partial',
    note: 'Community-maintained MCP server. Functional but not officially supported.',
  },
  DISCORD: {
    maturity: 'partial',
    note: 'Community-maintained MCP server. Functional but not officially supported.',
  },
  CLICKUP: {
    maturity: 'partial',
    note: 'Community-maintained MCP server. Functional but not officially supported.',
  },
  SENDGRID: {
    maturity: 'partial',
    note: 'Community-maintained MCP server. Functional but not officially supported.',
  },
};

function getIntegrationMaturity(providerUpper: string): { maturity: IntegrationMaturity; note: string } {
  return INTEGRATION_MATURITY[providerUpper] ?? {
    maturity: 'partial',
    note: 'Provider available via MCP configuration; production readiness depends on provider-specific adapter depth.',
  };
}

export async function integrationRoutes(app: FastifyInstance) {
  // List connected integrations for tenant
  app.get('/integrations', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user;
    const integrations = await app.db.integration.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(ok(
      integrations.map((integration) => ({
        ...integration,
        ...getIntegrationMaturity(integration.provider),
      })),
    ));
  });

  // Get provider setup info (credential fields, instructions)
  app.get('/integrations/providers/:provider', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const providerDef = MCP_PROVIDERS[provider.toUpperCase()];
    if (!providerDef) {
      return reply.code(404).send(err('NOT_FOUND', `Unknown provider: ${provider}`));
    }
    return reply.send(ok({
        name: providerDef.name,
        description: providerDef.description,
        credentialFields: providerDef.credentialFields,
        setupInstructions: providerDef.setupInstructions,
        isMcp: true,
        ...getIntegrationMaturity(provider.toUpperCase()),
      }));
  });

  // Connect integration with credentials
  app.post('/integrations/connect', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId, userId } = request.user;
    const connectSchema = z.object({
      provider: z.string().min(1).max(100),
      credentials: z.record(z.string(), z.string()),
    });
    const parsed = connectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(err('VALIDATION_ERROR', 'Invalid request body', parsed.error.flatten()));
    }
    const { provider, credentials } = parsed.data;

    const providerUpper = provider.toUpperCase();
    const providerDef = MCP_PROVIDERS[providerUpper];
    if (!providerDef) {
      return reply.code(400).send(err('VALIDATION_ERROR', `Unsupported provider: ${provider}`));
    }

    // Validate all required credentials are provided
    for (const field of providerDef.credentialFields) {
      if (!credentials[field.key]) {
        return reply.code(422).send(err('VALIDATION_ERROR', `Missing required credential: ${field.label}`));
      }
    }

    try {
      // Build MCP server config and connect
      const config = providerDef.buildConfig(credentials);
      const tools = await mcpClientManager.connect(providerUpper, config);

      // Store integration record
      const firstFieldKey = providerDef.credentialFields[0]?.key;
      const displayName = (firstFieldKey ? credentials[firstFieldKey] : undefined) ?? providerUpper;

      const metadata = JSON.parse(JSON.stringify({ toolCount: tools.length, tools }));

      const integration = await app.db.integration.upsert({
        where: { tenantId_provider: { tenantId, provider: providerUpper } },
        update: {
          status: 'CONNECTED',
          displayName,
          connectedBy: userId,
          metadata,
          updatedAt: new Date(),
        },
        create: {
          tenantId,
          provider: providerUpper,
          status: 'CONNECTED',
          displayName,
          connectedBy: userId,
          metadata,
        },
      });

      // Store encrypted credentials
      await app.db.integrationCredential.upsert({
        where: { integrationId: integration.id },
        update: { accessTokenEnc: encryptCredentials(JSON.stringify(credentials)) },
        create: { integrationId: integration.id, accessTokenEnc: encryptCredentials(JSON.stringify(credentials)) },
      });

      await app.auditLog(request, 'CONNECT_INTEGRATION', 'Integration', integration.id, { provider: providerUpper });

      return reply.send(ok({
          id: integration.id,
          provider: providerUpper,
          status: 'CONNECTED',
          toolsRegistered: tools,
        }));
    } catch (connectErr) {
      return reply.code(500).send(err('INTERNAL_ERROR', `Failed to connect ${provider}: ${connectErr instanceof Error ? connectErr.message : String(connectErr)}`));
    }
  });

  // Test connection
  app.post('/integrations/:id/test', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const integration = await app.db.integration.findFirst({ where: { id, tenantId } });
    if (!integration) return reply.code(404).send(err('NOT_FOUND', 'Integration not found'));

    const isConnected = mcpClientManager.isConnected(integration.provider);
    const tools = mcpClientManager.getRegisteredTools(integration.provider);

    return reply.send(ok({
        connected: isConnected,
        provider: integration.provider,
        toolCount: tools.length,
        tools,
      }));
  });

  // Disconnect an integration
  app.delete('/integrations/:id', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user;
    const { id } = request.params as { id: string };

    const integration = await app.db.integration.findFirst({ where: { id, tenantId } });
    if (integration) {
      await mcpClientManager.disconnect(integration.provider);
    }

    await app.db.integration.deleteMany({
      where: { id, tenantId },
    });
    if (integration) {
      await app.auditLog(request, 'DISCONNECT_INTEGRATION', 'Integration', id, { provider: integration.provider });
    }
    return reply.code(204).send();
  });
}
