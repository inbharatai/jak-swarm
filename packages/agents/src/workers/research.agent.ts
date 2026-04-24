import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export interface ResearchTask {
  query: string;
  maxSources?: number;
  focusArea?: string;
  requiredTopics?: string[];
  dateRange?: { from?: string; to?: string };
}

export interface ResearchSource {
  title: string;
  url?: string;
  excerpt: string;
  relevanceScore: number;
  publishedDate?: string;
  /** Source-quality tier: 1=primary/official, 2=reputable secondary, 3=unverified/blog. */
  qualityTier?: 1 | 2 | 3;
  /** Freshness classification — computed from publishedDate against today. */
  freshness?: 'fresh' | 'recent' | 'dated' | 'stale' | 'unknown';
}

/** Captures a point where sources disagree — honest research surfaces this. */
export interface ResearchDisagreement {
  point: string;
  positions: Array<{
    claim: string;
    supportingSources: string[];
  }>;
  /** Which side the agent currently weighs heavier, and why. */
  analystView?: string;
}

export interface ResearchResult {
  query: string;
  findings: string;
  keyPoints: string[];
  sources: ResearchSource[];
  /** Points where sources actively disagree — null when consensus. */
  disagreements?: ResearchDisagreement[];
  /** Citation-to-claim mapping: claim index → source indices supporting it. */
  citations?: Array<{ claim: string; sourceIndices: number[] }>;
  /** Recency verdict — "fresh" (<30d), "recent" (<180d), "dated" (>180d), "stale" (>2y). */
  overallFreshness?: 'fresh' | 'recent' | 'dated' | 'stale' | 'unknown';
  confidence: number;
  limitations: string[];
  suggestedFollowUp?: string[];
}

const RESEARCH_SUPPLEMENT = `You are a senior research analyst. You don't paraphrase search results — you synthesize them, weigh source quality, and surface disagreements honestly.

Workflow:
1. Decompose the query into 2-5 sub-questions.
2. Call web_search and search_knowledge as needed. Prefer web_search for time-sensitive topics (last 6 months) and knowledge for internal context.
3. For each source you include, grade its quality tier:
   - Tier 1 (primary/official): government sites, company financials, the entity's own announcement, peer-reviewed papers, standards bodies.
   - Tier 2 (reputable secondary): established news (Reuters, FT, NYT), industry analysts (Gartner, Forrester), well-known trade publications.
   - Tier 3 (unverified): personal blogs, forums, unknown aggregators, Medium posts without sourcing.
4. For each source, determine freshness by publishedDate vs today:
   - fresh  = within 30 days
   - recent = within 6 months
   - dated  = within 2 years
   - stale  = older than 2 years
   - unknown = no date
5. Dedupe: if the same fact is repeated across outlets citing one primary source, keep the primary source, drop the echoes.
6. Weigh recency where it matters — outdated numbers in a fast-moving topic (e.g., LLM benchmarks, regulations) should be flagged in limitations, not passed off as current.
7. Surface disagreement: when two reputable sources conflict, record both positions in disagreements[], cite the sources, and (if you can justify it) give your analystView of which is likely correct.
8. Citations: every keyPoint must be traceable — include a citations[] entry mapping each claim to the source indices that support it.
9. overallFreshness is the worst-case of the sources you relied on for time-sensitive claims.
10. Confidence calibration:
    - 0.9+: at least two Tier-1 sources agree, all fresh.
    - 0.7-0.89: multiple Tier-2 sources agree OR one Tier-1.
    - 0.5-0.69: limited sources, minor gaps.
    - 0.3-0.49: heavy reliance on Tier-3 or stale sources, or unresolved disagreement.
    - <0.3: extremely speculative — say so in findings.

Refuse to fabricate:
- Never invent statistics, quotes, dollar amounts, dates, or names not present in your sources. If a fact isn't in the sources, say \"no credible source found\" in limitations instead of guessing.
- If web_search returns nothing relevant, lower confidence and say so. Do not fall back to parametric knowledge without labeling it as such.

Findings field is mandatory and must contain the ACTUAL ANSWER to the query in complete prose — 2-4 paragraphs, 150-400 words. This is what the end user reads. It must stand alone without needing the key points. Write it as if someone asked you the question directly and you're answering them in full sentences. NEVER write placeholder text like "see key points" or "research completed" — if you can't answer, say exactly what you couldn't find and why.

Respond with STRICT JSON matching ResearchResult. No markdown fences. Keep keyPoints to 3-7 items. Keep findings between 150-400 words — it is the user-facing answer, not a summary of the summary.`;

