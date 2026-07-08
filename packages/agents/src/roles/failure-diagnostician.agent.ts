/**
 * failure-diagnostician.agent.ts — HyperAgent Phase 4 FailureDiagnosticianAgent.
 *
 * This is the LLM half of the spec's "combine deterministic rules with an LLM
 * diagnostician." The deterministic classifier + counterfactual replay live in
 * `packages/swarm/src/hyperagent/failure-diagnostician.ts` (pure, testable, and
 * the layer that actually decides). This agent is the thin LLM wrapper that the
 * swarm diagnostician injects ONLY for UNKNOWN failures — it explains ambiguous
 * root causes, compares alternative repairs, and emits a structured suggestion.
 * It can never override a deterministic security block (the pure orchestrator
 * seals those before the LLM is consulted and ignores any LLM attempt to un-block).
 *
 * Layering: agents → shared (never agents → swarm), so this file imports only
 * shared types. The swarm node passes `agent.llmDiagnose` as the `llmDiagnose`
 * option to `diagnoseFailure()`.
 */

import { AgentRole, FailureClass } from '@jak-swarm/shared';
import type {
  ClassificationResult,
  CounterfactualReplayResult,
  ExecutionFailure,
  FailureDiagnosis,
} from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

/** Input the swarm diagnostician hands to the LLM. */
export interface LlmDiagnoseInput {
  failure: ExecutionFailure;
  deterministic: ClassificationResult;
  counterfactual?: CounterfactualReplayResult;
  verifierIssues: string[];
}

/** Structured suggestion the LLM returns. */
export interface LlmDiagnosis {
  rootCause: string;
  confidence: number;
  recommendedChanges: Record<string, unknown>;
  /** The LLM may suggest a more specific non-block class for an UNKNOWN. */
  suggestedFailureClass?: FailureClass;
}

export class FailureDiagnosticianAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.VERIFIER, apiKey ?? 'not-used');
  }

  /** Standard BaseAgent entry — delegates to the typed `llmDiagnose`. */
  async _executeImpl(input: unknown, context: AgentContext): Promise<LlmDiagnosis> {
    return this.llmDiagnose(input as LlmDiagnoseInput, context);
  }

  /**
   * LLM diagnosis for an UNKNOWN failure. Returns a structured suggestion;
   * the pure orchestrator decides whether to adopt it (never for a block).
   * When no LLM key is configured, returns a honest fallback rather than throwing.
   */
  async llmDiagnose(input: LlmDiagnoseInput, _context?: AgentContext): Promise<LlmDiagnosis> {
    const prompt = this.buildPrompt(input);
    try {
      const completion = await this.callLLM(prompt, undefined, {
        maxTokens: 600,
        temperature: 0.2,
        jsonMode: true,
      });
      const text = completion.choices[0]?.message?.content ?? '{}';
      return this.parseDiagnosis(text);
    } catch (err) {
      this.logger.warn({ err }, 'FailureDiagnosticianAgent LLM call failed; returning deterministic fallback');
      return {
        rootCause: input.deterministic.reason,
        confidence: 0.3,
        recommendedChanges: { llmUnavailable: true },
      };
    }
  }

  private buildPrompt(input: LlmDiagnoseInput): Array<{ role: 'system' | 'user'; content: string }> {
    return [
      {
        role: 'system',
        content:
          'You are a failure diagnostician for a governed multi-agent system. The deterministic ' +
          'classifier could not classify this failure (UNKNOWN). Explain the likely root cause, ' +
          'estimate confidence (0..1), and suggest a more specific failure class from: ' +
          'TRANSIENT_PROVIDER, RATE_LIMIT, TOOL_UNAVAILABLE, TOOL_BAD_INPUT, MISSING_CONTEXT, ' +
          'OUTPUT_SCHEMA, HALLUCINATION, GROUNDING_FAILURE, PLAN_DEPENDENCY, WRONG_AGENT, ' +
          'WRONG_TOOL, TIMEOUT, EXTERNAL_STATE_CHANGED. NEVER suggest PERMISSION_DENIED, ' +
          'POLICY_BLOCK, or PROMPT_INJECTION to downgrade a block. Return strict JSON.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          failure: {
            taskId: input.failure.taskId,
            agentRole: input.failure.agentRole,
            toolName: input.failure.toolName,
            message: input.failure.message,
          },
          verifierIssues: input.verifierIssues,
          counterfactual: input.counterfactual?.isolatedDimension,
        }),
      },
    ];
  }

  private parseDiagnosis(text: string): LlmDiagnosis {
    try {
      const obj = JSON.parse(text) as Partial<LlmDiagnosis>;
      return {
        rootCause: typeof obj.rootCause === 'string' ? obj.rootCause : 'LLM returned no root cause',
        confidence: typeof obj.confidence === 'number' ? Math.min(1, Math.max(0, obj.confidence)) : 0.3,
        recommendedChanges: obj.recommendedChanges ?? {},
        suggestedFailureClass: obj.suggestedFailureClass,
      };
    } catch {
      return { rootCause: text.slice(0, 280), confidence: 0.3, recommendedChanges: { parseFailed: true } };
    }
  }
}

/** Re-export for callers that want the diagnosis shape alongside the agent. */
export type { FailureDiagnosis };