// Temporal workflow for scheduled report generation.
// Runs on a cron schedule — generates daily/weekly KPI reports for a tenant.
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities/report.activity.js';

const { gatherMetrics, generateReport, deliverReport } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 2, initialInterval: '30s' },
});

export interface ScheduledReportInput {
  tenantId: string;
  reportType: 'daily' | 'weekly' | 'monthly';
  industry: string;
  deliveryConfig: { email?: string[]; webhook?: string };
}

export async function scheduledReport(input: ScheduledReportInput): Promise<void> {
  const metrics = await gatherMetrics({ tenantId: input.tenantId, reportType: input.reportType, industry: input.industry });
  const report = await generateReport({ tenantId: input.tenantId, metrics, reportType: input.reportType });
  await deliverReport({ tenantId: input.tenantId, report, deliveryConfig: input.deliveryConfig });
}
