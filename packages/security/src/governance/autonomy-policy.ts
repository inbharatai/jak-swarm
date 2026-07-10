/**
 * autonomy-policy.ts — the SINGLE, central, deterministic evaluator for what
 * the HyperAgent may do at a given autonomy level.
 *
 * Why this file exists (HyperAgent spec, Phase 1): "Create central autonomy-
 * policy evaluation. Do not scatter autonomy checks through unrelated files."
 * Before this, autonomy was implicit — the verifier re-sent tasks, RepairService
 * refused a few classes, and there was no notion of levels. Every later phase
 * (replanner, learning, governance overlay, Shield MCP, code-patch) MUST call
 * `evaluateAutonomy()` (or the `AutonomyPolicyService` wrapper) before acting.
 *
 * Design rules enforced here and in tests:
 *  1. Capabilities only *add* as level increases; a higher level never loses a
 *     hard block.
 *  2. A fixed NEVER_* set is blocked at EVERY level (including L5) and requires
 *     a human — merge, deploy, secrets, payments, prod-data delete, external
 *     publish, permission expansion, governance rewrite.
 *  3. The evaluator is pure + deterministic — no LLM, no I/O — so it is fully
 *     unit-testable and cannot "decide" to bypass itself.
 *  4. `allowed` and `requiresApproval` are mutually exclusive in the safe set:
 *     a capability is either autonomous-at-this-level, approval-gated, or never.
 */

import {
  AutonomyCapability,
  AutonomyDecision,
  AutonomyLevel,
  HyperAgentConfig,
  HyperAgentMode,
  RepairBudget,
} from '@jak-swarm/shared';

/**
 * Canonical capability → minimum autonomy level matrix.
 * A capability is autonomous (allowed=true) only when `level >= minLevel`.
 * Capabilities absent from this map are NEVER_* (blocked at every level).
 */
const AUTONOMY_CAPABILITY_MATRIX: Readonly<Partial<Record<AutonomyCapability, AutonomyLevel>>> = Object.freeze({
  [AutonomyCapability.OBSERVE_REPORT]: AutonomyLevel.L0,
  [AutonomyCapability.PROPOSE_REPAIRS]: AutonomyLevel.L1,
  [AutonomyCapability.PROPOSE_LEARNINGS]: AutonomyLevel.L1,
  [AutonomyCapability.RETRY_SAFE_READONLY]: AutonomyLevel.L2,
  [AutonomyCapability.CORRECT_OUTPUT]: AutonomyLevel.L2,
  [AutonomyCapability.REPLAN_WITHIN_APPROVED]: AutonomyLevel.L3,
  [AutonomyCapability.PROPOSE_CONFIG_CHANGE]: AutonomyLevel.L3,
  [AutonomyCapability.SHADOW_EXPERIMENT]: AutonomyLevel.L4,
  [AutonomyCapability.CANARY_EXPERIMENT]: AutonomyLevel.L4,
  [AutonomyCapability.PROMOTE_CONFIG]: AutonomyLevel.L4,
  [AutonomyCapability.CODE_PATCH_BRANCH]: AutonomyLevel.L5,
});

/**
 * Approval-gated capabilities — permitted only with explicit human approval,
 * never autonomous, at every level. These are the "Even at L5 JAK must not
 * independently …" list from the spec §10.
 */
const APPROVAL_GATED: ReadonlySet<AutonomyCapability> = Object.freeze(new Set<AutonomyCapability>([
  AutonomyCapability.MERGE_PR,
  AutonomyCapability.DEPLOY_PRODUCTION,
  AutonomyCapability.CHANGE_SECRETS,
  AutonomyCapability.APPROVE_PAYMENTS,
  AutonomyCapability.DELETE_PRODUCTION_DATA,
  AutonomyCapability.PUBLISH_EXTERNALLY,
  AutonomyCapability.EXPAND_PERMISSIONS,
  AutonomyCapability.MODIFY_GOVERNANCE,
]));

const LEVEL_RANK: Readonly<Record<AutonomyLevel, number>> = Object.freeze({
  [AutonomyLevel.L0]: 0,
  [AutonomyLevel.L1]: 1,
  [AutonomyLevel.L2]: 2,
  [AutonomyLevel.L3]: 3,
  [AutonomyLevel.L4]: 4,
  [AutonomyLevel.L5]: 5,
});

/** True if `level` is at least `min`. */
export function levelAtLeast(level: AutonomyLevel, min: AutonomyLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[min];
}

/**
 * Evaluate a single capability at a level. Pure.
 *
 * Outcomes:
 *  - NEVER_*  → allowed=false, requiresApproval=true  (human must approve; never autonomous)
 *  - safe cap → allowed=(level>=min), requiresApproval=false
 *  - mode OFF → allowed=false for everything except OBSERVE_REPORT; observe-only
 *               is still permitted so the cockpit can show state.
 */
