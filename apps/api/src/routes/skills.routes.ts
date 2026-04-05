import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ok, err } from '../types.js';
import { AppError, NotFoundError, ForbiddenError } from '../errors.js';
import type { SkillStatus } from '../types.js';

// SkillTier in DB is Int: 1=BUILTIN, 2=COMMUNITY, 3=TENANT
const TIER_MAP: Record<string, number> = {
  BUILTIN: 1,
  COMMUNITY: 2,
  TENANT: 3,
};

const proposeSkillBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()),
  permissions: z.array(z.string()),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  testCases: z.array(z.record(z.unknown())).min(1),
});


const skillsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /skills
   * List skills — global built-ins and tenant-specific skills.
   * Supports filtering by tier and status.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        tier?: string;
        status?: string;
        page?: string;
        limit?: string;
      };

      const VALID_TIERS = Object.keys(TIER_MAP);
      const VALID_STATUSES: SkillStatus[] = [
        'PROPOSED', 'SANDBOX_RUNNING', 'SANDBOX_PASSED', 'SANDBOX_FAILED',
        'APPROVED', 'REJECTED', 'DEPRECATED',
      ];

      const tierStr = query.tier;
      const status = query.status as SkillStatus | undefined;

      if (tierStr && !VALID_TIERS.includes(tierStr)) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Invalid tier '${tierStr}'`));
      }
      if (status && !VALID_STATUSES.includes(status)) {
        return reply.status(422).send(err('VALIDATION_ERROR', `Invalid status '${status}'`));
      }

      const tierNum = tierStr ? TIER_MAP[tierStr] : undefined;

      const page = Math.max(1, parseInt(query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
      const skip = (page - 1) * limit;

      try {
        const where = {
          AND: [
            // Show global skills OR the tenant's own skills
            {
              OR: [
                { tenantId: null },
                { tenantId: request.user.tenantId },
              ],
            },
            ...(tierNum !== undefined ? [{ tier: tierNum }] : []),
            ...(status ? [{ status }] : []),
          ],
        };

        const [total, skills] = await Promise.all([
          fastify.db.skill.count({ where }),
          fastify.db.skill.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
        ]);

        return reply
          .status(200)
          .send(ok({ items: skills, total, page, limit, hasMore: skip + skills.length < total }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /skills/propose
   * Propose a new skill for this tenant.
   */
  fastify.post(
    '/propose',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = proposeSkillBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply
          .status(422)
          .send(err('VALIDATION_ERROR', 'Invalid request body', parseResult.error.flatten()));
      }

      const { name, description, inputSchema, outputSchema, permissions, riskLevel, testCases } =
        parseResult.data;

      try {
        // Check name uniqueness within the tenant scope
        const existing = await fastify.db.skill.findFirst({
          where: { name, tenantId: request.user.tenantId },
        });
        if (existing) {
          return reply.status(409).send(err('CONFLICT', `Skill '${name}' already exists`));
        }

        const skill = await fastify.db.skill.create({
          data: {
            tenantId: request.user.tenantId,
            name,
            description,
            tier: TIER_MAP['TENANT'],
            status: 'PROPOSED',
            riskLevel,
            inputSchemaJson: inputSchema as object,
            outputSchemaJson: outputSchema as object,
            permissions,
            testCasesJson: testCases as object[],
          },
        });

        await fastify.auditLog(request, 'PROPOSE_SKILL', 'Skill', skill.id, { name, riskLevel });
        return reply.status(201).send(ok(skill));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /skills/:skillId
   * Get a skill by id — accessible if global or belongs to the tenant.
   */
  fastify.get(
    '/:skillId',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { skillId: string };

      try {
        const skill = await fastify.db.skill.findUnique({ where: { id: skillId } });
        if (!skill) throw new NotFoundError('Skill', skillId);

        // Access check: global skills are visible to all; tenant skills only to their tenant
        if (
          skill.tenantId !== null &&
          skill.tenantId !== request.user.tenantId &&
          request.user.role !== 'SYSTEM_ADMIN'
        ) {
          throw new ForbiddenError('Access to skill in another tenant is not allowed');
        }

        return reply.status(200).send(ok(skill));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /skills/:skillId/approve
   * Approve a proposed skill — TENANT_ADMIN only, scoped to their tenant.
   */
  fastify.post(
    '/:skillId/approve',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { skillId: string };

      try {
        const skill = await fastify.db.skill.findUnique({ where: { id: skillId } });
        if (!skill) throw new NotFoundError('Skill', skillId);

        if (skill.tenantId !== request.user.tenantId && request.user.role !== 'SYSTEM_ADMIN') {
          throw new ForbiddenError('Access to skill in another tenant is not allowed');
        }

        if (skill.status !== 'PROPOSED' && skill.status !== 'SANDBOX_PASSED') {
          return reply
            .status(409)
            .send(err('CONFLICT', `Cannot approve skill with status '${skill.status}'`));
        }

        const updated = await fastify.db.skill.update({
          where: { id: skillId },
          data: { status: 'APPROVED', approvedBy: request.user.userId, approvedAt: new Date() },
        });

        await fastify.auditLog(request, 'APPROVE_SKILL', 'Skill', skillId);
        return reply.status(200).send(ok(updated));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /skills/:skillId/reject
   * Reject a proposed skill — TENANT_ADMIN only.
   */
  fastify.post(
    '/:skillId/reject',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { skillId: string };
      const body = request.body as { reason?: string } | null;

      try {
        const skill = await fastify.db.skill.findUnique({ where: { id: skillId } });
        if (!skill) throw new NotFoundError('Skill', skillId);

        if (skill.tenantId !== request.user.tenantId && request.user.role !== 'SYSTEM_ADMIN') {
          throw new ForbiddenError('Access to skill in another tenant is not allowed');
        }

        if (skill.status === 'APPROVED' || skill.status === 'REJECTED') {
          return reply
            .status(409)
            .send(err('CONFLICT', `Cannot reject skill with status '${skill.status}'`));
        }

        const updated = await fastify.db.skill.update({
          where: { id: skillId },
          data: { status: 'REJECTED' },
        });

        await fastify.auditLog(request, 'REJECT_SKILL', 'Skill', skillId, {
          reason: body?.reason,
        });
        return reply.status(200).send(ok(updated));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * POST /skills/:skillId/sandbox
   * Trigger a sandbox test run for a proposed skill — TENANT_ADMIN only.
   */
  fastify.post(
    '/:skillId/sandbox',
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole('TENANT_ADMIN', 'SYSTEM_ADMIN'),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { skillId: string };

      try {
        const skill = await fastify.db.skill.findUnique({ where: { id: skillId } });
        if (!skill) throw new NotFoundError('Skill', skillId);

        if (skill.tenantId !== request.user.tenantId && request.user.role !== 'SYSTEM_ADMIN') {
          throw new ForbiddenError('Access to skill in another tenant is not allowed');
        }

        if (skill.status !== 'PROPOSED') {
          return reply
            .status(409)
            .send(err('CONFLICT', `Cannot run sandbox for skill with status '${skill.status}'`));
        }

        const updated = await fastify.db.skill.update({
          where: { id: skillId },
          data: { status: 'SANDBOX_RUNNING' },
        });

        await fastify.auditLog(request, 'SANDBOX_SKILL', 'Skill', skillId);

        // TODO: enqueue Temporal sandbox workflow here
        request.log.info({ skillId }, 'Skill sandbox run triggered');

        return reply.status(202).send(ok({ ...updated, message: 'Sandbox run enqueued' }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default skillsRoutes;
