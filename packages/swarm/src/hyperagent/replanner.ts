/**
 * replanner.ts — HyperAgent Phase 4 genuine plan repair (Innovation #3).
 *
 * Innovation #3: the Replanner is a CONSTRAINED SYMBOLIC SEARCH, not an
 * unrestricted LLM. An LLM (or the deterministic proposer below) may PROPOSE a
 * revised plan, but a deterministic symbolic layer (`plan-validator.ts`) VALIDATES
 * it and only a validated plan within the remaining budget + autonomy level is
 * applied. No cyclic / invalid / unsafe plan can ever reach execution.
 *
 * Spec §6 Step 4 + §13 Phase 4: the Replanner changes the plan (agent / tool /
 * task order / dependency / approach) rather than re-sending the same task to
 * the same worker. It must never repeat completed external actions, must
 * preserve successful outputs + signed approvals + receipts, and must version
 * every plan into a complete history.
 *
 * This module is PURE + deterministic. The deterministic proposer covers the
 * common failure classes (WRONG_AGENT, WRONG_TOOL/TOOL_UNAVAILABLE,
 * PLAN_DEPENDENCY/MISSING_CONTEXT, GROUNDING_FAILURE, BUDGET_EXCEEDED, and the
 * security/capability classes that must ESCALATE). An optional LLM proposer can
 * be injected for richer repairs; its output still passes the same validator.
 */

import {
  AgentRole,
  FailureClass,
  RepairType,
  RiskLevel,
  TaskStatus,
} from '@jak-swarm/shared';
import type {
  ReplanContext,
  ReplanResult,
  WorkflowPlan,
  WorkflowTask,
} from '@jak-swarm/shared';
import { validateReplan } from './plan-validator.js';
import type { PlanValidationContext } from './plan-validator.js';

/** An optional LLM proposer — its plan still passes the symbolic validator. */
export interface LlmProposeFn {
  (ctx: ReplanContext): Promise<{
    repairType: RepairType;
    updatedPlan: WorkflowPlan;
    reason: string;
    expectedImprovement: number;
  } | null>;
}

export interface ReplanOptions {
  /** Injected LLM proposer (deterministic proposer is used when absent). */
  llmPropose?: LlmProposeFn;
  /** Tool registry snapshot — required for validation. */
  knownToolNames: ReadonlySet<string>;
}

/** Build a ReplanResult for the ESCALATE path (no plan change, human required). */
function escalate(ctx: ReplanContext, reason: string): ReplanResult {
  return {
    repairType: 'ESCALATE',
    updatedPlan: undefined,
    changedTaskIds: [],
    invalidatedTaskIds: [],
    retainedCompletedTaskIds: Object.keys(ctx.successfulTaskOutputs),
    reason,
    expectedImprovement: 0,
    additionalRisk: RiskLevel.LOW,
    requiresApproval: true,
    valid: false,
    validationIssues: [],
    autonomy: ctx.autonomy,
    escalated: true,
  };
}

/** Clone a task with overrides. */
function withTask(t: WorkflowTask, patch: Partial<WorkflowTask>): WorkflowTask {
  return { ...t, ...patch };
}

/** Pick a permitted agent different from the current one. */
function pickAlternateAgent(ctx: ReplanContext, current: AgentRole): AgentRole | undefined {
  return ctx.permittedAgents.find((a) => a !== current);
}

/**
 * REPLACE_AGENT: swap the failed task's agentRole to a permitted alternative.
 * Counterfactual-isolated agent-only failures route here.
 */
function replaceAgent(ctx: ReplanContext, alternates: AgentRole[]): WorkflowPlan | undefined {
  const alt = alternates.find((a) => ctx.permittedAgents.includes(a));
  if (!alt) return undefined;
  const tasks = ctx.originalPlan.tasks.map((t) =>
    t.id === ctx.failedTask.id ? withTask(t, { agentRole: alt }) : t,
  );
  return { ...ctx.originalPlan, tasks, updatedAt: new Date() };
}

/**
 * REPLACE_TOOL: for each unavailable/disallowed tool on the failed task, swap
 * to the first permitted+known alternative from the tenant's equivalence map.
 * Tools with no available alternative are dropped; if the task ends up toolless,
 * return undefined (caller escalates).
 */
