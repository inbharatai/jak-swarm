import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
// ToolCall type used internally by executeWithTools()
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type OpsAction =
  | 'EXECUTE_PROCEDURE'
  | 'MONITOR'
  | 'CONFIGURE'
  | 'TROUBLESHOOT'
  | 'AUTOMATE';

export interface OpsStep {
  stepIndex: number;
  description: string;
  status: 'pending' | 'completed' | 'failed' | 'skipped';
  output?: string;
  error?: string;
}

export interface OpsTask {
  action: OpsAction;
  description: string;
  procedureId?: string;
  parameters?: Record<string, unknown>;
  systemContext?: string;
  urgency?: 'low' | 'medium' | 'high' | 'critical';
}

/** Severity triage during MONITOR / TROUBLESHOOT. */
export type OpsSeverity = 'p4' | 'p3' | 'p2' | 'p1' | 'p0';

export interface OpsIncidentTriage {
  severity: OpsSeverity;
  /** Blast-radius estimate: how many users/tenants/services affected. */
  blastRadius: 'single_user' | 'single_tenant' | 'service_cohort' | 'all_users';
  /** Whether customer data loss is possible. */
  dataLossRisk: boolean;
  /** Whether an active cascade risk exists (dependent services failing). */
  cascadeRisk: boolean;
  /** Primary suspect cause — one line, evidence-based. */
  primaryHypothesis: string;
  /** Alternative hypotheses in rank order. */
  alternativeHypotheses?: string[];
  /** Is this a known-issue match in runbook? If so, its id. */
  matchedRunbookId?: string;
}

/** Concrete rollback plan when a CONFIGURE or destructive op is staged. */
export interface OpsRollbackPlan {
  /** Specific steps to reverse the change if it goes wrong. */
  steps: string[];
  /** How quickly rollback can be initiated (SLA / eta). */
  eta: string;
  /** Whether the rollback itself requires data restore. */
  requiresDataRestore: boolean;
}

export interface OpsResult {
  action: OpsAction;
  result: string;
  steps: OpsStep[];
  recommendations: string[];
  /** Severity-classified triage for MONITOR / TROUBLESHOOT. */
  triage?: OpsIncidentTriage;
  /** Rollback plan for CONFIGURE / AUTOMATE. */
  rollback?: OpsRollbackPlan;
  /** Five-whys diagnosis chain for TROUBLESHOOT (shallow to root). */
  rootCauseChain?: string[];
  requiresApproval: boolean;
  approvalReason?: string;
}

const OPS_SUPPLEMENT = `You are a senior SRE / Operations engineer who has been on-call for production systems serving millions of users. You triage by severity, hypothesize with evidence, and never run CONFIGURE / AUTOMATE / destructive actions without a written rollback plan.

Action handling:

EXECUTE_PROCEDURE:
- Follow the referenced procedureId or the described procedure step-by-step.
- Every step carries a clear pass/fail outcome. Never skip a step silently — mark skipped with reason.
- If a step fails AND the procedure has no recovery branch, STOP and return with a clear break-point for a human.
- Idempotency: verify each step can safely re-run before executing (e.g., "service already started" is success, not failure).

MONITOR:
- Classify severity:
  • p0 — outage / data loss / security breach — blast radius = all users
  • p1 — critical degradation — blast radius = service cohort; customer-visible errors
  • p2 — elevated error rate / latency SLO breach — partial user impact
  • p3 — saturation warning / capacity concern — no current user impact
  • p4 — informational / drift from baseline
- Report blast radius, data-loss risk, cascade risk. Don't under-classify to avoid a page.

CONFIGURE / AUTOMATE:
- ALWAYS returns requiresApproval=true with a structured rollback plan.
- Rollback plan must include: exact reversal steps, ETA to complete rollback, whether data restore is required.
- If the change is a database migration, explicitly call out: forward-migration reversibility, backfill time, lock contention risk.
- Never propose destructive config without a dry-run / backup step first.

TROUBLESHOOT:
- Use structured five-whys: record rootCauseChain[] from surface symptom → root cause, each layer a concrete fact.
- Primary hypothesis + alternatives: rank by likelihood. State what evidence would confirm / rule out each.
- Check for known-issue runbook matches before hypothesizing from scratch.
- Monitor for cascading failures: if service A depends on service B and both look bad, B is the suspect. Don't chase symptoms upstream.

General non-negotiables:
- Document every action. Audit trail is the deliverable, not an afterthought.
- Safety check before any change: does the system tolerate this action at this time-of-day / this traffic level?
- Escalate immediately on data-loss risk or security incident — don't batch these in a normal response.
- Time-of-day awareness: prefer non-peak windows for risky changes. If caller requests a peak-hour change, warn explicitly.

Tools:
- search_knowledge: runbooks + past incidents (MATCH against this first)
- generate_report: structured operational report
- classify_text: incident / alert classification
- track_okrs: correlate ops incidents with OKR impact

Return STRICT JSON matching OpsResult. Populate triage for MONITOR/TROUBLESHOOT, rollback for CONFIGURE/AUTOMATE, rootCauseChain for TROUBLESHOOT.`;

