/**
 * team.routes.ts — Department / org-chart CRUD + team-member directory.
 *
 * RBAC:
 *   - GET (list / detail / members): any authed tenant member
 *   - POST / PATCH / DELETE department: TENANT_ADMIN+
 *   - PATCH user-membership (assign user to department / set manager): TENANT_ADMIN+
 *
 * The /team UI page calls these to render an org chart + a searchable
 * directory the CEO uses when assigning a workflow step to a human.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { AppError, NotFoundError, ValidationError } from '../errors.js';

const createDeptSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  parentId: z.string().nullable().optional(),
});

const updateDeptSchema = createDeptSchema.partial();

const deleteDeptParamsSchema = z.object({
  id: z.string().min(1),
});

const updateMembershipSchema = z.object({
  departmentId: z.string().nullable().optional(),
  jobTitle: z.string().max(120).nullable().optional(),
  managerId: z.string().nullable().optional(),
});

const teamRoutes: FastifyPluginAsync = async (fastify) => {
  const writeAdmin = [
    fastify.authenticate,
    fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
  ];
  const auth = [fastify.authenticate];

  // ────────────── Departments ──────────────

  /** GET /team/departments — list this tenant's departments (with member counts). */
  fastify.get('/departments', { preHandler: auth }, async (request, reply) => {
    try {
      const tenantId = request.user.tenantId;
      const departments = await fastify.db.department.findMany({
        where: { tenantId },
        orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { members: true, children: true } },
        },
      });
      return reply.status(200).send(ok({ items: departments, count: departments.length }));
    } catch (e) {
      if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
      request.log.error({ err: e }, 'Failed to list departments');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /** GET /team/departments/:id — detail + members. */
  fastify.get('/departments/:id', { preHandler: auth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const tenantId = request.user.tenantId;
      const dept = await fastify.db.department.findFirst({
        where: { id, tenantId },
        include: {
          members: {
            select: { id: true, name: true, email: true, jobTitle: true, role: true, active: true },
          },
          children: { select: { id: true, name: true } },
          parent: { select: { id: true, name: true } },
        },
      });
      if (!dept) return reply.status(404).send(err('NOT_FOUND', 'Department not found'));
      return reply.status(200).send(ok(dept));
    } catch (e) {
      if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
      request.log.error({ err: e }, 'Failed to get department');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /** POST /team/departments — create department. */
  fastify.post('/departments', { preHandler: writeAdmin }, async (request, reply) => {
    const parsed = createDeptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(422)
        .send(err('VALIDATION_ERROR', 'Invalid body', parsed.error.flatten()));
    }
    try {
      const tenantId = request.user.tenantId;
      // Parent must belong to this tenant if specified.
      if (parsed.data.parentId) {
        const parent = await fastify.db.department.findFirst({
          where: { id: parsed.data.parentId, tenantId },
          select: { id: true },
        });
        if (!parent) throw new ValidationError('parentId is not in this tenant');
      }
      const dept = await fastify.db.department.create({
        data: {
          tenantId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          parentId: parsed.data.parentId ?? null,
        },
      });
      return reply.status(201).send(ok(dept));
    } catch (e) {
      if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
      // Unique-constraint collision on (tenantId, name).
      if ((e as { code?: string }).code === 'P2002') {
        return reply
          .status(409)
          .send(err('CONFLICT', 'A department with that name already exists in this tenant'));
      }
      throw e;
    }
  });

  /** PATCH /team/departments/:id — update name/description/parent. */
  fastify.patch('/departments/:id', { preHandler: writeAdmin }, async (request, reply) => {
    const parsed = updateDeptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(422)
        .send(err('VALIDATION_ERROR', 'Invalid body', parsed.error.flatten()));
    }
    try {
      const { id } = request.params as { id: string };
      const tenantId = request.user.tenantId;
      const existing = await fastify.db.department.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError('Department', id);

      // P0-8 (audit 2026-05-08): full ancestor-cycle prevention.
      // Direct self-parent (A→A) is one case. Indirect cycles are A→B→C→A
      // and arbitrary depth. Walk parent chain from the proposed parent and
      // refuse if we ever encounter `id` (the dept being updated). Cap the
      // walk depth at 64 to avoid pathological loops if a cycle was somehow
      // already inserted by an older code path.
      if (parsed.data.parentId !== undefined && parsed.data.parentId !== null) {
        if (parsed.data.parentId === id) {
          throw new ValidationError('A department cannot be its own parent');
        }
        let cursor: string | null = parsed.data.parentId;
        const seen = new Set<string>();
        for (let i = 0; i < 64 && cursor; i++) {
          if (cursor === id) {
            throw new ValidationError('Reparenting would create a cycle in the org chart');
          }
          if (seen.has(cursor)) {
            throw new ValidationError('Existing parent chain already contains a cycle (data corruption — contact admin)');
          }
          seen.add(cursor);
          const parent: { parentId: string | null } | null = await fastify.db.department.findFirst({
            where: { id: cursor, tenantId },
            select: { parentId: true },
          });
          if (!parent) throw new ValidationError('parentId is not in this tenant');
          cursor = parent.parentId;
        }
      }

      const dept = await fastify.db.department.update({
        where: { id },
        data: parsed.data,
      });
      return reply.status(200).send(ok(dept));
    } catch (e) {
      if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
      throw e;
    }
  });

  /** DELETE /team/departments/:id — soft-delete (sets parentId on children to null + members to null). */
  fastify.delete('/departments/:id', { preHandler: writeAdmin }, async (request, reply) => {
    try {
      const paramsParsed = deleteDeptParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid params', paramsParsed.error.flatten()));
      }
      const { id } = paramsParsed.data;
      const tenantId = request.user.tenantId;
      const existing = await fastify.db.department.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send(err('NOT_FOUND', 'Department not found'));

      // FK on departmentId is SET NULL; children too via parentId. Hard-delete is fine.
      await fastify.db.department.delete({ where: { id } });
      return reply.status(204).send();
    } catch (e) {
      if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
      request.log.error({ err: e }, 'Failed to delete department');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ────────────── Members / directory ──────────────

  /** GET /team/members — searchable directory of all active users in this tenant. */
  fastify.get('/members', { preHandler: auth }, async (request, reply) => {
    try {
      const tenantId = request.user.tenantId;
      const q = (request.query as { q?: string; departmentId?: string })?.q?.trim();
      const departmentId = (request.query as { departmentId?: string })?.departmentId;

      const where: Record<string, unknown> = { tenantId, active: true };
      if (departmentId) where.departmentId = departmentId;
      if (q) {
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { jobTitle: { contains: q, mode: 'insensitive' } },
        ];
      }

      const members = await fastify.db.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          jobTitle: true,
          role: true,
          departmentId: true,
          managerId: true,
          avatarUrl: true,
          department: { select: { id: true, name: true } },
          manager: { select: { id: true, name: true, email: true } },
        },
        orderBy: { name: 'asc' },
        take: 200,
      });
      return reply.status(200).send(ok({ items: members, count: members.length }));
    } catch (e) {
      if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
      request.log.error({ err: e }, 'Failed to list team members');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /** PATCH /team/members/:userId — update department / jobTitle / manager. */
  fastify.patch('/members/:userId', { preHandler: writeAdmin }, async (request, reply) => {
    const parsed = updateMembershipSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(422)
        .send(err('VALIDATION_ERROR', 'Invalid body', parsed.error.flatten()));
    }
    try {
      const { userId } = request.params as { userId: string };
      const tenantId = request.user.tenantId;

      const target = await fastify.db.user.findFirst({
        where: { id: userId, tenantId },
        select: { id: true },
      });
      if (!target) throw new NotFoundError('User', userId);

      // Cross-tenant check on departmentId + managerId.
      if (parsed.data.departmentId) {
        const dept = await fastify.db.department.findFirst({
          where: { id: parsed.data.departmentId, tenantId },
          select: { id: true },
        });
        if (!dept) throw new ValidationError('departmentId is not in this tenant');
      }
      if (parsed.data.managerId) {
        if (parsed.data.managerId === userId) {
          throw new ValidationError('A user cannot be their own manager');
        }
        const mgr = await fastify.db.user.findFirst({
          where: { id: parsed.data.managerId, tenantId },
          select: { id: true },
        });
        if (!mgr) throw new ValidationError('managerId is not a member of this tenant');
      }

      const updated = await fastify.db.user.update({
        where: { id: userId },
        data: parsed.data,
        select: {
          id: true,
          name: true,
          email: true,
          jobTitle: true,
          role: true,
          departmentId: true,
          managerId: true,
        },
      });
      return reply.status(200).send(ok(updated));
    } catch (e) {
      if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
      throw e;
    }
  });
};

export default teamRoutes;
