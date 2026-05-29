/**
 * inbox.routes.ts — single-page Inbox aggregator for the calling user.
 *
 * Pulls together:
 *   - TaskAssignments addressed to me (PENDING + ACKNOWLEDGED)
 *   - ApprovalRequests in this tenant where I am eligible to decide
 *     (REVIEWER+) and status=PENDING
 *   - Unread Notifications addressed to me
 *
 * One round-trip → cockpit-ready payload. The /inbox UI page calls this
 * endpoint via SWR every 10s + on SSE bump events.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';

const markReadBodySchema = z.object({}).passthrough();
const markAllReadBodySchema = z.object({}).passthrough();

const inboxRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /inbox — aggregated inbox payload for the calling user. */
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const tenantId = request.user.tenantId;
      const userId = request.user.userId;
      const role = request.user.role;

      // B3 (audit 2026-05-08): align with /approvals/:id/decide RBAC.
      // The decide handler requires REVIEWER+ (REVIEWER / TENANT_ADMIN /
      // SYSTEM_ADMIN); inbox previously also surfaced approvals to OPERATOR,
      // but OPERATORs cannot decide them — leading to "approve" buttons in
      // the cockpit that 403 on click. Match the actual RBAC of the action.
      const isReviewerLike =
        role === 'REVIEWER' || role === 'TENANT_ADMIN' || role === 'SYSTEM_ADMIN';

      const [tasks, approvals, notifications, taskCount, notifCount] = await Promise.all([
        fastify.db.taskAssignment.findMany({
          where: {
            tenantId,
            assigneeUserId: userId,
            status: { in: ['PENDING', 'ACKNOWLEDGED'] },
          },
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          take: 100,
        }),
        isReviewerLike
          ? fastify.db.approvalRequest.findMany({
              where: { tenantId, status: 'PENDING' },
              orderBy: { createdAt: 'desc' },
              take: 50,
              select: {
                id: true,
                workflowId: true,
                taskId: true,
                agentRole: true,
                action: true,
                rationale: true,
                riskLevel: true,
                createdAt: true,
              },
            })
          : Promise.resolve([]),
        fastify.db.notification.findMany({
          where: { tenantId, userId, readAt: null },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        fastify.db.taskAssignment.count({
          where: {
            tenantId,
            assigneeUserId: userId,
            status: { in: ['PENDING', 'ACKNOWLEDGED'] },
          },
        }),
        fastify.db.notification.count({
          where: { tenantId, userId, readAt: null },
        }),
      ]);

      return reply.status(200).send(
        ok({
          tasks,
          approvals,
          notifications,
          counts: {
            tasks: taskCount,
            approvals: approvals.length,
            notifications: notifCount,
            total: taskCount + approvals.length + notifCount,
          },
        }),
      );
    } catch (err) {
      request.log.error({ err }, 'Failed to get inbox');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /** POST /inbox/notifications/:id/read — mark a notification read. */
  fastify.post(
    '/notifications/:id/read',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const parsed = markReadBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.status(400).send(err('VALIDATION_ERROR', parsed.error.message));
        }
        const { id } = request.params as { id: string };
        const tenantId = request.user.tenantId;
        const userId = request.user.userId;

        const result = await fastify.db.notification.updateMany({
          where: { id, tenantId, userId },
          data: { readAt: new Date() },
        });

        if (result.count === 0) {
          return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND' } });
        }
        return reply.status(200).send(ok({ id, readAt: new Date().toISOString() }));
      } catch (err) {
        request.log.error({ err }, 'Failed to mark notification as read');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /** POST /inbox/notifications/read-all — mark every unread notification read. */
  fastify.post(
    '/notifications/read-all',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const parsed = markAllReadBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.status(400).send(err('VALIDATION_ERROR', parsed.error.message));
        }
        const tenantId = request.user.tenantId;
        const userId = request.user.userId;

        const result = await fastify.db.notification.updateMany({
          where: { tenantId, userId, readAt: null },
          data: { readAt: new Date() },
        });

        return reply.status(200).send(ok({ markedRead: result.count }));
      } catch (err) {
        request.log.error({ err }, 'Failed to mark all notifications as read');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};

export default inboxRoutes;
