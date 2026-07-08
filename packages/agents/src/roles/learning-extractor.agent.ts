/**
 * learning-extractor.agent.ts — HyperAgent Phase 5 LearningExtractorAgent.
 *
 * The LLM half of the self-learning pipeline. The deterministic extractor
 * (`packages/swarm/src/hyperagent/learning-extractor.ts`) emits typed learning
 * candidates from the structured outcome + diagnoses. This agent is the thin
 * LLM wrapper that may REFINE a candidate's `summary` / `value` for ambiguous
 * cases — it never sets confidence above what the contingency table justifies,
 * and it can never promote a candidate on its own (the information-theoretic
 * gate, learning-gate.ts, is the final arbiter).
 *
 * Layering: agents → shared only (never agents → swarm).
 */
import { AgentRole, LearningKind, LearningSource } from '@jak-swarm/shared';
import type { LearningCandidate, OutcomeEvaluation, FailureDiagnosis } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

/** Input the swarm extractor hands to the LLM. */
export interface LlmExtractInput {
  outcome: OutcomeEvaluation;
  diagnoses?: Record<string, FailureDiagnosis>;
}

/** Structured refinement the LLM returns. */
export interface LlmExtractResult {
  candidates: Array<{
    key: string;
    kind: LearningKind;
    source: LearningSource;
    summary: string;
    value: Record<string, unknown>;
    tags: string[];
    confidence: number;
  }>;
}

export class LearningExtractorAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.VERIFIER, apiKey ?? 'not-used');
  }

  /** Standard BaseAgent entry — delegates to the typed `llmExtract`. */
  async _executeImpl(input: unknown, context: AgentContext): Promise<LlmExtractResult> {
    return this.llmExtract(input as LlmExtractInput, context);
  }

  /**
   * LLM refinement of learning candidates. Returns structured candidates whose
   * confidence the gate will re-derive from the contingency table (never trusts
   * the LLM's number). When no LLM key is configured, returns an honest empty
   * result so the deterministic extractor's candidates flow through unchanged.
   */
  async llmExtract(input: LlmExtractInput, _context?: AgentContext): Promise<LlmExtractResult> {
    const prompt = this.buildPrompt(input);
    try {
      const completion = await this.callLLM(prompt, undefined, {
        maxTokens: 900,
        temperature: 0.2,
        jsonMode: true,
      });
      const text = completion.choices[0]?.message?.content ?? '{}';
      return this.parseResult(text);
    } catch (err) {
      this.logger.warn({ err }, 'LearningExtractorAgent LLM call failed; deferring to deterministic extractor');
      return { candidates: [] };
    }
  }

  private buildPrompt(input: LlmExtractInput): Array<{ role: 'system' | 'user'; content: string }> {
    return [
      {
        role: 'system',
        content:
          'You are the learning extractor for a governed multi-agent system. Given a finished run ' +
          '(its outcome + failure diagnoses), emit TYPED learning candidates: what configuration / ' +
          'repair preference / plan-shape worked or failed, generalised by task type. Each candidate ' +
          'has a stable key, kind (KNOWLEDGE | POLICY | WORKFLOW), source, summary, value, tags, and ' +
          'a confidence (0..1). NEVER claim a confidence above 0.5 for a single-observation guess. ' +
          'Return strict JSON: { candidates: [...] }. The information-theoretic gate decides promotion.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          verdict: input.outcome.verdict,
          taskOutcomes: input.outcome.taskOutcomes.map((t) => ({
            taskId: t.taskId,
            verdict: t.verdict,
            failureClass: t.failureClass,
            verified: t.verified,
          })),
          diagnoses: input.diagnoses
            ? Object.fromEntries(
                Object.entries(input.diagnoses).map(([k, v]) => [
                  k,
                  { failureClass: v.failureClass, rootCause: v.rootCause, isolatedDimension: v.evidence?.isolatedDimension },
                ]),
              )
            : {},
        }),
      },
    ];
  }

  private parseResult(text: string): LlmExtractResult {
    try {
      const obj = JSON.parse(text) as Partial<LlmExtractResult>;
      const candidates = Array.isArray(obj.candidates) ? obj.candidates : [];
      return {
        candidates: candidates.map((c) => ({
          key: typeof c?.key === 'string' ? c.key : `llm:${Math.random().toString(36).slice(2)}`,
          kind: c?.kind ?? LearningKind.KNOWLEDGE,
          source: c?.source ?? LearningSource.OUTCOME,
          summary: typeof c?.summary === 'string' ? c.summary : '',
          value: c?.value ?? {},
          tags: Array.isArray(c?.tags) ? c.tags.map(String) : [],
          confidence: typeof c?.confidence === 'number' ? Math.min(0.5, Math.max(0, c.confidence)) : 0.3,
        })),
      };
    } catch {
      return { candidates: [] };
    }
  }
}

/** Re-export so callers can name the candidate shape alongside the agent. */
export type { LearningCandidate };