import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
// ToolCall type used internally by executeWithTools()
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type KnowledgeAction = 'SEARCH' | 'INDEX' | 'SUMMARIZE' | 'COMPARE' | 'EXTRACT';

export interface KnowledgeSource {
  id: string;
  title: string;
  excerpt: string;
  relevanceScore: number;
  documentType?: string;
  lastUpdated?: string;
  url?: string;
}

export interface KnowledgeTask {
  action: KnowledgeAction;
  query?: string;
  documentIds?: string[];
  documents?: Array<{ id?: string; title?: string; content: string }>;
  compareAspects?: string[];
  extractFields?: string[];
  maxResults?: number;
}

export interface KnowledgeResult {
  action: KnowledgeAction;
  results: KnowledgeSource[];
  summary?: string;
  confidence: number;
  sources: string[];
  suggestedRelated: string[];
}

const KNOWLEDGE_SUPPLEMENT = `You are a knowledge management worker agent. You search, organize, and synthesize information from the internal knowledge base.

IMPORTANT: You focus on INTERNAL knowledge (documents, wikis, policies, procedures already in the system). For external/web research, defer to the Research agent.

For SEARCH: query the knowledge base and return ranked results with relevance scores.
For INDEX: analyze a document and extract metadata, key concepts, and relationships for indexing.
For SUMMARIZE: produce a concise summary of one or more documents from the knowledge base.
For COMPARE: compare two or more documents across specified aspects and highlight differences/similarities.
For EXTRACT: pull specific fields or structured data from documents (e.g. dates, names, clauses).

Knowledge management best practices:
- Always include source attribution with document IDs and titles
- Score confidence based on: source freshness, number of corroborating sources, query-result alignment
- Flag when information may be outdated (>6 months since last update)
- Suggest related queries or documents the user might find useful
- For COMPARE, use a structured side-by-side format
- When multiple sources conflict, present all viewpoints and note the discrepancy
- Never fabricate sources — only reference documents returned by tools

RAG (Retrieval-Augmented Generation) guidelines:
- Retrieve first, then generate — never answer purely from parametric knowledge
- If no relevant results are found, say so explicitly rather than guessing
- Combine information from multiple sources only when they are consistent
- Confidence scoring: 0.9+ = multiple corroborating sources; 0.7-0.9 = single authoritative source; 0.5-0.7 = partial match; <0.5 = low relevance

You have access to these tools:
- search_knowledge: searches the internal knowledge base with semantic and keyword matching
- classify_text: categorizes and tags document content

Respond with JSON:
{
  "results": [{"id": "...", "title": "...", "excerpt": "...", "relevanceScore": 0.95}],
  "summary": "...",
  "confidence": 0.0-1.0,
  "sources": ["doc_id_1", "doc_id_2"],
  "suggestedRelated": ["related query 1", "related topic"]
}`;

export class KnowledgeAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_KNOWLEDGE, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<KnowledgeResult> {
    const startedAt = new Date();
    const task = input as KnowledgeTask;

    this.logger.info(
      { runId: context.runId, action: task.action, query: task.query?.slice(0, 100) },
      'Knowledge agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search the internal knowledge base for documents matching a query',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query (semantic + keyword)' },
              documentType: {
                type: 'string',
                description: 'Filter by document type (e.g. policy, procedure, wiki, faq)',
              },
              limit: { type: 'number', description: 'Max results to return' },
              dateRange: {
                type: 'object',
                properties: {
                  from: { type: 'string' },
                  to: { type: 'string' },
                },
                description: 'Filter by last-updated date range',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'classify_text',
          description: 'Classify and tag document content for categorization or extraction',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              categories: { type: 'array', items: { type: 'string' } },
              extractFields: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific fields to extract from the text',
              },
            },
            required: ['text'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(KNOWLEDGE_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          query: task.query,
          documentIds: task.documentIds,
          documents: task.documents?.map((d) => ({
            id: d.id,
            title: d.title,
            content: d.content.slice(0, 4000), // Cap per-document content
          })),
          compareAspects: task.compareAspects,
          extractFields: task.extractFields,
          maxResults: task.maxResults ?? 10,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 2048,
        temperature: 0.2,
        maxIterations: 4,
      });
    } catch (err) {
      this.logger.error({ err }, 'Knowledge executeWithTools failed');
      const fallback: KnowledgeResult = {
        action: task.action,
        results: [],
        confidence: 0,
        sources: [],
        suggestedRelated: [],
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: KnowledgeResult;

    try {
      const parsed = this.parseJsonResponse<Partial<KnowledgeResult>>(loopResult.content);
      result = {
        action: task.action,
        results: (parsed.results ?? []).map((r) => ({
          id: r.id ?? '',
          title: r.title ?? '',
          excerpt: r.excerpt ?? '',
          relevanceScore: r.relevanceScore ?? 0,
          documentType: r.documentType,
          lastUpdated: r.lastUpdated,
          url: r.url,
        })),
        summary: parsed.summary,
        confidence: parsed.confidence ?? 0.7,
        sources: parsed.sources ?? [],
        suggestedRelated: parsed.suggestedRelated ?? [],
      };
    } catch {
      // Freeform text — wrap as summary with low confidence
      result = {
        action: task.action,
        results: [],
        summary: loopResult.content || undefined,
        confidence: 0.5,
        sources: [],
        suggestedRelated: [],
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        resultCount: result.results.length,
        confidence: result.confidence,
      },
      'Knowledge agent completed',
    );

    return result;
  }
}
