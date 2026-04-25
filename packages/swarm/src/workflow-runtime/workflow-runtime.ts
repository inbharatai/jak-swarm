/**
 * WorkflowRuntime — JAK-owned interface for workflow orchestration.
 *
 * Phase 6 of the OpenAI-first migration introduces this so the rest of
 * the codebase never imports `@langchain/langgraph` types directly.
 * Today's `SwarmGraph` + `SwarmRunner` get wrapped as
 * `SwarmGraphRuntime`; Phase 6+ adds `LangGraphRuntime` behind the same
 * interface. Callers (apps/api/src/services/swarm-execution.service.ts,
 * apps/api/src/routes/approvals.routes.ts) only know about
 * `WorkflowRuntime` — they never care which engine is executing.
 *
 * The interface is intentionally narrow:
 *   - start: kick off a workflow with a goal + initial context
 *   - resume: continue a paused workflow after an approval decision
 *   - cancel: stop an in-flight workflow
 *   - getState: read the current state without mutating it
 *
 * Anything richer (streaming, partial-run snapshots, fork/replay) gets
 * added later as needed — keeping the interface narrow keeps both
 * runtimes interchangeable.
 */

import type { WorkflowStatus } from '@jak-swarm/shared';
import type { SwarmState } from '../state/swarm-state.js';
import type { SwarmResult } from '../runner/swarm-runner.js';

/**
 * Decision payload supplied when resuming a paused workflow. Mirrors
 * `ApprovalDecision` from the existing approvals route.
 *
 * `approvalId` is optional because some callers (the approval resume
 * flow that operates per-workflow rather than per-approval) don't have
 * an approval id in scope; it's a logging breadcrumb when present.
 */
export interface ResumeDecision {
  approvalId?: string;
  decision: 'APPROVED' | 'REJECTED';
  reviewedBy: string;
  comment?: string;
}

/**
 * Context handed to start() — minimum viable surface so both runtimes
 * (SwarmGraph + LangGraph) can construct an initial state from it.
 */
export interface StartContext {
  workflowId: string;
  tenantId: string;
  userId: string;
  goal: string;
  industry?: string;
  roleModes?: string[];
  idempotencyKey?: string;
  maxCostUsd?: number;
  autoApproveEnabled?: boolean;
  approvalThreshold?: string;
  allowedDomains?: string[];
  browserAutomationEnabled?: boolean;
  restrictedCategories?: unknown[];
  disabledToolNames?: string[];
  connectedProviders?: string[];
  subscriptionTier?: 'free' | 'paid';
}

/**
 * Snapshot of a workflow's state for read-only consumption. Independent
 * of the underlying engine's state representation.
 */
export interface WorkflowSnapshot {
  workflowId: string;
  status: WorkflowStatus;
  currentStage?: string;
  currentTaskId?: string;
  completedTaskIds: string[];
  failedTaskIds: string[];
  pendingApprovalIds: string[];
  finalOutput?: string;
  error?: string;
  /** Engine-specific raw state (don't depend on this shape across engines). */
  rawState?: SwarmState;
}

export interface WorkflowRuntime {
  /** Engine name for telemetry ('swarmgraph' | 'langgraph'). */
  readonly name: string;

  /**
   * Start a new workflow. Returns the final result when complete OR throws
   * a `WorkflowPausedError` when the workflow hits an approval interrupt.
   * Caller (SwarmExecutionService) catches paused state and enqueues a
   * resume control job.
   */
  start(ctx: StartContext): Promise<SwarmResult>;

  /**
   * Resume a paused workflow with an approval decision. Returns the final
   * result OR throws `WorkflowPausedError` again if more approvals follow.
   */
  resume(workflowId: string, decision: ResumeDecision): Promise<SwarmResult>;

  /**
   * Cooperatively cancel an in-flight workflow. The runtime is expected
   * to honor this at the next node boundary.
   */
  cancel(workflowId: string, reason?: string): Promise<void>;

  /**
   * Read-only snapshot of the workflow's current state. Used by the UI
   * Runs page + GET /workflows/:id recovery layer.
   */
  getState(workflowId: string): Promise<WorkflowSnapshot | null>;
}

/** Thrown by start/resume when the runtime hits an approval interrupt. */
export class WorkflowPausedError extends Error {
  constructor(
    public readonly workflowId: string,
    public readonly pendingApprovalIds: string[],
  ) {
    super(`Workflow ${workflowId} paused for approval (${pendingApprovalIds.length} pending)`);
    this.name = 'WorkflowPausedError';
  }
}
