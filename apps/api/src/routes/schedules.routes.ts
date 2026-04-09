import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import { ok, err } from '../types.js';
import { enforceTenantIsolation } from '../middleware/tenant-isolation.js';

const createScheduleSchema = z.object({
  name: z.string().min(1).max(200),
  goal: z.string().min(1).max(5000),
  cronExpression: z.string().min(5).max(100),
  description: z.string().max(2000).optional(),
  industry: z.string().max(100).optional(),
  maxCostUsd: z.number().positive().optional(),
});

const updateScheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  goal: z.string().min(1).max(5000).optional(),
  cronExpression: z.string().min(5).max(100).optional(),
  description: z.string().max(2000).optional(),
  industry: z.string().max(100).optional(),
  maxCostUsd: z.number().positive().nullable().optional(),
  enabled: z.boolean().optional(),
});

const schedulesRoutes: FastifyPluginAsync = async (fastify) => {
  const preHandlerBase = [fastify.authenticate, enforceTenantIsolation];

  /**
   * GET /schedules
   * List all schedules for tenant.
   */
  fastify.get(
    '/',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.user;
      const schedules = await fastify.db.workflowSchedule.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(ok(schedules));
    },
  );

  /**
   * GET /schedules/:id
   * Get a single schedule.
   */
  fastify.get(
    '/:id',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;
      const schedule = await fastify.db.workflowSchedule.findFirst({ where: { id, tenantId } });
      if (!schedule) return reply.code(404).send(err('NOT_FOUND', 'Schedule not found'));
      return reply.send(ok(schedule));
    },
  );

  /**
   * POST /schedules
   * Create a new schedule.
   */
  fastify.post(
    '/',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.user;
      const parsed = createScheduleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(err('VALIDATION_ERROR', parsed.error.message));
      }
      const body = parsed.data;

      if (!body.name || !body.goal || !body.cronExpression) {
        return reply.code(400).send(err('VALIDATION_ERROR', 'name, goal, and cronExpression are required'));
      }

      // Validate cron expression
      try {
        CronExpressionParser.parse(body.cronExpression);
      } catch {
        return reply.code(400).send(
          err('VALIDATION_ERROR', 'Invalid cron expression. Use standard 5-field format: "minute hour dayOfMonth month dayOfWeek"'),
        );
      }

      // Calculate first nextRunAt
      const expr = CronExpressionParser.parse(body.cronExpression);
      const nextRunAt = expr.next().toDate();

      const schedule = await fastify.db.workflowSchedule.create({
        data: {
          tenantId,
          userId,
          name: body.name,
          goal: body.goal,
          cronExpression: body.cronExpression,
          description: body.description,
          industry: body.industry,
          maxCostUsd: body.maxCostUsd,
          nextRunAt,
        },
      });

      return reply.code(201).send(ok(schedule));
    },
  );

  /**
   * PATCH /schedules/:id
   * Update a schedule.
   */
  fastify.patch(
    '/:id',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;
      const parsed = updateScheduleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(err('VALIDATION_ERROR', parsed.error.message));
      }
      const updates: Record<string, unknown> = { ...parsed.data };

      const existing = await fastify.db.workflowSchedule.findFirst({ where: { id, tenantId } });
      if (!existing) return reply.code(404).send(err('NOT_FOUND', 'Schedule not found'));

      // If cron expression changed, recalculate nextRunAt
      if (updates.cronExpression && typeof updates.cronExpression === 'string') {
        try {
          const expr = CronExpressionParser.parse(updates.cronExpression);
          updates.nextRunAt = expr.next().toDate();
        } catch {
          return reply.code(400).send(err('VALIDATION_ERROR', 'Invalid cron expression'));
        }
      }

      // If re-enabled, recalculate nextRunAt
      if (updates.enabled === true && !existing.enabled) {
        const cron = (updates.cronExpression as string) ?? existing.cronExpression;
        const expr = CronExpressionParser.parse(cron);
        updates.nextRunAt = expr.next().toDate();
      }

      const schedule = await fastify.db.workflowSchedule.update({
        where: { id },
        data: updates as any,
      });

      return reply.send(ok(schedule));
    },
  );

  /**
   * DELETE /schedules/:id
   * Delete a schedule.
   */
  fastify.delete(
    '/:id',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;

      await fastify.db.workflowSchedule.deleteMany({ where: { id, tenantId } });
      return reply.code(204).send();
    },
  );

  /**
   * POST /schedules/:id/run
   * Trigger an immediate run.
   */
  fastify.post(
    '/:id/run',
    { preHandler: preHandlerBase },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;

      const schedule = await fastify.db.workflowSchedule.findFirst({ where: { id, tenantId } });
      if (!schedule) return reply.code(404).send(err('NOT_FOUND', 'Schedule not found'));

      // Create a workflow record and kick off execution
      const workflow = await fastify.db.workflow.create({
        data: {
          tenantId: schedule.tenantId,
          userId: schedule.userId,
          goal: schedule.goal,
          industry: schedule.industry,
          status: 'PENDING',
        },
      });

      setImmediate(() => {
        void fastify.swarm.executeAsync({
          workflowId: workflow.id,
          tenantId: schedule.tenantId,
          userId: schedule.userId,
          goal: schedule.goal,
          industry: schedule.industry ?? undefined,
        });
      });

      // Update last run info
      await fastify.db.workflowSchedule.update({
        where: { id },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: 'RUNNING',
          lastRunId: workflow.id,
          runCount: { increment: 1 },
        },
      });

      return reply.send(ok({ workflowId: workflow.id, message: 'Workflow triggered' }));
    },
  );
};

export default schedulesRoutes;
