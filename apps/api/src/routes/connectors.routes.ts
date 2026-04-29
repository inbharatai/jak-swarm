/**
 * Connector Runtime — REST surface.
 *
 * Read-only for v1: lists registered connectors + their current status,
 * filtered by category / status, and exposes a resolve endpoint that
 * turns a natural-language task into ranked connector candidates.
 *
 * Mutations (install / configure / approve / disable) intentionally
 * NOT exposed yet. Those flow through the existing `/integrations/*`
 * routes (OAuth, credential storage, audit log) plus the existing
 * `/approvals/*` gate. The Connector Runtime read API and the
 * existing integration write API converge in the dashboard.
 *
 * All routes require auth — listing tenant-eligible connectors needs
 * the tenantId for future per-tenant gating (industry-pack policy,
 * per-tenant disable). Today every authenticated user sees the same
 * list; the route still pulls tenantId so the contract is stable when
 * the gating lands.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  connectorRegistry,
  resolveConnectorsForTask,
  type ConnectorStatus,
} from '@jak-swarm/tools';
import { ok, err } from '../types.js';

const VALID_CATEGORIES = ['creative', 'coding', 'research', 'business', 'media', 'local', 'cloud'] as const;
const VALID_STATUSES: ConnectorStatus[] = [
  'available', 'installed', 'configured', 'needs_user_setup',
  'failed_validation', 'unavailable', 'disabled', 'blocked_by_policy',
];

const resolveBodySchema = z.object({
  task: z.string().min(1).max(2000),
  hintedRoles: z.array(z.string()).optional(),
  maxAlternatives: z.number().int().min(1).max(10).optional(),
});

const connectorsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /connectors
   * List all registered connectors with current status. Optional
   * filters: ?category=media&status=available
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { category?: string; status?: string };

      if (query.category && !VALID_CATEGORIES.includes(query.category as (typeof VALID_CATEGORIES)[number])) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Invalid category '${query.category}'`));
      }
      if (query.status && !VALID_STATUSES.includes(query.status as ConnectorStatus)) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Invalid status '${query.status}'`));
      }

      let views = connectorRegistry.list();
      if (query.category) {
        views = views.filter((v) => v.manifest.category === query.category);
      }
      if (query.status) {
        views = views.filter((v) => v.status === query.status);
      }

      // Aggregate counts by status so the dashboard can show a header
      // ribbon ("4 installed · 2 needs setup · 17 available") without
      // a second round-trip.
      const all = connectorRegistry.list();
      const counts: Record<ConnectorStatus, number> = {
        available: 0,
        installed: 0,
        configured: 0,
        needs_user_setup: 0,
        failed_validation: 0,
        unavailable: 0,
        disabled: 0,
        blocked_by_policy: 0,
      };
      for (const v of all) {
        counts[v.status] = (counts[v.status] ?? 0) + 1;
      }

      return reply.send(ok({
        connectors: views,
        total: views.length,
        registered: all.length,
        counts,
      }));
    },
  );

  /**
   * GET /connectors/:id
   * Single connector view (manifest + status + setup instructions).
   */
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const view = connectorRegistry.get(id);
      if (!view) {
        return reply.status(404).send(err('NOT_FOUND', `Connector '${id}' not registered`));
      }
      return reply.send(ok(view));
    },
  );

  /**
   * POST /connectors/resolve
   * Body: { task: string, hintedRoles?: string[], maxAlternatives?: number }
   * Returns the ranked candidates the resolver picked for this task.
   *
   * The dashboard calls this when the user types a task into the
   * cockpit so the user sees what JAK would route to BEFORE pressing
   * send. Useful for "do I need to install something first?" flows.
   */
  fastify.post(
    '/resolve',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = resolveBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', parsed.error.message));
      }
      const opts: { hintedRoles?: string[]; maxAlternatives?: number } = {};
      if (parsed.data.hintedRoles !== undefined) opts.hintedRoles = parsed.data.hintedRoles;
      if (parsed.data.maxAlternatives !== undefined) opts.maxAlternatives = parsed.data.maxAlternatives;
      const result = resolveConnectorsForTask(parsed.data.task, opts);
      return reply.send(ok(result));
    },
  );
};

export default connectorsRoutes;
