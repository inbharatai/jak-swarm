import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type MarketingAction =
  | 'GTM_STRATEGY'
  | 'CONTENT_STRATEGY'
  | 'CAMPAIGN_PLAN'
  | 'BRAND_AUDIT'
  | 'SEO_ANALYSIS'
  | 'SOCIAL_STRATEGY'
  | 'COMPETITIVE_MESSAGING'
  | 'CUSTOMER_SEGMENTATION'
  | 'EXECUTE_CAMPAIGN'
  | 'MONITOR_BRAND'
  | 'ENGAGE_COMMUNITY';

export interface MarketingTask {
  action: MarketingAction;
  description?: string;
  product?: string;
  targetMarket?: string;
  currentBrand?: string;
  competitors?: string[];
  budget?: number;
  timeline?: string;
  existingChannels?: string[];
  constraints?: string[];
}

export interface ContentCalendarItem {
  date: string;
  channel: string;
  contentType: string;
  topic: string;
  cta: string;
}

export interface MarketingResult {
  action: MarketingAction;
  strategy: string;
  targetAudience: string;
  messaging: string;
  channels: string[];
  budget?: string;
  kpis: string[];
  contentCalendar?: ContentCalendarItem[];
  competitiveAnalysis?: string;
  confidence: number;
}

const MARKETING_SUPPLEMENT = `You are a world-class CMO who has scaled multiple companies from seed to IPO -- the marketing brain of the JAK Swarm platform. You combine creative brilliance with analytical rigor. Every campaign you design is measurable, every message you craft converts, and every strategy you build ties directly to revenue.

Your marketing philosophy:
- Marketing that cannot be measured does not exist. Tie everything to KPIs.
- Know your customer better than they know themselves. Build from insight, not assumption.
- The best marketing does not feel like marketing. It feels like value.
- Distribution is more important than content. Great content with bad distribution loses to mediocre content with great distribution.
- CAC/LTV is the north star. If the unit economics do not work, nothing else matters.

For GTM_STRATEGY:
1. Define the ICP (Ideal Customer Profile) with painful specificity.
2. Size the market: TAM/SAM/SOM with sources and methodology.
3. Map the buyer journey (awareness, consideration, decision, retention, expansion).
4. Design the channel mix with expected CAC by channel.
5. Build the launch sequence: pre-launch, launch, post-launch with clear milestones.
6. Define success metrics and leading indicators for each phase.

For CONTENT_STRATEGY:
1. Audit existing content and identify gaps in the funnel.
2. Define content pillars aligned to buyer pain points and search intent.
3. Map content types to funnel stages (TOFU, MOFU, BOFU).
4. Create a content calendar with topics, formats, channels, and cadence.
5. Include SEO keyword targets and estimated search volume.
6. Define content repurposing and distribution workflows.

For CAMPAIGN_PLAN:
1. Set SMART campaign objectives tied to business goals.
2. Define audience segments with targeting criteria for each channel.
3. Create messaging frameworks (headlines, value props, CTAs) per segment.
4. Design the channel mix with budget allocation and expected ROAS.
5. Build A/B testing plan for key variables (copy, creative, audience, landing pages).
6. Define measurement framework with attribution model.

For BRAND_AUDIT:
1. Evaluate brand positioning, messaging consistency, and visual identity.
2. Assess brand perception vs intended positioning.
3. Analyze brand touchpoints across all channels.
4. Identify brand equity strengths and vulnerabilities.
5. Recommend brand evolution strategy (not revolution unless warranted).

For SEO_ANALYSIS:
1. Analyze keyword landscape and search intent categories.
2. Evaluate on-page SEO factors (titles, meta, headings, content quality).
3. Assess technical SEO (site speed, mobile, crawlability, schema markup).
4. Map content gaps and keyword opportunities.
5. Prioritize actions by effort vs impact.

For SOCIAL_STRATEGY:
1. Audit current social presence and engagement metrics.
2. Define platform-specific strategies (each platform has different rules).
3. Create content pillars and posting cadence per platform.
4. Design community engagement and growth tactics.
5. Include influencer and partnership opportunities.

For COMPETITIVE_MESSAGING:
1. Map competitor messaging, positioning, and unique claims.
2. Identify messaging white space and differentiation opportunities.
3. Create battle cards with competitive objection handling.
4. Design win/loss messaging for head-to-head situations.

For CUSTOMER_SEGMENTATION:
1. Define segments by demographics, psychographics, behavior, and needs.
2. Size each segment and estimate revenue potential.
3. Map each segment's pain points, motivations, and objections.
4. Prioritize segments by fit, revenue potential, and acquisition difficulty.
5. Create persona narratives for the top 3 segments.

For EXECUTE_CAMPAIGN:
1. Define campaign objectives, target audience, and success metrics.
2. Select channels and allocate budget across each.
3. Create campaign timeline with milestones and checkpoints.
4. Design A/B testing framework for creative and messaging.
5. Set up tracking and attribution for real-time optimization.

For MONITOR_BRAND:
1. Track brand mentions across Reddit, Twitter, Hacker News, and news outlets.
2. Analyze sentiment trends and identify emerging narratives.
3. Flag potential PR crises or viral moments early.
4. Benchmark share of voice against competitors.
5. Generate actionable insights from brand perception data.

For ENGAGE_COMMUNITY:
1. Identify high-value community discussions on Reddit, Twitter, and forums.
2. Draft contextual, value-first replies that build authority (not spam).
3. Monitor engagement metrics and response effectiveness.
4. Build relationships with key influencers and community leaders.
5. Track community sentiment and feedback loops back to product.

You have access to these tools:
- find_document: look up a brief, brand asset, or competitor report the user uploaded (use FIRST when a file is referenced by name or described)
- web_search: search the web for market data, competitor content, and industry trends
- search_knowledge: search the internal knowledge base for brand assets and past campaigns
- generate_report: compile your marketing strategy into a structured report
- monitor_brand_mentions: track brand mentions across Reddit, Twitter, HN, and news
- auto_reply_reddit: find Reddit threads and draft contextual replies
- auto_reply_twitter: find Twitter discussions and draft engagement replies
- generate_seo_report: generate comprehensive SEO report combining audit, keywords, and SERP analysis
- track_content_performance: track published content URLs and performance over time

Respond with JSON:
{
  "strategy": "comprehensive marketing strategy description",
  "targetAudience": "detailed target audience description",
  "messaging": "core messaging framework",
  "channels": ["channel 1", "channel 2"],
  "budget": "budget allocation breakdown",
  "kpis": ["KPI 1 with target", "KPI 2 with target"],
  "contentCalendar": [{"date": "...", "channel": "...", "contentType": "...", "topic": "...", "cta": "..."}],
  "competitiveAnalysis": "competitive positioning analysis",
  "confidence": 0.0-1.0
}`;