function replaceTool(ctx: ReplanContext, unavailable: string[]): WorkflowPlan | undefined {
  const alternates = ctx.toolAlternates ?? {};
  const tasks = ctx.originalPlan.tasks.map((t) => {
    if (t.id !== ctx.failedTask.id) return t;
    const nextTools: string[] = [];
    for (const tool of t.toolsRequired) {
      if (unavailable.includes(tool)) {
        // Pick the first permitted alternative from the tenant equivalence map.
        const chosen = (alternates[tool] ?? []).find((a) => ctx.permittedTools.includes(a));
        if (chosen) {
          nextTools.push(chosen);
        }
        // else: drop the unavailable tool (no equivalent configured).
      } else {
        nextTools.push(tool);
      }
    }
    return withTask(t, { toolsRequired: nextTools });
  });
  // If the failed task lost all its tools, we cannot run it — escalate.
  const failed = tasks.find((t) => t.id === ctx.failedTask.id);
  if (failed && failed.toolsRequired.length === 0) return undefined;
  return { ...ctx.originalPlan, tasks, updatedAt: new Date() };
}

/**
 * ADD_PREREQUISITE: insert a new research/grounding task before the failed
 * task and make the failed task depend on it. Used for MISSING_CONTEXT,
 * GROUNDING_FAILURE, PLAN_DEPENDENCY, HALLUCINATION.
 */
function addPrerequisite(
  ctx: ReplanContext,
  prereqRole: AgentRole,
  prereqTool: string,
  description: string,
): WorkflowPlan | undefined {
  if (!ctx.permittedAgents.includes(prereqRole) || !ctx.permittedTools.includes(prereqTool)) {
    return undefined;
  }
  const prereqId = `prereq_${ctx.failedTask.id}_v${ctx.currentPlanVersion + 1}`;
  const prereq: WorkflowTask = {
    id: prereqId,
    name: `Prerequisite for ${ctx.failedTask.name}`,
    description,
    agentRole: prereqRole,
    toolsRequired: [prereqTool],
    riskLevel: RiskLevel.LOW,
    requiresApproval: false,
    status: TaskStatus.PENDING,
    dependsOn: [],
    retryable: true,
    maxRetries: 1,
  };
  const tasks = ctx.originalPlan.tasks.map((t) =>
    t.id === ctx.failedTask.id
      ? withTask(t, { dependsOn: Array.from(new Set([...(t.dependsOn ?? []), prereqId])) })
      : t,
  );
  // Insert the prerequisite immediately before the failed task.
  const idx = tasks.findIndex((t) => t.id === ctx.failedTask.id);
  const next = [...tasks];
  next.splice(idx >= 0 ? idx : 0, 0, prereq);
  if (next.length > ctx.maxTasks) return undefined;
  return { ...ctx.originalPlan, tasks: next, updatedAt: new Date() };
}

/**
 * The deterministic proposer. Maps failure class (+ counterfactual dimension)
 * to a candidate revised plan + repair type. Returns null when the class must
 * escalate (security / capability / unknown / budget).
 */
