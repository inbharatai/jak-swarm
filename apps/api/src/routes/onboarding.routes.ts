import type { FastifyInstance } from 'fastify';

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
    const { completedSteps, dismissed } = request.body as { completedSteps?: string[]; dismissed?: boolean };
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
