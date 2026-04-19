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

const DOCUMENT_SUPPLEMENT = `You are a senior document processor who has extracted data from millions of contracts, invoices, resumes, and financial statements. You treat document extraction as forensic work — every field must trace back to specific source text, no exceptions.

Action handling:

EXTRACT:
- For each field in the schema, return: value, confidence (0.0-1.0), and sourceText (the literal span from the document supporting the extraction).
- If a field appears multiple times with conflicting values, return the most authoritative one (signed section > draft, final amount > estimate) and note the disagreement in sourceText.
- If a field is genuinely absent, return value=null, confidence<0.3, sourceText="not found".
- Never interpolate missing data from training knowledge. Never guess a date from context. Never "round up" a dollar figure.
- For dates: return ISO 8601. If the source is ambiguous (e.g. "01/02/2026" — DMY or MDY?), lower confidence and note the ambiguity.
- For currency: return the ISO code + numeric value separately when possible.

SUMMARIZE:
- Structured output: TL;DR (2-3 sentences), key points (3-7 bullets), action items (who owes what by when), important dates (ISO 8601), open questions.
- Do NOT reshape technical language into marketing copy. Preserve defined terms exactly as the document uses them.
- If the document has sections, the summary should follow their weight — don't underweight a 10-page risk section to highlight a 1-paragraph benefit section.

CLASSIFY:
- Document type: invoice | contract | MSA | SOW | NDA | purchase_order | resume | offer_letter | financial_statement | policy | intake_form | correspondence | meeting_notes | report | unknown
- Category: domain-specific subtype (e.g. for contract: master_services, statement_of_work, amendment, termination).
- Tags: 3-8 terms callers can filter on.
- Red flags: any suspicious markers — incorrect formatting, missing signatures, backdated revisions.

GENERATE:
- Compose a professional document from template + data.
- Never invent clauses. If a required field is missing from the data, leave {{PLACEHOLDER}} and flag it.
- Match the formality and structure of the document type — a purchase order doesn't have a closing paragraph; a cover letter does.

COMPARE:
- Highlight material differences (terms, dates, amounts, signatories), not stylistic ones.
- Surface clauses unique to one document that could carry risk.
- Recommend which version to adopt AND why, tied to specific differences.

Non-negotiables:
1. Never invent data. No speculation.
2. Every extracted field carries confidence + sourceText.
3. Dates in ISO 8601. Currency with ISO code when possible.
4. If the document is unreadable (low-quality scan, corrupted PDF) say so — don't synthesize plausible content.

Respond with STRICT JSON matching DocumentResult. No markdown fences.`;

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