function proposeDeterministic(ctx: ReplanContext): {
  repairType: RepairType;
  updatedPlan?: WorkflowPlan;
  reason: string;
  expectedImprovement: number;
} {
  const cls = ctx.diagnosis.failureClass;
  const iso = ctx.counterfactual?.isolatedDimension;

  // Security / capability / unknown / credential / external-state → escalate.
  const ESCALATE_CLASSES: ReadonlySet<FailureClass> = new Set<FailureClass>([
    FailureClass.PERMISSION_DENIED,
    FailureClass.POLICY_BLOCK,
    FailureClass.PROMPT_INJECTION,
    FailureClass.UNKNOWN,
    FailureClass.CAPABILITY_GAP,
    FailureClass.MISSING_CREDENTIAL,
    FailureClass.EXTERNAL_STATE_CHANGED,
  ]);
  if (ESCALATE_CLASSES.has(cls)) {
    return {
      repairType: 'ESCALATE',
      reason: `Failure class ${cls} requires human escalation (security/capability/credential).`,
      expectedImprovement: 0,
    };
  }

  // Budget exhausted → reduce scope (drop one tool) or escalate.
  if (cls === FailureClass.BUDGET_EXCEEDED) {
    const failed = ctx.failedTask;
    if (failed.toolsRequired.length > 1) {
      // NOTE: tools carry no modelled per-tool cost or risk, so there is no
      // principled "highest-risk tool" to drop — the prior reason claimed exactly
      // that and was a lie. We drop the LAST tool as a deterministic heuristic
      // and say so plainly in the audit trail. A human reviewing the replan can
      // re-add the tool or pick a different one.
      const dropped = failed.toolsRequired[failed.toolsRequired.length - 1];
      const trimmed = failed.toolsRequired.slice(0, -1);
      const tasks = ctx.originalPlan.tasks.map((t) =>
        t.id === failed.id ? withTask(t, { toolsRequired: trimmed }) : t,
      );
      return {
        repairType: 'REDUCE_SCOPE',
        updatedPlan: { ...ctx.originalPlan, tasks, updatedAt: new Date() },
        reason: `Reduced scope on '${failed.id}': dropped tool '${dropped}' (last in toolsRequired) to fit the remaining budget. Per-tool cost/risk is not modelled, so the dropped tool is not provably the least essential — a human may re-add it.`,
        expectedImprovement: 0.3,
      };
    }
    return { repairType: 'ESCALATE', reason: 'Budget exceeded with no scope to reduce (single-tool task).', expectedImprovement: 0 };
  }

  // WRONG_AGENT or counterfactual isolated agent-only.
  if (cls === FailureClass.WRONG_AGENT || iso === 'agent-only') {
    const alt = pickAlternateAgent(ctx, ctx.failedTask.agentRole);
    if (!alt) return { repairType: 'ESCALATE', reason: 'No permitted alternate agent available.', expectedImprovement: 0 };
    return {
      repairType: 'REPLACE_AGENT',
      updatedPlan: replaceAgent(ctx, [alt]),
      reason: `Replaced agent on '${ctx.failedTask.id}': ${ctx.failedTask.agentRole} → ${alt}.`,
      expectedImprovement: 0.6,
    };
  }

  // WRONG_TOOL / TOOL_UNAVAILABLE or counterfactual isolated tool-only.
  if (cls === FailureClass.WRONG_TOOL || cls === FailureClass.TOOL_UNAVAILABLE || iso === 'tool-only') {
    // Determine which tools are unavailable / not permitted.
    const bad = ctx.failedTask.toolsRequired.filter(
      (tool) => !ctx.permittedTools.includes(tool),
    );
    const plan = replaceTool(ctx, bad.length > 0 ? bad : ctx.failedTask.toolsRequired);
    if (!plan) return { repairType: 'ESCALATE', reason: 'No permitted alternate tool available.', expectedImprovement: 0 };
    return {
      repairType: 'REPLACE_TOOL',
      updatedPlan: plan,
      reason: `Replaced tool(s) on '${ctx.failedTask.id}' with permitted alternatives.`,
      expectedImprovement: 0.6,
    };
  }

  // MISSING_CONTEXT / GROUNDING_FAILURE / HALLUCINATION → add a research prerequisite.
  if (
    cls === FailureClass.MISSING_CONTEXT ||
    cls === FailureClass.GROUNDING_FAILURE ||
    cls === FailureClass.HALLUCINATION ||
    cls === FailureClass.PLAN_DEPENDENCY
  ) {
    const plan = addPrerequisite(
      ctx,
      AgentRole.WORKER_RESEARCH,
      'web_search',
      cls === FailureClass.PLAN_DEPENDENCY
        ? `Re-establish dependency context for ${ctx.failedTask.name}`
        : `Gather grounding context for ${ctx.failedTask.name} before retry`,
    );
    if (!plan) return { repairType: 'ESCALATE', reason: 'Cannot add research prerequisite (agent/tool not permitted).', expectedImprovement: 0 };
    return {
      repairType: 'ADD_PREREQUISITE',
      updatedPlan: plan,
      reason: `Added research prerequisite before '${ctx.failedTask.id}' for ${cls}.`,
      expectedImprovement: 0.5,
    };
  }

  // Default: escalate anything not explicitly handled.
  return { repairType: 'ESCALATE', reason: `No deterministic repair for class ${cls}.`, expectedImprovement: 0 };
}

/**
 * Run the replanner. Proposes (deterministically or via injected LLM), then
 * validates symbolically, then checks autonomy + budget. Returns a ReplanResult
 * the graph node applies only when `valid && !escalated && autonomy.allowed`.
 */
