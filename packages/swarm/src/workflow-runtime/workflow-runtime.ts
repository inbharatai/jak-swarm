/**
 * WorkflowRuntime - JAK-owned interface for workflow orchestration.
 *
 * LangGraph is the active runtime. The interface keeps API/services isolated
 * from `@langchain/langgraph` implementation details while preserving the
 * approval pause/resume, cancellation, and read-only snapshot contract.
 */

import type { WorkflowStatus } from '@jak-swarm/shared';
import type { SwarmState } from '../state/swarm-state.js';
import type { SwarmResult } from '../runner/swarm-runner.js';
import type { WorkflowLifecycleEmitter } from './lifecycle-events.js';

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
  userRole?: string;
  /** Conversation thread history loaded by the service layer and injected
   *  into the graph state so agents see prior turns. */
  conversationHistory?: Array<{ role: string; content: string }>;
  /**
   * Sink for canonical lifecycle events. Wired by SwarmExecutionService
   * to persist the events into AuditLog + emit SSE for the cockpit. The
   * runtime calls this for every transition (created, planned, started,
   * step_started, step_completed, step_failed, approval_required,
   * approval_granted, approval_rejected, resumed, cancelled, completed,
   * failed). When undefined the runtime drops the events silently —
   * keeping it optional preserves backward compatibility for callers
   * that don't yet wire the audit emitter.
   */
  onLifecycle?: WorkflowLifecycleEmitter;
  /** Per-tenant LLM provider preference ('openai' | 'gemini'). Undefined = env-var default. */
  llmProvider?: 'openai' | 'gemini';
  /** Enable Google Search grounding for Gemini. Falls back to env var. */
  googleSearchGrounding?: boolean;
  /** Vertex AI Search datastore path for Gemini. Falls back to env var. */
  vertexAISearchDatastore?: string;
  /** Enable OpenAI's hosted web_search tool. Falls back to env var. */
  openaiWebSearch?: boolean;
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
  /** Engine name for telemetry. Current production value: 'langgraph'. */
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
