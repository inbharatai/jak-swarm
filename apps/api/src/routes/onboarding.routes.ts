import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const updateOnboardingSchema = z.object({
  completedSteps: z.array(z.string()).optional(),
  dismissed: z.boolean().optional(),
});

export async function onboardingRoutes(app: FastifyInstance) {
  // GET current onboarding state
  app.get('/onboarding/state', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user;
    const state = await app.db.onboardingState.findUnique({
      where: { tenantId },
    });
    return reply.send({ data: state ?? { completedSteps: [], dismissed: false } });
  });

  // POST update onboarding state
  app.post('/onboarding/state', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { tenantId } = request.user;
    const parsed = updateOnboardingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.message });
    }
    const { completedSteps, dismissed } = parsed.data;
    const state = await app.db.onboardingState.upsert({
      where: { tenantId },
      update: {
        ...(completedSteps !== undefined && { completedSteps }),
        ...(dismissed !== undefined && { dismissed }),
      },
      create: {
        tenantId,
        completedSteps: completedSteps ?? [],
        dismissed: dismissed ?? false,
      },
    });
    return reply.send({ data: state });
  });
}
