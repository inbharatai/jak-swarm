/**
 * Workflow lifecycle events — JAK-owned canonical event vocabulary that
 * any WorkflowRuntime must emit through `emitLifecycle`. The audit log,
 * cockpit, and downstream Audit & Compliance product all read from this
 * single vocabulary instead of the runtime-specific event names.
 *
 * Two layers of events exist intentionally:
 *
 *   1. AGENT-level events (`agent:activity` from the swarm graph + base
 *      agents) — fine-grained: tool_called, tool_completed, cost_updated,
 *      worker_started, worker_completed, plan_created. These are the SSE
 *      events the cockpit already reads.
 *
 *   2. WORKFLOW-level lifecycle events (this file) — coarse-grained
 *      terminal-state-machine transitions: created, planned, started,
 *      step_started, step_completed, step_failed, approval_required,
 *      approval_granted, approval_rejected, resumed, cancelled, completed,
 *      failed. The Audit & Compliance product replays this stream to
 *      reconstruct exactly what happened in a workflow.
 *
 * The two layers MUST stay in sync at observable boundaries (the audit
 * trail must include both an `approval_required` lifecycle event AND
 * the corresponding `paused` SSE event). The lifecycle stream is the
 * source of truth; SSE events are the live mirror.
 */

import type { WorkflowStatus } from '@jak-swarm/shared';

/**
 * Exhaustive list of lifecycle events. Each carries a discriminated `type`
 * + the workflowId + a timestamp. Event-specific fields are added per type.
 *
 * Note: `step_*` events use `stepId` to identify the WorkflowTask within
 * the run. For the swarm runtime today, stepId === task.id from the plan.
 */
