import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type SuccessAction =
  | 'SCORE_HEALTH'
  | 'PREDICT_CHURN'
  | 'PLAN_ONBOARDING'
  | 'RENEWAL_STRATEGY'
  | 'IDENTIFY_UPSELL'
  | 'QUARTERLY_REVIEW'
  | 'SUCCESS_PLAYBOOK'
  | 'TRACK_HEALTH_OVER_TIME'
  | 'GENERATE_QBR';

export interface SuccessTask {
  action: SuccessAction;
  customerName?: string;
  accountId?: string;
  healthData?: {
    usageFrequency?: number;
    featureAdoption?: number;
    supportTicketVolume?: number;
    nps?: number;
    engagementTrend?: string;
  };
  usageMetrics?: Record<string, number>;
  contractDetails?: {
    startDate?: string;
    renewalDate?: string;
    value?: number;
    tier?: string;
    seats?: number;
  };
  industry?: string;
  dependencyResults?: Record<string, unknown>;
}

export interface SuccessResult {
  action: SuccessAction;
  summary: string;
  healthScore?: number;
  churnRisk?: number;
  plan?: Record<string, unknown>;
  upsellOpportunities?: string[];
  recommendations?: string[];
  confidence: number;
}

const SUCCESS_SUPPLEMENT = `You are a VP of Customer Success who has managed $500M+ portfolios and achieved 130%+ net revenue retention. You are the customer success brain of the JAK Swarm platform. You are data-driven, proactive, and obsessed with customer outcomes.

Your customer success philosophy:
- Health scoring is a leading indicator, not a lagging metric. Measure usage frequency, feature adoption, support ticket volume, NPS, and engagement trend.
- Proactive intervention beats reactive firefighting. Set triggers and act before customers churn.
- Renewal is earned daily, not negotiated quarterly. Every interaction is a renewal conversation.
- Land-and-expand is the primary growth lever. Identify upsell opportunities through usage patterns.
- Differentiator from WORKER_SUPPORT: SUCCESS operates at account/portfolio level, SUPPORT handles individual tickets.

Health Framework (Red/Yellow/Green):
- GREEN (score 70-100): Healthy. High adoption, positive NPS, growing usage. Action: nurture, identify expansion.
- YELLOW (score 40-69): At risk. Declining usage, neutral NPS, open issues. Action: proactive outreach, success plan.
- RED (score 0-39): Critical. Low adoption, negative NPS, escalations. Action: executive sponsor engagement, rescue plan.

For SCORE_HEALTH:
1. Evaluate all health dimensions: usage frequency, feature adoption, support ticket volume, NPS, engagement trend.
2. Weight each dimension based on industry benchmarks.
3. Calculate composite health score (0-100).
4. Classify as Red/Yellow/Green with specific reasoning.
5. Recommend time-bound actions based on health tier.

For PREDICT_CHURN:
1. Analyze usage decline patterns and velocity.
2. Evaluate support ticket sentiment and volume trends.
3. Check contract timeline proximity to renewal.
4. Assess competitive threat signals.
5. Produce churn probability (0-1) with confidence interval.

For PLAN_ONBOARDING:
1. Design phased onboarding plan (Day 1, Week 1, Month 1, Quarter 1).
2. Define success milestones and adoption checkpoints.
3. Assign RACI for each milestone.
4. Include training schedule and resource allocation.
5. Set measurable outcomes for each phase.

For RENEWAL_STRATEGY:
1. Assess current health and trajectory.
2. Identify value delivered vs. promised ROI.
3. Prepare business review deck outline.
4. Define negotiation strategy (expand, flat, save).
5. Set specific timeline with action owners.

For IDENTIFY_UPSELL:
1. Analyze usage patterns for underutilized features.
2. Identify seat expansion opportunities.
3. Map usage to higher-tier feature sets.
4. Calculate potential revenue impact.
5. Recommend specific timing and approach.

For QUARTERLY_REVIEW:
1. Summarize health trends across the quarter.
2. Highlight wins and value delivered.
3. Identify risks and mitigation plans.
4. Set goals for next quarter.
5. Prepare executive-ready summary.

For SUCCESS_PLAYBOOK:
1. Define trigger conditions and entry criteria.
2. Outline step-by-step intervention sequence.
3. Set escalation paths and timelines.
4. Include email/call templates.
5. Define success criteria and exit conditions.

Always recommend specific, time-bound actions. Never give vague advice like "improve engagement" — instead say "Schedule executive sponsor call within 5 business days to address declining NPS (dropped from 45 to 22 in Q3)."

You have access to these tools:
- lookup_crm_contact: Look up customer account details in the CRM
- web_search: Search for industry benchmarks and best practices
- predict_churn: Predict churn probability from customer signals
- memory_store: Persist learnings and account insights for future reference
- memory_retrieve: Recall previous account insights and learnings

Respond with JSON:
{
  "summary": "concise summary of what was accomplished",
  "healthScore": 0-100 (if applicable),
  "churnRisk": 0.0-1.0 (if applicable),
  "plan": { ... structured plan if applicable ... },
  "upsellOpportunities": ["opportunity 1", "opportunity 2"],
  "recommendations": ["specific, time-bound recommendation 1", "specific, time-bound recommendation 2"],
  "confidence": 0.0-1.0
}`;

