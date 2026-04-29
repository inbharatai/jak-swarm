import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { AppError, NotFoundError } from '../errors.js';

/**
 * Item C (OpenClaw-inspired Phase 1) — Standing Orders routes.
 *
 * A StandingOrder is a per-tenant policy contract that bounds the
 * autonomy of a WorkflowSchedule (or applies tenant-globally). The
 * scheduler service consults the linked StandingOrder at fire time and
 * enforces allowedTools / blockedActions / approvalRequiredFor /
 * budgetUsd / expiresAt.
 *
 * RBAC:
 *   - GET (list / detail): authenticated tenant member
 *   - POST / PATCH / DELETE: REVIEWER, TENANT_ADMIN, SYSTEM_ADMIN
 *
 * The mutations are NOT restricted to a workflow-schedule owner because
 * tenant-global standing orders apply to every schedule and must be
 * managed by an operator-class user.
 */

const createBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  workflowScheduleId: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).default([]),
  blockedActions: z.array(z.string()).default([]),
  approvalRequiredFor: z.array(z.string()).default([]),
  allowedSources: z.array(z.string()).default([]),
  budgetUsd: z.number().positive().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  enabled: z.boolean().optional(),
});

const updateBodySchema = createBodySchema.partial();

const standingOrdersRoutes: FastifyPluginAsync = async (fastify) => {
  const writePreHandler = [
    fastify.authenticate,
    fastify.requireRole('REVIEWER', 'TENANT_ADMIN', 'SYSTEM_ADMIN'),
  ];

  /** GET /standing-orders — list this tenant's standing orders. */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const tenantId = request.user.tenantId;
        const orders = await fastify.db.standingOrder.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
        });
        return reply.status(200).send(ok({ items: orders, count: orders.length }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /** GET /standing-orders/:id — get a single standing order. */
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = request.params as { id: string };
        const tenantId = request.user.tenantId;
        const order = await fastify.db.standingOrder.findFirst({
          where: { id, tenantId },
        });
        if (!order) throw new NotFoundError('StandingOrder', id);
        return reply.status(200).send(ok(order));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /** POST /standing-orders — create a new standing order. */
  fastify.post(
    '/',
    { preHandler: writePreHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = createBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }
      const data = parseResult.data;
      try {
        // Sanity check: if a workflowScheduleId is supplied, it must
        // belong to the same tenant. We refuse cross-tenant attachment
        // here rather than at fire time so admin UIs surface the error
        // immediately.
        if (data.workflowScheduleId) {
          const schedule = await fastify.db.workflowSchedule.findFirst({
            where: { id: data.workflowScheduleId, tenantId: request.user.tenantId },
            select: { id: true },
          });
          if (!schedule) throw new NotFoundError('WorkflowSchedule', data.workflowScheduleId);
        }

        const created = await fastify.db.standingOrder.create({
          data: {
            tenantId: request.user.tenantId,
            userId: request.user.userId,
            name: data.name,
            description: data.description ?? null,
            workflowScheduleId: data.workflowScheduleId ?? null,
            allowedTools: data.allowedTools,
            blockedActions: data.blockedActions,
            approvalRequiredFor: data.approvalRequiredFor,
            allowedSources: data.allowedSources,
            budgetUsd: data.budgetUsd ?? null,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
            enabled: data.enabled ?? true,
          },
        });
        await fastify.auditLog(
          request,
          'STANDING_ORDER_CREATED',
          'StandingOrder',
          created.id,
          {
            name: created.name,
            workflowScheduleId: created.workflowScheduleId,
            blockedActionsCount: created.blockedActions.length,
            allowedToolsCount: created.allowedTools.length,
            budgetUsd: created.budgetUsd,
            expiresAt: created.expiresAt,
          },
        );
        return reply.status(201).send(ok(created));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /** PATCH /standing-orders/:id — update a standing order. */
  fastify.patch(
    '/:id',
    { preHandler: writePreHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parseResult = updateBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }
      const data = parseResult.data;
      try {
        const existing = await fastify.db.standingOrder.findFirst({
          where: { id, tenantId: request.user.tenantId },
        });
        if (!existing) throw new NotFoundError('StandingOrder', id);

        const updated = await fastify.db.standingOrder.update({
          where: { id },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.workflowScheduleId !== undefined
              ? { workflowScheduleId: data.workflowScheduleId }
              : {}),
            ...(data.allowedTools !== undefined ? { allowedTools: data.allowedTools } : {}),
            ...(data.blockedActions !== undefined ? { blockedActions: data.blockedActions } : {}),
            ...(data.approvalRequiredFor !== undefined
              ? { approvalRequiredFor: data.approvalRequiredFor }
              : {}),
            ...(data.allowedSources !== undefined ? { allowedSources: data.allowedSources } : {}),
            ...(data.budgetUsd !== undefined ? { budgetUsd: data.budgetUsd } : {}),
            ...(data.expiresAt !== undefined
              ? { expiresAt: data.expiresAt ? new Date(data.expiresAt) : null }
              : {}),
            ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          },
        });
        await fastify.auditLog(request, 'STANDING_ORDER_UPDATED', 'StandingOrder', id, {
          changedFields: Object.keys(data),
        });
        return reply.status(200).send(ok(updated));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /** DELETE /standing-orders/:id — delete (hard) a standing order. */
  fastify.delete(
    '/:id',
    { preHandler: writePreHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = request.params as { id: string };
        const existing = await fastify.db.standingOrder.findFirst({
          where: { id, tenantId: request.user.tenantId },
        });
        if (!existing) throw new NotFoundError('StandingOrder', id);
        await fastify.db.standingOrder.delete({ where: { id } });
        await fastify.auditLog(request, 'STANDING_ORDER_DELETED', 'StandingOrder', id);
        return reply.status(200).send(ok({ id, deleted: true }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /** POST /standing-orders/:id/disable — disable shortcut. */
  fastify.post(
    '/:id/disable',
    { preHandler: writePreHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = request.params as { id: string };
        const existing = await fastify.db.standingOrder.findFirst({
          where: { id, tenantId: request.user.tenantId },
        });
        if (!existing) throw new NotFoundError('StandingOrder', id);
        const updated = await fastify.db.standingOrder.update({
          where: { id },
          data: { enabled: false },
        });
        await fastify.auditLog(request, 'STANDING_ORDER_DISABLED', 'StandingOrder', id);
        return reply.status(200).send(ok(updated));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default standingOrdersRoutes;
