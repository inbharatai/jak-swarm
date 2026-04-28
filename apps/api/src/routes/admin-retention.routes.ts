/**
 * Admin retention sweep routes — Final hardening / Gap E.
 *
 * Endpoints:
 *   POST /admin/retention/sweep   — run sweep (dry_run by default)
 *
 * Authorisation: SYSTEM_ADMIN only. Per-tenant TENANT_ADMIN can also
 * trigger sweeps scoped to their own tenant.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { RetentionSweepService } from '../services/retention-sweep.service.js';

const sweepBodySchema = z.object({
  /** When omitted, defaults to 'dry_run' for safety. */
  mode: z.enum(['dry_run', 'execute']).default('dry_run'),
  /**
   * When omitted, sweeps the requesting user's tenant. When '*',
   * sweeps all tenants — SYSTEM_ADMIN only.
   */
  tenantId: z.string().optional(),
  policy: z
    .object({
      expiredInviteAfterDays: z.number().int().positive().max(365).optional(),
      revokedInviteAfterDays: z.number().int().positive().max(365).optional(),
      revokedEngagementAfterDays: z.number().int().positive().max(365).optional(),
    })
    .optional(),
});

const adminRetentionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/admin/retention/sweep',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('SYSTEM_ADMIN', 'TENANT_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId: callerTenantId, role } = request.user;
      const parsed = sweepBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_REQUEST', parsed.error.issues.map((i) => i.message).join('; ')));
      }
      const requestedTenant = parsed.data.tenantId ?? callerTenantId;

      // SYSTEM_ADMIN can sweep '*' or any tenant. TENANT_ADMIN can only
      // sweep their own.
      if (requestedTenant !== callerTenantId && role !== 'SYSTEM_ADMIN') {
        return reply.status(403).send(err('FORBIDDEN', 'TENANT_ADMIN can only sweep its own tenant'));
      }
      if (requestedTenant === '*' && role !== 'SYSTEM_ADMIN') {
        return reply.status(403).send(err('FORBIDDEN', 'Cross-tenant sweep requires SYSTEM_ADMIN'));
      }

      try {
        const svc = new RetentionSweepService(fastify.db, fastify.log);
        const report = await svc.sweep({
          mode: parsed.data.mode,
          tenantId: requestedTenant,
          ...(parsed.data.policy ? { policy: parsed.data.policy } : {}),
        });
        return reply.send(ok({ report }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        fastify.log.error?.({ err: msg }, '[admin/retention/sweep] failed');
        return reply.status(500).send(err('SWEEP_FAILED', msg));
      }
    },
  );
};

export default adminRetentionRoutes;