export function evaluateAutonomy(
  level: AutonomyLevel,
  capability: AutonomyCapability,
  mode: HyperAgentMode = HyperAgentMode.ASSISTED,
): AutonomyDecision {
  // NEVER_* — human-only at every level.
  if (APPROVAL_GATED.has(capability)) {
    return {
      capability,
      level,
      allowed: false,
      requiresApproval: true,
      reason: `Capability '${capability}' is human-only at every autonomy level (never autonomous).`,
    };
  }

  // When the HyperAgent layer is OFF, nothing acts — not even L5 capabilities.
  // Observation is allowed so the UI can render state, but it changes nothing.
  if (mode === HyperAgentMode.OFF && capability !== AutonomyCapability.OBSERVE_REPORT) {
    return {
      capability,
      level,
      allowed: false,
      requiresApproval: false,
      reason: `HyperAgent mode is OFF; capability '${capability}' is inert.`,
    };
  }

  // OBSERVE is read-only: the HyperAgent may *propose* repairs/learnings and
  // report observations, but it must NOT mutate plan/state, correct output,
  // promote learnings, or pause the workflow for approval (approval-pause is
  // itself a side effect). Every mutating capability is denied with
  // requiresApproval=false so the consumer nodes record an observation and
  // CONTINUE rather than blocking. OBSERVE_REPORT stays allowed so observation
  // and cockpit reporting still run. Before this, OBSERVE fell through to the
  // normal levelAtLeast check, so OBSERVE+L3 mutated the plan, OBSERVE+L2
  // corrected output, and OBSERVE+L4 promoted learnings — defeating the
  // "observe only" contract. The only prior gate was failure-injection.ts:370
  // (classifier-tier retry path), which the replanner graph node bypassed.
  if (mode === HyperAgentMode.OBSERVE && capability !== AutonomyCapability.OBSERVE_REPORT) {
    return {
      capability,
      level,
      allowed: false,
      requiresApproval: false,
      reason: `HyperAgent mode is OBSERVE; observation only — no mutation.`,
    };
  }

  const minLevel = AUTONOMY_CAPABILITY_MATRIX[capability];
  if (minLevel === undefined) {
    // Unknown capability → fail closed. Never auto-allow an unlisted action.
    return {
      capability,
      level,
      allowed: false,
      requiresApproval: true,
      reason: `Capability '${capability}' is not in the autonomy matrix; failing closed pending human review.`,
    };
  }

  const allowed = levelAtLeast(level, minLevel);
  return {
    capability,
    level,
    allowed,
    requiresApproval: false,
    reason: allowed
      ? `Capability '${capability}' permitted at ${level} (min ${minLevel}).`
      : `Capability '${capability}' requires level ${minLevel}; current ${level}.`,
  };
}

/**
 * Convenience: evaluate against a full tenant config. Also enforces the
 * hyperAgentEnabled flag (when false, behaves like mode OFF).
 */
export function evaluateForConfig(
  config: Pick<HyperAgentConfig, 'hyperAgentEnabled' | 'hyperAgentMode' | 'autonomyLevel'>,
  capability: AutonomyCapability,
): AutonomyDecision {
  const effectiveMode = config.hyperAgentEnabled ? config.hyperAgentMode : HyperAgentMode.OFF;
  return evaluateAutonomy(config.autonomyLevel, capability, effectiveMode);
}

/** Validate a RepairBudget. Returns a list of human-readable violations (empty = valid). */
export function validateRepairBudget(b: RepairBudget): string[] {
  const v: string[] = [];
  if (!Number.isFinite(b.maxExecutionRetries) || b.maxExecutionRetries < 0) v.push('maxExecutionRetries must be >= 0');
  if (!Number.isFinite(b.maxOutputRepairs) || b.maxOutputRepairs < 0) v.push('maxOutputRepairs must be >= 0');
  if (!Number.isFinite(b.maxPlanRepairs) || b.maxPlanRepairs < 0) v.push('maxPlanRepairs must be >= 0');
  if (!Number.isFinite(b.maxCapabilityRepairs) || b.maxCapabilityRepairs < 0) v.push('maxCapabilityRepairs must be >= 0');
  if (!Number.isFinite(b.maxTotalCostUsd) || b.maxTotalCostUsd < 0) v.push('maxTotalCostUsd must be >= 0');
  if (!Number.isFinite(b.maxDurationMs) || b.maxDurationMs < 0) v.push('maxDurationMs must be >= 0');
  return v;
}

/**
 * AutonomyPolicyService — thin injectable wrapper around the pure evaluator
 * so callers can mock it in tests and so the governance overlay (Phase 7) has
 * a single service to depend on. The logic never leaves this file.
 */
export class AutonomyPolicyService {
  evaluate(level: AutonomyLevel, capability: AutonomyCapability, mode?: HyperAgentMode): AutonomyDecision {
    return evaluateAutonomy(level, capability, mode);
  }
  evaluateForConfig(
    config: Pick<HyperAgentConfig, 'hyperAgentEnabled' | 'hyperAgentMode' | 'autonomyLevel'>,
    capability: AutonomyCapability,
  ): AutonomyDecision {
    return evaluateForConfig(config, capability);
  }
  validateBudget(b: RepairBudget): string[] {
    return validateRepairBudget(b);
  }
}

export const autonomyPolicyService = new AutonomyPolicyService();