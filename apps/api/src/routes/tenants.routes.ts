import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { enforceTenantIsolation } from '../middleware/tenant-isolation.js';
import { ok, err } from '../types.js';
import { AppError, NotFoundError, ForbiddenError } from '../errors.js';

const updateTenantBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
});

const inviteUserBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(['TENANT_ADMIN', 'OPERATOR', 'REVIEWER', 'VIEWER']),
  password: z.string().min(8),
});

const updateUserBodySchema = z.object({
  role: z.enum(['TENANT_ADMIN', 'OPERATOR', 'REVIEWER', 'VIEWER']).optional(),
  active: z.boolean().optional(),
});

const updateUserProfileBodySchema = z.object({
  jobFunction: z.string().optional(),
  name: z.string().min(1).max(120).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

const tenantsRoutes: FastifyPluginAsync = async (fastify) => {
  const preHandlerBase = [fastify.authenticate, enforceTenantIsolation];

  /**
   * GET /tenants/:tenantId
   * Returns tenant info — any user in the tenant can view.
   */
  fastify.get(
    '/:tenantId',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.params as { tenantId: string };

      try {
        const tenant = await fastify.db.tenant.findUnique({
          where: { id: tenantId },
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (!tenant) throw new NotFoundError('Tenant', tenantId);

        return reply.status(200).send(ok(tenant));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * PATCH /tenants/:tenantId
   * Update tenant settings — requires TENANT_ADMIN.
   */
  fastify.patch(
    '/:tenantId',
    { preHandler: [...preHandlerBase, fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.params as { tenantId: string };
      const parseResult = updateTenantBodySchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      try {
        const tenant = await fastify.db.tenant.update({
          where: { id: tenantId },
          data: {
            ...(parseResult.data.name ? { name: parseResult.data.name } : {}),
          },
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        await fastify.auditLog(request, 'UPDATE_TENANT', 'Tenant', tenantId, parseResult.data);
        return reply.status(200).send(ok(tenant));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /tenants/:tenantId/users
   * List users in tenant — requires TENANT_ADMIN.
   */
  fastify.get(
    '/:tenantId/users',
    { preHandler: [...preHandlerBase, fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.params as { tenantId: string };
      const query = request.query as { page?: string; limit?: string };
      const page = Math.max(1, parseInt(query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
      const skip = (page - 1) * limit;

      try {
        const [total, users] = await Promise.all([
          fastify.db.user.count({ where: { tenantId } }),
          fastify.db.user.findMany({
            where: { tenantId },
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              active: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { createdAt: 'asc' },
            skip,
            take: limit,
          }),
        ]);

        return reply.status(200).send(
          ok({ items: users, total, page, limit, hasMore: skip + users.length < total }),
        );
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /tenants/:tenantId/users
   * Invite a new user to the tenant — requires TENANT_ADMIN.
   */
  fastify.post(
    '/:tenantId/users',
    { preHandler: [...preHandlerBase, fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.params as { tenantId: string };
      const parseResult = inviteUserBodySchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      const { email, name, role, password } = parseResult.data;

      try {
        // Check for duplicate email within the tenant
        const existing = await fastify.db.user.findFirst({
          where: { email: email.toLowerCase(), tenantId },
        });
        if (existing) {
          return reply
            .status(409)
            .send(err('CONFLICT', `User with email '${email}' already exists in this tenant`));
        }

        const bcrypt = await import('bcryptjs');
        const passwordHash = await bcrypt.default.hash(password, 12);

        const user = await fastify.db.user.create({
          data: {
            tenantId,
            email: email.toLowerCase(),
            name,
            passwordHash,
            role,
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            active: true,
            createdAt: true,
          },
        });

        await fastify.auditLog(request, 'INVITE_USER', 'User', user.id, { email, role });
        return reply.status(201).send(ok(user));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * PATCH /tenants/:tenantId/users/:userId
   * Update user role or active status — requires TENANT_ADMIN.
   */
  fastify.patch(
    '/:tenantId/users/:userId',
    { preHandler: [...preHandlerBase, fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.params as { tenantId: string; userId: string };
      const parseResult = updateUserBodySchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      try {
        // Ensure target user belongs to this tenant
        const target = await fastify.db.user.findFirst({ where: { id: userId, tenantId } });
        if (!target) throw new NotFoundError('User', userId);

        // Prevent demoting the only TENANT_ADMIN
        if (target.role === 'TENANT_ADMIN' && parseResult.data.role && parseResult.data.role !== 'TENANT_ADMIN') {
          const adminCount = await fastify.db.user.count({ where: { tenantId, role: 'TENANT_ADMIN', active: true } });
          if (adminCount <= 1) {
            throw new ForbiddenError('Cannot demote the last TENANT_ADMIN of the tenant');
          }
        }

        const updated = await fastify.db.user.update({
          where: { id: userId },
          data: {
            ...(parseResult.data.role ? { role: parseResult.data.role } : {}),
            ...(parseResult.data.active !== undefined ? { active: parseResult.data.active } : {}),
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            active: true,
            updatedAt: true,
          },
        });

        await fastify.auditLog(request, 'UPDATE_USER', 'User', userId, parseResult.data);
        return reply.status(200).send(ok(updated));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
  /**
   * PATCH /tenants/current/users/:userId
   * Update user profile (jobFunction, name, avatarUrl) — any authenticated user can update their own profile.
   */
  fastify.patch(
    '/current/users/:userId',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.params as { userId: string };
      const { tenantId } = request.user;
      const parseResult = updateUserProfileBodySchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      try {
        const target = await fastify.db.user.findFirst({ where: { id: userId, tenantId } });
        if (!target) throw new NotFoundError('User', userId);

        const updated = await fastify.db.user.update({
          where: { id: userId },
          data: {
            ...(parseResult.data.name !== undefined ? { name: parseResult.data.name } : {}),
            ...(parseResult.data.jobFunction !== undefined ? { jobFunction: parseResult.data.jobFunction } : {}),
            ...(parseResult.data.avatarUrl !== undefined ? { avatarUrl: parseResult.data.avatarUrl } : {}),
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            jobFunction: true,
            avatarUrl: true,
            active: true,
            updatedAt: true,
          },
        });

        await fastify.auditLog(request, 'UPDATE_USER_PROFILE', 'User', userId, { fields: Object.keys(parseResult.data) });
        return reply.status(200).send(ok(updated));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default tenantsRoutes;
