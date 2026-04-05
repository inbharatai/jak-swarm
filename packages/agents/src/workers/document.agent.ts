import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type DocumentAction = 'EXTRACT' | 'SUMMARIZE' | 'CLASSIFY' | 'GENERATE' | 'COMPARE';

export interface DocumentTask {
  action: DocumentAction;
  documentContent?: string;
  documentType?: string;
  extractionSchema?: Record<string, string>;
  compareDocuments?: string[];
  generatePrompt?: string;
}

export interface ExtractionField {
  field: string;
  value: string | null;
  confidence: number;
  sourceText?: string;
}

export interface DocumentResult {
  action: DocumentAction;
  extractedFields?: ExtractionField[];
  summary?: string;
  classification?: {
    documentType: string;
    category: string;
    confidence: number;
    tags: string[];
  };
  generatedContent?: string;
  comparisonResult?: {
    commonPoints: string[];
    differences: string[];
    recommendation: string;
  };
  overallConfidence: number;
}

const DOCUMENT_SUPPLEMENT = `You are a document processing agent. You excel at extracting, summarizing, classifying, and generating structured information from documents.

For EXTRACT: identify and extract fields from the schema. Return each field with confidence (0.0-1.0) and the source text.
For SUMMARIZE: provide a structured summary with key points, action items, and important dates.
For CLASSIFY: determine document type (invoice, contract, intake form, report, etc.) and relevant categories.
For GENERATE: create a professional document based on the provided template and data.
For COMPARE: analyze two documents and highlight commonalities, differences, and recommendations.

Always provide confidence scores. If a field cannot be found, return null with low confidence.
Never invent data that isn't in the source document.`;

export class DocumentAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_DOCUMENT, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<DocumentResult> {
    const startedAt = new Date();
    const task = input as DocumentTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Document agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'extract_document_data',
          description: 'Extract structured data from document using a schema',
          parameters: {
            type: 'object',
            properties: {
              fields: {
                type: 'array',
                items: { type: 'string' },
                description: 'Fields to extract',
              },
            },
            required: ['fields'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'summarize_document',
          description: 'Generate a structured summary of the document',
          parameters: {
            type: 'object',
            properties: {
              focus: {
                type: 'string',
                description: 'Optional focus area for summarization',
              },
            },
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(DOCUMENT_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          documentContent: task.documentContent?.slice(0, 8000), // truncate for token limit
          documentType: task.documentType,
          extractionSchema: task.extractionSchema,
          generatePrompt: task.generatePrompt,
          industryContext: context.industry,
        }),
      },
    ];

    let result: DocumentResult;

    try {
      const loopResult: ToolLoopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 2048,
        temperature: 0.1,
      });

      try {
        const parsed = this.parseJsonResponse<Partial<DocumentResult>>(loopResult.content);
        result = {
          action: task.action,
          extractedFields: parsed.extractedFields,
          summary: parsed.summary,
          classification: parsed.classification,
          generatedContent: parsed.generatedContent,
          comparisonResult: parsed.comparisonResult,
          overallConfidence: parsed.overallConfidence ?? 0.8,
        };
      } catch {
        // LLM returned freeform text — wrap gracefully
        result = {
          action: task.action,
          summary: loopResult.content || 'Document processed but output format was unexpected.',
          overallConfidence: 0.6,
        };
      }

      this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: errorMsg }, 'Document agent execution failed');
      result = {
        action: task.action,
        summary: `Error: ${errorMsg}`,
        overallConfidence: 0,
      };
      this.recordTrace(context, input, result, [], startedAt);
    }

    this.logger.info(
      { action: task.action, confidence: result.overallConfidence },
      'Document agent completed',
    );

    return result;
  }
}
