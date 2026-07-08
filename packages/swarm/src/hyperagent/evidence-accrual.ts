/**
 * evidence-accrual.ts — Innovation #5 (HyperAgent Phase 5).
 *
 * Provenance-weighted Bayesian evidence accrual. When observations contradict
 * the leading hypothesis, the cluster FORKS a competing hypothesis instead of
 * silently merging the contradiction. Competing hypotheses are tracked until
 * one posterior collapses the other (≥ collapseThreshold), at which point the
 * winner is resolved and may be promoted into a LearningRecord.
 *
 * This is the honest alternative to "average the evidence and hope" — two
 * observations that disagree don't wash out, they spawn a tracked branch that
 * the next observations adjudicate.
 *
 * Pure + deterministic — no I/O, no Date.now (caller stamps `now`).
 */
import type { EvidenceCluster, Hypothesis } from '@jak-swarm/shared';

/** Default collapse threshold: a hypothesis is the winner at normalized posterior ≥ this. */
export const DEFAULT_COLLAPSE_THRESHOLD = 0.95;

/** Default fork threshold: fork a competitor when the leader's posterior drops below this. */
export const DEFAULT_FORK_THRESHOLD = 0.4;

/** Create a cluster with an initial set of hypotheses (priors copied to posteriors). */
export function createCluster(input: {
  id: string;
  tenantId: string;
  question: string;
  hypotheses: Array<{ id: string; claim: string; prior: number }>;
  now: string;
}): EvidenceCluster {
  return {
    id: input.id,
    tenantId: input.tenantId,
    question: input.question,
    hypotheses: input.hypotheses.map((h) => ({
      id: h.id,
      claim: h.claim,
      prior: h.prior,
      posterior: h.prior,
      observations: 0,
      lastUpdatedAt: input.now,
    })),
    resolved: false,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Apply a Bayesian observation: multiply each named hypothesis's posterior by
 * its likelihood P(e | H_i), then leave normalisation to `normalizedPosteriors`.
 * Hypotheses not named in `likelihoods` keep their current posterior.
 */
export function observe(
  cluster: EvidenceCluster,
  likelihoods: Record<string, number>,
  now: string,
): EvidenceCluster {
  const hypotheses = cluster.hypotheses.map((h) => {
    const lik = likelihoods[h.id];
    if (lik === undefined) return h;
    return {
      ...h,
      posterior: h.posterior * Math.max(0, lik),
      observations: h.observations + 1,
      lastUpdatedAt: now,
    };
  });
  return { ...cluster, hypotheses, updatedAt: now };
}

/** Normalised posteriors (sum to 1). Returns id → probability. */
export function normalizedPosteriors(hypotheses: Hypothesis[]): Record<string, number> {
  const sum = hypotheses.reduce((s, h) => s + Math.max(0, h.posterior), 0);
  const out: Record<string, number> = {};
  if (sum <= 0) {
    // Uniform fallback when everything has been zeroed out.
    const u = hypotheses.length > 0 ? 1 / hypotheses.length : 0;
    for (const h of hypotheses) out[h.id] = u;
    return out;
  }
  for (const h of hypotheses) out[h.id] = Math.max(0, h.posterior) / sum;
  return out;
}

/**
 * Fork a competing hypothesis when the leading posterior has dropped below
 * `forkThreshold` (a contradiction has eroded confidence). The new hypothesis
 * starts with the leftover mass as its prior so it is a genuine competitor,
 * not a token. Pure — returns a new cluster.
 */
export function forkOnContradiction(
  cluster: EvidenceCluster,
  newHypothesis: { id: string; claim: string },
  now: string,
  forkThreshold: number = DEFAULT_FORK_THRESHOLD,
): EvidenceCluster {
  if (cluster.resolved) return cluster;
  if (cluster.hypotheses.length === 0) return cluster;
  const norms = normalizedPosteriors(cluster.hypotheses);
  const first = cluster.hypotheses[0]!;
  const leader = cluster.hypotheses.reduce((best, h) =>
    (norms[best.id] ?? 0) >= (norms[h.id] ?? 0) ? best : h, first);
  if ((norms[leader.id] ?? 0) >= forkThreshold) {
    // Leader still strong — no fork needed.
    return cluster;
  }
  const leftover = 1 - (norms[leader.id] ?? 0);
  const competitor: Hypothesis = {
    id: newHypothesis.id,
    claim: newHypothesis.claim,
    prior: Math.max(1e-6, leftover),
    posterior: Math.max(1e-6, leftover),
    observations: 0,
    lastUpdatedAt: now,
  };
  return {
    ...cluster,
    hypotheses: [...cluster.hypotheses, competitor],
    updatedAt: now,
  };
}

/**
 * Collapse the cluster when one hypothesis's normalised posterior reaches
 * `threshold`. Marks the cluster resolved + records the winner; the caller
 * promotes the winner into a LearningRecord.
 */
export function collapseWinner(
  cluster: EvidenceCluster,
  threshold: number = DEFAULT_COLLAPSE_THRESHOLD,
): EvidenceCluster {
  if (cluster.resolved) return cluster;
  const norms = normalizedPosteriors(cluster.hypotheses);
  let winnerId: string | undefined;
  for (const h of cluster.hypotheses) {
    if ((norms[h.id] ?? 0) >= threshold) {
      winnerId = h.id;
      break;
    }
  }
  if (!winnerId) return cluster;
  return { ...cluster, resolved: true, winnerId };
}

/** The current leader (highest normalised posterior). */
export function leader(cluster: EvidenceCluster): { id: string; posterior: number } | undefined {
  if (cluster.hypotheses.length === 0) return undefined;
  const norms = normalizedPosteriors(cluster.hypotheses);
  const first = cluster.hypotheses[0]!;
  const best = cluster.hypotheses.reduce((b, h) =>
    (norms[b.id] ?? 0) >= (norms[h.id] ?? 0) ? b : h, first);
  return { id: best.id, posterior: norms[best.id] ?? 0 };
}