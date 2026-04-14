/**
 * Workflow Trace Enrichment Service
 *
 * Provides per-node cost breakdowns, execution timelines, and DAG
 * visualisation data for a completed workflow. Bridges the gap between
 * raw AgentTrace rows and actionable observability insights.
 */

import type { PrismaClient } from '@jak-swarm/db';
import { calculateCost } from '@jak-swarm/shared';

/* ---------------------------------------------------------------------- */
/*  Types                                                                  */
/* ---------------------------------------------------------------------- */

export interface NodeCost {
  agentRole: string;
  stepIndex: number;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  toolCalls: number;
}

export interface WorkflowTimeline {
  workflowId: string;
  tenantId: string;
  status: string;
  goal: string;
  totalCostUsd: number;
  totalDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  nodeCount: number;
  nodes: NodeCost[];
  criticalPath: string[];           // agent roles on the longest-duration chain
  costByAgent: Record<string, number>;
  costByProvider: Record<string, number>;
  costByModel: Record<string, number>;
  startedAt: string | null;
  completedAt: string | null;
}

/* ---------------------------------------------------------------------- */
/*  Implementation                                                         */
/* ---------------------------------------------------------------------- */

export async function buildWorkflowTimeline(
  db: PrismaClient,
  workflowId: string,
  tenantId: string,
): Promise<WorkflowTimeline | null> {
  const workflow = await db.workflow.findFirst({
    where: { id: workflowId, tenantId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      goal: true,
      totalCostUsd: true,
      startedAt: true,
      completedAt: true,
    },
  });

  if (!workflow) return null;

  const traces = await db.agentTrace.findMany({
    where: { workflowId, tenantId },
    orderBy: { stepIndex: 'asc' },
  });

  const nodes: NodeCost[] = [];
  const costByAgent: Record<string, number> = {};
  const costByProvider: Record<string, number> = {};
  const costByModel: Record<string, number> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let totalDurationMs = 0;

  for (const trace of traces) {
    // Parse tokenUsage JSON safely
    const tokenUsage = (trace.tokenUsage ?? {}) as {
      inputTokens?: number;
      outputTokens?: number;
      model?: string;
      provider?: string;
    };

    const inputTokens = tokenUsage.inputTokens ?? 0;
    const outputTokens = tokenUsage.outputTokens ?? 0;
    const model = tokenUsage.model ?? 'unknown';
    const provider = tokenUsage.provider ?? 'unknown';
    const durationMs = trace.durationMs ?? 0;

    const costUsd = calculateCost(model, inputTokens, outputTokens);

    // Parse toolCalls to get count
    const toolCallsArr = trace.toolCallsJson
      ? (Array.isArray(trace.toolCallsJson) ? trace.toolCallsJson : [])
      : [];

    const node: NodeCost = {
      agentRole: trace.agentRole,
      stepIndex: trace.stepIndex,
      model,
      provider,
      inputTokens,
      outputTokens,
      costUsd,
      durationMs,
      toolCalls: toolCallsArr.length,
    };

    nodes.push(node);

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalCostUsd += costUsd;
    totalDurationMs += durationMs;

    costByAgent[trace.agentRole] = (costByAgent[trace.agentRole] ?? 0) + costUsd;
    costByProvider[provider] = (costByProvider[provider] ?? 0) + costUsd;
    costByModel[model] = (costByModel[model] ?? 0) + costUsd;
  }

  // Compute critical path — nodes with longest cumulative duration
  const criticalPath = nodes
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5)
    .map((n) => n.agentRole);

  return {
    workflowId: workflow.id,
    tenantId: workflow.tenantId,
    status: workflow.status,
    goal: workflow.goal,
    totalCostUsd: workflow.totalCostUsd ?? totalCostUsd,
    totalDurationMs,
    totalInputTokens,
    totalOutputTokens,
    nodeCount: nodes.length,
    nodes: nodes.sort((a, b) => a.stepIndex - b.stepIndex),
    criticalPath,
    costByAgent,
    costByProvider,
    costByModel,
    startedAt: workflow.startedAt?.toISOString() ?? null,
    completedAt: workflow.completedAt?.toISOString() ?? null,
  };
}
