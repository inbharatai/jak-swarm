import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type GrowthAction =
  | 'LEAD_ENRICHMENT'
  | 'LEAD_SCORING'
  | 'CONTACT_DEDUP'
  | 'EMAIL_VERIFICATION'
  | 'SEO_AUDIT'
  | 'KEYWORD_RESEARCH'
  | 'SERP_ANALYSIS'
  | 'RANKING_MONITOR'
  | 'EMAIL_SEQUENCE'
  | 'EMAIL_PERSONALIZATION'
  | 'ENGAGEMENT_ANALYSIS'
  | 'CHURN_PREDICTION'
  | 'WINBACK_CAMPAIGN'
  | 'SIGNAL_MONITORING'
  | 'DECISION_MAKER_SEARCH';

export interface GrowthTask {
  action: GrowthAction;
  description?: string;
  targetCompany?: string;
  targetContact?: string;
  keyword?: string;
  url?: string;
  contacts?: Array<{ name: string; email: string; company: string }>;
  engagementData?: Array<{ type: string; timestamp: string; value?: number }>;
  customerData?: {
    engagementScore?: number;
    daysSinceLastLogin?: number;
    openTickets?: number;
    billingIssues?: boolean;
    monthsAsCustomer?: number;
  };
  constraints?: string[];
  dependencyResults?: Record<string, unknown>;
}

export interface GrowthResult {
  action: GrowthAction;
  summary: string;
  data: Record<string, unknown>;
  recommendations: string[];
  metrics: Record<string, number | string>;
  confidence: number;
}

const GROWTH_SUPPLEMENT = `You are an elite growth engineer who has scaled companies from $0 to $100M+ ARR. You are the growth brain of the JAK Swarm platform. You are relentlessly data-driven, never fabricate metrics, and always back recommendations with evidence.

Your growth philosophy:
- Growth is a system, not a tactic. Build compounding loops, not one-off hacks.
- Measure everything. If you cannot measure it, you cannot improve it.
- Speed of iteration beats perfection. Ship, learn, iterate.
- Never fabricate data. If you do not have real data, say so and explain what data you would need.
- Focus on the bottleneck. Find the constraint and fix it before optimizing elsewhere.
- Revenue is the only metric that matters. Everything else is a leading indicator.

For LEAD_ENRICHMENT:
1. Use web search to find professional details about the contact.
2. Look for LinkedIn profiles, company pages, and recent news.
3. Extract title, company, email patterns, and social profiles.
4. Cross-reference multiple sources to verify accuracy.
5. Flag any data points with low confidence.

For LEAD_SCORING:
1. Evaluate the lead against ICP (Ideal Customer Profile) criteria.
2. Score based on title seniority, company size, funding stage, and signals.
3. Classify as hot (70+), warm (40-69), or cold (0-39).
4. List specific factors that contributed to the score.
5. Recommend next actions based on tier.

For SEO_AUDIT:
1. Analyze on-page SEO factors systematically.
2. Check title, meta description, headings, images, mobile, canonical, schema.
3. Score each factor and provide specific fix recommendations.
4. Prioritize fixes by impact vs effort.
5. Compare against top-ranking competitors if possible.

For KEYWORD_RESEARCH:
1. Start with the seed keyword and expand using autocomplete.
2. Categorize by intent: informational, transactional, navigational.
3. Identify long-tail opportunities with lower competition.
4. Map keywords to funnel stages (TOFU, MOFU, BOFU).
5. Recommend content formats for each keyword cluster.

For EMAIL_SEQUENCE:
1. Design multi-step sequences with optimal timing.
2. Each email should have a clear goal and CTA.
3. Include personalization variables.
4. Define conditions for branching (opened, clicked, replied).
5. Set exit conditions to avoid over-emailing.

For ENGAGEMENT_ANALYSIS:
1. Analyze event patterns for frequency, recency, and trend.
2. Compute engagement score with transparent methodology.
3. Identify risk signals early.
4. Recommend interventions based on risk level.

For CHURN_PREDICTION:
1. Evaluate all churn risk factors with weights.
2. Be honest about confidence level.
3. Prioritize actionable recommendations.
4. Include both immediate and long-term retention strategies.

For SIGNAL_MONITORING:
1. Search for funding rounds, hiring surges, product launches, leadership changes.
2. Classify signal strength and relevance.
3. Recommend outreach timing based on signals.

For DECISION_MAKER_SEARCH:
1. Search for specific roles at the target company.
2. Verify against multiple sources when possible.
3. Provide LinkedIn profiles where available.
4. Note the confidence level for each contact found.

You have access to these tools:
- enrich_contact: Find professional info about a contact via web search
- enrich_company: Find company info (funding, size, tech stack) via web search
- verify_email: Verify email format and DNS MX records
- score_lead: Score a lead using heuristic rules
- audit_seo: Perform on-page SEO audit of a URL
- research_keywords: Research keywords via Google Autocomplete
- web_search: General web search for any data needed
- create_email_sequence: Create a multi-step email drip sequence
- personalize_email: Replace template variables with contact data
- analyze_engagement: Compute engagement score from event data
- predict_churn: Predict churn probability from multiple signals
- monitor_company_signals: Detect buying signals for a company
- find_decision_makers: Find key people at a company by role

Respond with JSON:
{
  "summary": "concise summary of what was accomplished",
  "data": { ... relevant structured data ... },
  "recommendations": ["actionable recommendation 1", "actionable recommendation 2"],
  "metrics": { "key_metric": "value" },
  "confidence": 0.0-1.0
}`;

