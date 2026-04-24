import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ensureModelMap, smokeResponsesApi } from '@jak-swarm/agents';
import { ok, err } from '../types.js';
import { enforceTenantIsolation } from '../middleware/tenant-isolation.js';

// The smoke test runs through `smokeResponsesApi` in @jak-swarm/agents
// (which already has `openai` as a direct dep). This keeps the API
// bundle free of ambiguous module-format issues on Node 25 — previously
// a top-level `require('openai')` here triggered
// ERR_AMBIGUOUS_MODULE_SYNTAX in Render because the graph has top-level
// await elsewhere.

/**
 * Admin diagnostics — observability surface for the ModelResolver + the
 * OpenAI Responses API smoke test.
 *
 * GET  /admin/diagnostics/models
 *   Returns the currently resolved model map + the full list of models
 *   the configured API key has access to. Forces a fresh resolution
 *   when called with `?refresh=1`. Visible to TENANT_ADMIN +
 *   SYSTEM_ADMIN users only because it leaks model capability info.
 *
 * POST /admin/diagnostics/smoke/openai
 *   Runs a minimal `/v1/responses` call against each preferred model
 *   (gpt-5.4, gpt-5.4-mini, gpt-5.4-nano). Returns per-model pass/fail
 *   with latency + the first slice of the response text. Use this to
 *   confirm end-to-end the Responses API works from this deploy's env
 *   with this API key, NOT just `/v1/models`. Admin-only.
 */
export async function adminDiagnosticsRoutes(app: FastifyInstance) {
  // ─── GET /admin/diagnostics/models ──────────────────────────────────────
  app.get(
    '/admin/diagnostics/models',
    {
      preHandler: [
        app.authenticate,
        app.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
        enforceTenantIsolation,
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { refresh?: string };
      const force = query.refresh === '1' || query.refresh === 'true';
      try {
        const map = await ensureModelMap({ force });
        return reply.status(200).send(
          ok({
            resolved: {
              tier3: map.tier3,
              tier2: map.tier2,
              tier1: map.tier1,
            },
            verified: map.verified,
            resolvedAt: map.resolvedAt.toISOString(),
            diagnostic: map.diagnostic,
            modelsAvailable: map.available.length,
            models: map.available,
            preferredModels: {
              tier3: 'gpt-5.4 → gpt-5 → gpt-4o',
              tier2: 'gpt-5.4-mini → gpt-5-mini → gpt-4o-mini',
              tier1: 'gpt-5.4-nano → gpt-5-nano → gpt-4o-mini',
            },
            env: {
              OPENAI_API_KEY_set: Boolean(process.env['OPENAI_API_KEY']),
              OPENAI_BASE_URL: process.env['OPENAI_BASE_URL']?.trim() || null,
              OPENAI_MODEL: process.env['OPENAI_MODEL']?.trim() || null,
              OPENAI_MODEL_TIER_1: process.env['OPENAI_MODEL_TIER_1']?.trim() || null,
              OPENAI_MODEL_TIER_2: process.env['OPENAI_MODEL_TIER_2']?.trim() || null,
              OPENAI_MODEL_TIER_3: process.env['OPENAI_MODEL_TIER_3']?.trim() || null,
              JAK_EXECUTION_ENGINE: process.env['JAK_EXECUTION_ENGINE']?.trim() || '(default — openai-first when key present)',
              JAK_OPENAI_RUNTIME_AGENTS: process.env['JAK_OPENAI_RUNTIME_AGENTS']?.trim() || null,
            },
          }),
        );
      } catch (e) {
        return reply
          .status(500)
          .send(err('MODEL_RESOLVER_FAILED', e instanceof Error ? e.message : String(e)));
      }
    },
  );

  // ─── POST /admin/diagnostics/smoke/openai ───────────────────────────────
  app.post(
    '/admin/diagnostics/smoke/openai',
    {
      preHandler: [
        app.authenticate,
        app.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
        enforceTenantIsolation,
      ],
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) {
        return reply.status(503).send(err('NOT_CONFIGURED', 'OPENAI_API_KEY is not set in this environment.'));
      }

      // Reuse the resolver's known list so we only smoke the models the
      // key can actually access — no point spending money hitting
      // gpt-5.4 when it's not entitled.
      const map = await ensureModelMap();
      const allCandidates = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'];
      const availableSet = new Set(map.available);
      const models = allCandidates.filter((m) => map.verified ? availableSet.has(m) : true);
      const skipped = allCandidates.filter((m) => !models.includes(m));

      const results = await smokeResponsesApi(models);

      const summary = {
        allPassed: results.every((r) => r.ok),
        passed: results.filter((r) => r.ok).map((r) => r.model),
        failed: results.filter((r) => !r.ok).map((r) => r.model),
        skipped,
        results,
        resolvedMap: {
          tier3: map.tier3,
          tier2: map.tier2,
          tier1: map.tier1,
          verified: map.verified,
        },
      };
      return reply.status(200).send(ok(summary));
    },
  );
}
