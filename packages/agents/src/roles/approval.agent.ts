import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import type { WorkflowTask, ApprovalRequest } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export interface ApprovalInput {
  task: WorkflowTask;
  proposedData: unknown;
  affectedEntities?: string[];
  /** Item B (OpenClaw-inspired Phase 1) — reviewer-context fields the
   * approval card surfaces so the reviewer can see the SPECIFIC
   * tool / files / service / expected result they're binding their
   * decision to. All optional. The approval-node populates what it
   * can derive from the task; the agent passes them through. */
  toolName?: string;
  filesAffected?: string[];
  externalService?: string;
  idempotencyKey?: string;
}

/**
 * Coarse mapping from tool name patterns to the user-visible external
 * service label that the approval card shows. Conservative — when the
 * tool name doesn't match a known pattern, the field is left undefined
 * so the UI falls back to the tool name itself.
 */
function deriveExternalService(toolName?: string): string | undefined {
  if (!toolName) return undefined;
  const t = toolName.toLowerCase();
  if (t.startsWith('gmail') || t.includes('email')) return 'Gmail';
  if (t.startsWith('slack')) return 'Slack';
  if (t.startsWith('whatsapp')) return 'WhatsApp';
  if (t.startsWith('twitter') || t.startsWith('x_')) return 'Twitter/X';
  if (t.startsWith('linkedin')) return 'LinkedIn';
  if (t.startsWith('hubspot')) return 'HubSpot';
  if (t.startsWith('salesforce')) return 'Salesforce';
  if (t.startsWith('notion')) return 'Notion';
  if (t.startsWith('github')) return 'GitHub';
  if (t.startsWith('vercel')) return 'Vercel';
  if (t.startsWith('stripe')) return 'Stripe';
  if (t.startsWith('paddle')) return 'Paddle';
  return undefined;
}

const APPROVAL_SUPPLEMENT = `You are an approval agent that explains risky actions clearly to non-technical reviewers.

Your role is to generate a human-readable approval request that explains:
1. What action is about to happen (in plain English, no jargon)
2. What data will be affected (specific records, people, systems)
3. What the consequences are if approved
4. What the rollback options are if something goes wrong
5. A risk assessment in plain language

You must respond with JSON:
{
  "actionTitle": "short action title (max 80 chars)",
  "plainDescription": "2-3 sentence plain English explanation of what will happen",
  "affectedData": "description of what data/records/people will be affected",
  "consequences": "what happens if approved — be specific",
  "rollbackOptions": "how to undo this action if needed, or 'Not reversible' if irreversible",
  "riskAssessment": "plain language risk explanation suitable for a business manager"
}

Be honest about irreversible actions. Never downplay risks.`;

export class ApprovalAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.APPROVAL, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<ApprovalRequest> {
    const startedAt = new Date();
    const {
      task,
      proposedData,
      affectedEntities,
      toolName: explicitToolName,
      filesAffected: explicitFilesAffected,
      externalService: explicitExternalService,
      idempotencyKey: explicitIdempotencyKey,
    } = input as ApprovalInput;

    this.logger.info(
      { runId: context.runId, taskId: task.id, riskLevel: task.riskLevel },
      'Approval agent generating approval request',
    );

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(APPROVAL_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          taskName: task.name,
          taskDescription: task.description,
          agentRole: task.agentRole,
          toolsRequired: task.toolsRequired,
          riskLevel: task.riskLevel,
          proposedData,
          affectedEntities: affectedEntities ?? [],
        }),
      },
    ];

    let actionTitle = task.name;
    let plainDescription = task.description;
    let affectedData = 'See task details';
    let consequences = 'Action will be executed as described';
    let rollbackOptions = 'Review task for rollback options';
    let riskAssessment = `This is a ${task.riskLevel} risk action.`;

    try {
      const completion = await this.callLLM(messages, undefined, {
        maxTokens: 768,
        temperature: 0.3,
      });

      const rawContent = completion.choices[0]?.message?.content ?? '{}';
      const parsed = this.parseJsonResponse<{
        actionTitle?: string;
        plainDescription?: string;
        affectedData?: string;
        consequences?: string;
        rollbackOptions?: string;
        riskAssessment?: string;
      }>(rawContent);

      actionTitle = parsed.actionTitle ?? actionTitle;
      plainDescription = parsed.plainDescription ?? plainDescription;
      affectedData = parsed.affectedData ?? affectedData;
      consequences = parsed.consequences ?? consequences;
      rollbackOptions = parsed.rollbackOptions ?? rollbackOptions;
      riskAssessment = parsed.riskAssessment ?? riskAssessment;
    } catch (err) {
      this.logger.warn({ err }, 'Approval agent LLM call failed, using task metadata');
    }

    // Item B (OpenClaw-inspired Phase 1) — reviewer-context defaults.
    // Prefer fields explicitly passed in by the caller (they have the
    // freshest task input); fall back to deriving from task.toolsRequired
    // and the LLM's `consequences` line when available.
    const toolName = explicitToolName ?? task.toolsRequired?.[0];
    const externalService = explicitExternalService ?? deriveExternalService(toolName);
    const filesAffected = explicitFilesAffected ?? [];
    const idempotencyKey = explicitIdempotencyKey;

    const approvalRequest: ApprovalRequest = {
      id: this.generateId('apr_'),
      workflowId: context.workflowId,
      taskId: task.id,
      agentRole: task.agentRole,
      action: actionTitle,
      rationale: `${plainDescription}\n\nAffected data: ${affectedData}\n\nConsequences: ${consequences}\n\nRollback: ${rollbackOptions}\n\nRisk assessment: ${riskAssessment}`,
      proposedData,
      riskLevel: task.riskLevel,
      status: 'PENDING',
      createdAt: new Date(),
      // New reviewer-context surface (Item B). All optional — the UI
      // gracefully falls back to action+rationale when these are absent.
      toolName,
      filesAffected,
      externalService,
      idempotencyKey,
      expectedResult: consequences,
    };

    this.recordTrace(context, input, approvalRequest, [], startedAt);

    this.logger.info(
      { approvalRequestId: approvalRequest.id, taskId: task.id },
      'Approval request created',
    );

    return approvalRequest;
  }
}