/** Actions that modify system configuration and must be approved. */
const APPROVAL_REQUIRED_ACTIONS: Set<OpsAction> = new Set([
  'CONFIGURE',
  'AUTOMATE',
]);

export class OpsAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_OPS, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<OpsResult> {
    const startedAt = new Date();
    const task = input as OpsTask;

    this.logger.info(
      { runId: context.runId, action: task.action, urgency: task.urgency },
      'Ops agent executing task',
    );

    // Configuration and automation changes require human approval
    if (APPROVAL_REQUIRED_ACTIONS.has(task.action)) {
      const result: OpsResult = {
        action: task.action,
        result: `Proposed ${task.action.toLowerCase()} operation prepared for review.`,
        steps: [
          {
            stepIndex: 0,
            description: `Prepare ${task.action.toLowerCase()} plan based on: ${task.description.slice(0, 200)}`,
            status: 'completed',
            output: 'Plan prepared, awaiting approval.',
          },
        ],
        recommendations: [
          'Review the proposed changes before approving.',
          'Ensure a rollback plan is in place.',
        ],
        requiresApproval: true,
        approvalReason:
          `Operations ${task.action.toLowerCase()} tasks require explicit human approval to prevent unintended system changes.`,
      };
      this.recordTrace(context, input, result, [], startedAt);
      return result;
    }

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search the internal knowledge base for procedures, runbooks, and documentation',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              category: { type: 'string', description: 'Category filter (e.g. runbook, procedure, config)' },
              limit: { type: 'number', description: 'Max results to return' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generate_report',
          description: 'Generate a structured operational report',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              findings: { type: 'object' },
              format: { type: 'string', enum: ['summary', 'detailed', 'incident'] },
            },
            required: ['title', 'findings'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'classify_text',
          description: 'Classify operational text into categories (alert type, severity, component)',
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
      {
        type: 'function',
        function: {
          name: 'check_runbook',
          description: 'Look up a runbook by known-issue signature (error message, stack trace, alert name). Returns matching runbookId + steps if found. USE FIRST on TROUBLESHOOT — a known-issue match bypasses new hypothesizing.',
          parameters: {
            type: 'object',
            properties: {
              signature: { type: 'string', description: 'Error message, alert name, or stack trace hash' },
              service: { type: 'string', description: 'Optional service name for narrower match' },
            },
            required: ['signature'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(OPS_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          description: task.description,
          procedureId: task.procedureId,
          parameters: task.parameters,
          systemContext: task.systemContext,
          urgency: task.urgency,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 2048,
        temperature: 0.2,
        maxIterations: 5,
      });
    } catch (err) {
      this.logger.error({ err }, 'Ops executeWithTools failed');
      const fallback: OpsResult = {
        action: task.action,
        result: 'Operation failed due to an internal error. Manual intervention may be required.',
        steps: [],
        recommendations: ['Retry the operation', 'Check system logs for more details'],
        requiresApproval: false,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: OpsResult;

    try {
      const parsed = this.parseJsonResponse<Partial<OpsResult>>(loopResult.content);
      result = {
        action: task.action,
        result: parsed.result ?? 'Operation completed. See steps for details.',
        steps: parsed.steps ?? [],
        recommendations: parsed.recommendations ?? [],
        triage: parsed.triage,
        rollback: parsed.rollback,
        rootCauseChain: parsed.rootCauseChain,
        requiresApproval: false,
      };
    } catch {
      result = {
        action: task.action,
        result: loopResult.content || 'Operation completed with unstructured output.',
        steps: [],
        recommendations: [
          'Manual review required — output format was unexpected. Do not execute any proposed action without operator verification.',
        ],
        requiresApproval: false,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        stepCount: result.steps.length,
        recommendationCount: result.recommendations.length,
      },
      'Ops agent completed',
    );

    return result;
  }
}
