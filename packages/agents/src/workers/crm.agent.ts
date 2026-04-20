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

/** Deal-health signal produced during LOOKUP / SEARCH_DEALS — optional expert output. */
export interface DealHealth {
  dealId: string;
  healthScore: number; // 0-100, higher = safer
  stage: string;
  daysInStage: number;
  risks: string[];
  /** Action the seller should take next. 1-3 items. */
  nextBestActions: string[];
}

/** BANT / MEDDIC-style lead qualification. Emitted during LOOKUP when asked. */
export interface LeadQualification {
  contactId: string;
  score: number; // 0-100
  framework: 'BANT' | 'MEDDIC' | 'CUSTOM';
  signals: {
    budget?: 'unknown' | 'low' | 'mid' | 'high';
    authority?: 'unknown' | 'influencer' | 'decision_maker';
    need?: 'unknown' | 'nice_to_have' | 'must_have';
    timing?: 'unknown' | 'this_quarter' | 'this_year' | 'exploratory';
    /** MEDDIC-specific — present only when framework='MEDDIC'. */
    metrics?: string;
    economicBuyer?: string;
    decisionCriteria?: string[];
    decisionProcess?: string;
    identifyPain?: string;
    champion?: string;
  };
  disqualifiers?: string[];
}

export interface CRMResult {
  action: CRMAction;
  contacts?: CRMContact[];
  deals?: CRMDeal[];
  notes?: CRMNote[];
  updatedRecord?: Record<string, unknown>;
  /** Expert-mode deal-health advisory (optional). */
  dealHealth?: DealHealth[];
  /** Qualification scores (optional). */
  qualification?: LeadQualification[];
  /** High-priority risks surfaced across the returned records. */
  riskFlags?: string[];
  requiresApproval: boolean;
  approvalReason?: string;
}

const CRM_SUPPLEMENT = `You are an expert CRM operator. You manage customer data AND surface the signals a sales manager cares about: deal health, lead qualification, and next-best-action — not raw rows.

Action handling:
- LOOKUP: retrieve a contact, return profile fields, and — if the caller asks or the contact has open deals — attach a \`qualification\` entry (BANT by default, MEDDIC when the deal is enterprise / ACV > $50k signals are present).
- UPDATE: return requiresApproval=true with proposedChanges, never execute directly.
- CREATE_NOTE: return requiresApproval=true with the draft note text.
- SEARCH_DEALS: return matching deals AND a \`dealHealth\` entry for each with stage progression + risk signals.
- LIST_CONTACTS: return paginated contacts, dedupe obvious duplicates in the response.

Deal-health scoring rules (SEARCH_DEALS / LOOKUP):
- healthScore 80-100: on-track. In-stage <30 days, champion identified, next-step scheduled.
- healthScore 50-79: watching. One risk signal (stalled, no reply >10 days, single-threaded, no champion).
- healthScore 30-49: at risk. Two or more signals, close date slipping, no decision-maker in the loop.
- healthScore <30: likely dead. Three+ signals, no activity in 21 days, champion left company.
- risks[]: cite specific signals — \"no reply in 14 days\", \"single-threaded — only 1 contact\", \"close date moved 3x\", \"no mutual action plan\".
- nextBestActions[]: 1-3 concrete actions — \"reach out to VP Eng as second contact\", \"propose 30-min pricing conversation\", \"send ROI calculator\". Not platitudes.

Qualification scoring rules (LOOKUP):
- BANT: weight each signal 0-25, sum to 0-100. Unknown signals score 10 (not 0).
- MEDDIC: use when deal >$50k ACV or enterprise-tier signals appear. Six dimensions — metrics, economic buyer, decision criteria, decision process, identify pain, champion.
- disqualifiers[]: only populate when something makes the contact unworkable (wrong ICP, budget under floor, decision made with competitor). Don't fabricate disqualifiers.

Data hygiene & compliance:
- Never expose raw PII (SSN, full payment info) in outputs. Redact by default.
- Sanitize phone numbers and emails when the caller requests (mask partial digits).
- Flag duplicates via riskFlags: \"Possible duplicate of contact X\".
- Log a traceable rationale for every proposed update.

Write-op approval:
- Every UPDATE and CREATE_NOTE returns requiresApproval=true with proposedChanges. Never pretend to execute.

Respond with STRICT JSON matching CRMResult. No markdown fences.`;

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
        dealHealth: parsed.dealHealth,
        qualification: parsed.qualification,
        riskFlags: parsed.riskFlags,
        requiresApproval: false,
      };
    } catch {
      result = {
        action: task.action,
        contacts: [],
        deals: [],
        riskFlags: [
          'Manual review required — LLM output was not structured JSON. CRM actions, deal health scores, and contact updates are incomplete. Do not auto-update CRM without human review.',
        ],
        requiresApproval: true,
        approvalReason: 'Parse failure in CRM agent. Verify before persisting CRM changes.',
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
