import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type EmailAction = 'READ' | 'DRAFT' | 'SEND' | 'CLASSIFY' | 'SUMMARIZE';

export interface EmailFilter {
  from?: string;
  subject?: string;
  after?: string;
  before?: string;
  labels?: string[];
  limit?: number;
}

export interface EmailTask {
  action: EmailAction;
  filters?: EmailFilter;
  draftContent?: {
    to: string[];
    subject: string;
    body: string;
    replyToId?: string;
  };
  messageId?: string;
  requiresApproval?: boolean;
}

export interface EmailMessage {
  id: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: string;
  labels: string[];
  snippet?: string;
}

/** Deliverability advisory fields — populated on DRAFT when the LLM
 *  detects a risk. Absent when the draft is clean. Kept optional so
 *  existing callers don't need to change. */
export interface EmailDeliverability {
  /** 0-100, higher is safer (less likely to be flagged as spam / phishing). */
  safetyScore: number;
  /** Spam-trigger phrases the draft should avoid (detected by regex + LLM). */
  spamTriggers: string[];
  /** Notes on tone, length, CTA count, and image/text ratio. */
  notes: string[];
  /** True when the body is missing an unsubscribe line in a marketing send. */
  missingUnsubscribe?: boolean;
  /** True when the draft asks for SPF/DKIM/DMARC alignment in the sending domain. */
  authenticationAdvisory?: boolean;
}

export interface EmailABVariant {
  label: string;
  subject: string;
  preheader?: string;
  hypothesis: string;
}

export interface EmailResult {
  action: EmailAction;
  emails?: EmailMessage[];
  draft?: {
    id: string;
    to: string[];
    subject: string;
    /** Inbox-preview hint (iOS/Gmail 40-90 chars after subject). Optional. */
    preheader?: string;
    body: string;
    createdAt: string;
  };
  summary?: string;
  classification?: {
    category: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    tags: string[];
  };
  /** Expert deliverability advisory for DRAFT output. */
  deliverability?: EmailDeliverability;
  /** Optional A/B subject variants — 2-3 hypotheses, e.g. benefit-led vs curiosity. */
  abVariants?: EmailABVariant[];
  /** Suggested ISO 8601 send time (e.g. Tue/Wed/Thu 9-11am in the recipient TZ). */
  sendTimeSuggestion?: string;
  /** Human-readable compliance flags (CAN-SPAM, GDPR, sender-warmup etc). */
  complianceNotes?: string[];
  requiresApproval: boolean;
  approvalReason?: string;
}

const EMAIL_SUPPLEMENT = `You are an expert email operator. Your job is to produce email output that is professional, on-brand, deliverable, and compliant — not just grammatically correct.

Action handling:
- READ: return a structured summary of emails matching filters (from, subject, labels, limit). Do not invent emails.
- DRAFT: compose a draft AND attach a deliverability advisory (see schema below). Do not send.
- SEND: ALWAYS requires explicit human approval. Never fabricate a send confirmation.
- CLASSIFY: label intent, priority (LOW/MEDIUM/HIGH), and 3-5 tags.
- SUMMARIZE: 2-3 sentence TL;DR followed by action items.

When drafting:
1. SUBJECT + PREHEADER — write a subject (≤60 chars, action-oriented) AND a 40-90 char preheader that completes the hook shown in inbox previews. The subject should not repeat words the preheader covers.
2. TONE — match the industry context (B2B SaaS ≠ e-commerce ≠ internal ops). Avoid superlatives and salesy exclamation marks in B2B unless the brand voice calls for them.
3. LENGTH — a cold email should be ≤120 words. A follow-up ≤80. An internal status email can be longer.
4. ONE ask per email. State the ask clearly in the last line.
5. PII — never introduce personally-identifying information that wasn't in the input.
6. ATTACHMENTS / LINKS — never invent URLs. If a link is needed, leave {{LINK}} placeholder.

Deliverability checklist to run before returning the draft:
- Spam triggers: avoid ALL CAPS, \"100% FREE\", \"guarantee\", excessive !!!, hidden text, shortened URLs. List any triggers found in spamTriggers[].
- Authentication advisory: if sending from a new domain, note that SPF + DKIM + DMARC alignment is required to avoid spam folder.
- Sender warmup: if the volume looks like a cold-outreach campaign, recommend <50 sends/day from a new mailbox for the first 2 weeks and gradual ramp.
- Unsubscribe: a marketing broadcast without an unsubscribe line is non-compliant with CAN-SPAM / GDPR — set missingUnsubscribe=true and add to complianceNotes.
- Image-to-text ratio: text-dominant drafts deliver better. Flag image-heavy drafts.
- Compute safetyScore 0-100 (lower = riskier). <60 should block automated send.

A/B variants (abVariants[]):
- Offer 2-3 subject + preheader variants with a one-line hypothesis each:
  • benefit-led: what the reader gets
  • curiosity: incomplete information that prompts open
  • social-proof: name-drop a metric or customer

Send-time suggestion:
- Default to Tue/Wed/Thu 9-11am in the recipient's local TZ. Avoid Mondays/Fridays unless the content is time-sensitive.

Return STRICT JSON matching EmailResult. Do not wrap in markdown fences.

Tools available:
- read_email: reads emails from the inbox
- draft_email: creates a draft email
- classify_text: classifies text content
Send is NEVER in-loop; it goes through the approval gate.`;

