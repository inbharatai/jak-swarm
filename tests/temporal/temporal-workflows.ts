import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { batchDocumentProcessing, scheduledReport } from '../../packages/workflows/src/workflows/index.js';
import type { BatchProcessingInput } from '../../packages/workflows/src/workflows/batch-processing.workflow.js';

const TASK_QUEUE = 'test-queue';

async function runBatchProcessing(env: TestWorkflowEnvironment) {
  const activities = {
    processDocument: async () => ({ summary: 'ok', confidence: 0.9 }),
    saveDocumentResult: async () => undefined,
    notifyProgress: async () => undefined,
  };

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const workflowsPath = path.resolve(repoRoot, 'packages/workflows/src/workflows/index.ts');

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath,
    activities,
  });

  const run = worker.run();

  const client = env.workflowClient;
  const input: BatchProcessingInput = {
    tenantId: 't1',
    workflowId: 'wf1',
    documentIds: ['d1', 'd2'],
    options: { summarize: true, extract: false, classify: false },
  };

  const result = await client.execute(batchDocumentProcessing, {
    taskQueue: TASK_QUEUE,
    workflowId: 'test-batch',
    args: [input],
  });

  if (result.processed + result.failed !== 2) {
    throw new Error(`Expected 2 results, got ${result.processed + result.failed}`);
  }

  await worker.shutdown();
  await run;
  await env.teardown();
}

async function runScheduledReport(env: TestWorkflowEnvironment) {
  const activities = {
    gatherMetrics: async () => ({ workflowsCompleted: 1, workflowsTotal: 1, totalCostUsd: 0, industry: 'TECH' }),
    generateReport: async () => ({ title: 'Report', generatedAt: new Date().toISOString(), metrics: {}, sections: [] }),
    deliverReport: async () => undefined,
  };

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const workflowsPath = path.resolve(repoRoot, 'packages/workflows/src/workflows/index.ts');

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath,
    activities,
  });

  const run = worker.run();

  const client = env.workflowClient;
  await client.execute(scheduledReport, {
    taskQueue: TASK_QUEUE,
    workflowId: 'test-report',
    args: [{ tenantId: 't1', reportType: 'daily', industry: 'TECH', deliveryConfig: {} }],
  });

  await worker.shutdown();
  await run;
  await env.teardown();
}

async function main() {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  await runBatchProcessing(env);

  const env2 = await TestWorkflowEnvironment.createTimeSkipping();
  await runScheduledReport(env2);

  console.log('Temporal workflow tests passed');
}

main().catch((err) => {
  console.error('Temporal workflow tests failed:', err);
  process.exit(1);
});
