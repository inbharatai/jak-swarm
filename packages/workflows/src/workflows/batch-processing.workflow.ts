// Temporal workflow for batch document processing.
// Used when a tenant submits 10+ documents for processing — too long for a single agent step.
import { proxyActivities, sleep, defineSignal, setHandler } from '@temporalio/workflow';
import type * as activities from '../activities/document.activity.js';

const { processDocument, notifyProgress, saveDocumentResult } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3, initialInterval: '5s', backoffCoefficient: 2 },
});

export interface BatchProcessingInput {
  tenantId: string;
  workflowId: string;
  documentIds: string[];
  options: { summarize: boolean; extract: boolean; classify: boolean };
}

export interface BatchProcessingResult {
  processed: number;
  failed: number;
  results: Array<{ documentId: string; success: boolean; error?: string }>;
}

export const cancelSignal = defineSignal('cancel');

export async function batchDocumentProcessing(input: BatchProcessingInput): Promise<BatchProcessingResult> {
  let cancelled = false;
  setHandler(cancelSignal, () => { cancelled = true; });

  const results: BatchProcessingResult['results'] = [];
  let processed = 0;
  let failed = 0;

  for (const documentId of input.documentIds) {
    if (cancelled) break;

    try {
      const result = await processDocument({ tenantId: input.tenantId, documentId, options: input.options });
      await saveDocumentResult({ tenantId: input.tenantId, documentId, result });
      results.push({ documentId, success: true });
      processed++;
    } catch (err) {
      results.push({ documentId, success: false, error: err instanceof Error ? err.message : String(err) });
      failed++;
    }

    await notifyProgress({
      tenantId: input.tenantId,
      workflowId: input.workflowId,
      processed: processed + failed,
      total: input.documentIds.length,
    });

    // Yield to allow cancellation check between documents
    await sleep('100ms');
  }

  return { processed, failed, results };
}
