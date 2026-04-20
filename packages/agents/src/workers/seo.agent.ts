import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type SEOAction =
  | 'OPTIMIZE_PAGE'
  | 'BUILD_LINK_STRATEGY'
  | 'FIX_TECHNICAL_SEO'
  | 'OPTIMIZE_META_TAGS'
  | 'CREATE_SCHEMA_MARKUP'
  | 'ANALYZE_COMPETITORS_SEO'
  | 'CONTENT_GAP_ANALYSIS';

export interface SEOTask {
  action: SEOAction;
  url?: string;
  keyword?: string;
  competitors?: string[];
  currentContent?: string;
  dependencyResults?: Record<string, unknown>;
}

export interface SEOResult {
  action: SEOAction;
  summary: string;
  optimizations?: Array<{ item: string; priority: string; effort: string; description: string }>;
  technicalIssues?: Array<{ issue: string; severity: string; fix: string }>;
  schemaMarkup?: string;
  linkOpportunities?: Array<{ type: string; target: string; rationale: string }>;
  gapAnalysis?: Array<{ keyword: string; opportunity: string; difficulty: string }>;
  confidence: number;
}

const SEO_SUPPLEMENT = `You are a technical SEO expert with deep expertise in search engine optimization, web performance, and structured data. You approach SEO as a systematic discipline grounded in data, not guesswork.

Your SEO philosophy:
- Technical foundation first. No amount of content optimization fixes a broken crawl.
- Measure, prioritize, execute. Every recommendation gets a priority (P0-P3) and effort estimate.
- User experience and SEO are aligned, not opposed. What is good for users is good for search.
- Never fabricate metrics. Use tools to gather real data, or clearly state estimates.
- Stay current. Search algorithms evolve constantly — rely on web_search for the latest best practices.

For OPTIMIZE_PAGE:
1. Audit the page using audit_seo for on-page factors.
2. Check Core Web Vitals targets: LCP <2.5s, FID <100ms, CLS <0.1.
3. Analyze title tag (<60 chars), meta description (<160 chars), heading hierarchy.
4. Check image alt tags, internal linking, canonical tags.
5. Review content for keyword relevance, density (target 1-2%), and readability.
6. Provide a prioritized list of fixes with P0-P3 severity and estimated effort (low/medium/high).

For BUILD_LINK_STRATEGY:
1. Analyze current backlink profile context from the task.
2. Use web_search to identify relevant link opportunities: guest posts, resource pages, broken link targets.
3. Categorize opportunities: editorial, resource, outreach, digital PR.
4. Prioritize by domain authority potential and relevance.
5. Provide outreach templates or angles for top opportunities.

For FIX_TECHNICAL_SEO:
1. Identify crawlability issues: robots.txt, sitemap.xml, canonical tags, redirect chains.
2. Check for duplicate content, thin pages, and orphan pages.
3. Evaluate site structure and internal linking depth.
4. Review mobile-friendliness and page speed factors.
5. Output a technical audit checklist with fix instructions.

For OPTIMIZE_META_TAGS:
1. Analyze current title and description against target keywords.
2. Generate optimized title (<60 chars) with primary keyword near the front.
3. Generate optimized meta description (<160 chars) with CTA and keyword.
4. Suggest Open Graph and Twitter Card meta tags.
5. Check for duplicate meta tags across pages if multiple URLs provided.

For CREATE_SCHEMA_MARKUP:
1. Determine the appropriate Schema.org type(s) for the page content.
2. Generate valid JSON-LD structured data.
3. Include all required and recommended properties for the schema type.
4. Validate the markup structure against Schema.org specifications.
5. Provide implementation instructions.

For ANALYZE_COMPETITORS_SEO:
1. Use web_search and analyze_serp to research competitor rankings.
2. Compare keyword coverage, content depth, and domain authority signals.
3. Identify competitors' top-performing content and keywords.
4. Find weaknesses and opportunities to differentiate.
5. Provide a competitive gap matrix with actionable recommendations.

For CONTENT_GAP_ANALYSIS:
1. Research target keywords using research_keywords.
2. Analyze existing content coverage against keyword opportunities.
3. Identify topics competitors rank for that are missing from the target site.
4. Prioritize gaps by search volume, difficulty, and business relevance.
5. Recommend content pieces to fill each gap with format and angle suggestions.

You have access to these tools:
- audit_seo: Perform on-page SEO audit of a URL
- research_keywords: Research keywords via Google Autocomplete
- analyze_serp: Analyze search engine results pages for a keyword
- web_search: General web search for current information
- browser_navigate: Navigate to a URL for inspection
- browser_extract: Extract structured data from a page
- browser_get_text: Get the text content of a page

Respond with JSON:
{
  "summary": "concise summary of findings and recommendations",
  "optimizations": [{ "item": "...", "priority": "P0-P3", "effort": "low|medium|high", "description": "..." }],
  "technicalIssues": [{ "issue": "...", "severity": "critical|high|medium|low", "fix": "..." }],
  "schemaMarkup": "JSON-LD string if applicable",
  "linkOpportunities": [{ "type": "...", "target": "...", "rationale": "..." }],
  "gapAnalysis": [{ "keyword": "...", "opportunity": "...", "difficulty": "low|medium|high" }],
  "confidence": 0.0-1.0
}`;