export class EmailAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_EMAIL, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<EmailResult> {
    const startedAt = new Date();
    const task = input as EmailTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Email agent executing task',
    );

    // SEND always requires approval
    if (task.action === 'SEND') {
      const result: EmailResult = {
        action: 'SEND',
        requiresApproval: true,
        approvalReason:
          'Email send operations always require explicit human approval before execution to prevent unauthorized external communications.',
        draft: task.draftContent
          ? {
              id: this.generateId('draft_'),
              to: task.draftContent.to,
              subject: task.draftContent.subject,
              body: task.draftContent.body,
              createdAt: new Date().toISOString(),
            }
          : undefined,
      };
      this.recordTrace(context, input, result, [], startedAt);
      return result;
    }

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'read_email',
          description: 'Read emails from inbox with optional filters',
          parameters: {
            type: 'object',
            properties: {
              filter: {
                type: 'object',
                properties: {
                  from: { type: 'string' },
                  subject: { type: 'string' },
                  limit: { type: 'number' },
                },
              },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'draft_email',
          description: 'Create a draft email',
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'array', items: { type: 'string' } },
              subject: { type: 'string' },
              body: { type: 'string' },
            },
            required: ['to', 'subject', 'body'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'classify_text',
          description: 'Classify email content',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              categories: { type: 'array', items: { type: 'string' } },
            },
            required: ['text'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(EMAIL_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          filters: task.filters,
          draftContent: task.draftContent,
          messageId: task.messageId,
          industryContext: context.industry,
        }),
      },
    ];

    let result: EmailResult;

    try {
      const loopResult: ToolLoopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 1536,
        temperature: 0.3,
      });

      try {
        const parsed = this.parseJsonResponse<Partial<EmailResult>>(loopResult.content);
        result = {
          action: task.action,
          emails: parsed.emails,
          draft: parsed.draft,
          summary: parsed.summary,
          classification: parsed.classification,
          deliverability: parsed.deliverability,
          abVariants: parsed.abVariants,
          sendTimeSuggestion: parsed.sendTimeSuggestion,
          complianceNotes: parsed.complianceNotes,
          requiresApproval: parsed.requiresApproval ?? false,
          approvalReason: parsed.approvalReason,
        };
      } catch {
        // LLM returned freeform text — wrap gracefully
        result = {
          action: task.action,
          summary: loopResult.content || 'Email task processed but output format was unexpected.',
          requiresApproval: false,
        };
      }

      this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: errorMsg }, 'Email agent execution failed');
      result = {
        action: task.action,
        requiresApproval: false,
        summary: `Error: ${errorMsg}`,
      };
      this.recordTrace(context, input, result, [], startedAt);
    }

    return result;
  }
}
