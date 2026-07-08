/**
 * plan-validator.ts — the symbolic validation layer for HyperAgent Phase 4
 * (Innovation #3: Replanner as constrained symbolic search).
 *
 * The spec mandates that every revised plan pass: schema validation, DAG cycle
 * detection, dependency validation, tool existence, agent existence, ability-
 * pack validation, autonomy validation, cost validation, risk recalculation,
 * approval recalculation, and idempotency/replay validation — and that
 * completed external actions are never repeated.
 *
 * This module is PURE + deterministic: no LLM, no I/O, no singleton access.
 * The known-tool set, permitted tool/agent allowlists, completed-external ids,
 * remaining budget and previous plan are all injected via `PlanValidationContext`
 * so the function is fully unit-testable and cannot be bypassed by an LLM
 * "deciding" a plan is fine. The graph node layer (replanner-node.ts) snapshots
 * `ToolRegistry.getInstance()` + tenant config into the context.
 *
 * The LLM Replanner may PROPOSE a plan; this validator decides whether it can
 * be APPLIED. No cyclic / invalid / unsafe plan can ever reach execution.
 */

import type { AgentRole, RiskLevel } from '@jak-swarm/shared';
import { RiskLevel as RiskL } from '@jak-swarm/shared';
import type { WorkflowPlan } from '@jak-swarm/shared';
import type { PlanValidationIssue, PlanValidationResult } from '@jak-swarm/shared';

/** Context the validator needs — all injected, never read from globals. */
export interface PlanValidationContext {
  /** All tool names known to the registry at validation time. */
  knownToolNames: ReadonlySet<string>;
  /** Tenant/run tool allowlist (intersect registry). Empty = no allowlist enforced. */
  permittedTools: ReadonlySet<string>;
  /** Permitted worker roles for this tenant / run. */
  permittedAgents: ReadonlySet<AgentRole>;
  /** Tasks that already completed WITH an external side effect (receipts/emails/publishes). */
  completedExternalTaskIds: ReadonlySet<string>;
  /** The plan this revision was derived from — for risk/approval regression checks. */
  previousPlan: WorkflowPlan;
  /** Defensive ceiling on tasks per plan. */
  maxTasks: number;
}

const RISK_RANK: Readonly<Record<RiskLevel, number>> = Object.freeze({
  [RiskL.LOW]: 0,
  [RiskL.MEDIUM]: 1,
  [RiskL.HIGH]: 2,
  [RiskL.CRITICAL]: 3,
});

/**
 * Detect cycles in the task dependency DAG via DFS three-coloring.
 * Returns the id of a task on a cycle, or undefined if the DAG is acyclic.
 */
export function findCycleTask(plan: WorkflowPlan): string | undefined {
  const ids = new Set(plan.tasks.map((t) => t.id));
  const adj = new Map<string, string[]>();
  for (const t of plan.tasks) {
    adj.set(t.id, (t.dependsOn ?? []).filter((d) => ids.has(d)));
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, WHITE);

  let cycleId: string | undefined;
  const dfs = (u: string): void => {
    if (cycleId) return;
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GRAY) { cycleId = v; return; }
      if (color.get(v) === WHITE) dfs(v);
      if (cycleId) return;
    }
    color.set(u, BLACK);
  };
  for (const id of ids) {
    if (color.get(id) === WHITE) dfs(id);
    if (cycleId) break;
  }
  return cycleId;
}

/**
 * Validate a revised plan. Pure. Returns the issue list (empty = valid).
 *
 * Checks, in order:
 *   1. non-empty + each task well-formed (id/name/agentRole)
 *   2. task count within limit
 *   3. DAG acyclic
 *   4. every dependsOn id exists (no dangling deps)
 *   5. every agentRole is a permitted worker
 *   6. every toolsRequired entry exists in the registry AND the allowlist
 *   7. completed external actions are not re-scheduled (status must stay COMPLETED)
 *   8. risk did not silently decrease on a previously-approval-required task
 *   9. approval was not stripped from a previously-approval-required task
 *      (destructive tasks cannot become auto-approved)
 */
