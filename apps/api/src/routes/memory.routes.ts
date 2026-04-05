import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { AppError, NotFoundError } from '../errors.js';
import type { MemoryType } from '../types.js';

const upsertMemoryBodySchema = z.object({
  value: z.unknown(),
  type: z.enum(['FACT', 'PREFERENCE', 'CONTEXT', 'SKILL_RESULT']).default('FACT'),
  ttl: z.string().datetime().optional(), // ISO-8601 expiry datetime
});

const VALID_TYPES: MemoryType[] = ['FACT', 'PREFERENCE', 'CONTEXT', 'SKILL_RESULT'];

const memoryRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /memory
   * List tenant memory entries with optional type filter and pagination.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        type?: string;
        page?: string;
        limit?: string;
        search?: string;
      };

      const type = query.type as MemoryType | undefined;
      if (type && !VALID_TYPES.includes(type)) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Invalid memory type '${type}'`));
      }

      const page = Math.max(1, parseInt(query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
      const skip = (page - 1) * limit;
      const tenantId = request.user.tenantId;

      try {
        const where = {
          tenantId,
          ...(type ? { memoryType: type } : {}),
          ...(query.search ? { key: { contains: query.search } } : {}),
        };

        const [total, entries] = await Promise.all([
          fastify.db.tenantMemory.count({ where }),
          fastify.db.tenantMemory.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            skip,
            take: limit,
          }),
        ]);

        return reply
          .status(200)
          .send(ok({ items: entries, total, page, limit, hasMore: skip + entries.length < total }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /memory/:key
   * Get a specific memory entry by its key.
   */
  fastify.get(
    '/:key',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { key } = request.params as { key: string };
      const tenantId = request.user.tenantId;

      try {
        const entry = await fastify.db.tenantMemory.findFirst({
          where: { tenantId, key },
        });

        if (!entry) throw new NotFoundError('MemoryEntry', key);

        return reply.status(200).send(ok(entry));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * PUT /memory/:key
   * Upsert a memory entry — requires OPERATOR or above.
   */
  fastify.put(
    '/:key',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('OPERATOR', 'TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { key } = request.params as { key: string };
      const parseResult = upsertMemoryBodySchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      const { value, type, ttl } = parseResult.data;
      const tenantId = request.user.tenantId;

      try {
        const existing = await fastify.db.tenantMemory.findFirst({ where: { tenantId, key } });

        let entry;
        if (existing) {
          entry = await fastify.db.tenantMemory.update({
            where: { id: existing.id },
            data: {
              value: value as object,
              memoryType: type,
              expiresAt: ttl ? new Date(ttl) : null,
            },
          });
        } else {
          entry = await fastify.db.tenantMemory.create({
            data: {
              tenantId,
              key,
              value: value as object,
              source: request.user.userId,
              memoryType: type,
              expiresAt: ttl ? new Date(ttl) : null,
            },
          });
        }

        await fastify.auditLog(request, 'UPSERT_MEMORY', 'MemoryEntry', key, { type });
        return reply.status(existing ? 200 : 201).send(ok(entry));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * DELETE /memory/:key
   * Delete a memory entry — requires TENANT_ADMIN.
   */
  fastify.delete(
    '/:key',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { key } = request.params as { key: string };
      const tenantId = request.user.tenantId;

      try {
        const entry = await fastify.db.tenantMemory.findFirst({ where: { tenantId, key } });
        if (!entry) throw new NotFoundError('MemoryEntry', key);

        await fastify.db.tenantMemory.delete({ where: { id: entry.id } });

        await fastify.auditLog(request, 'DELETE_MEMORY', 'MemoryEntry', key);
        return reply.status(200).send(ok({ deleted: true, key }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default memoryRoutes;
