import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { enforceTenantIsolation } from '../../middleware/tenant-isolation.js';
import { ok, err } from '../../types.js';

const conversationRoutes: FastifyPluginAsync = async (fastify) => {
  const preHandlerBase = [fastify.authenticate, enforceTenantIsolation];

  /**
   * GET /workflows/conversations/:conversationId/messages
   * Fetch paginated messages for a conversation thread.
   */
  fastify.get(
    '/conversations/:conversationId/messages',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { conversationId } = request.params as { conversationId: string };
      const { tenantId } = request.user;
      const query = request.query as { limit?: string; before?: string };
      const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '50', 10)));

      const conversation = await fastify.db.conversation.findFirst({
        where: { id: conversationId, tenantId },
        select: { id: true },
      });
      if (!conversation) {
        return reply.status(404).send(err('NOT_FOUND', 'Conversation not found'));
      }

      const messages = await fastify.db.conversationMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        take: limit,
        ...(query.before ? { where: { conversationId, createdAt: { lt: new Date(query.before) } } } : {}),
      });

      return reply.status(200).send(ok({ messages }));
    },
  );

  /**
   * POST /workflows/conversations
   * Create a new conversation thread explicitly.
   */
  fastify.post(
    '/conversations',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.user;
      const body = request.body as { title?: string };
      const conversation = await fastify.db.conversation.create({
        data: {
          tenantId,
          userId,
          title: body.title ?? null,
        },
      });
      return reply.status(201).send(ok({ conversation }));
    },
  );
};

export default conversationRoutes;
