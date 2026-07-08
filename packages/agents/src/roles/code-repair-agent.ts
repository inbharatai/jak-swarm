/**
 * code-repair-agent.ts — HyperAgent Phase 12 CodeRepairAgent (R5).
 *
 * The LLM half of repair level R5 (code self-repair). The deterministic policy
 * gate + lifecycle live in `packages/swarm/src/hyperagent/code-repair.ts` (pure,
 * testable, the layer that decides whether a proposal may proceed to a branch +
 * draft PR). This agent is the thin LLM wrapper that PROPOSES a code patch from
 * a failure diagnosis. Its output STILL passes the policy gate — no LLM-proposed
 * patch creates a branch if the gate classifies it FORBIDDEN, and the agent
 * NEVER merges its own PR / NEVER deploys (canAutoMerge() === false).
 *
 * Layering: agents → shared only. The swarm node passes `agent.llmProposePatch`
 * to the repair orchestrator; when no LLM key is configured the agent returns
 * null and no R5 repair is attempted (the failure is reported for a human).
 */

import { AgentRole, CodeRepairKind } from '@jak-swarm/shared';
import type { CodeRepairRisk, FailureDiagnosis } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

/** Structured patch proposal the LLM returns. */
export interface LlmCodePatchProposal {
  kind: CodeRepairKind;
  targetFiles: string[];
  targetSymbol?: string;
  description: string;
  patchDiff: string;
  rationale: string;
  risk: CodeRepairRisk;
}

/** Input the swarm node hands the agent. */
export interface LlmCodeRepairInput {
  diagnosis: Pick<FailureDiagnosis, 'failureClass' | 'rootCause' | 'recommendedRepairLevel' | 'taskId'>;
  /** Repo-relative path of the failing component, if known. */
  suspectFile?: string;
  /** The offending symbol, if known. */
  suspectSymbol?: string;
}

export class CodeRepairAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.VERIFIER, apiKey ?? 'not-used');
  }

  /** Standard BaseAgent entry — delegates to the typed `llmProposePatch`. */
  async _executeImpl(input: unknown, context: AgentContext): Promise<LlmCodePatchProposal | null> {
    return this.llmProposePatch(input as LlmCodeRepairInput, context);
  }

  /**
   * Propose a code patch for an R5 failure. Returns null when the LLM is
   * unavailable or declines to propose — no R5 repair is attempted and the
   * failure is reported for a human. The returned patch is NEVER trusted
   * blindly; the policy gate (code-repair.ts) classifies it before any branch
   * is created.
   */
  async llmProposePatch(input: LlmCodeRepairInput, _context?: AgentContext): Promise<LlmCodePatchProposal | null> {
    const prompt = this.buildPrompt(input);
    try {
      const completion = await this.callLLM(prompt, undefined, {
        maxTokens: 2000,
        temperature: 0.1,
        jsonMode: true,
      });
      const text = completion.choices[0]?.message?.content ?? '';
      return this.parseProposal(text);
    } catch (err) {
      this.logger.warn({ err }, 'CodeRepairAgent LLM call failed; deferring to human review');
      return null;
    }
  }

  private buildPrompt(input: LlmCodeRepairInput): Array<{ role: 'system' | 'user'; content: string }> {
    return [
      {
        role: 'system',
        content:
          'You are the code-repair agent for a governed multi-agent system (repair level R5). ' +
          'Given a failure diagnosis, propose a MINIMAL, LOW-risk code patch that fixes the root ' +
          'cause. You may NEVER touch: branch protection, CI/deploys, secrets, the JAK Shield, ' +
          'approval controls, governance/autonomy policy, or your own permissions. You may NEVER ' +
          'disable a guardrail, strip an approval flag, or auto-merge/auto-deploy. The patch ' +
          'lands on an ISOLATED branch as a DRAFT PR — a human reviews, approves, and merges. ' +
          'Return strict JSON: { kind, targetFiles[], targetSymbol?, description, patchDiff, ' +
          'rationale, risk }. The policy gate will reject any forbidden patch.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          failureClass: input.diagnosis.failureClass,
          rootCause: input.diagnosis.rootCause,
          recommendedRepairLevel: input.diagnosis.recommendedRepairLevel,
          taskId: input.diagnosis.taskId,
          suspectFile: input.suspectFile,
          suspectSymbol: input.suspectSymbol,
        }),
      },
    ];
  }

  private parseProposal(text: string): LlmCodePatchProposal | null {
    try {
      const parsed = JSON.parse(text) as Partial<LlmCodePatchProposal>;
      if (
        !parsed.kind ||
        !Array.isArray(parsed.targetFiles) ||
        typeof parsed.description !== 'string' ||
        typeof parsed.patchDiff !== 'string' ||
        typeof parsed.rationale !== 'string' ||
        typeof parsed.risk !== 'string'
      ) {
        return null;
      }
      return {
        kind: parsed.kind,
        targetFiles: parsed.targetFiles,
        targetSymbol: parsed.targetSymbol,
        description: parsed.description,
        patchDiff: parsed.patchDiff,
        rationale: parsed.rationale,
        risk: parsed.risk as CodeRepairRisk,
      };
    } catch {
      return null;
    }
  }
}