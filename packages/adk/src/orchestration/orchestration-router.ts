/**
 * orchestration-router.ts — HyperAgent Phase 5: unify ADK under LangGraph governance.
 *
 * The audit (defect #5) found that ADK bypassed LangGraph governance: when
 * `JAK_ADK_MODE=1` the swarm-execution service ran ADK FIRST and only fell
 * back to LangGraph on ADK error, and the ADK call never threaded the
 * governance seams `runWithAdk` already accepts (`plannerPlan`, `approvalGate`).
 * So a tenant with HyperAgent ON + ADK ON got an UNGOVERNED run — no
 * diagnosis/replanner/learning, no per-tool approval gate.
 *
 * This module is the PURE decision + param-threading core that closes that.
 * The swarm-execution service snapshots the tenant's HyperAgent config +
 * `JAK_ADK_MODE` into `chooseOrchestrationPath`, then:
 *
 *   - `primary: 'langgraph'` → LangGraph runs (the governed path — diagnosis /
 *     replanner / learning / autonomy all apply). ADK is not invoked. This is
 *     the default whenever HyperAgent is ON and the tenant has not explicitly
 *     opted into ADK.
 *   - `primary: 'adk'` + `adkGoverned: true` → ADK runs GOVERNED: the approval
 *     gate (and a Planner plan, when a plan provider is wired) is threaded via
 *     `buildGovernedAdkParams` so high-risk tools pause for approval even on
 *     the ADK path. No ungoverned execution route.
 *   - `primary: 'adk'` + `adkGoverned: false` → ADK runs as the opt-in LEGACY
 *     path (HyperAgent OFF). Byte-for-byte the prior behavior — no plan/gate
 *     threaded, `runWithAdk` derives roles from `workerRoles`/roleModes.
 *
 * Decision matrix:
 *   HyperAgent ON  + adkRequested=false → langgraph primary (governed default)
 *   HyperAgent ON  + adkRequested=true  → adk primary, GOVERNED (plan+gate threaded)
 *   HyperAgent OFF + adkRequested=true  → adk primary, legacy (unchanged)
 *   HyperAgent OFF + adkRequested=false → langgraph primary (unchanged)
 *
 * The ONLY behavioral change vs the prior ADK-first code is the
 * HyperAgent-ON + adkRequested-true cell: ungoverned ADK → governed ADK. Every
 * other cell is identical to today (HyperAgent OFF is byte-for-byte unchanged;
 * HyperAgent ON + adkRequested-false already ran LangGraph because the ADK
 * block was gated on `JAK_ADK_MODE==='1'`).
 *
 * Pure + deterministic — no I/O, no LLM, no Date.now. The approval-gate
 * callback's `createApprovalRequest` is INJECTED so the gate builder stays
 * pure and unit-testable (the service supplies the real Prisma-backed
 * creator; tests supply a stub).
 */
import type { ToolMetadata, WorkflowPlan } from '@jak-swarm/shared';
import {
  shouldPauseForApproval,
  type ApprovalGate,
  type ApprovalDecision,
} from './adk-parity.js';

// ─── Orchestration-path decision ──────────────────────────────────────────────

export interface OrchestrationDecision {
  /** Which engine runs first. `langgraph` = the governed path. */
  primary: 'langgraph' | 'adk';
  /**
   * When ADK runs, is it GOVERNED? True when HyperAgent is ON — the approval
   * gate (and a Planner plan, when a plan provider is wired) is threaded so
   * there is no ungoverned ADK route. False for the HyperAgent-OFF legacy path.
   */
  adkGoverned: boolean;
}

/**
 * Decide the orchestration order + whether ADK (if it runs) is governed.
 * Pure.
 */
export function chooseOrchestrationPath(input: {
  hyperAgentEnabled: boolean;
  adkRequested: boolean;
}): OrchestrationDecision {
  return {
    primary: input.adkRequested ? 'adk' : 'langgraph',
    adkGoverned: input.hyperAgentEnabled,
  };
}

// ─── Governed-ADK param construction ──────────────────────────────────────────

export interface GovernedAdkParams {
  /** The Planner plan — when supplied, ADK derives roles FROM the plan + builds a waved pipeline. */
  plannerPlan?: WorkflowPlan;
  /** The per-tool approval gate — pauses high-risk tools for approval. */
  approvalGate?: ApprovalGate;
}

/**
 * Build the governed-ADK params threaded into `runWithAdk`. Pure. When `plan`
 * or `approvalGate` are omitted, the corresponding field is left unset so
 * `runWithAdk` falls back to its non-regressing default (caller roleModes /
 * no gate) — but only the HyperAgent-OFF legacy path should ever call this
 * with both omitted (via `chooseOrchestrationPath` the governed path always
 * supplies at least the gate).
 */
export function buildGovernedAdkParams(input: {
  plan?: WorkflowPlan;
  approvalGate?: ApprovalGate;
}): GovernedAdkParams {
  const params: GovernedAdkParams = {};
  if (input.plan) params.plannerPlan = input.plan;
  if (input.approvalGate) params.approvalGate = input.approvalGate;
  return params;
}

// ─── Approval gate construction (pure, injected creator) ──────────────────────

/** Injected creator the gate calls when a tool requires approval. Pure seam. */
export type ApprovalRequestCreator = (toolName: string, metadata: ToolMetadata) => Promise<unknown>;

/**
 * Build the ADK approval gate from an INJECTED approval-request creator. The
 * gate mirrors LangGraph's per-tool approval gate within ADK's synchronous-
 * event constraint (ADK's `for await` loop has no `interrupt()`, so the gate
 * cannot truly pause for a human — it records the approval request and returns
 * `approval_required`, so the tool does NOT execute and a human reviewer sees
 * it; honest parity, not a fake pause).
 *
 * `allow` for tools that do not require approval (low-risk); `approval_required`
 * (tool not executed) for high-risk tools, after persisting the request. If the
 * request persist itself throws, fail-closed: still `approval_required` so the
 * tool never runs unapproved. Pure given the injected creator.
 */
export function buildAdkApprovalGate(input: {
  createApprovalRequest: ApprovalRequestCreator;
}): ApprovalGate {
  return async (toolName: string, metadata: ToolMetadata): Promise<ApprovalDecision> => {
    if (!shouldPauseForApproval(metadata)) {
      return { verdict: 'allow', reason: 'tool does not require approval' };
    }
    try {
      await input.createApprovalRequest(toolName, metadata);
    } catch {
      // Fail-closed: the approval record could not be persisted, so do NOT run
      // the tool — return approval_required (recorded-for-review outcome) so a
      // human still sees the attempt and the tool is not silently auto-run.
      return {
        verdict: 'approval_required',
        reason: 'approval record persist failed — recorded for review (tool not executed)',
      };
    }
    return {
      verdict: 'approval_required',
      reason: 'high-risk tool — approval request recorded (tool not executed until approved)',
    };
  };
}