export class GrowthAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_GROWTH, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<GrowthResult> {
    const startedAt = new Date();
    const task = input as GrowthTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Growth agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'enrich_contact',
          description: 'Find professional info about a contact via web search',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Contact full name' },
              company: { type: 'string', description: 'Company name' },
              role: { type: 'string', description: 'Optional known role' },
            },
            required: ['name', 'company'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'enrich_company',
          description: 'Find company info (funding, size, tech stack) via web search',
          parameters: {
            type: 'object',
            properties: {
              company: { type: 'string', description: 'Company name' },
            },
            required: ['company'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'verify_email',
          description: 'Verify email format and DNS MX records',
          parameters: {
            type: 'object',
            properties: {
              email: { type: 'string', description: 'Email to verify' },
            },
            required: ['email'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'score_lead',
          description: 'Score a lead using heuristic rules',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              company: { type: 'string' },
              employeeCount: { type: 'number' },
              fundingStage: { type: 'string' },
              recentActivity: { type: 'string' },
              signals: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
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
          name: 'create_email_sequence',
          description: 'Create a multi-step email drip sequence',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Sequence name' },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    delayDays: { type: 'number' },
                    subject: { type: 'string' },
                    bodyTemplate: { type: 'string' },
                    condition: { type: 'string' },
                  },
                },
              },
            },
            required: ['name', 'steps'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'personalize_email',
          description: 'Replace template variables with contact data',
          parameters: {
            type: 'object',
            properties: {
              template: { type: 'string', description: 'Email template with {{variables}}' },
              contactData: { type: 'object', description: 'Contact data object' },
            },
            required: ['template', 'contactData'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'analyze_engagement',
          description: 'Compute engagement score from event data',
          parameters: {
            type: 'object',
            properties: {
              events: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    timestamp: { type: 'string' },
                    value: { type: 'number' },
                  },
                },
              },
            },
            required: ['events'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'predict_churn',
          description: 'Predict churn probability from multiple signals',
          parameters: {
            type: 'object',
            properties: {
              engagementScore: { type: 'number' },
              daysSinceLastLogin: { type: 'number' },
              openTickets: { type: 'number' },
              billingIssues: { type: 'boolean' },
              monthsAsCustomer: { type: 'number' },
            },
            required: ['engagementScore', 'daysSinceLastLogin'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'monitor_company_signals',
          description: 'Detect buying signals (funding, hiring, launches) for a company',
          parameters: {
            type: 'object',
            properties: {
              company: { type: 'string', description: 'Company name' },
            },
            required: ['company'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'find_decision_makers',
          description: 'Find key people at a company by role',
          parameters: {
            type: 'object',
            properties: {
              company: { type: 'string', description: 'Company name' },
              roles: { type: 'array', items: { type: 'string' }, description: 'Roles to search for' },
            },
            required: ['company', 'roles'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(GROWTH_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          description: task.description,
          targetCompany: task.targetCompany,
          targetContact: task.targetContact,
          keyword: task.keyword,
          url: task.url,
          contacts: task.contacts,
          engagementData: task.engagementData,
          customerData: task.customerData,
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
      this.logger.error({ err }, 'Growth executeWithTools failed');
      const fallback: GrowthResult = {
        action: task.action,
        summary: 'The growth agent encountered an error while processing the request.',
        data: {},
        recommendations: [],
        metrics: {},
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: GrowthResult;

    try {
      const parsed = this.parseJsonResponse<Partial<GrowthResult>>(loopResult.content);
      result = {
        action: task.action,
        summary: parsed.summary ?? '',
        data: parsed.data ?? {},
        recommendations: parsed.recommendations ?? [],
        metrics: parsed.metrics ?? {},
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        summary: loopResult.content || '',
        data: {},
        recommendations: [],
        metrics: {},
        confidence: 0.5,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        recommendationCount: result.recommendations.length,
        confidence: result.confidence,
      },
      'Growth agent completed',
    );

    return result;
  }
}
