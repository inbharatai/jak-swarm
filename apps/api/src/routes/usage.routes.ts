/**
 * Usage & billing routes.
 *
 * GET /usage          — Current credit balance and limits
 * GET /usage/history  — Recent usage ledger entries
 * POST /usage/estimate — Pre-execution cost estimate
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { CreditService } from '../billing/credit-service.js';
import { detectTaskType, estimateCredits } from '../billing/model-router.js';
import { enforceTenantIsolation } from '../middleware/tenant-isolation.js';

const estimateBodySchema = z.object({
  goal: z.string().min(1).max(5000),
});

const usageRoutes: FastifyPluginAsync = async (fastify) => {
  const creditService = new CreditService(fastify.db);
  const preHandler = [fastify.authenticate, enforceTenantIsolation];

  /**
   * GET /usage — Current credit balance and limits
   */
  fastify.get('/', { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const usage = await creditService.getUsage(request.user.tenantId);
    if (!usage) {
      return reply.status(404).send(err('NOT_FOUND', 'No subscription found'));
    }
    return reply.send(ok(usage));
  });

  /**
   * GET /usage/history — Recent usage entries
   */
  fastify.get('/history', { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user;
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit ?? '20', 10), 100);
    const offset = parseInt(query.offset ?? '0', 10);

    try {
      const entries = await (fastify.db as any).usageLedger.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          taskType: true,
          modelUsed: true,
          creditsCost: true,
          status: true,
          createdAt: true,
        },
      });

      const total = await (fastify.db as any).usageLedger.count({ where: { tenantId } });

      return reply.send(ok({ entries, total, limit, offset }));
    } catch {
      return reply.send(ok({ entries: [], total: 0, limit, offset }));
    }
  });

  /**
   * POST /usage/estimate — Pre-execution cost estimate
   */
  fastify.post('/estimate', { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = estimateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send(err('VALIDATION_ERROR', 'Goal is required'));
    }

    const { tenantId } = request.user;
    const usage = await creditService.getUsage(tenantId);
    if (!usage) {
      return reply.status(404).send(err('NOT_FOUND', 'No subscription found'));
    }

    const taskType = detectTaskType(parsed.data.goal);
    const estimate = estimateCredits(parsed.data.goal, taskType, usage.maxModelTier);

    const canAfford = estimate.estimatedCredits <= usage.credits.remaining
      && estimate.estimatedCredits <= usage.daily.remaining;

    return reply.send(ok({
      taskType,
      estimatedCredits: estimate.estimatedCredits,
      model: estimate.model,
      tier: estimate.tier,
      canAfford,
      remaining: {
        daily: usage.daily.remaining,
        monthly: usage.credits.remaining,
      },
      message: canAfford
        ? `Estimated cost: ~${estimate.estimatedCredits} credits`
        : `This task needs ~${estimate.estimatedCredits} credits but you have ${Math.min(usage.daily.remaining, usage.credits.remaining)} remaining`,
    }));
  });
};

export default usageRoutes;
