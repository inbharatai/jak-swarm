/**
 * trial-cap-guard.ts — Fastify preHandler that enforces daily resource caps
 * + trial-expiry on workflow-creation and approval-decide routes.
 *
 * Wired in apps/api/src/index.ts via:
 *   fastify.register(workflowsRoutes, { prefix: '/workflows', preHandler: [enforceTrialAgentRunCap] })
 *
 * Returns:
 *   429 TRIAL_DAILY_CAP_HIT { resource, counters, resetsAt }   on cap
 *   402 TRIAL_EXPIRED        { trialEndsAt }                    on trial-expired
 *
 * Why preHandler not middleware: Fastify's preHandler runs after auth + body
 * parse, so request.user is populated. Cap-hit is an expected outcome on the
 * free trial, not an error — return structured JSON the cockpit can render.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  UsageCounterService,
  type TrialResource,
} from '../services/trial/usage-counter.service.js';

export function makeTrialCapGuard(fastify: FastifyInstance, resource: TrialResource, amount = 1) {
  const usage = new UsageCounterService(fastify.db);

  return async function trialCapGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user?.tenantId) return; // unauthed routes shouldn't hit this guard

    const tenantId = request.user.tenantId;
    const result = await usage.check(tenantId, resource, amount);

    if (result.trial.expired) {
      return reply.status(402).send({
        ok: false,
        error: {
          code: 'TRIAL_EXPIRED',
          message: 'Your 30-day free trial has ended. Please upgrade to continue.',
          trialEndsAt: result.trial.trialEndsAt?.toISOString() ?? null,
        },
      });
    }

    if (!result.allowed) {
      return reply.status(429).send({
        ok: false,
        error: {
          code: 'TRIAL_DAILY_CAP_HIT',
          message: `Daily ${result.blockedBy} cap reached. Resets at UTC midnight.`,
          resource: result.blockedBy,
          counters: result.counters,
          resetsAt: result.resetsAt,
          daysRemaining: result.trial.daysRemaining,
        },
      });
    }

    // Allowed — record usage AFTER the route handler succeeds. We attach the
    // recorder onto the request so the route can call it on success.
    request.recordTrialUsage = (overrideAmount?: number) =>
      usage.recordUsage(tenantId, resource, overrideAmount ?? amount);
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Set by `trialCapGuard` when the cap check passes. The route handler
     * MUST call this on success so the counter increments. Skipping this
     * call effectively gives the user a free run — a bug, not a feature.
     */
    recordTrialUsage?: (amount?: number) => Promise<void>;
  }
}