export async function replan(ctx: ReplanContext, options: ReplanOptions): Promise<ReplanResult> {
  // Budget guard — no plan repairs left → escalate immediately.
  if (ctx.budgetRemaining.planRepairs <= 0) {
    return escalate(ctx, 'Plan-repair budget exhausted.');
  }

  // Propose. Try the LLM first if injected; fall back to the deterministic proposer.
  let proposal: {
    repairType: RepairType;
    updatedPlan?: WorkflowPlan;
    reason: string;
    expectedImprovement: number;
  };
  if (options.llmPropose) {
    try {
      const llmPlan = await options.llmPropose(ctx);
      proposal = llmPlan ?? proposeDeterministic(ctx);
    } catch {
      proposal = proposeDeterministic(ctx);
    }
  } else {
    proposal = proposeDeterministic(ctx);
  }

  // ESCALATE proposals short-circuit — no plan to validate.
  if (proposal.repairType === 'ESCALATE' || !proposal.updatedPlan) {
    return escalate(ctx, proposal.reason);
  }

  // Symbolic validation (Innovation #3 — the constraint layer).
  const validationCtx: PlanValidationContext = {
    knownToolNames: options.knownToolNames,
    permittedTools: new Set(ctx.permittedTools),
    permittedAgents: new Set(ctx.permittedAgents),
    completedExternalTaskIds: new Set(ctx.completedExternalTaskIds),
    previousPlan: ctx.originalPlan,
    maxTasks: ctx.maxTasks,
  };
  const validation = validateReplan(proposal.updatedPlan, validationCtx);

  // Compute what changed + what's invalidated (downstream of changed tasks).
  const changedTaskIds = proposal.updatedPlan.tasks
    .filter((t) => {
      const prev = ctx.originalPlan.tasks.find((p) => p.id === t.id);
      return !prev || prev.agentRole !== t.agentRole
        || JSON.stringify(prev.toolsRequired) !== JSON.stringify(t.toolsRequired)
        || JSON.stringify(prev.dependsOn) !== JSON.stringify(t.dependsOn);
    })
    .map((t) => t.id);
  // Newly inserted tasks are "changed".
  for (const t of proposal.updatedPlan.tasks) {
    if (!ctx.originalPlan.tasks.some((p) => p.id === t.id) && !changedTaskIds.includes(t.id)) {
      changedTaskIds.push(t.id);
    }
  }
  const invalidatedTaskIds = computeInvalidated(proposal.updatedPlan, changedTaskIds);
  const retainedCompletedTaskIds = Object.keys(ctx.successfulTaskOutputs).filter(
    (id) => !invalidatedTaskIds.includes(id) && !changedTaskIds.includes(id),
  );

  const requiresApproval =
    !ctx.autonomy.allowed || ctx.autonomy.requiresApproval;

  return {
    repairType: proposal.repairType,
    updatedPlan: proposal.updatedPlan,
    changedTaskIds,
    invalidatedTaskIds,
    retainedCompletedTaskIds,
    reason: proposal.reason,
    expectedImprovement: proposal.expectedImprovement,
    additionalRisk: computeAdditionalRisk(ctx.originalPlan, proposal.updatedPlan),
    requiresApproval,
    valid: validation.valid,
    validationIssues: validation.issues,
    autonomy: ctx.autonomy,
    escalated: false,
  };
}

/**
 * Tasks invalidated by a change = the changed tasks + everything downstream
 * (transitive dependents). Completed external actions are never invalidated
 * (the validator already rejected plans that try to re-schedule them).
 */
function computeInvalidated(plan: WorkflowPlan, changedIds: string[]): string[] {
  const dependents = new Map<string, string[]>();
  for (const t of plan.tasks) {
    for (const dep of t.dependsOn ?? []) {
      const arr = dependents.get(dep) ?? [];
      arr.push(t.id);
      dependents.set(dep, arr);
    }
  }
  const invalidated = new Set<string>(changedIds);
  const queue = [...changedIds];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const dep of dependents.get(cur) ?? []) {
      if (!invalidated.has(dep)) {
        invalidated.add(dep);
        queue.push(dep);
      }
    }
  }
  return Array.from(invalidated);
}

/**
 * Additional risk introduced by the repair = the max riskLevel among tasks that
 * are NEWLY INSERTED or CHANGED in `next` vs `prev`. "Changed" mirrors the
 * replan() diff (agent / tools / deps) and also catches a riskLevel bump.
 *
 * Before the fix only INSERTED tasks were counted, so a repair that modified an
 * existing HIGH-risk task (REPLACE_AGENT / REPLACE_TOOL / REDUCE_SCOPE) reported
 * additionalRisk = LOW — understating the risk surfaced to the autonomy policy
 * before a replan is approved. The comment said "changed/inserted" but the code
 * only did inserted; this makes the code match the comment.
 */
function computeAdditionalRisk(prev: WorkflowPlan, next: WorkflowPlan): RiskLevel {
  const RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  let maxNew: RiskLevel = RiskLevel.LOW;
  for (const t of next.tasks) {
    const prevTask = prev.tasks.find((p) => p.id === t.id);
    const changed =
      !prevTask ||
      prevTask.agentRole !== t.agentRole ||
      JSON.stringify(prevTask.toolsRequired) !== JSON.stringify(t.toolsRequired) ||
      JSON.stringify(prevTask.dependsOn) !== JSON.stringify(t.dependsOn) ||
      prevTask.riskLevel !== t.riskLevel;
    if (changed && RANK[t.riskLevel] > RANK[maxNew]) {
      maxNew = t.riskLevel;
    }
  }
  return maxNew;
}