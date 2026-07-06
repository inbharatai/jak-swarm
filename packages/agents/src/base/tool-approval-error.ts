/**
 * ToolApprovalRequiredError — thrown by the tool-execution loop when the
 * tenant registry returns `outcome: 'approval_required'` for a tool call.
 *
 * Item 10 of the post-audit follow-ups (per-tool approval gate). The prior
 * behavior emitted a `tool_approval_required` activity (which persists an
 * ApprovalRequest row + fires the canonical lifecycle event) but then
 * CONTINUED the tool loop — handing the LLM a fake "wait for the user to
 * decide" message and letting it burn more iterations (and tokens) on a
 * tool that would never run until a human decides. The workflow would
 * then complete with a degraded answer while the approval sat in the
 * inbox, never actually blocking the task.
 *
 * Throwing a structured error instead:
 *   1. Stops the tool loop cleanly — no more LLM iterations after a gate
 *      fired (no token waste, no lying to the model about "waiting").
 *   2. Propagates up to the worker node, which catches it specifically
 *      and marks the task `AWAITING_APPROVAL` (honest task state) instead
 *      of `COMPLETED`-with-degraded-answer or generic `FAILED`.
 *   3. Carries the approval context (toolName, category, reason,
 *      inputSummary) so the worker node + trace can surface exactly what
 *      was blocked and why, without re-deriving it from the activity log.
 *
 * What this does NOT do (deferred — needs live LangGraph validation):
 *   The full workflow-level PAUSE is not implemented here. Calling
 *   LangGraph `interrupt()` from the worker node would suspend the graph,
 *   but the resume side (`LangGraphRuntime.resume` →
 *   `Command({ resume: { status, reviewedBy, comment } })`) does not
 *   thread an `approvalId` into the agent context, so on resume the tool
 *   loop would re-run from iteration 0, hit the same gate, and re-block —
 *   an infinite re-block loop. Wiring the resume `approvalId` through the
 *   agent context + verifying the replay behavior requires a live LLM +
 *   LangGraph end-to-end test that cannot be run in this environment.
 *   Shipping that blind would violate the no-half-measures / no-bugs
 *   directive. The structured throw + honest task state here is the safe,
 *   fully-testable portion; the deep pause/resume is documented as the
 *   remaining scope.
 */
export class ToolApprovalRequiredError extends Error {
  readonly toolName: string;
  readonly category: string;
  readonly reason: string;
  readonly inputSummary: string;

  constructor(params: {
    toolName: string;
    category: string;
    reason: string;
    inputSummary: string;
  }) {
    super(
      `Tool '${params.toolName}' requires user approval before execution ` +
        `(category: ${params.category}). The approval request has been ` +
        `surfaced to the cockpit inbox; the task is marked AWAITING_APPROVAL ` +
        `pending human review. Reason: ${params.reason}`,
    );
    this.name = 'ToolApprovalRequiredError';
    this.toolName = params.toolName;
    this.category = params.category;
    this.reason = params.reason;
    this.inputSummary = params.inputSummary;
  }
}