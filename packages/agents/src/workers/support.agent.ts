import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type SupportAction = 'CLASSIFY' | 'DRAFT_RESPONSE' | 'ESCALATE' | 'SUMMARIZE_TICKET';

export type SupportCategory = 'billing' | 'technical' | 'general' | 'complaint' | 'feature_request' | 'account';
export type SupportSentiment = 'positive' | 'neutral' | 'negative' | 'frustrated' | 'urgent';

export interface SupportTask {
  action: SupportAction;
  ticketContent: string;
  ticketId?: string;
  customerName?: string;
  previousInteractions?: string[];
  category?: SupportCategory;
}

export interface SupportClassification {
  category: SupportCategory;
  sentiment: SupportSentiment;
  urgency: 1 | 2 | 3 | 4 | 5;
  escalationRequired: boolean;
  escalationReason?: string;
  suggestedTags: string[];
  confidence: number;
}

export interface SupportResult {
  action: SupportAction;
  classification?: SupportClassification;
  draftResponse?: string;
  summary?: string;
  escalationRequired: boolean;
  escalationReason?: string;
  suggestedTags: string[];
  nextActions: string[];
}

const SUPPORT_SUPPLEMENT = `You are a customer support agent. You help classify tickets, draft professional responses, and escalate when needed.

Classification categories: billing, technical, general, complaint, feature_request, account
Sentiment categories: positive, neutral, negative, frustrated, urgent
Urgency scale: 1 (low) to 5 (critical - customer cannot use the product)

Escalation triggers:
- Sentiment is 'frustrated' or 'urgent' AND urgency >= 4
- Category is 'complaint' AND this is not first contact
- Any mention of legal action, regulatory complaints, or public posting
- VIP customer indicators

When drafting responses:
- Be empathetic and professional
- Acknowledge the customer's frustration if negative sentiment
- Provide concrete next steps
- Include ticket reference number if available
- Keep responses concise (under 200 words for simple issues)

Respond with JSON:
{
  "classification": {
    "category": "...",
    "sentiment": "...",
    "urgency": 1-5,
    "escalationRequired": boolean,
    "escalationReason": "...",
    "suggestedTags": [],
    "confidence": 0.0-1.0
  },
  "draftResponse": "...",
  "summary": "...",
  "nextActions": ["action 1", "action 2"]
}`;

export class SupportAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_SUPPORT, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<SupportResult> {
    const startedAt = new Date();
    const task = input as SupportTask;

    this.logger.info(
      { runId: context.runId, action: task.action, ticketId: task.ticketId },
      'Support agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'classify_ticket',
          description: 'Classify a support ticket by category, sentiment, and urgency',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Ticket content to classify' },
              categories: { type: 'array', items: { type: 'string' }, description: 'Available categories' },
            },
            required: ['text'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_knowledge_base',
          description: 'Search the support knowledge base for relevant articles and past resolutions',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              category: { type: 'string', description: 'Filter by support category' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'lookup_customer',
          description: 'Look up customer information and interaction history',
          parameters: {
            type: 'object',
            properties: {
              customerName: { type: 'string', description: 'Customer name to look up' },
              ticketId: { type: 'string', description: 'Related ticket ID' },
            },
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(SUPPORT_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          ticketContent: task.ticketContent,
          ticketId: task.ticketId,
          customerName: task.customerName,
          previousInteractions: task.previousInteractions?.slice(0, 3),
          category: task.category,
          industryContext: context.industry,
        }),
      },
    ];

    let result: SupportResult;

    try {
      const loopResult: ToolLoopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 1536,
        temperature: 0.3,
      });

      try {
        const parsed = this.parseJsonResponse<{
          classification?: {
            category?: string;
            sentiment?: string;
            urgency?: number;
            escalationRequired?: boolean;
            escalationReason?: string;
            suggestedTags?: string[];
            confidence?: number;
          };
          draftResponse?: string;
          summary?: string;
          nextActions?: string[];
        }>(loopResult.content);

        const cls = parsed.classification;
        const classification: SupportClassification | undefined = cls
          ? {
              category: (cls.category ?? 'general') as SupportCategory,
              sentiment: (cls.sentiment ?? 'neutral') as SupportSentiment,
              urgency: (Math.min(5, Math.max(1, cls.urgency ?? 3)) as 1 | 2 | 3 | 4 | 5),
              escalationRequired: cls.escalationRequired ?? false,
              escalationReason: cls.escalationReason,
              suggestedTags: cls.suggestedTags ?? [],
              confidence: cls.confidence ?? 0.8,
            }
          : undefined;

        result = {
          action: task.action,
          classification,
          draftResponse: parsed.draftResponse,
          summary: parsed.summary,
          escalationRequired: classification?.escalationRequired ?? false,
          escalationReason: classification?.escalationReason,
          suggestedTags: classification?.suggestedTags ?? [],
          nextActions: parsed.nextActions ?? [],
        };
      } catch {
        result = {
          action: task.action,
          escalationRequired: false,
          suggestedTags: [],
          nextActions: ['Manual review required — output format was unexpected'],
          summary: loopResult.content.slice(0, 500),
        };
      }

      this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: errorMsg }, 'Support agent execution failed');
      result = {
        action: task.action,
        escalationRequired: false,
        suggestedTags: [],
        nextActions: [`Error: ${errorMsg}`],
      };
      this.recordTrace(context, input, result, [], startedAt);
    }

    this.logger.info(
      {
        action: task.action,
        category: result.classification?.category,
        escalation: result.escalationRequired,
      },
      'Support agent completed',
    );

    return result;
  }
}
