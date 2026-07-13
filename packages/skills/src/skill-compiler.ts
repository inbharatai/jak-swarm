/**
 * skill-compiler.ts — Phase 8 procedural skill compiler + sandbox verdict core.
 *
 * Two PURE, deterministic cores that the skills routes + tests call. No I/O,
 * no LLM, no clock — the caller stamps `now` and persists. Pure so the
 * compiler's output is reproducible + auditable, and so the sandbox verdict
 * (a security-relevant fail-closed decision) is fully testable without a
 * database or a sandbox runtime.
 *
 * 1. `compilePlanToSkill` — the Tier 2 GENERATED_PLAN producer. Compiles an
 *    approved plan's tasks into a versioned, executable skill spec (a procedure
 *    of ordered steps). This is STRUCTURAL compilation only — it does not
 *    generate code with an LLM (that would be env-blocked + un-reviewable).
 *    The compiled skill enters the pipeline at status PROPOSED; it still
 *    requires sandbox validation + TENANT_ADMIN approval before it governs
 *    agent behaviour. A generated skill is never auto-approved.
 *
 * 2. `resolveSandboxVerdict` — the fail-closed sandbox result decider. Closes
 *    two audit gaps in the prior route logic:
 *      - fail-OPEN on sandbox-unavailable: a coded skill whose sandbox adapter
 *        threw used to silently degrade to a schema-only PASS. Now a coded
 *        skill that cannot run its sandbox FAILS (a skill with code MUST run
 *        the sandbox to pass).
 *      - "no tests = pass" for coded skills: a coded skill with zero test
 *        cases used to skip execution and PASS. Now a coded skill requires
 *        ≥1 test case that RAN and passed.
 *    Schema-only (codeless) skills still pass on schema validity alone —
 *    that is the legitimate no-code path, preserved.
 */
import { SkillTier, RiskLevel } from '@jak-swarm/shared';
import type { RiskLevel as RiskLevelType } from '@jak-swarm/shared';

/** A plan task projected to the fields the compiler reads. */
export interface PlanTaskInput {
  id: string;
  name: string;
  description: string;
  agentRole?: string;
  toolsRequired?: string[];
  riskLevel?: RiskLevelType | string;
}

/** The risk-level ordering used to pick the max risk across a plan's tasks. */
const RISK_ORDER: Readonly<Record<string, number>> = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

/** The highest of a list of risk levels (LOW < MEDIUM < HIGH < CRITICAL). */
export function maxRiskLevel(levels: ReadonlyArray<RiskLevelType | string | undefined>): RiskLevelType {
  let best: RiskLevelType = RiskLevel.LOW;
  let bestRank = RISK_ORDER[RiskLevel.LOW] ?? 1;
  for (const lvl of levels) {
    const rank = RISK_ORDER[lvl ?? RiskLevel.LOW] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = (lvl as RiskLevelType) ?? RiskLevel.LOW;
    }
  }
  return best;
}

/** One compiled step in a GENERATED_PLAN skill (derived 1:1 from a plan task). */
export interface CompiledSkillStep {
  id: string;
  name: string;
  description: string;
  agentRole?: string;
  toolsRequired: string[];
  riskLevel: string;
}

/** The output of the compiler — the spec persisted as the skill's input contract. */
export interface CompiledSkillSpec {
  /** Skill name (derived from the plan goal / title). */
  name: string;
  /** Human-readable description carrying the source plan provenance. */
  description: string;
  /** Always SkillTier.GENERATED_PLAN (2) — this is a plan-compiled skill. */
  tier: SkillTier.GENERATED_PLAN;
  /** The ordered procedure (1:1 with the source plan's tasks, order preserved). */
  steps: CompiledSkillStep[];
  /** The maximum risk level across the plan's tasks (drives approval gating). */
  riskLevel: RiskLevelType;
  /** Provenance: the spec/plan this skill was compiled from. */
  sourceSpecId: string;
  sourceSpecTitle: string;
  /** Caller-stamped ISO timestamp (no clock in the pure core). */
  generatedAt: string;
}

export interface CompilePlanToSkillInput {
  sourceSpecId: string;
  sourceSpecTitle: string;
  /** The plan goal / objective — becomes the skill name + description basis. */
  goal: string;
  tasks: ReadonlyArray<PlanTaskInput>;
  /** Caller-stamped ISO timestamp. */
  now: string;
}

/**
 * Compile an approved plan's tasks into a Tier 2 GENERATED_PLAN skill spec.
 * Pure + deterministic — order-preserving, no LLM, no clock. The compiled
 * skill is PROPOSED (caller persists it as such); it is never auto-approved.
 *
 * Throws on an empty task list (a plan with no tasks compiles to no procedure —
 * refuse rather than emit a no-op skill that would masquerade as executable).
 */
