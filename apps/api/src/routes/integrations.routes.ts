import type { FastifyInstance } from 'fastify';
import { mcpClientManager, MCP_PROVIDERS } from '@jak-swarm/tools';

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
    return reply.send({ data: integrations });
  });

  // Get provider setup info (credential fields, instructions)
  app.get('/integrations/providers/:provider', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const providerDef = MCP_PROVIDERS[provider.toUpperCase()];
    if (!providerDef) {
      return reply.code(404).send({ error: `Unknown provider: ${provider}` });
    }
    return reply.send({
      data: {
        name: providerDef.name,
        description: providerDef.description,
        credentialFields: providerDef.credentialFields,
        setupInstructions: providerDef.setupInstructions,
        isMcp: true,
      },
    });
  });

  // Connect integration with credentials
  app.post('/integrations/connect', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId, userId } = request.user;
    const { provider, credentials } = request.body as { provider: string; credentials: Record<string, string> };

    const providerUpper = provider.toUpperCase();
    const providerDef = MCP_PROVIDERS[providerUpper];
    if (!providerDef) {
      return reply.code(400).send({ error: `Unsupported provider: ${provider}` });
    }

    // Validate all required credentials are provided
    for (const field of providerDef.credentialFields) {
      if (!credentials[field.key]) {
        return reply.code(400).send({ error: `Missing required credential: ${field.label}` });
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
        update: { accessTokenEnc: JSON.stringify(credentials) },
        create: { integrationId: integration.id, accessTokenEnc: JSON.stringify(credentials) },
      });

      return reply.send({
        data: {
          id: integration.id,
          provider: providerUpper,
          status: 'CONNECTED',
          toolsRegistered: tools,
        },
      });
    } catch (err) {
      return reply.code(500).send({
        error: `Failed to connect ${provider}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Test connection
  app.post('/integrations/:id/test', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const integration = await app.db.integration.findFirst({ where: { id, tenantId } });
    if (!integration) return reply.code(404).send({ error: 'Integration not found' });

    const isConnected = mcpClientManager.isConnected(integration.provider);
    const tools = mcpClientManager.getRegisteredTools(integration.provider);

    return reply.send({
      data: {
        connected: isConnected,
        provider: integration.provider,
        toolCount: tools.length,
        tools,
      },
    });
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
    return reply.code(204).send();
  });
}
