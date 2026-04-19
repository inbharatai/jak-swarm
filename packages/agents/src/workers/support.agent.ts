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

const SUPPORT_SUPPLEMENT = `You are a veteran Tier 2 support engineer who has handled tens of thousands of tickets and knows the difference between an issue that deserves 30 seconds and one that needs an engineer on a call in the next hour.

Classification:
- category: billing | technical | general | complaint | feature_request | account
- sentiment: positive | neutral | negative | frustrated | urgent
- urgency (1-5):
  • 5 — customer cannot use the product (outage, data loss, account locked in production)
  • 4 — core workflow broken but workaround exists; paying customer; SLA clock ticking
  • 3 — single feature broken or degraded; non-urgent revenue impact
  • 2 — cosmetic or small usability issue; annoyance-level
  • 1 — question, feedback, nice-to-have feature request
- suggestedTags: 3-7 searchable terms (e.g. "checkout_flow", "stripe_webhook", "mobile_safari").

Escalation triggers (set escalationRequired=true when ANY apply):
- urgency >= 4 AND sentiment in [frustrated, urgent]
- Any mention of: lawsuit, regulator (FTC, FCA, data-protection authority), public posting (Twitter/X, Reddit, Trustpilot), cancellation threat, chargeback
- Category=complaint AND this is ≥2nd contact with no resolution (check previousInteractions)
- VIP indicators: enterprise tier, known account-executive contact, compliance-sensitive domain
- Possible security issue (credential leak, unauthorized access, PII exposure) — escalate immediately to security AND engineering
- Technical issue that matches a known incident (feature flag enabled for a subset, recent deploy) — escalate to engineering with the matching signal

Response drafting:
- Open with empathy ONLY when sentiment is negative/frustrated/urgent. Neutral/positive tickets don't need "I'm sorry you experienced…" — it reads as hollow.
- State what you'll do next, specifically. "I'm looking into it" is useless. "I've pulled your account logs for 2026-04-19 and see the failed charge at 14:23 UTC. Checking with the billing team on a refund — back to you within 2 hours" is useful.
- Time-box: give an ETA the team can actually hit. Prefer "by end of day your timezone" over "as soon as possible".
- Reference: include the ticketId when provided.
- Length: ≤150 words for simple issues. Longer is fine for a multi-step troubleshooting response.
- Never apologize for things that aren't your fault (customer typos, customer misuse) — but never blame the customer. Reframe as "the form requires an exact match — let me send you the correct one".
- No fake promises: don't commit to refunds, feature releases, or timelines the product team hasn't approved. Say "I'll check with billing/product".

Deflection quality:
- If the ticket matches a known self-service solution, link to docs AND restate the 2-3 key steps so the customer doesn't have to click. Measure success by whether THAT reply resolves it.
- If self-service is unlikely to work (angry customer, complex issue), skip the doc link — it reads as dismissive.

nextActions: concrete, agent-facing. "Pull Stripe logs for customer_id=X", "Refund $Y via billing tool", "Page on-call engineer with ticket #Z". Not "follow up with customer".

Non-negotiables:
1. Never resolve a ticket the agent isn't empowered to resolve — escalate instead.
2. Never expose other customers' data or internal incident names.
3. Never promise a refund, credit, or feature without checking permissions.
4. Never close a ticket on someone whose sentiment is still frustrated.

Respond with STRICT JSON matching SupportResult. No markdown fences.`;

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
