import { Context } from '@temporalio/activity';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface GatherMetricsInput { tenantId: string; reportType: string; industry: string }
export interface MetricsData { [key: string]: number | string }
export interface ReportData { title: string; generatedAt: string; metrics: MetricsData; sections: Array<{ name: string; content: string }> }

export async function gatherMetrics(input: GatherMetricsInput): Promise<MetricsData> {
  Context.current().heartbeat();

  const now = new Date();
  const periodStart = new Date(now);
  if (input.reportType === 'daily') periodStart.setDate(now.getDate() - 1);
  else if (input.reportType === 'weekly') periodStart.setDate(now.getDate() - 7);
  else periodStart.setMonth(now.getMonth() - 1);

  const [workflows, approvals, traces] = await Promise.all([
    prisma.workflow.findMany({
      where: { tenantId: input.tenantId, startedAt: { gte: periodStart } },
      select: { status: true, totalCostUsd: true },
    }),
    prisma.approvalRequest.count({
      where: { tenantId: input.tenantId, status: 'APPROVED', createdAt: { gte: periodStart } },
    }),
    prisma.agentTrace.findMany({
      where: { tenantId: input.tenantId, startedAt: { gte: periodStart } },
      select: { durationMs: true },
    }),
  ]);

  // Prisma 6's select-typed rows don't always infer in strict mode under
  // workspace linking; explicit types on the callback params keep the
  // reducer readable without a full runtime-type gymnastic pass.
  type WorkflowRow = { status: string; totalCostUsd: number | null };
  type TraceRow = { durationMs: number | null };
  const completed = (workflows as WorkflowRow[]).filter((w) => w.status === 'COMPLETED').length;
  const failed = (workflows as WorkflowRow[]).filter((w) => w.status === 'FAILED').length;
  const totalCost = (workflows as WorkflowRow[]).reduce(
    (sum: number, w) => sum + (w.totalCostUsd ?? 0),
    0,
  );
  const durations = (traces as TraceRow[])
    .filter((t) => t.durationMs != null)
    .map((t) => t.durationMs as number);
  const avgLatency = durations.length > 0
    ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
    : 0;

  return {
    period: input.reportType,
    workflowsCompleted: completed,
    workflowsFailed: failed,
    workflowsTotal: workflows.length,
    approvalsGranted: approvals,
    agentSteps: traces.length,
    avgLatencyMs: avgLatency,
    totalCostUsd: Math.round(totalCost * 10000) / 10000,
    industry: input.industry,
  };
}

export async function generateReport(input: { tenantId: string; metrics: MetricsData; reportType: string }): Promise<ReportData> {
  Context.current().heartbeat();

  const m = input.metrics;
  const successRate = Number(m['workflowsTotal']) > 0
    ? Math.round((Number(m['workflowsCompleted']) / Number(m['workflowsTotal'])) * 100)
    : 0;

  const sections: Array<{ name: string; content: string }> = [
    {
      name: 'Executive Summary',
      content: `${input.reportType.charAt(0).toUpperCase() + input.reportType.slice(1)} report for ${m['industry'] ?? 'your organization'}. `
        + `${m['workflowsCompleted']} of ${m['workflowsTotal']} workflows completed (${successRate}% success rate). `
        + `Total cost: $${m['totalCostUsd']}.`,
    },
    {
      name: 'Workflow Performance',
      content: `Completed: ${m['workflowsCompleted']} | Failed: ${m['workflowsFailed']} | Total: ${m['workflowsTotal']}\n`
        + `Average agent step latency: ${m['avgLatencyMs']}ms across ${m['agentSteps']} steps.`,
    },
    {
      name: 'Approvals & Compliance',
      content: `${m['approvalsGranted']} approval requests granted during this period.`,
    },
    {
      name: 'Cost Analysis',
      content: `Total LLM spend: $${m['totalCostUsd']}. `
        + `Average cost per workflow: $${Number(m['workflowsTotal']) > 0 ? (Number(m['totalCostUsd']) / Number(m['workflowsTotal'])).toFixed(4) : '0'}.`,
    },
  ];

  return {
    title: `${input.reportType.charAt(0).toUpperCase() + input.reportType.slice(1)} Operations Report`,
    generatedAt: new Date().toISOString(),
    metrics: m,
    sections,
  };
}

export async function deliverReport(input: { tenantId: string; report: ReportData; deliveryConfig: { email?: string[]; webhook?: string } }): Promise<void> {
  Context.current().heartbeat();

  const reportBody = input.report.sections.map(s => `## ${s.name}\n${s.content}`).join('\n\n');

  if (input.deliveryConfig.webhook) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(input.deliveryConfig.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: input.report, tenantId: input.tenantId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.error(`[Temporal] Webhook delivery failed: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      console.error(`[Temporal] Webhook delivery error:`, err);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (input.deliveryConfig.email?.length) {
    // Store the report in TenantMemory so the email agent can access it
    await prisma.tenantMemory.create({
      data: {
        tenantId: input.tenantId,
        key: `report_${Date.now()}`,
        value: {
          title: input.report.title,
          body: reportBody,
          recipients: input.deliveryConfig.email,
        },
        source: 'temporal:scheduled-report',
        memoryType: 'REPORT',
      },
    });
    console.info(`[Temporal] Report stored for email delivery to: ${input.deliveryConfig.email.join(', ')}`);
  }
}
