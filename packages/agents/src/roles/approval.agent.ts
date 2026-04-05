import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import type { WorkflowTask, ApprovalRequest } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export interface ApprovalInput {
  task: WorkflowTask;
  proposedData: unknown;
  affectedEntities?: string[];
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
    const { task, proposedData, affectedEntities } = input as ApprovalInput;

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
    };

    this.recordTrace(context, input, approvalRequest, [], startedAt);

    this.logger.info(
      { approvalRequestId: approvalRequest.id, taskId: task.id },
      'Approval request created',
    );

    return approvalRequest;
  }
}
