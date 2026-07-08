/**
 * replanner.agent.ts — HyperAgent Phase 4 ReplannerAgent.
 *
 * The LLM half of Innovation #3 (replanner as constrained symbolic search).
 * The deterministic proposer + symbolic validator live in
 * `packages/swarm/src/hyperagent/replanner.ts` (pure, testable, and the layer
 * that decides whether a plan can be applied). This agent is the thin LLM
 * wrapper that proposes a richer revised plan for cases the deterministic
 * proposer does not cover. Its output STILL passes the symbolic validator —
 * no LLM-proposed plan reaches execution without passing DAG / tool / agent /
 * cost / risk / approval / idempotency validation.
 *
 * Layering: agents → shared only. The swarm node passes `agent.llmPropose` as
 * the `llmPropose` option to `replan()`; when no LLM key is configured the
 * agent returns null and the deterministic proposer runs.
 */

import { AgentRole, RepairType, RiskLevel } from '@jak-swarm/shared';
import type { ReplanContext, WorkflowPlan } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

/** Structured proposal the LLM returns. */
export interface LlmReplanProposal {
  repairType: RepairType;
  updatedPlan: WorkflowPlan;
  reason: string;
  expectedImprovement: number;
}

export class ReplannerAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.VERIFIER, apiKey ?? 'not-used');
  }

  /** Standard BaseAgent entry — delegates to the typed `llmPropose`. */
  async _executeImpl(input: unknown, context: AgentContext): Promise<LlmReplanProposal | null> {
    return this.llmPropose(input as ReplanContext, context);
  }

  /**
   * Propose a revised plan. Returns null when the LLM is unavailable or declines
   * to propose — the pure orchestrator then falls back to the deterministic
   * proposer. The returned plan is NEVER trusted blindly; `replan()` validates it.
   */
  async llmPropose(ctx: ReplanContext, _context?: AgentContext): Promise<LlmReplanProposal | null> {
    const prompt = this.buildPrompt(ctx);
    try {
      const completion = await this.callLLM(prompt, undefined, {
        maxTokens: 1200,
        temperature: 0.2,
        jsonMode: true,
      });
      const text = completion.choices[0]?.message?.content ?? '';
      return this.parseProposal(text);
    } catch (err) {
      this.logger.warn({ err }, 'ReplannerAgent LLM call failed; deferring to deterministic proposer');
      return null;
    }
  }

  private buildPrompt(ctx: ReplanContext): Array<{ role: 'system' | 'user'; content: string }> {
    return [
      {
        role: 'system',
        content:
          'You are the replanner for a governed multi-agent system. Given a failed task, its ' +
          'diagnosis, the original plan, completed outputs, permitted agents/tools, and the ' +
          'remaining budget, propose a MINIMAL revised plan. You may: MODIFY_TASK, REPLACE_AGENT, ' +
          'REPLACE_TOOL, ADD_PREREQUISITE, SPLIT_TASK, REORDER_TASKS, REDUCE_SCOPE, REQUEST_INPUT, ' +
          'or ESCALATE. Never repeat completed external actions. Never lower risk or strip ' +
          'approval from a previously approval-required task. Return the FULL revised plan as ' +
          'strict JSON matching the WorkflowPlan shape. The symbolic validator will reject any ' +
          'cyclic / invalid / unsafe plan.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          originalGoal: ctx.originalGoal,
          failedTask: {
            id: ctx.failedTask.id,
            name: ctx.failedTask.name,
            agentRole: ctx.failedTask.agentRole,
            toolsRequired: ctx.failedTask.toolsRequired,
          },
          diagnosis: {
            failureClass: ctx.diagnosis.failureClass,
            rootCause: ctx.diagnosis.rootCause,
            recommendedRepairLevel: ctx.diagnosis.recommendedRepairLevel,
          },
          counterfactualIsolated: ctx.counterfactual?.isolatedDimension,
          verifierIssues: ctx.verifierIssues,
          permittedAgents: ctx.permittedAgents,
          permittedTools: ctx.permittedTools,
          completedExternalTaskIds: ctx.completedExternalTaskIds,
          successfulTaskOutputs: Object.keys(ctx.successfulTaskOutputs),
          budgetRemaining: ctx.budgetRemaining,
        }),
      },
    ];
  }

  private parseProposal(text: string): LlmReplanProposal | null {
    try {
      const obj = JSON.parse(text) as Partial<LlmReplanProposal> & { updatedPlan?: unknown };
      if (!obj.updatedPlan || typeof obj.updatedPlan !== 'object') return null;
      const plan = obj.updatedPlan as WorkflowPlan;
      if (!Array.isArray(plan.tasks)) return null;
      return {
        repairType: obj.repairType ?? 'MODIFY_TASK',
        updatedPlan: plan,
        reason: typeof obj.reason === 'string' ? obj.reason : 'LLM-proposed replan',
        expectedImprovement:
          typeof obj.expectedImprovement === 'number'
            ? Math.min(1, Math.max(0, obj.expectedImprovement))
            : 0.4,
      };
    } catch {
      return null;
    }
  }
}

/** Re-export so callers can name the proposal shape alongside the agent. */
export type { RiskLevel };