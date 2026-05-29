import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { enforceTenantIsolation } from '../../middleware/tenant-isolation.js';
import { ok, err } from '../../types.js';

const createConversationBodySchema = z.object({
  title: z.string().max(500).optional(),
});

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
      try {
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
      } catch (err) {
        request.log.error({ err }, 'Failed to get conversation messages');
        return reply.status(500).send({ error: 'Internal server error' });
      }
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
      try {
        const { tenantId, userId } = request.user;
        const parsed = createConversationBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid request body', parsed.error.flatten()));
        }
        const body = parsed.data;
        const conversation = await fastify.db.conversation.create({
          data: {
            tenantId,
            userId,
            title: body.title ?? null,
          },
        });
        return reply.status(201).send(ok({ conversation }));
      } catch (err) {
        request.log.error({ err }, 'Failed to create conversation');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
};

export default conversationRoutes;