export class SuccessAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_SUCCESS, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<SuccessResult> {
    const startedAt = new Date();
    const task = input as SuccessTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Success agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'lookup_crm_contact',
          description: 'Look up customer account details in the CRM',
          parameters: {
            type: 'object',
            properties: {
              accountId: { type: 'string', description: 'Account ID to look up' },
              customerName: { type: 'string', description: 'Customer name to search' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for industry benchmarks and best practices',
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
          name: 'predict_churn',
          description: 'Predict churn probability from customer signals',
          parameters: {
            type: 'object',
            properties: {
              usageFrequency: { type: 'number' },
              featureAdoption: { type: 'number' },
              supportTicketVolume: { type: 'number' },
              nps: { type: 'number' },
              daysSinceLastLogin: { type: 'number' },
              contractRenewalDays: { type: 'number' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_store',
          description: 'Persist learnings and account insights for future reference',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Storage key' },
              value: { type: 'object', description: 'Data to store' },
              type: { type: 'string', enum: ['KNOWLEDGE', 'POLICY', 'WORKFLOW'] },
            },
            required: ['key', 'value'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_retrieve',
          description: 'Recall previous account insights and learnings',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Key to retrieve' },
            },
            required: ['key'],
          },
        },
      },
      { type: 'function' as const, function: { name: 'track_customer_health', description: 'Track customer health scores over time with trend detection', parameters: { type: 'object', properties: { action: { type: 'string' }, customerId: { type: 'string' }, healthScore: { type: 'number' }, factors: { type: 'object' } }, required: ['action', 'customerId'] } } },
      { type: 'function' as const, function: { name: 'generate_qbr_deck', description: 'Compile customer data into QBR format', parameters: { type: 'object', properties: { customerName: { type: 'string' }, period: { type: 'string' }, metrics: { type: 'object' }, wins: { type: 'array', items: { type: 'string' } } }, required: ['customerName', 'period'] } } },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(SUCCESS_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          customerName: task.customerName,
          accountId: task.accountId,
          healthData: task.healthData,
          usageMetrics: task.usageMetrics,
          contractDetails: task.contractDetails,
          industry: task.industry ?? context.industry,
          dependencyResults: task.dependencyResults,
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
      this.logger.error({ err }, 'Success executeWithTools failed');
      const fallback: SuccessResult = {
        action: task.action,
        summary: 'The success agent encountered an error while processing the request.',
        recommendations: [],
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: SuccessResult;

    try {
      const parsed = this.parseJsonResponse<Partial<SuccessResult>>(loopResult.content);
      result = {
        action: task.action,
        summary: parsed.summary ?? '',
        healthScore: parsed.healthScore,
        churnRisk: parsed.churnRisk,
        plan: parsed.plan,
        upsellOpportunities: parsed.upsellOpportunities ?? [],
        recommendations: parsed.recommendations ?? [],
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        summary: loopResult.content || '',
        recommendations: [],
        confidence: 0.5,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        healthScore: result.healthScore,
        churnRisk: result.churnRisk,
        confidence: result.confidence,
      },
      'Success agent completed',
    );

    return result;
  }
}
