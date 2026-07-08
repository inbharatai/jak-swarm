/**
 * counterfactual-explainer.ts — Innovation #9 (HyperAgent Phase 7): audit explanations.
 *
 * For every governance decision (promote a learning, apply a replan, accept a
 * spec), emit a COUNTERFACTUAL explanation: the minimal single-variable change
 * to the decision's inputs that would have FLIPPED the outcome. This is the
 * "why did the system decide this, and how fragile is the decision" audit seam
 * — a human reviewer can see that "had there been one fewer present-success,
 * this learning would not have promoted", which is far more actionable than a
 * bare `promoted: true`.
 *
 * Generic + pure + deterministic: the caller supplies a `decide(factors)`
 * predicate and an ordered list of single-variable perturbations (ordered by
 * minimality — smallest change first). The explainer applies each perturbation
 * and records which ones flip the decision. No I/O, no LLM.
 */

export interface CounterfactualPerturbation<F> {
  /** Stable name for the perturbation (e.g. "one-fewer-present-success"). */
  name: string;
  /** Apply the perturbation to the factors, returning NEW factors (pure). */
  apply: (factors: F) => F;
  /** Human-readable description of the change, for the audit log. */
  describe: (factors: F) => string;
}

export interface CounterfactualFlip {
  name: string;
  description: string;
  /** The decision value under the perturbation (opposite of the original). */
  counterfactualDecision: boolean;
}

export interface CounterfactualExplanation {
  /** The original decision value. */
  decision: boolean;
  /** Every perturbation that flipped the decision, in the order supplied. */
  flippingPerturbations: CounterfactualFlip[];
  /** The minimal (first supplied) flipping perturbation, if any. */
  minimalFlip?: CounterfactualFlip;
  /** True when no single perturbation flipped the decision (it is robust). */
  robust: boolean;
}

/**
 * Explain a decision counterfactually. Pure.
 *
 * The caller orders `perturbations` by minimality (smallest change first) so
 * `minimalFlip` is genuinely the smallest input change that would have reversed
 * the decision. `robust: true` means none of the supplied perturbations flipped
 * the decision — it is stable under the considered single-variable changes.
 */
export function explainCounterfactual<F>(input: {
  factors: F;
  decide: (factors: F) => boolean;
  perturbations: CounterfactualPerturbation<F>[];
}): CounterfactualExplanation {
  const decision = input.decide(input.factors);
  const flippingPerturbations: CounterfactualFlip[] = [];

  for (const p of input.perturbations) {
    const perturbed = p.apply(input.factors);
    const counterfactualDecision = input.decide(perturbed);
    if (counterfactualDecision !== decision) {
      flippingPerturbations.push({
        name: p.name,
        description: p.describe(input.factors),
        counterfactualDecision,
      });
    }
  }

  const minimalFlip = flippingPerturbations[0];
  return {
    decision,
    flippingPerturbations,
    minimalFlip,
    robust: flippingPerturbations.length === 0,
  };
}