export class SEOAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_SEO, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<SEOResult> {
    const startedAt = new Date();
    const task = input as SEOTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'SEO agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'audit_seo',
          description: 'Perform on-page SEO audit of a URL',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to audit' },
            },
            required: ['url'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'research_keywords',
          description: 'Research keywords via Google Autocomplete',
          parameters: {
            type: 'object',
            properties: {
              seed_keyword: { type: 'string', description: 'Seed keyword' },
              market: { type: 'string', description: 'Target market' },
            },
            required: ['seed_keyword'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'analyze_serp',
          description: 'Analyze search engine results pages for a keyword',
          parameters: {
            type: 'object',
            properties: {
              keyword: { type: 'string', description: 'Keyword to analyze' },
              market: { type: 'string', description: 'Target market or region' },
            },
            required: ['keyword'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for current information',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              maxResults: { type: 'number', description: 'Max results' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_navigate',
          description: 'Navigate to a URL for inspection',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to navigate to' },
            },
            required: ['url'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_extract',
          description: 'Extract structured data from a page',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector to extract' },
              attribute: { type: 'string', description: 'Attribute to extract' },
            },
            required: ['selector'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_get_text',
          description: 'Get the text content of a page',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'Optional CSS selector to scope text extraction' },
            },
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(SEO_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          url: task.url,
          keyword: task.keyword,
          competitors: task.competitors,
          currentContent: task.currentContent,
          dependencyResults: task.dependencyResults,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 4096,
        temperature: 0.3,
        maxIterations: 5,
      });
    } catch (err) {
      this.logger.error({ err }, 'SEO executeWithTools failed');
      const fallback: SEOResult = {
        action: task.action,
        summary: 'The SEO agent encountered an error while processing the request.',
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: SEOResult;

    try {
      const parsed = this.parseJsonResponse<Partial<SEOResult>>(loopResult.content);
      result = {
        action: task.action,
        summary: parsed.summary ?? '',
        optimizations: parsed.optimizations,
        technicalIssues: parsed.technicalIssues,
        schemaMarkup: parsed.schemaMarkup,
        linkOpportunities: parsed.linkOpportunities,
        gapAnalysis: parsed.gapAnalysis,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        summary: loopResult.content || '',
        optimizations: [
          {
            item: 'Manual review required — LLM output was not structured JSON; SEO recommendations are incomplete.',
            priority: 'P0' as const,
            effort: 'low' as const,
            description: 'Do not ship any page change based on this output. Re-run or escalate to an SEO specialist.',
          },
        ],
        confidence: 0.3,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        optimizationCount: result.optimizations?.length ?? 0,
        confidence: result.confidence,
      },
      'SEO agent completed',
    );

    return result;
  }
}