export function compilePlanToSkill(input: CompilePlanToSkillInput): CompiledSkillSpec {
  if (!input.tasks || input.tasks.length === 0) {
    throw new Error('compilePlanToSkill: cannot compile a plan with no tasks');
  }
  const steps: CompiledSkillStep[] = input.tasks.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    ...(t.agentRole ? { agentRole: t.agentRole } : {}),
    toolsRequired: t.toolsRequired ? [...t.toolsRequired] : [],
    riskLevel: t.riskLevel ?? 'LOW',
  }));
  const riskLevel = maxRiskLevel(input.tasks.map((t) => t.riskLevel));
  const name = input.goal.trim().slice(0, 120) || `Generated skill from ${input.sourceSpecId}`;
  const description = `Procedural skill compiled from approved spec "${input.sourceSpecTitle}" (${input.sourceSpecId}) on ${input.now}. The skill is a ${steps.length}-step procedure; it requires sandbox validation + TENANT_ADMIN approval before it governs agent behaviour.`;
  return {
    name,
    description,
    tier: SkillTier.GENERATED_PLAN,
    steps,
    riskLevel,
    sourceSpecId: input.sourceSpecId,
    sourceSpecTitle: input.sourceSpecTitle,
    generatedAt: input.now,
  };
}

// ─── Sandbox verdict (fail-closed) ──────────────────────────────────────────

export interface SandboxVerdictInput {
  /** True when the skill has non-empty `implementation` source code. */
  hasCode: boolean;
  /** Number of test cases defined on the skill. */
  testCasesCount: number;
  /** The results that actually ran in the sandbox (empty when none ran). */
  testResults: ReadonlyArray<{ passed: boolean }>;
  /** Non-null when the sandbox ran but execution failed (parse error, exit≠0). */
  executionError: string | null;
  /** False when the sandbox adapter threw (no sandbox runtime available). */
  sandboxAvailable: boolean;
  /** True when both input + output schemas parsed as JSON objects. */
  schemaValid: boolean;
}

export type SandboxFinalStatus = 'SANDBOX_PASSED' | 'PROPOSED';

export interface SandboxVerdict {
  passed: boolean;
  finalStatus: SandboxFinalStatus;
  phase: 'validation' | 'execution';
  /** Human-readable reason (audit + cockpit). */
  reason: string;
}

/**
 * Decide a sandbox run's outcome. Fail-closed for coded skills:
 *   - a coded skill whose sandbox is unavailable FAILS (never schema-only pass);
 *   - a coded skill with zero test cases FAILS (must have ≥1 test);
 *   - a coded skill whose tests did not run (no results) FAILS;
 *   - a coded skill with any failed test or execution error FAILS.
 * Codeless (schema-only) skills PASS on schema validity alone — that is the
 * legitimate no-code path, preserved. Pure.
 */
export function resolveSandboxVerdict(input: SandboxVerdictInput): SandboxVerdict {
  if (!input.schemaValid) {
    return {
      passed: false,
      finalStatus: 'PROPOSED',
      phase: 'validation',
      reason: 'schema validation failed',
    };
  }
  if (!input.hasCode) {
    // Codeless skill: schema validity is the real validation. Legitimate pass.
    return {
      passed: true,
      finalStatus: 'SANDBOX_PASSED',
      phase: 'validation',
      reason: 'schema-only skill: schema valid (no code to execute)',
    };
  }
  // Coded skill — fail-closed from here.
  if (!input.sandboxAvailable) {
    return {
      passed: false,
      finalStatus: 'PROPOSED',
      phase: 'execution',
      reason: 'sandbox unavailable: coded skills require sandbox execution to pass (fail-closed)',
    };
  }
  if (input.executionError) {
    return {
      passed: false,
      finalStatus: 'PROPOSED',
      phase: 'execution',
      reason: `execution error: ${input.executionError}`,
    };
  }
  if (input.testCasesCount === 0) {
    return {
      passed: false,
      finalStatus: 'PROPOSED',
      phase: 'execution',
      reason: 'coded skill requires ≥1 test case (no-tests ≠ pass)',
    };
  }
  if (input.testResults.length === 0) {
    return {
      passed: false,
      finalStatus: 'PROPOSED',
      phase: 'execution',
      reason: 'no tests ran: coded skills require ≥1 test that executed',
    };
  }
  const failedCount = input.testResults.filter((t) => !t.passed).length;
  if (failedCount > 0) {
    return {
      passed: false,
      finalStatus: 'PROPOSED',
      phase: 'execution',
      reason: `${failedCount}/${input.testResults.length} test(s) failed`,
    };
  }
  return {
    passed: true,
    finalStatus: 'SANDBOX_PASSED',
    phase: 'execution',
    reason: `all ${input.testResults.length} test(s) passed`,
  };
}