/**
 * governance-gate.ts — HyperAgent Phase 7 bounded self-modification gate.
 *
 * Ties the four Phase 7 innovations into ONE governance verdict a self-
 * modification (a revised plan, a promoted learning, an approved spec) must
 * pass before it may be applied. A proposal is APPROVED only when:
 *
 *   #4  it SURVIVES the adversarial red-team (zero breakthroughs — no mutation
 *       the validator let through was independently unsafe);
 *   #7  it PASSES the bounded model checker (every safety invariant holds up
 *       to the unroll bound, with no counterexample);
 *   #9  it CARRIES a counterfactual explanation (the minimal input change that
 *       would have flipped the decision — for audit);
 *   #8  and it does not EXHAUST the tenant's privacy budget (DP releases are
 *       bounded so cross-tenant learning can't be re-identified).
 *
 * "The LLM said this is safe" is never enough — the proposal must be PROVEN
 * safe by the deterministic gates. Pure + deterministic; the LLM wrappers may
 * PROPOSE, this gate DECIDES.
 */
import { redTeamPlan } from './adversarial-redteam.js';
import type { RedTeamInput, RedTeamReport } from './adversarial-redteam.js';
import { checkPlan } from './bounded-model-checker.js';
import type { ModelCheckInput, ModelCheckResult } from './bounded-model-checker.js';
import { explainCounterfactual } from './counterfactual-explainer.js';
import type { CounterfactualExplanation, CounterfactualPerturbation } from './counterfactual-explainer.js';
import { composeBudget } from './dp-noise.js';

export interface GovernancePrivacyBudget {
  /** ε spent per release this decision triggers. */
  epsilonPerRelease: number;
  /** Number of releases this decision triggers. */
  releases: number;
  /** Tenant's remaining epoch budget. */
  tenantBudget: number;
}

export interface GovernanceVerdict {
  approved: boolean;
  reasons: string[];
  redTeam: RedTeamReport;
  modelCheck: ModelCheckResult;
  counterfactual: CounterfactualExplanation;
  /** Privacy budget remaining after this decision's releases (when supplied). */
  remainingPrivacyBudget?: number;
}

export interface GovernanceInput<F> {
  redTeam: RedTeamInput;
  modelCheck: ModelCheckInput;
  counterfactual: {
    factors: F;
    decide: (factors: F) => boolean;
    perturbations: CounterfactualPerturbation<F>[];
  };
  privacyBudget?: GovernancePrivacyBudget;
}

/**
 * Run the full governance gate over a self-modification proposal. Pure.
 *
 * `approved === true` only when the red-team survived AND the model checker is
 * safe AND the privacy budget is not exhausted. The counterfactual explanation
 * is always attached (for audit) regardless of the verdict — a reviewer sees
 * both why it was approved and how fragile the approval is.
 */
export function governSelfModification<F>(input: GovernanceInput<F>): GovernanceVerdict {
  const reasons: string[] = [];

  // Wire the bounded model checker (innovation #7) as the red-team's independent
  // safety oracle: a mutation that passes the symbolic validator BUT fails the
  // model checker is a breakthrough (innovation #4 + #7 composed).
  const modelCheckOracle = (mutatedPlan: import('@jak-swarm/shared').WorkflowPlan): string | null => {
    const mc = checkPlan({ ...input.modelCheck, plan: mutatedPlan });
    if (mc.safe) return null;
    const ce = mc.counterexample;
    return ce ? `model checker unsafe: ${ce.invariant} on task ${ce.taskId} at step ${ce.step}` : 'model checker unsafe';
  };

  const redTeam = redTeamPlan({ ...input.redTeam, isUnsafe: modelCheckOracle });
  if (!redTeam.survived) {
    reasons.push(`adversarial red-team found ${redTeam.breakthroughs} breakthrough(s) the validator let through`);
  }

  const modelCheck = checkPlan(input.modelCheck);
  if (!modelCheck.safe) {
    const ce = modelCheck.counterexample;
    reasons.push(
      `bounded model checker unsafe: ${modelCheck.violations.length} violation(s)` +
        (ce ? ` (counterexample: ${ce.invariant} on task ${ce.taskId} at step ${ce.step})` : ''),
    );
  }

  let remainingPrivacyBudget: number | undefined;
  if (input.privacyBudget) {
    const spent = composeBudget(input.privacyBudget.epsilonPerRelease, input.privacyBudget.releases);
    remainingPrivacyBudget = Math.max(0, input.privacyBudget.tenantBudget - spent);
    if (spent > input.privacyBudget.tenantBudget) {
      reasons.push(
        `privacy budget exhausted: ${spent.toFixed(4)} ε spent > ${input.privacyBudget.tenantBudget.toFixed(4)} tenant budget`,
      );
    }
  }

  const counterfactual = explainCounterfactual({
    factors: input.counterfactual.factors,
    decide: input.counterfactual.decide,
    perturbations: input.counterfactual.perturbations,
  });

  const approved = reasons.length === 0;
  return { approved, reasons, redTeam, modelCheck, counterfactual, remainingPrivacyBudget };
}