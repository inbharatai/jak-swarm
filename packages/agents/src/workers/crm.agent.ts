import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
// ToolCall type used internally by executeWithTools()
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type CRMAction = 'LOOKUP' | 'UPDATE' | 'CREATE_NOTE' | 'SEARCH_DEALS' | 'LIST_CONTACTS';

export interface CRMContact {
  id: string;
  name: string;
  email?: string;
  company?: string;
  title?: string;
  phone?: string;
  lastContactDate?: string;
  tags?: string[];
}

export interface CRMDeal {
  id: string;
  name: string;
  stage: string;
  value?: number;
  currency?: string;
  contactId?: string;
  expectedCloseDate?: string;
  probability?: number;
}

export interface CRMNote {
  id: string;
  contactId: string;
  content: string;
  createdAt: string;
  author?: string;
}

export interface CRMTask {
  action: CRMAction;
  contactId?: string;
  contactEmail?: string;
  searchQuery?: string;
  updateData?: Record<string, unknown>;
  noteContent?: string;
  dealFilters?: {
    stage?: string;
    minValue?: number;
    maxValue?: number;
  };
  limit?: number;
}

export interface CRMResult {
  action: CRMAction;
  contacts?: CRMContact[];
  deals?: CRMDeal[];
  notes?: CRMNote[];
  updatedRecord?: Record<string, unknown>;
  requiresApproval: boolean;
  approvalReason?: string;
}

const CRM_SUPPLEMENT = `You are a CRM worker agent. You manage customer relationship data with care and precision.

For LOOKUP: retrieve a contact by ID or email and return structured profile data.
For UPDATE: modify a contact or deal record. This ALWAYS requires approval.
For CREATE_NOTE: add a note to a contact record. This ALWAYS requires approval.
For SEARCH_DEALS: query deals by stage, value range, or contact association.
For LIST_CONTACTS: return a paginated list of contacts with optional filters.

CRM best practices:
- Never expose raw PII (social security numbers, full payment info) in outputs
- Sanitize phone numbers and emails before returning (mask partial digits if configured)
- Maintain data hygiene: flag duplicate contacts, normalize company names
- When updating records, always include the previous value for audit trail
- Log every write operation for compliance traceability
- Use standardized lifecycle stages: lead, qualified, opportunity, customer, churned

You have access to these tools:
- lookup_crm_contact: retrieves a CRM contact by ID or email
- update_crm_record: updates a CRM record (REQUIRES APPROVAL)
- search_deals: searches deals with filters

Respond with JSON:
{
  "contacts": [...],
  "deals": [...],
  "notes": [...],
  "updatedRecord": {...}
}`;

/** Write operations that must be approved before execution. */
const WRITE_ACTIONS: Set<CRMAction> = new Set(['UPDATE', 'CREATE_NOTE']);

export class CRMAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_CRM, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<CRMResult> {
    const startedAt = new Date();
    const task = input as CRMTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'CRM agent executing task',
    );

    // All write operations require human approval
    if (WRITE_ACTIONS.has(task.action)) {
      const result: CRMResult = {
        action: task.action,
        requiresApproval: true,
        approvalReason:
          `CRM ${task.action.toLowerCase().replace('_', ' ')} operations require explicit human approval to ensure data integrity and compliance.`,
        updatedRecord:
          task.action === 'UPDATE' && task.updateData
            ? { contactId: task.contactId, proposedChanges: task.updateData }
            : undefined,
        notes:
          task.action === 'CREATE_NOTE' && task.noteContent
            ? [
                {
                  id: this.generateId('note_'),
                  contactId: task.contactId ?? '',
                  content: task.noteContent,
                  createdAt: new Date().toISOString(),
                },
              ]
            : undefined,
      };
      this.recordTrace(context, input, result, [], startedAt);
      return result;
    }

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'lookup_crm_contact',
          description: 'Look up a CRM contact by ID or email address',
          parameters: {
            type: 'object',
            properties: {
              contactId: { type: 'string', description: 'Contact ID' },
              email: { type: 'string', description: 'Contact email address' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'update_crm_record',
          description: 'Update a CRM record (requires approval)',
          parameters: {
            type: 'object',
            properties: {
              recordId: { type: 'string' },
              recordType: { type: 'string', enum: ['contact', 'deal', 'company'] },
              updates: { type: 'object' },
            },
            required: ['recordId', 'recordType', 'updates'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_deals',
          description: 'Search CRM deals with optional filters',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              stage: { type: 'string' },
              minValue: { type: 'number' },
              maxValue: { type: 'number' },
              limit: { type: 'number' },
            },
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(CRM_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          contactId: task.contactId,
          contactEmail: task.contactEmail,
          searchQuery: task.searchQuery,
          dealFilters: task.dealFilters,
          limit: task.limit,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 1536,
        temperature: 0.2,
        maxIterations: 3,
      });
    } catch (err) {
      this.logger.error({ err }, 'CRM executeWithTools failed');
      const fallback: CRMResult = {
        action: task.action,
        requiresApproval: false,
        contacts: [],
        deals: [],
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: CRMResult;

    try {
      const parsed = this.parseJsonResponse<Partial<CRMResult>>(loopResult.content);
      result = {
        action: task.action,
        contacts: parsed.contacts,
        deals: parsed.deals,
        notes: parsed.notes,
        updatedRecord: parsed.updatedRecord,
        requiresApproval: false,
      };
    } catch {
      result = {
        action: task.action,
        contacts: [],
        deals: [],
        requiresApproval: false,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        contactCount: result.contacts?.length ?? 0,
        dealCount: result.deals?.length ?? 0,
      },
      'CRM agent completed',
    );

    return result;
  }
}
