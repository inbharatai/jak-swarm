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

export interface EmailResult {
  action: EmailAction;
  emails?: EmailMessage[];
  draft?: {
    id: string;
    to: string[];
    subject: string;
    body: string;
    createdAt: string;
  };
  summary?: string;
  classification?: {
    category: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    tags: string[];
  };
  requiresApproval: boolean;
  approvalReason?: string;
}

const EMAIL_SUPPLEMENT = `You are an email worker agent. You process email tasks with precision.

For READ: return a summary of emails found matching filters
For DRAFT: compose a professional email draft based on provided content
For SEND: this ALWAYS requires human approval before execution
For CLASSIFY: categorize emails by intent, priority, and suggest tags
For SUMMARIZE: provide a concise summary of email content

When drafting emails:
- Match the professional tone of the industry context
- Be concise and clear
- Include appropriate greetings and sign-offs
- Do not include PII that wasn't in the input

You have access to these tools:
- read_email: reads emails from the inbox
- draft_email: creates a draft email
- send_email: sends an email (REQUIRES APPROVAL)
- classify_text: classifies text content`;

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