export class MarketingAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_MARKETING, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<MarketingResult> {
    const startedAt = new Date();
    const task = input as MarketingTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Marketing agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'find_document',
          description: 'Look up a brief, brand asset, competitor report, or campaign doc the user uploaded via the Files tab. Returns metadata + best-matching content snippet. Use this FIRST when the user references a named file (campaign_brief.pdf, brand_guidelines.pdf, competitor_teardown.md) or describes its contents — do not ask them to paste it until you have tried this.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'File name or content description. Examples: "Q3 launch brief", "brand voice guidelines", "competitor teardown — Notion".',
              },
              limit: { type: 'number', description: 'Max documents to return (default 5, max 20).' },
              tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag filter.' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for market data, competitor content, and industry trends',
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
          description: 'Search the internal knowledge base for brand assets and past campaigns',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              category: { type: 'string', description: 'Category filter' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generate_report',
          description: 'Compile marketing strategy into a structured report',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Report title' },
              content: { type: 'string', description: 'Report content in markdown' },
              format: { type: 'string', enum: ['markdown', 'json', 'html'], description: 'Output format' },
            },
            required: ['title', 'content'],
          },
        },
      },
      { type: 'function' as const, function: { name: 'monitor_brand_mentions', description: 'Track brand mentions across Reddit, Twitter, HN, and news', parameters: { type: 'object', properties: { brand: { type: 'string' }, platforms: { type: 'array', items: { type: 'string' } } }, required: ['brand'] } } },
      { type: 'function' as const, function: { name: 'auto_engage_reddit', description: 'Find Reddit threads and draft contextual replies', parameters: { type: 'object', properties: { topic: { type: 'string' }, product: { type: 'string' }, tone: { type: 'string' } }, required: ['topic'] } } },
      { type: 'function' as const, function: { name: 'auto_engage_twitter', description: 'Find Twitter discussions and draft engagement replies', parameters: { type: 'object', properties: { topic: { type: 'string' }, product: { type: 'string' } }, required: ['topic'] } } },
      { type: 'function' as const, function: { name: 'auto_engage_linkedin', description: 'Find LinkedIn posts about topics and draft professional engagement comments', parameters: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' } }, productName: { type: 'string' }, tone: { type: 'string' } }, required: ['keywords'] } } },
      { type: 'function' as const, function: { name: 'generate_seo_report', description: 'Generate comprehensive SEO report combining audit, keywords, and SERP analysis', parameters: { type: 'object', properties: { url: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } } }, required: ['url'] } } },
      { type: 'function' as const, function: { name: 'track_content_performance', description: 'Track published content URLs and performance over time', parameters: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' }, platform: { type: 'string' }, action: { type: 'string' } }, required: ['url', 'title', 'platform', 'action'] } } },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(MARKETING_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          description: task.description,
          product: task.product,
          targetMarket: task.targetMarket,
          currentBrand: task.currentBrand,
          competitors: task.competitors,
          budget: task.budget,
          timeline: task.timeline,
          existingChannels: task.existingChannels,
          constraints: task.constraints,
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
      this.logger.error({ err }, 'Marketing executeWithTools failed');
      const fallback: MarketingResult = {
        action: task.action,
        strategy: 'The marketing agent encountered an error while processing the request.',
        targetAudience: '',
        messaging: '',
        channels: [],
        kpis: [],
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: MarketingResult;

    try {
      const parsed = this.parseJsonResponse<Partial<MarketingResult>>(loopResult.content);
      result = {
        action: task.action,
        strategy: parsed.strategy ?? '',
        targetAudience: parsed.targetAudience ?? '',
        messaging: parsed.messaging ?? '',
        channels: parsed.channels ?? [],
        budget: parsed.budget,
        kpis: parsed.kpis ?? [],
        contentCalendar: parsed.contentCalendar,
        competitiveAnalysis: parsed.competitiveAnalysis,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        strategy: loopResult.content || '',
        targetAudience: 'Manual review required — parse failure; re-derive target audience before launch.',
        messaging: '',
        channels: [],
        kpis: ['Manual review required — LLM output was not structured JSON. Do not ship this campaign without human verification.'],
        confidence: 0.3,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        channelCount: result.channels.length,
        kpiCount: result.kpis.length,
        confidence: result.confidence,
      },
      'Marketing agent completed',
    );

    return result;
  }
}
