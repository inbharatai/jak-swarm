import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';

const layoutSchema = z.object({
  layout: z.object({
    openModuleIds: z.array(z.string()),
    layoutTree: z.unknown().nullable(),
    floatingWindows: z.record(z.string(), z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      zIndex: z.number(),
    })).default({}),
    minimizedModules: z.array(z.string()).default([]),
    dockOrder: z.array(z.string()).default([]),
    activeModuleId: z.string().nullable().default(null),
  }),
});

const layoutRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /layouts/current
   * Get the current user's saved layout.
   */
  fastify.get(
    '/current',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;

      const record = await fastify.db.userLayout.findUnique({
        where: { userId },
      });

      if (!record) {
        return reply.send(ok({ layout: null }));
      }

      return reply.send(ok({ layout: record.layout }));
    },
  );

  /**
   * PUT /layouts/current
   * Save or update the current user's layout.
   */
  fastify.put(
    '/current',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;

      const parsed = layoutSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(err('INVALID_LAYOUT', 'Invalid layout data'));
      }

      const record = await fastify.db.userLayout.upsert({
        where: { userId },
        create: {
          userId,
          layout: parsed.data.layout as any,
        },
        update: {
          layout: parsed.data.layout as any,
        },
      });

      return reply.send(ok({ layout: record.layout }));
    },
  );
};

export default layoutRoutes;