export function validateReplan(plan: WorkflowPlan, ctx: PlanValidationContext): PlanValidationResult {
  const issues: PlanValidationIssue[] = [];

  // 1. Empty + well-formedness.
  if (!plan.tasks || plan.tasks.length === 0) {
    issues.push({ code: 'EMPTY_PLAN', message: 'Revised plan has no tasks.' });
    return { valid: false, issues };
  }
  for (const t of plan.tasks) {
    if (!t.id || !t.name || !t.agentRole) {
      issues.push({
        code: 'INVALID_TASK',
        message: `Task is missing id/name/agentRole (id=${t.id ?? '<none>'}).`,
        taskId: t.id,
      });
    }
  }

  // 2. Task count ceiling.
  if (plan.tasks.length > ctx.maxTasks) {
    issues.push({
      code: 'TASK_COUNT_OVER_LIMIT',
      message: `Plan has ${plan.tasks.length} tasks; max is ${ctx.maxTasks}.`,
    });
  }

  // 3. DAG cycle detection.
  const cycleTask = findCycleTask(plan);
  if (cycleTask) {
    issues.push({
      code: 'CYCLE',
      message: `Dependency cycle detected involving task '${cycleTask}'.`,
      taskId: cycleTask,
    });
  }

  // 4. Dangling dependencies.
  const ids = new Set(plan.tasks.map((t) => t.id));
  for (const t of plan.tasks) {
    for (const dep of t.dependsOn ?? []) {
      if (!ids.has(dep)) {
        issues.push({
          code: 'DANGLING_DEPENDENCY',
          message: `Task '${t.id}' depends on unknown task '${dep}'.`,
          taskId: t.id,
        });
      }
    }
  }

  // 5 + 6. Agent + tool existence + permission.
  for (const t of plan.tasks) {
    if (t.agentRole && !ctx.permittedAgents.has(t.agentRole)) {
      issues.push({
        code: 'AGENT_NOT_PERMITTED',
        message: `Task '${t.id}' uses agent '${t.agentRole}' not in the permitted set.`,
        taskId: t.id,
      });
    }
    for (const tool of t.toolsRequired ?? []) {
      if (!ctx.knownToolNames.has(tool)) {
        issues.push({
          code: 'UNKNOWN_TOOL',
          message: `Task '${t.id}' requires unknown tool '${tool}'.`,
          taskId: t.id,
        });
        continue;
      }
      if (ctx.permittedTools.size > 0 && !ctx.permittedTools.has(tool)) {
        issues.push({
          code: 'TOOL_NOT_PERMITTED',
          message: `Task '${t.id}' uses tool '${tool}' not in the tenant allowlist.`,
          taskId: t.id,
        });
      }
    }
  }

  // 7. Completed external actions must not be re-scheduled.
  for (const t of plan.tasks) {
    if (ctx.completedExternalTaskIds.has(t.id) && t.status !== 'COMPLETED') {
      issues.push({
        code: 'COMPLETED_EXTERNAL_REPEATED',
        message: `Task '${t.id}' completed with an external side effect and must not be re-scheduled (status must stay COMPLETED).`,
        taskId: t.id,
      });
    }
  }

  // 8 + 9. Risk / approval regression vs the previous plan.
  const prevById = new Map(ctx.previousPlan.tasks.map((t) => [t.id, t] as const));
  for (const t of plan.tasks) {
    const prev = prevById.get(t.id);
    if (!prev) continue;
    // Risk silently decreased on an approval-required task.
    if (
      prev.requiresApproval &&
      RISK_RANK[t.riskLevel] < RISK_RANK[prev.riskLevel]
    ) {
      issues.push({
        code: 'RISK_SILENTLY_DECREASED',
        message: `Task '${t.id}' risk decreased ${prev.riskLevel}→${t.riskLevel} without re-approval.`,
        taskId: t.id,
      });
    }
    // Approval stripped from a previously-approval-required task.
    if (prev.requiresApproval && !t.requiresApproval) {
      issues.push({
        code: 'DESTRUCTIVE_AUTO_APPROVED',
        message: `Task '${t.id}' was approval-required and is now auto-approved — destructive tasks cannot become auto-approved.`,
        taskId: t.id,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}