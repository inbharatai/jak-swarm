import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { ok, err } from '../types.js';
import { AppError } from '../errors.js';
import { config } from '../config.js';

// ─── Encryption helpers ──────────────────────────────────────────────────────
// AES-256-GCM using AUTH_SECRET as key material

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

let cachedKey: Buffer | null = null;

function deriveKey(): Buffer {
  if (!cachedKey) {
    cachedKey = scryptSync(config.jwtSecret, 'jak-swarm-llm-keys', 32);
  }
  return cachedKey;
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as: iv:tag:ciphertext (all base64)
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(encoded: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const iv = Buffer.from(parts[0]!, 'base64');
  const tag = Buffer.from(parts[1]!, 'base64');
  const encrypted = Buffer.from(parts[2]!, 'base64');
  const key = deriveKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

// ─── Provider configuration ──────────────────────────────────────────────────

const PROVIDER_NAMES = ['openai', 'anthropic', 'gemini', 'deepseek', 'openrouter', 'ollama'] as const;
type ProviderName = (typeof PROVIDER_NAMES)[number];

const PROVIDER_ENV_KEYS: Record<ProviderName, { apiKeyEnv: string; modelEnv: string; defaultModel: string }> = {
  openai: { apiKeyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-4.1' },
  anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_MODEL', defaultModel: 'claude-sonnet-4-20250514' },
  gemini: { apiKeyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-2.5-flash' },
  deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY', modelEnv: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-chat' },
  openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'meta-llama/llama-3.1-70b-instruct' },
  ollama: { apiKeyEnv: '', modelEnv: 'OLLAMA_MODEL', defaultModel: 'llama3.1' },
};

function maskKey(key: string): string {
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}...${key.slice(-3)}`;
}

function memoryKey(provider: ProviderName): string {
  return `llm:${provider}:api_key`;
}

const setKeySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  model: z.string().optional(),
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

        const providers = PROVIDER_NAMES.map((name) => {
          const cfg = PROVIDER_ENV_KEYS[name];
          const dbEntry = storedMap.get(memoryKey(name));

          // Check DB first, then env
          if (dbEntry) {
            let keyPreview = '***';
            try {
              const decrypted = decrypt(dbEntry.value['encryptedKey'] as string);
              keyPreview = maskKey(decrypted);
            } catch {
              keyPreview = '***';
            }
            const model = (dbEntry.value['model'] as string) ?? cfg.defaultModel;
            return { name, configured: true, keyPreview, model, source: 'database' as const };
          }

          // Check env vars
          if (name === 'ollama') {
            const hasOllama = !!process.env['OLLAMA_URL'] || !!process.env['OLLAMA_MODEL'];
            if (hasOllama) {
              return {
                name,
                configured: true,
                model: process.env['OLLAMA_MODEL'] ?? cfg.defaultModel,
                source: 'local' as const,
                url: process.env['OLLAMA_URL'] ?? 'http://localhost:11434',
              };
            }
            return { name, configured: false };
          }

          const envKey = process.env[cfg.apiKeyEnv];
          if (envKey) {
            return {
              name,
              configured: true,
              keyPreview: maskKey(envKey),
              model: process.env[cfg.modelEnv] ?? cfg.defaultModel,
              source: 'env' as const,
            };
          }

          return { name, configured: false };
        });

        return reply.status(200).send(ok({ providers }));
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
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const results = PROVIDER_NAMES.map((name) => {
        const cfg = PROVIDER_ENV_KEYS[name];

        if (name === 'ollama') {
          const hasOllama = !!process.env['OLLAMA_URL'] || !!process.env['OLLAMA_MODEL'];
          return { name, available: hasOllama, source: 'local' as const };
        }

        const hasEnv = !!process.env[cfg.apiKeyEnv];
        return { name, available: hasEnv, source: hasEnv ? ('env' as const) : (null as null) };
      });

      return reply.status(200).send(ok({ providers: results }));
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
        const encryptedKey = encrypt(apiKey);
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