export type WorkflowLifecycleEvent =
  | { type: 'created'; workflowId: string; tenantId: string; userId: string; goal: string; timestamp: string }
  // ── Intent / clarification (Migration 16) ─────────────────────────────
  // intent_detected fires after Commander returns a structured intent.
  // The cockpit renders a clean intent badge from this event.
  | { type: 'intent_detected'; workflowId: string; intent: string; intentConfidence: number | null; subFunction?: string; urgency?: number; timestamp: string }
  // clarification_required when Commander's `clarificationNeeded=true`.
  // Workflow pauses here; cockpit prompts the user.
  | { type: 'clarification_required'; workflowId: string; question: string; timestamp: string }
  // clarification_answered when the user replies to the prompt.
  | { type: 'clarification_answered'; workflowId: string; answer: string; timestamp: string }
  // workflow_selected when a WorkflowTemplate (intent → template lookup) matches.
  // Carries templateId so the cockpit can show "using template: <name>".
  | { type: 'workflow_selected'; workflowId: string; templateId: string; templateName: string; intent: string; timestamp: string }
  | { type: 'planned'; workflowId: string; planId: string; taskCount: number; timestamp: string }
  | { type: 'started'; workflowId: string; runtime: string; timestamp: string }
  // agent_assigned fires when the Router maps a task to a specific agentRole,
  // BEFORE step_started (which fires when the worker actually picks up the task).
  // Coarser than step_started because it includes the routing decision.
  | { type: 'agent_assigned'; workflowId: string; stepId: string; agentRole: string; routingReason?: string; timestamp: string }
  | { type: 'step_started'; workflowId: string; stepId: string; agentRole: string; timestamp: string }
  | { type: 'step_completed'; workflowId: string; stepId: string; agentRole: string; durationMs: number; timestamp: string }
  | { type: 'step_failed'; workflowId: string; stepId: string; agentRole: string; error: string; durationMs: number; timestamp: string }
  // verification_started/completed when the Verifier runs (today fires as
  // step_started/completed with agentRole='VERIFIER' — these are explicit
  // typed events so the cockpit can render a dedicated verification panel).
  | { type: 'verification_started'; workflowId: string; stepId?: string; timestamp: string }
  | { type: 'verification_completed'; workflowId: string; stepId?: string; passed: boolean; groundingScore?: number; timestamp: string }
  // Sprint 2.2 / Item H — fires when worker-node compresses
  // state.taskResults before building the agent input on long DAGs.
  | { type: 'context_summarized'; workflowId: string; stepId: string; inputTaskResultCount: number; tokensBefore: number; tokensAfter: number; timestamp: string }
  | { type: 'approval_required'; workflowId: string; approvalId: string; stepId?: string; riskLevel?: string; timestamp: string }
  | { type: 'approval_granted'; workflowId: string; approvalId: string; reviewedBy: string; timestamp: string }
  | { type: 'approval_rejected'; workflowId: string; approvalId: string; reviewedBy: string; reason?: string; timestamp: string }
  | { type: 'resumed'; workflowId: string; reason: 'approval' | 'manual'; timestamp: string }
  | { type: 'cancelled'; workflowId: string; reason?: string; cancelledBy?: string; timestamp: string }
  | { type: 'completed'; workflowId: string; finalStatus: WorkflowStatus; durationMs: number; timestamp: string }
  | { type: 'failed'; workflowId: string; error: string; durationMs?: number; timestamp: string }
  // ── Company Brain events (Migration 16) ──────────────────────────────
  // company_context_loaded when BaseAgent grounds an agent's prompt with
  // the approved CompanyProfile (only fires when status='user_approved' or 'manual').
  | { type: 'company_context_loaded'; workflowId: string; agentRole: string; profileFieldsUsed: string[]; timestamp: string }
  // company_context_used_by_agent when the agent's output cites or relies
  // on the loaded context. Implicit from base-agent today; explicit going forward.
  | { type: 'company_context_used_by_agent'; workflowId: string; agentRole: string; profileFieldsCited: string[]; timestamp: string }
  // company_context_missing when an intent's required-context field is null
  // on the CompanyProfile (e.g. marketing_campaign_generation needs brandVoice).
  | { type: 'company_context_missing'; workflowId: string; intent: string; missingFields: string[]; timestamp: string }
  // company_memory_suggested when an agent proposes a memory to be persisted.
  // status='suggested' until the user approves; until then NOT loaded into prompts.
  | { type: 'company_memory_suggested'; workflowId: string; memoryId: string; key: string; suggestedBy: string; timestamp: string }
  | { type: 'company_memory_approved'; workflowId?: string; memoryId: string; reviewedBy: string; timestamp: string }
  | { type: 'company_memory_rejected'; workflowId?: string; memoryId: string; reviewedBy: string; reason?: string; timestamp: string }
  // ── CEO Super-Orchestrator events (final-hardening Gap A) ───────────
  // Emitted by CEOOrchestratorService.run when wrapping a normal
  // workflow with the executive-experience phases. The cockpit renders
  // a dedicated CEO panel reading these events.
  | { type: 'ceo_goal_understood'; workflowId: string; goal: string; intent: string; intentConfidence: number | null; timestamp: string }
  | { type: 'ceo_context_loaded'; workflowId: string; profileFieldsLoaded: string[]; profileStatus: string; timestamp: string }
  | { type: 'ceo_workflow_selected'; workflowId: string; workflow: string; templateId?: string; timestamp: string }
  | { type: 'ceo_agents_assigned'; workflowId: string; executiveFunctions: string[]; agentRoles: string[]; timestamp: string }
  | { type: 'ceo_plan_created'; workflowId: string; taskCount: number; estimatedDurationMs?: number; timestamp: string }
  | { type: 'ceo_blocker_detected'; workflowId: string; blocker: string; missingFields?: string[]; timestamp: string }
  | { type: 'ceo_escalation_created'; workflowId: string; reason: string; approvalId?: string; timestamp: string }
  | { type: 'ceo_final_summary_generated'; workflowId: string; summary: string; nextActions: string[]; durationMs: number; timestamp: string }
  // ── Cross-task auto-repair events (final-hardening Gap B) ───────────
  // Emitted by RepairService when handling node/agent/tool failures.
  | { type: 'repair_needed'; workflowId: string; stepId?: string; errorClass: string; reason: string; timestamp: string }
  | { type: 'repair_attempt_started'; workflowId: string; stepId?: string; attempt: number; strategy: string; timestamp: string }
  | { type: 'repair_attempt_completed'; workflowId: string; stepId?: string; attempt: number; succeeded: boolean; timestamp: string }
  | { type: 'repair_attempt_failed'; workflowId: string; stepId?: string; attempt: number; reason: string; timestamp: string }
  | { type: 'repair_escalated_to_human'; workflowId: string; stepId?: string; reason: string; approvalId?: string; timestamp: string }
  | { type: 'repair_limit_reached'; workflowId: string; stepId?: string; attempts: number; finalError: string; timestamp: string }
  // ── Retention sweep events (final-hardening Gap E) ──────────────────
  // Emitted by RetentionSweepService for tenant data hygiene.
  | { type: 'retention_sweep_started'; tenantId?: string; mode: 'dry_run' | 'execute'; timestamp: string }
  | { type: 'retention_candidate_found'; tenantId: string; objectType: string; objectId: string; reason: string; timestamp: string }
  | { type: 'retention_item_deleted'; tenantId: string; objectType: string; objectId: string; timestamp: string }
  | { type: 'retention_item_skipped'; tenantId: string; objectType: string; objectId: string; reason: string; timestamp: string }
  | { type: 'retention_sweep_completed'; tenantId?: string; mode: 'dry_run' | 'execute'; deletedCount: number; skippedCount: number; durationMs: number; timestamp: string }
  | { type: 'retention_sweep_failed'; tenantId?: string; error: string; timestamp: string };

/** Sink the runtime calls on every lifecycle transition. Must be infallible. */
export type WorkflowLifecycleEmitter = (event: WorkflowLifecycleEvent) => void;

/**
 * Default no-op emitter for runtimes constructed without an explicit sink.
 * Keeps the API total — every runtime has an emitter, even if it discards.
 */
export const NOOP_LIFECYCLE_EMITTER: WorkflowLifecycleEmitter = () => {};

/**
 * Helper to safely call an emitter without ever propagating its errors
 * back into the runtime path. Lifecycle telemetry must NEVER block
 * the workflow itself.
 */
export function safeEmitLifecycle(
  emitter: WorkflowLifecycleEmitter | undefined,
  event: WorkflowLifecycleEvent,
): void {
  if (!emitter) return;
  try {
    emitter(event);
  } catch {
    // Swallow — the alternative is breaking the workflow because the
    // audit logger crashed.
  }
}
