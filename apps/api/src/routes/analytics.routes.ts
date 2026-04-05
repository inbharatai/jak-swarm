import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { ok, err } from '../types.js';
import { AppError, NotFoundError } from '../errors.js';
import { calculateCost } from '@jak-swarm/shared';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface TokenUsageJson {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  model?: string;
  provider?: string;
}

function parseTokenUsage(raw: unknown): TokenUsageJson {
  if (!raw || typeof raw !== 'object') return {};
  return raw as TokenUsageJson;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /analytics/usage
   * Returns a TenantUsageSummary for the authenticated tenant.
   * Query params: from, to (ISO date strings), defaults to last 30 days.
   */
  fastify.get(
    '/usage',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { from?: string; to?: string };
      const tenantId = request.user.tenantId;

      const now = new Date();
      const fromDate = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 86_400_000);
      const toDate = query.to ? new Date(query.to) : now;

      try {
        // Fetch all traces in the period
        const traces = await fastify.db.agentTrace.findMany({
          where: {
            tenantId,
            startedAt: { gte: fromDate, lte: toDate },
          },
          select: {
            id: true,
            workflowId: true,
            agentRole: true,
            durationMs: true,
            tokenUsage: true,
            startedAt: true,
          },
        });

        // Fetch workflows for goal text
        const workflowIds = [...new Set(traces.map((t) => t.workflowId))];
        const workflows = await fastify.db.workflow.findMany({
          where: { id: { in: workflowIds } },
          select: { id: true, goal: true },
        });
        const goalMap = new Map(workflows.map((w) => [w.id, w.goal]));

        // Aggregate
        let totalPrompt = 0;
        let totalCompletion = 0;
        let totalTokens = 0;
        let totalCostUsd = 0;
        const costByProvider: Record<string, number> = {};
        const costByAgent: Record<string, number> = {};
        const workflowTokens: Record<string, number> = {};
        const workflowCosts: Record<string, number> = {};
        const dayBuckets: Record<string, { tokens: number; costUsd: number; workflows: Set<string> }> = {};

        for (const trace of traces) {
          const usage = parseTokenUsage(trace.tokenUsage);
          const prompt = usage.promptTokens ?? 0;
          const completion = usage.completionTokens ?? 0;
          const tokens = usage.totalTokens ?? prompt + completion;
          const model = usage.model ?? 'unknown';
          const provider = usage.provider ?? (model.startsWith('claude') ? 'anthropic' : 'openai');
          const cost = calculateCost(model, prompt, completion);

          totalPrompt += prompt;
          totalCompletion += completion;
          totalTokens += tokens;
          totalCostUsd += cost;

          costByProvider[provider] = (costByProvider[provider] ?? 0) + cost;
          costByAgent[trace.agentRole] = (costByAgent[trace.agentRole] ?? 0) + cost;

          workflowTokens[trace.workflowId] = (workflowTokens[trace.workflowId] ?? 0) + tokens;
          workflowCosts[trace.workflowId] = (workflowCosts[trace.workflowId] ?? 0) + cost;

          const day = toISODate(trace.startedAt);
          if (!dayBuckets[day]) {
            dayBuckets[day] = { tokens: 0, costUsd: 0, workflows: new Set() };
          }
          dayBuckets[day].tokens += tokens;
          dayBuckets[day].costUsd += cost;
          dayBuckets[day].workflows.add(trace.workflowId);
        }

        // Time series
        const timeSeries = Object.entries(dayBuckets)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([period, data]) => ({
            period,
            tokens: data.tokens,
            costUsd: Math.round(data.costUsd * 1_000_000) / 1_000_000,
            workflowCount: data.workflows.size,
          }));

        // Top workflows by cost
        const topWorkflows = Object.entries(workflowCosts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([id, costUsd]) => ({
            id,
            goal: goalMap.get(id) ?? 'Unknown',
            costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
            tokens: workflowTokens[id] ?? 0,
          }));

        const summary = {
          tenantId,
          period: { from: fromDate.toISOString(), to: toDate.toISOString() },
          totals: {
            tokens: totalTokens,
            costUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
            workflows: workflowIds.length,
          },
          timeSeries,
          topWorkflows,
          costByProvider,
          costByAgent,
        };

        return reply.status(200).send(ok(summary));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /analytics/usage/workflow/:workflowId
   * Returns a WorkflowUsageReport for a specific workflow.
   */
  fastify.get(
    '/usage/workflow/:workflowId',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workflowId } = request.params as { workflowId: string };
      const tenantId = request.user.tenantId;

      try {
        const traces = await fastify.db.agentTrace.findMany({
          where: { workflowId, tenantId },
          select: {
            agentRole: true,
            durationMs: true,
            tokenUsage: true,
            startedAt: true,
          },
        });

        if (traces.length === 0) {
          throw new NotFoundError('Workflow traces', workflowId);
        }

        let totalPrompt = 0;
        let totalCompletion = 0;
        let totalTokens = 0;
        let totalCostUsd = 0;
        let totalDurationMs = 0;
        const costByProvider: Record<string, number> = {};
        const costByAgent: Record<string, number> = {};
        const byModel: Record<string, { tokens: number; costUsd: number; calls: number }> = {};
        const durationByNode: Record<string, number> = {};

        for (const trace of traces) {
          const usage = parseTokenUsage(trace.tokenUsage);
          const prompt = usage.promptTokens ?? 0;
          const completion = usage.completionTokens ?? 0;
          const tokens = usage.totalTokens ?? prompt + completion;
          const model = usage.model ?? 'unknown';
          const provider = usage.provider ?? (model.startsWith('claude') ? 'anthropic' : 'openai');
          const cost = calculateCost(model, prompt, completion);
          const dur = trace.durationMs ?? 0;

          totalPrompt += prompt;
          totalCompletion += completion;
          totalTokens += tokens;
          totalCostUsd += cost;
          totalDurationMs += dur;

          costByProvider[provider] = (costByProvider[provider] ?? 0) + cost;
          costByAgent[trace.agentRole] = (costByAgent[trace.agentRole] ?? 0) + cost;
          durationByNode[trace.agentRole] = (durationByNode[trace.agentRole] ?? 0) + dur;

          if (!byModel[model]) byModel[model] = { tokens: 0, costUsd: 0, calls: 0 };
          byModel[model].tokens += tokens;
          byModel[model].costUsd += cost;
          byModel[model].calls += 1;
        }

        const report = {
          workflowId,
          tenantId,
          tokens: {
            promptTokens: totalPrompt,
            completionTokens: totalCompletion,
            totalTokens,
          },
          cost: {
            totalUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
            byProvider: costByProvider,
            byAgentRole: costByAgent,
            byModel,
          },
          duration: {
            totalMs: totalDurationMs,
            byNode: durationByNode,
          },
          timestamp: new Date().toISOString(),
        };

        return reply.status(200).send(ok(report));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  /**
   * GET /analytics/cost
   * Returns a cost breakdown for the current billing period (last 30 days).
   */
  fastify.get(
    '/cost',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.user.tenantId;
      const now = new Date();
      const fromDate = new Date(now.getTime() - 30 * 86_400_000);

      try {
        const traces = await fastify.db.agentTrace.findMany({
          where: {
            tenantId,
            startedAt: { gte: fromDate, lte: now },
          },
          select: {
            agentRole: true,
            tokenUsage: true,
          },
        });

        let totalUsd = 0;
        const byProvider: Record<string, number> = {};
        const byAgentRole: Record<string, number> = {};
        const byModel: Record<string, { tokens: number; costUsd: number; calls: number }> = {};

        for (const trace of traces) {
          const usage = parseTokenUsage(trace.tokenUsage);
          const prompt = usage.promptTokens ?? 0;
          const completion = usage.completionTokens ?? 0;
          const tokens = (usage.totalTokens ?? prompt + completion);
          const model = usage.model ?? 'unknown';
          const provider = usage.provider ?? (model.startsWith('claude') ? 'anthropic' : 'openai');
          const cost = calculateCost(model, prompt, completion);

          totalUsd += cost;
          byProvider[provider] = (byProvider[provider] ?? 0) + cost;
          byAgentRole[trace.agentRole] = (byAgentRole[trace.agentRole] ?? 0) + cost;

          if (!byModel[model]) byModel[model] = { tokens: 0, costUsd: 0, calls: 0 };
          byModel[model].tokens += tokens;
          byModel[model].costUsd += cost;
          byModel[model].calls += 1;
        }

        const breakdown = {
          totalUsd: Math.round(totalUsd * 1_000_000) / 1_000_000,
          byProvider,
          byAgentRole,
          byModel,
        };

        return reply.status(200).send(ok(breakdown));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default analyticsRoutes;