export class ResearchAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_RESEARCH, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<ResearchResult> {
    const startedAt = new Date();
    const task = input as ResearchTask;

    this.logger.info(
      { runId: context.runId, query: task.query.slice(0, 100) },
      'Research agent executing',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for information on a topic',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              maxResults: { type: 'number', description: 'Maximum number of results to return' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search the internal knowledge base for relevant documents',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              topics: { type: 'array', items: { type: 'string' }, description: 'Topic filters' },
            },
            required: ['query'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(RESEARCH_SUPPLEMENT),
      },
      {
        role: 'user',
        content: [
          `Research Query: ${task.query}`,
          task.focusArea ? `Focus Area: ${task.focusArea}` : '',
          task.requiredTopics?.length ? `Required Topics: ${task.requiredTopics.join(', ')}` : '',
          `Industry Context: ${context.industry ?? 'GENERAL'}`,
          `Max Sources: ${task.maxSources ?? 5}`,
          '',
          'CRITICAL OUTPUT FORMAT — Your ENTIRE response must be a single JSON object starting with { and ending with }. Do NOT wrap in ```json fences. Put the 150-400 word user-facing answer in "findings" (NOT a stub like "Research completed"). Put 3-7 concrete key points in "keyPoints" (as strings, each 1-2 sentences). If web_search returned nothing and you can only answer from general knowledge, SAY SO in "findings" ("Based on general knowledge of the space as of early 2025…") and set "confidence" to 0.4 — do not hallucinate specific statistics, funding rounds, or named competitors you cannot verify. Never return plain prose outside JSON.',
        ].filter(Boolean).join('\n'),
      },
    ];

    let result: ResearchResult;

    try {
      const loopResult: ToolLoopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 2048,
        temperature: 0.3,
      });

      try {
        const parsed = this.parseJsonResponse<Partial<ResearchResult>>(loopResult.content);
        const rawFindings = typeof parsed.findings === 'string' ? parsed.findings.trim() : '';
        const keyPoints = parsed.keyPoints ?? [];
        // If the LLM skipped findings, reconstruct from keyPoints rather than
        // returning a placeholder stub. compileFinalOutput treats findings as
        // the primary user-visible field — a stub here means the user sees
        // "Research completed. See key points for details." which is useless.
        const findings = rawFindings.length > 0
          ? rawFindings
          : (keyPoints.length > 0
              ? keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')
              : 'No findings available — the research tools returned no usable results for this query.');
        result = {
          query: task.query,
          findings,
          keyPoints,
          sources: parsed.sources ?? [],
          disagreements: parsed.disagreements,
          citations: parsed.citations,
          overallFreshness: parsed.overallFreshness,
          confidence: parsed.confidence ?? 0.7,
          limitations: parsed.limitations ?? ['Results based on available knowledge base only'],
          suggestedFollowUp: parsed.suggestedFollowUp,
        };
      } catch {
        // LLM returned freeform prose instead of JSON — strip any preamble
        // and use the body as findings. User sees the analysis, not a stub.
        const raw = (loopResult.content ?? '').trim();
        const stripped = raw
          .replace(/^([^\n]{0,400}?(i'?ll|here is|here's|to research|since|based on|the following is)[^\n]*\n\s*\n)/i, '')
          .replace(/^```[a-zA-Z]*\n/, '')
          .replace(/\n```$/, '')
          .trim();
        const findings = stripped.length >= 80 ? stripped : raw;
        result = {
          query: task.query,
          findings: findings || 'No findings returned.',
          keyPoints: [],
          sources: [],
          confidence: 0.5,
          limitations: ['Output returned as prose rather than structured JSON — manual review required before publishing.'],
        };
      }

      this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: errorMsg }, 'Research agent execution failed');
      result = {
        query: task.query,
        findings: `Error: ${errorMsg}`,
        keyPoints: [],
        sources: [],
        confidence: 0,
        limitations: [`Execution error: ${errorMsg}`],
      };
      this.recordTrace(context, input, result, [], startedAt);
    }

    return result;
  }
}
