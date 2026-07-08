/**
 * adk-parity.ts — HyperAgent Phase 11: ADK parity pure cores.
 *
 * Closes the three ADK parity gaps flagged in the Phase 0 audit:
 *   1. WAVES — ADK ran a single flat ParallelAgent; the LangGraph path runs
 *      dependency-ordered waves. `partitionRolesIntoWaves` does a Kahn topo-sort
 *      of the Planner plan and groups worker roles into waves so a depended-on
 *      role's wave runs before its dependents' wave (via a SequentialAgent of
 *      ParallelAgents in adk-pipeline.ts).
 *   2. ROLES FROM THE PLANNER PLAN — ADK took worker roles from the CALLER's
 *      roleModes, not the plan. `rolesFromPlan` extracts the unique agentRoles
 *      the Planner actually assigned, so ADK runs the roles the plan calls for.
 *   3. APPROVAL PAUSE/RESUME — ADK's `for await` event loop has no
 *      `interrupt()`, so the runner self-admitted it could not pause for
 *      approval. `shouldPauseForApproval` + the `ApprovalGate` seam give a REAL
 *      pause at the tool-call boundary: the bridged FunctionTool handler awaits
 *      the gate before executing a high-risk tool, so a human approval resolves
 *      before the tool runs (honest parity with LangGraph's per-tool gate,
 *      within ADK's synchronous-event constraint).
 *
 * Pure + deterministic — no I/O, no LLM, no Date.now. The runner wires I/O
 * (the gate callback); these cores decide. All new behavior is OPT-IN: when the
 * caller supplies no `plannerPlan` / `approvalGate`, ADK runs byte-for-byte as
 * before (non-regressing).
 */
import { ToolRiskClass } from '@jak-swarm/shared';
import type { ToolMetadata, WorkflowPlan } from '@jak-swarm/shared';

// ─── Roles from the Planner plan ─────────────────────────────────────────────

/**
 * Extract the unique worker agentRoles the Planner assigned, in first-appearance
 * order. The parity fix for "ADK worker roles from caller roleModes not Planner
 * plan" — ADK now runs the roles the PLAN calls for, not the caller's roleModes.
 * Pure.
 */
export function rolesFromPlan(plan: WorkflowPlan): string[] {
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const task of plan.tasks) {
    const role = task.agentRole as string;
    if (!seen.has(role)) {
      seen.add(role);
      roles.push(role);
    }
  }
  return roles;
}

// ─── Waves (dependency-ordered role groups) ──────────────────────────────────

/**
 * Partition the plan's roles into dependency-ordered waves via a Kahn topo-sort.
 * A task's wave = 1 + the max wave of its dependencies (roots = wave 0). Each
 * wave holds the UNIQUE roles whose tasks land in that wave, in first-appearance
 * order. A depended-on role's wave therefore runs before its dependents' wave.
 *
 * Returns an array of waves (string[][]); an empty plan ⇒ one empty wave so the
 * pipeline still builds. Pure + deterministic.
 */
export function partitionRolesIntoWaves(plan: WorkflowPlan): string[][] {
  const tasks = plan.tasks;
  if (tasks.length === 0) return [[]];

  const idToTask = new Map<string, (typeof tasks)[number]>();
  for (const t of tasks) idToTask.set(t.id, t);

  // wave[id] = longest dependency chain depth from a root.
  const waveCache = new Map<string, number>();
  function waveOf(id: string): number {
    const cached = waveCache.get(id);
    if (cached !== undefined) return cached;
    const t = idToTask.get(id);
    if (!t || t.dependsOn.length === 0) {
      waveCache.set(id, 0);
      return 0;
    }
    let depth = 0;
    for (const dep of t.dependsOn) {
      depth = Math.max(depth, waveOf(dep) + 1);
    }
    waveCache.set(id, depth);
    return depth;
  }

  const waves: string[][] = [];
  const seenPerWave: Set<string>[] = [];
  for (const t of tasks) {
    const w = waveOf(t.id);
    while (waves.length <= w) {
      waves.push([]);
      seenPerWave.push(new Set());
    }
    const role = t.agentRole as string;
    if (!seenPerWave[w]!.has(role)) {
      seenPerWave[w]!.add(role);
      waves[w]!.push(role);
    }
  }
  return waves;
}

// ─── Approval pause/resume seam ──────────────────────────────────────────────

/** The gate's verdict for a tool that requires approval. */
export type ApprovalVerdict = 'allow' | 'deny' | 'approval_required';

export interface ApprovalDecision {
  verdict: ApprovalVerdict;
  reason?: string;
}

/**
 * The approval gate the runner injects into the tool bridge. It receives the
 * tool name + metadata and resolves to a decision — possibly after awaiting a
 * human approver (real pause/resume at the tool-call boundary). When the gate is
 * absent, the bridge runs the tool as before (non-regressing).
 */
export type ApprovalGate = (toolName: string, metadata: ToolMetadata) => Promise<ApprovalDecision>;

/**
 * True when a tool requires a pause for approval: either it is declared
 * `requiresApproval`, or its risk class is EXTERNAL_SIDE_EFFECT / DESTRUCTIVE
 * (mirrors the embedded local Shield policy). Pure.
 */
export function shouldPauseForApproval(metadata: ToolMetadata): boolean {
  if (metadata.requiresApproval) return true;
  return (
    metadata.riskClass === ToolRiskClass.EXTERNAL_SIDE_EFFECT ||
    metadata.riskClass === ToolRiskClass.DESTRUCTIVE
  );
}

/**
 * Resolve a gate decision into a "may the tool execute?" boolean + the outcome
 * shape to return when it may not. `allow` ⇒ execute; `deny` / `approval_required`
 * ⇒ do NOT execute, return the recorded-for-review outcome (honest: the tool did
 * not run). Pure.
 */
export function applyApprovalDecision(decision: ApprovalDecision): {
  mayExecute: boolean;
  outcome: 'approved' | 'denied' | 'approval_required';
  reason?: string;
} {
  switch (decision.verdict) {
    case 'allow':
      return { mayExecute: true, outcome: 'approved', reason: decision.reason };
    case 'deny':
      return { mayExecute: false, outcome: 'denied', reason: decision.reason };
    case 'approval_required':
    default:
      return { mayExecute: false, outcome: 'approval_required', reason: decision.reason };
  }
}

/** Sentinel: the gate was not configured (bridge runs the tool as before). */
export const NO_APPROVAL_GATE: ApprovalGate | null = null;

/** The default decision when a pause is required but NO gate is configured. */
export const DEFAULT_NO_GATE_DECISION: ApprovalDecision = {
  verdict: 'approval_required',
  reason: 'no approval gate configured — recorded for review (tool not executed)',
};