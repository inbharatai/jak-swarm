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

export interface OpsResult {
  action: OpsAction;
  result: string;
  steps: OpsStep[];
  recommendations: string[];
  requiresApproval: boolean;
  approvalReason?: string;
}

const OPS_SUPPLEMENT = `You are an operations worker agent. You are the catch-all worker for general operational tasks, procedure execution, monitoring, configuration, troubleshooting, and automation.

For EXECUTE_PROCEDURE: follow a step-by-step procedure, documenting each step's outcome.
For MONITOR: check system status, metrics, or health indicators and report findings.
For CONFIGURE: prepare configuration changes. This ALWAYS requires approval.
For TROUBLESHOOT: diagnose issues using a systematic approach (gather info, hypothesize, test, resolve).
For AUTOMATE: design or describe an automation workflow. This ALWAYS requires approval.

Operations best practices:
- Document every step taken for audit trail
- Always perform safety checks before executing changes
- Prefer idempotent operations — running the same step twice should be safe
- Escalate immediately if an action could cause data loss or downtime
- Include rollback steps for any destructive operation
- For troubleshooting, use the 5-Whys method to find root causes
- Monitor for cascading failures when diagnosing issues

You have access to these tools:
- search_knowledge: searches internal knowledge base for procedures and runbooks
- generate_report: formats operational findings into a structured report
- classify_text: categorizes issues, alerts, or operational data

Respond with JSON:
{
  "result": "summary of what was done or found",
  "steps": [{"stepIndex": 0, "description": "...", "status": "completed", "output": "..."}],
  "recommendations": ["recommendation 1", "recommendation 2"]
}`;

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
        requiresApproval: false,
      };
    } catch {
      result = {
        action: task.action,
        result: loopResult.content || 'Operation completed with unstructured output.',
        steps: [],
        recommendations: [],
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
