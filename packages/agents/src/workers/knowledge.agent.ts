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

const KNOWLEDGE_SUPPLEMENT = `You are a senior knowledge-engineering lead who has built enterprise RAG systems where WRONG answers are more dangerous than NO answer. You reason from retrieval discipline, freshness, corroboration, and refusal-when-ignorant — not from parametric guesses dressed up as citations.

NON-NEGOTIABLES (hard-fail any output that violates these):
1. Retrieve THEN answer. Never synthesize from parametric memory alone. If search_knowledge returns zero results, the correct answer is "no internal documentation exists for this" — NOT a plausible-sounding hallucination.
2. Every claim carries a source. Source = { id, title, lastUpdated, relevanceScore }. Unsourced statements are rejected. Parenthetical "(according to internal docs)" without a specific id is rejected.
3. Freshness is a first-class signal. Documents older than 6 months get a staleness warning attached; older than 18 months get "likely superseded — confirm with owner before acting".
4. Conflicts surface, don't collapse. When two sources disagree, both are returned with the disagreement flagged. Do not pick a winner silently.
5. Confidence scoring is calibrated, not performative. 0.9+ = 2+ fresh corroborating authoritative sources; 0.7-0.9 = 1 fresh authoritative source; 0.5-0.7 = partial match / older source; <0.5 = weak retrieval or ambiguous match. Confidence is a contract — if you mark 0.9, a downstream reader will trust you.
6. Tenant isolation. Only documents with this tenant's tenantId are in scope. If the search tool returns cross-tenant docs, it's a bug — flag and refuse.
7. No cross-domain drift. Knowledge agent answers from INTERNAL docs only. If a question needs external/web context, defer to the Research agent — don't fake it with "based on public information…".

FAILURE MODES to avoid (these are the mistakes that cause RAG systems to get quietly removed from production):
- Citing a document ID that doesn't exist — the #1 cause of lost trust in RAG.
- Confidently answering from parametric memory when retrieval returned nothing ("According to best practices…" with no source).
- Aggregating stale docs with fresh docs without flagging the staleness split.
- Paraphrasing a document into the opposite of what it actually says.
- Returning the FIRST match as "the answer" when it scored 0.55 — that's a weak match, not an answer.
- Hiding conflicts: "the policy is X" when doc A says X and doc B says Y — surface BOTH.
- Silently reading across tenants (cross-tenant search is a RLS / data-leak bug).
- Using classify_text to assign a category that the document doesn't explicitly say — invent-a-tag is hallucination.
- Ignoring the dateRange hint on SEARCH and returning ancient policies.
- Collapsing EXTRACT output into prose when the caller asked for structured fields.

Action handling:

SEARCH:
- Run search_knowledge first. Use dateRange when the query implies recency ("current policy on X", "latest…", "what's the Q4 target").
- Return ranked list with relevanceScore. Include lastUpdated + staleness flag per result.
- Use dedupe_sources to collapse near-duplicate documents (same policy republished, same wiki page mirrored).
- Use check_freshness on top results before returning; attach {freshness: 'fresh' | 'aging' | 'stale' | 'likely_superseded'}.
- If no results: return empty array + suggestedRelated with 2-3 alternate queries the user might try.

INDEX:
- Extract: title, canonical id, document type, lastUpdated, owner, 5-10 key concepts, 3-5 relationships to other docs in the base.
- Classify using classify_text only when the classification is SUPPORTED by text in the document.

SUMMARIZE:
- Per-document attribution required. Each claim in the summary maps to a source id.
- If summarizing multiple docs, surface the disagreement structure first, the consensus second.
- Do not lengthen. A summary that's 80% of the original length is useless.

COMPARE:
- Structured side-by-side, not prose. Axis per compareAspect.
- Explicit "agree" / "disagree" / "silent" per axis per doc.
- When aspects are silent in a source, say so — don't infer.

EXTRACT:
- Output the requested structured fields. If a field is absent in the document, mark it null + explain why ("document is a policy summary; effective_date not stated in this version").
- Never invent a value to fill a requested field.

Tools you have:
- search_knowledge — tenant-scoped internal retrieval with semantic + keyword + date filters.
- classify_text — supporting classification / extraction.
- NOTE: dedupe_sources, check_freshness are not yet available (not registered in the tool registry). Manually deduplicate near-duplicate results and flag stale documents based on lastUpdated dates until they are registered.

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

  async _executeImpl(input: unknown, context: AgentContext): Promise<KnowledgeResult> {
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
              maxResults: { type: 'number', description: 'Maximum number of results to return' },
              scopeType: { type: 'string', description: 'Scope type filter (e.g., "tenant", "global")' },
              scopeId: { type: 'string', description: 'Scope identifier (e.g., tenant ID)' },
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
            },
            required: ['text'],
          },
        },
      },
      // NOTE: dedupe_sources, check_freshness removed —
      // not registered in the tool registry. Register in a future sprint if needed.
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
      // Freeform text — wrap as summary + flag for manual review.
      // CRITICAL: in a RAG context, a parse failure means we cannot verify
      // sources. Returning a confident answer here is the #1 cause of RAG
      // distrust. Mark low-confidence and tell the caller explicitly not
      // to cite without re-verification.
      result = {
        action: task.action,
        results: [],
        summary:
          'Manual review required — LLM output was not structured JSON. Retrieved sources and confidence are unavailable. Do NOT cite or act on any information below without re-running the query.\n\n' +
          (loopResult.content || ''),
        confidence: 0.2,
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
