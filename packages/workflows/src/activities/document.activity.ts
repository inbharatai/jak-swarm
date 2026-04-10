import { Context } from '@temporalio/activity';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export interface ProcessDocumentInput {
  tenantId: string;
  documentId: string;
  options: { summarize: boolean; extract: boolean; classify: boolean };
}

export interface DocumentProcessingResult {
  documentId: string;
  summary?: string;
  extractedData?: Record<string, unknown>;
  classification?: string;
  confidence: number;
  processedAt: string;
}

export async function processDocument(input: ProcessDocumentInput): Promise<DocumentProcessingResult> {
  Context.current().heartbeat();

  const result: DocumentProcessingResult = {
    documentId: input.documentId,
    confidence: 0,
    processedAt: new Date().toISOString(),
  };

  // Fetch the document content from the database
  const file = await prisma.projectFile.findFirst({
    where: { id: input.documentId },
    select: { content: true, path: true },
  });

  if (!file) {
    result.confidence = 0;
    return result;
  }

  const content = file.content ?? '';
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  if (input.options.summarize) {
    // Real extractive summary: take first meaningful paragraphs up to ~200 words
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 20);
    const summaryParts: string[] = [];
    let wordsUsed = 0;
    for (const para of paragraphs) {
      const paraWords = para.split(/\s+/).length;
      if (wordsUsed + paraWords > 200) break;
      summaryParts.push(para.trim());
      wordsUsed += paraWords;
    }
    result.summary = summaryParts.join('\n\n') || content.slice(0, 500);
    result.confidence = Math.min(0.6 + (wordCount > 100 ? 0.2 : 0) + (paragraphs.length > 3 ? 0.1 : 0), 0.95);
  }

  if (input.options.extract) {
    // Extract structured data: key-value pairs, dates, amounts
    const emailPattern = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
    const datePattern = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g;
    const amountPattern = /\$[\d,]+(?:\.\d{2})?/g;

    result.extractedData = {
      emails: [...new Set(content.match(emailPattern) ?? [])],
      dates: [...new Set(content.match(datePattern) ?? [])],
      amounts: [...new Set(content.match(amountPattern) ?? [])],
      wordCount,
      filePath: file.path,
    };
    result.confidence = Math.max(result.confidence, 0.8);
  }

  if (input.options.classify) {
    // Simple keyword-based classification
    const lower = content.toLowerCase();
    const categories: Record<string, string[]> = {
      INVOICE: ['invoice', 'bill', 'payment due', 'amount owed', 'remit to'],
      CONTRACT: ['agreement', 'terms and conditions', 'hereinafter', 'parties', 'whereas'],
      REPORT: ['summary', 'findings', 'analysis', 'recommendation', 'conclusion'],
      CORRESPONDENCE: ['dear', 'sincerely', 'regards', 'kind regards', 'thank you'],
      TECHNICAL: ['api', 'function', 'class', 'import', 'module', 'interface'],
    };

    let bestCategory = 'GENERAL';
    let bestScore = 0;
    for (const [category, keywords] of Object.entries(categories)) {
      const score = keywords.filter(kw => lower.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    result.classification = bestCategory;
    result.confidence = Math.max(result.confidence, bestScore >= 3 ? 0.85 : bestScore >= 1 ? 0.6 : 0.3);
  }

  return result;
}

export async function notifyProgress(input: { tenantId: string; workflowId: string; processed: number; total: number }): Promise<void> {
  Context.current().heartbeat();

  // Persist progress to the workflow's stateJson so SSE/polling clients can read it
  await prisma.workflow.update({
    where: { id: input.workflowId },
    data: {
      stateJson: {
        batchProgress: {
          processed: input.processed,
          total: input.total,
          percentage: Math.round((input.processed / input.total) * 100),
          updatedAt: new Date().toISOString(),
        },
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function saveDocumentResult(input: { tenantId: string; documentId: string; result: DocumentProcessingResult }): Promise<void> {
  Context.current().heartbeat();

  // Persist result to TenantMemory for retrieval by agents and UI
  await prisma.tenantMemory.create({
    data: {
      tenantId: input.tenantId,
      key: `doc_result_${input.documentId}`,
      value: JSON.parse(JSON.stringify(input.result)) as Prisma.InputJsonValue,
      source: 'temporal:batch-processing',
      memoryType: 'KNOWLEDGE',
    },
  });
}
