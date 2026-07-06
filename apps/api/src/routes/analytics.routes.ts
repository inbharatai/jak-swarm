import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { ok, err } from '../types.js';
import { AppError, NotFoundError } from '../errors.js';
import { calculateCost } from '@jak-swarm/shared';
import {
  canRevealProviderIdentity,
  redactModelCosts,
  redactProviderCosts,
} from '../security/provider-privacy.js';

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

// Nearest-rank percentile (p must be 0-100). Returns 0 for an empty sample.
// Honest: no interpolation, no smoothing — the value at the ceil(p/100*n) rank.
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0] ?? 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(Math.max(rank, 1) - 1, sortedAsc.length - 1);
  return sortedAsc[idx] ?? 0;
}

// toolCallsJson is persisted inconsistently — sometimes `{ calls: [...] }`,
// sometimes a bare array. Normalise to an array of call records. Each record
// carries toolName / durationMs / error (the shared ToolCall shape). There is
// no persisted `outcome` field, so success = (error absent) — honest given
// what is actually stored.
interface StoredToolCall {
  toolName?: string;
  durationMs?: number;
  error?: string | null;
}
function readToolCalls(raw: unknown): StoredToolCall[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as StoredToolCall[];
  if (typeof raw === 'object' && Array.isArray((raw as { calls?: unknown }).calls)) {
    return (raw as { calls: StoredToolCall[] }).calls;
  }
  return [];
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
      const allowIdentity = canRevealProviderIdentity(request.user.email);

      const now = new Date();
      const fromDate = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 86_400_000);
      const toDate = query.to ? new Date(query.to) : now;

      // Validate parsed dates
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return reply.code(400).send(err('VALIDATION_ERROR', 'Invalid date format. Use ISO 8601 (e.g. 2025-01-01)'));
      }

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
          const provider = usage.provider ?? 'openai';
          const cost = calculateCost(model, prompt, completion);

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
          costByProvider: redactProviderCosts(costByProvider, allowIdentity),
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
      const allowIdentity = canRevealProviderIdentity(request.user.email);

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
          const provider = usage.provider ?? 'openai';
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
            byProvider: redactProviderCosts(costByProvider, allowIdentity),
            byAgentRole: costByAgent,
            byModel: redactModelCosts(byModel, allowIdentity),
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
      const allowIdentity = canRevealProviderIdentity(request.user.email);
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
          const provider = usage.provider ?? 'openai';
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
          byProvider: redactProviderCosts(byProvider, allowIdentity),
          byAgentRole,
          byModel: redactModelCosts(byModel, allowIdentity),
        };

        return reply.status(200).send(ok(breakdown));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  // ───────────────────────────────────────────────────────────────────────
  // GET /analytics/tools — per-tool success + duration aggregation from the
  // toolCallsJson persisted on every AgentTrace. Honest: success = no `error`
  // field on the stored call (the shared ToolCall shape has no persisted
  // `outcome`; the web-only outcome badge is resolved client-side). Traces
  // with no tool calls are counted in `tracesWithoutTools` — never faked.
  // Query: from, to (ISO), defaults last 30 days.
  // ───────────────────────────────────────────────────────────────────────
  fastify.get(
    '/tools',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { from?: string; to?: string };
      const tenantId = request.user.tenantId;
      const now = new Date();
      const fromDate = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 86_400_000);
      const toDate = query.to ? new Date(query.to) : now;
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return reply.code(400).send(err('VALIDATION_ERROR', 'Invalid date format. Use ISO 8601 (e.g. 2025-01-01)'));
      }

      try {
        const traces = await fastify.db.agentTrace.findMany({
          where: { tenantId, startedAt: { gte: fromDate, lte: toDate } },
          select: { toolCallsJson: true },
        });

        const byTool: Record<string, { count: number; successCount: number; failCount: number; durations: number[] }> = {};
        let tracesWithoutTools = 0;
        let totalCalls = 0;

        for (const trace of traces) {
          const calls = readToolCalls(trace.toolCallsJson);
          if (calls.length === 0) {
            tracesWithoutTools += 1;
            continue;
          }
          for (const c of calls) {
            const name = c.toolName ?? 'unknown';
            const dur = typeof c.durationMs === 'number' ? c.durationMs : 0;
            const failed = Boolean(c.error);
            if (!byTool[name]) byTool[name] = { count: 0, successCount: 0, failCount: 0, durations: [] };
            byTool[name].count += 1;
            if (failed) byTool[name].failCount += 1;
            else byTool[name].successCount += 1;
            byTool[name].durations.push(dur);
            totalCalls += 1;
          }
        }

        const tools = Object.entries(byTool)
          .map(([name, s]) => {
            const sorted = s.durations.slice().sort((a, b) => a - b);
            return {
              toolName: name,
              count: s.count,
              successCount: s.successCount,
              failCount: s.failCount,
              successRate: s.count === 0 ? 0 : Math.round((s.successCount / s.count) * 1000) / 1000,
              avgDurationMs: sorted.length === 0 ? 0 : Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
              p50DurationMs: percentile(sorted, 50),
              p95DurationMs: percentile(sorted, 95),
            };
          })
          .sort((a, b) => b.count - a.count);

        return reply.status(200).send(ok({
          tenantId,
          period: { from: fromDate.toISOString(), to: toDate.toISOString() },
          tracesExamined: traces.length,
          tracesWithoutTools,
          totalToolCalls: totalCalls,
          tools,
        }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  // ───────────────────────────────────────────────────────────────────────
  // GET /analytics/routing — SYSTEM_ADMIN only. RoutingLog is NOT
  // tenant-scoped (it has no tenantId column), so this must never be exposed
  // to a TENANT_ADMIN. Aggregates by model / provider / taskType, fallback
  // rate, average score, and top reasons.
  // ───────────────────────────────────────────────────────────────────────
  fastify.get(
    '/routing',
    {
      preHandler: [
        fastify.authenticate,
        ...(fastify.requireRole ? [fastify.requireRole('SYSTEM_ADMIN')] : []),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { from?: string; to?: string };
      const now = new Date();
      const fromDate = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 86_400_000);
      const toDate = query.to ? new Date(query.to) : now;
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return reply.code(400).send(err('VALIDATION_ERROR', 'Invalid date format. Use ISO 8601 (e.g. 2025-01-01)'));
      }

      try {
        const rows = await (fastify.db as any).routingLog.findMany({
          where: { createdAt: { gte: fromDate, lte: toDate } },
          select: {
            taskType: true,
            selectedModel: true,
            selectedProvider: true,
            fallbackUsed: true,
            score: true,
            reason: true,
          },
        });

        const byModel: Record<string, number> = {};
        const byProvider: Record<string, number> = {};
        const byTaskType: Record<string, number> = {};
        const reasons: Record<string, number> = {};
        let total = rows.length;
        let fallbackCount = 0;
        let scoreSum = 0;
        let scoreCount = 0;

        for (const r of rows) {
          byModel[r.selectedModel] = (byModel[r.selectedModel] ?? 0) + 1;
          byProvider[r.selectedProvider] = (byProvider[r.selectedProvider] ?? 0) + 1;
          byTaskType[r.taskType] = (byTaskType[r.taskType] ?? 0) + 1;
          if (r.fallbackUsed) fallbackCount += 1;
          if (typeof r.score === 'number') { scoreSum += r.score; scoreCount += 1; }
          if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
        }

        const topReasons = Object.entries(reasons)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([reason, count]) => ({ reason, count }));

        return reply.status(200).send(ok({
          period: { from: fromDate.toISOString(), to: toDate.toISOString() },
          total,
          fallbackRate: total === 0 ? 0 : Math.round((fallbackCount / total) * 1000) / 1000,
          avgScore: scoreCount === 0 ? 0 : Math.round((scoreSum / scoreCount) * 1000) / 1000,
          byModel,
          byProvider,
          byTaskType,
          topReasons,
          // Honest: RoutingLog has no tenantId — this is a platform-wide view.
          tenantScoped: false,
        }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  // ───────────────────────────────────────────────────────────────────────
  // GET /analytics/approvals/decisions — tenant-scoped, from ApprovalAuditLog.
  // Totals by decision, byAgentRole, byRiskLevel, plus auto/human approval
  // split + autoApprovalRate.
  // ───────────────────────────────────────────────────────────────────────
  fastify.get(
    '/approvals/decisions',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { from?: string; to?: string };
      const tenantId = request.user.tenantId;
      const now = new Date();
      const fromDate = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 86_400_000);
      const toDate = query.to ? new Date(query.to) : now;
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return reply.code(400).send(err('VALIDATION_ERROR', 'Invalid date format. Use ISO 8601 (e.g. 2025-01-01)'));
      }

      try {
        const rows = await (fastify.db as any).approvalAuditLog.findMany({
          where: { tenantId, decidedAt: { gte: fromDate, lte: toDate } },
          select: { decision: true, agentRole: true, riskLevel: true, autoApproved: true },
        });

        const totals: Record<string, number> = {};
        const byAgentRole: Record<string, number> = {};
        const byRiskLevel: Record<string, number> = {};
        let autoApproved = 0;
        let humanApproved = 0;

        for (const r of rows) {
          totals[r.decision] = (totals[r.decision] ?? 0) + 1;
          byAgentRole[r.agentRole] = (byAgentRole[r.agentRole] ?? 0) + 1;
          byRiskLevel[r.riskLevel] = (byRiskLevel[r.riskLevel] ?? 0) + 1;
          if (r.autoApproved) autoApproved += 1;
          else humanApproved += 1;
        }

        const total = rows.length;
        // autoApprovalRate = auto-approved / all decisions. Honest 0 when empty.
        const autoApprovalRate = total === 0 ? 0 : Math.round((autoApproved / total) * 1000) / 1000;

        return reply.status(200).send(ok({
          tenantId,
          period: { from: fromDate.toISOString(), to: toDate.toISOString() },
          total,
          totals,
          byAgentRole,
          byRiskLevel,
          autoApproved,
          humanApproved,
          autoApprovalRate,
        }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  // ───────────────────────────────────────────────────────────────────────
  // GET /analytics/intents — tenant-scoped, from IntentRecord. byIntent
  // (count + avgConfidence + clarificationRate), urgencyDistribution (1-5),
  // topRiskIndicators, overall clarificationRate.
  // ───────────────────────────────────────────────────────────────────────
  fastify.get(
    '/intents',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { from?: string; to?: string };
      const tenantId = request.user.tenantId;
      const now = new Date();
      const fromDate = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 86_400_000);
      const toDate = query.to ? new Date(query.to) : now;
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return reply.code(400).send(err('VALIDATION_ERROR', 'Invalid date format. Use ISO 8601 (e.g. 2025-01-01)'));
      }

      try {
        const rows = await (fastify.db as any).intentRecord.findMany({
          where: { tenantId, createdAt: { gte: fromDate, lte: toDate } },
          select: { intent: true, intentConfidence: true, urgency: true, riskIndicators: true, clarificationNeeded: true },
        });

        const byIntent: Record<string, { count: number; confidenceSum: number; confidenceCount: number; clarifications: number }> = {};
        const urgencyDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        const riskIndicators: Record<string, number> = {};
        let total = rows.length;
        let totalClarifications = 0;

        for (const r of rows) {
          const bucket = byIntent[r.intent] ?? { count: 0, confidenceSum: 0, confidenceCount: 0, clarifications: 0 };
          byIntent[r.intent] = bucket;
          bucket.count += 1;
          if (typeof r.intentConfidence === 'number') {
            bucket.confidenceSum += r.intentConfidence;
            bucket.confidenceCount += 1;
          }
          if (r.clarificationNeeded) {
            bucket.clarifications += 1;
            totalClarifications += 1;
          }
          if (typeof r.urgency === 'number' && r.urgency >= 1 && r.urgency <= 5) {
            urgencyDistribution[r.urgency] = (urgencyDistribution[r.urgency] ?? 0) + 1;
          }
          if (Array.isArray(r.riskIndicators)) {
            for (const ind of r.riskIndicators as unknown[]) {
              if (typeof ind === 'string') riskIndicators[ind] = (riskIndicators[ind] ?? 0) + 1;
            }
          }
        }

        const intents = Object.entries(byIntent)
          .map(([intent, s]) => ({
            intent,
            count: s.count,
            avgConfidence: s.confidenceCount === 0 ? 0 : Math.round((s.confidenceSum / s.confidenceCount) * 1000) / 1000,
            clarificationRate: s.count === 0 ? 0 : Math.round((s.clarifications / s.count) * 1000) / 1000,
          }))
          .sort((a, b) => b.count - a.count);

        const topRiskIndicators = Object.entries(riskIndicators)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([indicator, count]) => ({ indicator, count }));

        return reply.status(200).send(ok({
          tenantId,
          period: { from: fromDate.toISOString(), to: toDate.toISOString() },
          total,
          clarificationRate: total === 0 ? 0 : Math.round((totalClarifications / total) * 1000) / 1000,
          intents,
          urgencyDistribution,
          topRiskIndicators,
        }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );

  // ───────────────────────────────────────────────────────────────────────
  // GET /analytics/latency — tenant-scoped, from UsageLedger.latencyMs.
  // Overall p50/p90/p95/p99/avg + per-provider breakdown. Only rows with a
  // non-null latencyMs are counted; rows without latency are excluded
  // (never faked as 0).
  // ───────────────────────────────────────────────────────────────────────
  fastify.get(
    '/latency',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { from?: string; to?: string };
      const tenantId = request.user.tenantId;
      const now = new Date();
      const fromDate = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 86_400_000);
      const toDate = query.to ? new Date(query.to) : now;
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return reply.code(400).send(err('VALIDATION_ERROR', 'Invalid date format. Use ISO 8601 (e.g. 2025-01-01)'));
      }

      try {
        const rows = await (fastify.db as any).usageLedger.findMany({
          where: { tenantId, createdAt: { gte: fromDate, lte: toDate }, latencyMs: { not: null } },
          select: { latencyMs: true, provider: true },
        });

        const byProvider: Record<string, number[]> = {};
        const all: number[] = [];
        for (const r of rows) {
          const lat = typeof r.latencyMs === 'number' ? r.latencyMs : 0;
          all.push(lat);
          const p = r.provider ?? 'unknown';
          if (!byProvider[p]) byProvider[p] = [];
          byProvider[p].push(lat);
        }
        all.sort((a, b) => a - b);

        const providerStats = Object.entries(byProvider)
          .map(([provider, vals]) => {
            const sorted = vals.slice().sort((a, b) => a - b);
            return {
              provider,
              count: sorted.length,
              avgMs: sorted.length === 0 ? 0 : Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
              p50Ms: percentile(sorted, 50),
              p90Ms: percentile(sorted, 90),
              p95Ms: percentile(sorted, 95),
              p99Ms: percentile(sorted, 99),
            };
          })
          .sort((a, b) => b.count - a.count);

        return reply.status(200).send(ok({
          tenantId,
          period: { from: fromDate.toISOString(), to: toDate.toISOString() },
          samples: all.length,
          avgMs: all.length === 0 ? 0 : Math.round(all.reduce((a, b) => a + b, 0) / all.length),
          p50Ms: percentile(all, 50),
          p90Ms: percentile(all, 90),
          p95Ms: percentile(all, 95),
          p99Ms: percentile(all, 99),
          byProvider: providerStats,
        }));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default analyticsRoutes;
