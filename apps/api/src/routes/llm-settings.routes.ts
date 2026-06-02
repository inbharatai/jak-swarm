import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { AppError } from '../errors.js';
import { anonymizeProviderName, canRevealProviderIdentity } from '../security/provider-privacy.js';
import { encryptLLMKey, decryptLLMKey } from '../utils/llm-key-crypto.js';

// ─── Provider configuration ──────────────────────────────────────────────────

const PROVIDER_NAMES = ['openai', 'gemini'] as const;
type ProviderName = (typeof PROVIDER_NAMES)[number];

const PROVIDER_ENV_KEYS: Record<ProviderName, { apiKeyEnv: string; modelEnv: string; defaultModel: string }> = {
  openai: { apiKeyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-5.4' },
  gemini: { apiKeyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-2.5-pro' },
};

function maskKey(key: string): string {
  if (!key) return '***';
  return `••• (${key.length} chars)`;
}

function memoryKey(provider: ProviderName): string {
  return `llm:${provider}:api_key`;
}

const PREFERRED_PROVIDER_KEY = 'llm:preferred_provider';

const setKeySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  model: z.string().optional(),
});

const setPreferredProviderSchema = z.object({
  provider: z.enum(['openai', 'gemini']),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

const llmSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /settings/llm
   * List all configured LLM providers with masked key previews.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.user.tenantId;
      const allowIdentity = canRevealProviderIdentity(request.user.email);

      try {
        // Fetch all stored keys from DB
        const storedKeys = await fastify.db.tenantMemory.findMany({
          where: {
            tenantId,
            memoryType: 'POLICY',
            key: { startsWith: 'llm:' },
          },
        });

        const storedMap = new Map<string, { value: Record<string, unknown> }>();
        for (const entry of storedKeys) {
          storedMap.set(entry.key, { value: entry.value as Record<string, unknown> });
        }

        // Get preferred provider
        const preferredEntry = storedMap.get(PREFERRED_PROVIDER_KEY);
        const preferredProvider = preferredEntry
          ? (preferredEntry.value['provider'] as string) ?? 'openai'
          : 'openai';

        const providers = PROVIDER_NAMES.map((name, index) => {
          const cfg = PROVIDER_ENV_KEYS[name];
          const dbEntry = storedMap.get(memoryKey(name));
          const maskedName = allowIdentity ? name : anonymizeProviderName(index);

          // Check DB first, then env
          if (dbEntry) {
            let keyPreview = '***';
            try {
              const decrypted = decryptLLMKey(dbEntry.value['encryptedKey'] as string);
              keyPreview = maskKey(decrypted);
            } catch {
              keyPreview = '***';
            }
            const model = (dbEntry.value['model'] as string) ?? cfg.defaultModel;
            return {
              id: `provider_${index + 1}`,
              name: maskedName,
              providerKey: allowIdentity ? name : undefined,
              configured: true,
              keyPreview: allowIdentity ? keyPreview : '***',
              model: allowIdentity ? model : 'managed',
              source: allowIdentity ? ('database' as const) : ('managed' as const),
              editable: allowIdentity,
              preferred: name === preferredProvider,
            };
          }

          const envKey = process.env[cfg.apiKeyEnv];
          if (envKey) {
            return {
              id: `provider_${index + 1}`,
              name: maskedName,
              providerKey: allowIdentity ? name : undefined,
              configured: true,
              keyPreview: allowIdentity ? maskKey(envKey) : '***',
              model: allowIdentity ? (process.env[cfg.modelEnv] ?? cfg.defaultModel) : 'managed',
              source: allowIdentity ? ('env' as const) : ('managed' as const),
              editable: allowIdentity,
              preferred: name === preferredProvider,
            };
          }

          return {
            id: `provider_${index + 1}`,
            name: maskedName,
            providerKey: allowIdentity ? name : undefined,
            configured: false,
            editable: allowIdentity,
            preferred: name === preferredProvider,
          };
        });

        return reply.status(200).send(ok({
          providers,
          preferredProvider: allowIdentity ? preferredProvider : 'managed',
          canViewProviderIdentity: allowIdentity,
        }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /settings/llm/status
   * Health check all providers — test connections.
   */
  fastify.get(
    '/status',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const allowIdentity = canRevealProviderIdentity(request.user.email);
      const results = PROVIDER_NAMES.map((name, index) => {
        const cfg = PROVIDER_ENV_KEYS[name];
        const maskedName = allowIdentity ? name : anonymizeProviderName(index);

        const hasEnv = !!process.env[cfg.apiKeyEnv];
        return {
          id: `provider_${index + 1}`,
          name: maskedName,
          providerKey: allowIdentity ? name : undefined,
          available: hasEnv,
          source: allowIdentity ? (hasEnv ? ('env' as const) : (null as null)) : ('managed' as const),
        };
      });

      return reply.status(200).send(ok({ providers: results, canViewProviderIdentity: allowIdentity }));
    },
  );

  /**
   * GET /settings/llm/preferred-provider
   * Get the tenant's current preferred LLM provider.
   */
  fastify.get(
    '/preferred-provider',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.user.tenantId;
      const entry = await fastify.db.tenantMemory.findFirst({
        where: { tenantId, key: PREFERRED_PROVIDER_KEY, memoryType: 'POLICY' },
      });

      const provider = entry
        ? (entry.value as { provider?: string }).provider ?? 'openai'
        : 'openai';

      return reply.status(200).send(ok({ provider }));
    },
  );

  /**
   * PUT /settings/llm/preferred-provider
   * Set the tenant's preferred LLM provider. Stored in TenantMemory
   * as a POLICY entry with key 'llm:preferred_provider'.
   */
  fastify.put(
    '/preferred-provider',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('OPERATOR', 'TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = setPreferredProviderSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      const { provider } = parseResult.data;
      const tenantId = request.user.tenantId;

      const value = { provider, updatedAt: new Date().toISOString() };
      const existing = await fastify.db.tenantMemory.findFirst({
        where: { tenantId, key: PREFERRED_PROVIDER_KEY },
      });

      if (existing) {
        await fastify.db.tenantMemory.update({
          where: { id: existing.id },
          data: { value: value as object },
        });
      } else {
        await fastify.db.tenantMemory.create({
          data: {
            tenantId,
            key: PREFERRED_PROVIDER_KEY,
            value: value as object,
            source: request.user.userId,
            memoryType: 'POLICY',
          },
        });
      }

      await fastify.auditLog(request, 'SET_PREFERRED_LLM_PROVIDER', 'LLMSettings', provider);

      return reply.status(200).send(ok({ provider }));
    },
  );

  /**
   * PUT /settings/llm/:provider
   * Set or update an API key for a provider. Stored encrypted in TenantMemory.
   */
  fastify.put(
    '/:provider',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('OPERATOR', 'TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!canRevealProviderIdentity(request.user.email)) {
        return reply.status(403).send(err('FORBIDDEN', 'Provider settings are restricted'));
      }

      const { provider } = request.params as { provider: string };

      if (!PROVIDER_NAMES.includes(provider as ProviderName)) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Unknown provider '${provider}'. Valid: ${PROVIDER_NAMES.join(', ')}`));
      }

      const parseResult = setKeySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      const { apiKey, model } = parseResult.data;
      const tenantId = request.user.tenantId;
      const key = memoryKey(provider as ProviderName);

      try {
        const encryptedKey = encryptLLMKey(apiKey);
        const value = {
          encryptedKey,
          model: model ?? PROVIDER_ENV_KEYS[provider as ProviderName].defaultModel,
          updatedAt: new Date().toISOString(),
        };

        const existing = await fastify.db.tenantMemory.findFirst({ where: { tenantId, key } });

        if (existing) {
          await fastify.db.tenantMemory.update({
            where: { id: existing.id },
            data: { value: value as object },
          });
        } else {
          await fastify.db.tenantMemory.create({
            data: {
              tenantId,
              key,
              value: value as object,
              source: request.user.userId,
              memoryType: 'POLICY',
            },
          });
        }

        await fastify.auditLog(request, 'SET_LLM_KEY', 'LLMSettings', provider);

        return reply.status(200).send(ok({
          provider,
          configured: true,
          keyPreview: maskKey(apiKey),
          model: model ?? PROVIDER_ENV_KEYS[provider as ProviderName].defaultModel,
          source: 'database',
        }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * DELETE /settings/llm/:provider
   * Remove a stored API key for a provider.
   */
  fastify.delete(
    '/:provider',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!canRevealProviderIdentity(request.user.email)) {
        return reply.status(403).send(err('FORBIDDEN', 'Provider settings are restricted'));
      }

      const { provider } = request.params as { provider: string };

      if (!PROVIDER_NAMES.includes(provider as ProviderName)) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Unknown provider '${provider}'. Valid: ${PROVIDER_NAMES.join(', ')}`));
      }

      const tenantId = request.user.tenantId;
      const key = memoryKey(provider as ProviderName);

      try {
        const existing = await fastify.db.tenantMemory.findFirst({ where: { tenantId, key } });

        if (!existing) {
          return reply.status(404).send(err('NOT_FOUND', `No stored API key for provider '${provider}'`));
        }

        await fastify.db.tenantMemory.delete({ where: { id: existing.id } });
        await fastify.auditLog(request, 'DELETE_LLM_KEY', 'LLMSettings', provider);

        return reply.status(200).send(ok({ deleted: true, provider }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default llmSettingsRoutes;