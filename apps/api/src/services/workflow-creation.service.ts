import type { FastifyInstance, FastifyRequest } from 'fastify';
import { WorkflowService } from './workflow.service.js';
import { CreditService } from '../billing/credit-service.js';
import { detectTaskType, estimateCredits } from '../billing/model-router.js';
import { UsageCounterService } from './trial/usage-counter.service.js';
import { ok, err } from '../types.js';
import { AppError } from '../errors.js';

export async function createWorkflowOrchestration(
  fastify: FastifyInstance,
  request: FastifyRequest,
  workflowService: WorkflowService,
  data: {
    goal: string;
    industry?: string;
    roleModes?: string[];
    maxCostUsd?: number;
    conversationId?: string;
  },
): Promise<{ statusCode: number; body: unknown }> {
  const { goal, industry, roleModes, maxCostUsd, conversationId } = data;
  const ceoMode = roleModes?.includes('ceo') ? 'ceo' as const : undefined;
  const { tenantId, userId } = request.user;
  const requestId = request.id;

  try {
    // ── Migration 106 — trial daily-cap + expiry guard ───────────────
    const usageCounter = new UsageCounterService(fastify.db);
    const capCheck = await usageCounter.check(tenantId, 'agentRuns', 1);
    if (capCheck.trial.expired) {
      return {
        statusCode: 402,
        body: err('TRIAL_EXPIRED', 'Your 30-day free trial has ended. Please upgrade to continue.', {
          trialEndsAt: capCheck.trial.trialEndsAt?.toISOString() ?? null,
        }),
      };
    }
    if (!capCheck.allowed) {
      return {
        statusCode: 429,
        body: err('TRIAL_DAILY_CAP_HIT', `Daily ${capCheck.blockedBy} cap reached. Resets at UTC midnight.`, {
          resource: capCheck.blockedBy,
          counters: capCheck.counters,
          resetsAt: capCheck.resetsAt,
          daysRemaining: capCheck.trial.daysRemaining,
        }),
      };
    }

    // ── Credit check: estimate cost and verify user has budget ───────
    const creditService = new CreditService(fastify.db);
    const taskType = detectTaskType(goal);
    const usage = await creditService.getUsage(tenantId);
    const maxTier = usage?.maxModelTier ?? 1;
    const estimate = estimateCredits(goal, taskType, maxTier);
    const creditCheck = await creditService.checkCredits(tenantId, estimate.estimatedCredits);
    if (!creditCheck.allowed) {
      return {
        statusCode: 429,
        body: err('CREDIT_LIMIT', creditCheck.message ?? 'Credit limit reached', {
          reason: creditCheck.reason,
          remaining: creditCheck.remaining,
          estimatedCost: estimate.estimatedCredits,
        }),
      };
    }

    // Reserve credits before execution
    const reservation = await creditService.reserveCredits(tenantId, estimate.estimatedCredits);
    if (!reservation.allowed) {
      return {
        statusCode: 429,
        body: err('CREDIT_RESERVE_FAILED', reservation.message ?? 'Could not reserve credits'),
      };
    }

    // Ensure the conversation row exists before linking the workflow.
    if (conversationId) {
      await fastify.db.conversation.upsert({
        where: { id: conversationId },
        create: { id: conversationId, tenantId, userId, title: goal.slice(0, 120) },
        update: { updatedAt: new Date() },
      });
    }

    // 1. Persist the workflow record (PENDING)
    const workflow = await workflowService.createWorkflow(tenantId, userId, goal, industry, conversationId);

    // Persist the user message into the conversation thread
    if (conversationId) {
      await fastify.db.conversationMessage.create({
        data: {
          conversationId,
          workflowId: workflow.id,
          role: 'user',
          content: goal,
        },
      });
    }

    // Migration 106 — increment trial counter on success.
    void usageCounter.recordUsage(tenantId, 'agentRuns', 1).catch((e) => {
      fastify.log.warn({ tenantId, err: e }, '[trial-cap] recordUsage(agentRuns) failed');
    });

    // Persist queue execution intent
    await (fastify.db.workflow.update as any)({
      where: { id: workflow.id },
      data: {
        maxCostUsd: maxCostUsd ?? null,
        stateJson: {
          roleModes: roleModes ?? [],
          ceoMode: ceoMode ?? null,
          requestedAt: new Date().toISOString(),
          requestedBy: userId,
        },
      },
    });

    await fastify.auditLog(request, 'CREATE_WORKFLOW', 'Workflow', workflow.id, {
      goal, maxCostUsd, estimatedCredits: estimate.estimatedCredits, taskType,
    });

    // 2. Enqueue execution for queue-backed background processing
    const idempotencyKey = typeof request.headers['idempotency-key'] === 'string'
      ? request.headers['idempotency-key']
      : undefined;

    const subscriptionTier: 'free' | 'paid' = maxTier >= 2 ? 'paid' : 'free';

    fastify.swarm.enqueueExecution({
      workflowId: workflow.id,
      tenantId,
      userId,
      goal,
      industry,
      roleModes,
      maxCostUsd,
      conversationId,
      idempotencyKey,
      subscriptionTier,
      ceoMode,
    });

    fastify.log.info(
      {
        requestId,
        tenantId,
        userId,
        workflowId: workflow.id,
        kind: 'workflow_created',
      },
      '[workflows.create] workflow accepted and enqueued',
    );

    // 3. Return 202 with the created workflow + cost estimate
    return {
      statusCode: 202,
      body: ok({
        kind: 'workflow_created' as const,
        workflowId: workflow.id,
        ...workflow,
        estimatedCredits: estimate.estimatedCredits,
        creditsReserved: reservation.reserved,
        taskType,
        model: estimate.model,
      }),
    };
  } catch (e) {
    if (e instanceof AppError) {
      return {
        statusCode: e.statusCode,
        body: err(e.code, e.message),
      };
    }
    throw e;
  }
}
