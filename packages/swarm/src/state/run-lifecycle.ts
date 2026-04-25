/**
 * Run lifecycle — typed state machine for workflow status.
 *
 * Phase 5 of the OpenAI-first migration introduces this so the canonical
 * set of allowed transitions lives in ONE place instead of scattered
 * `status =` writes across services. Today the codebase has at least
 * three places that mutate workflow.status (swarm-execution.service.ts,
 * approval-node.ts, queue-worker.ts). They all set the right thing
 * today but there's no compile-time or runtime guard against a code
 * path advancing a workflow from `COMPLETED` back to `EXECUTING`.
 *
 * Phase 5 ships:
 *   - the canonical state graph (this file)
 *   - `assertTransition(from, to)` that LOGS (not throws) on illegal
 *     transitions in this phase, so we can surface real-world drift
 *     in production logs without breaking any in-flight workflows
 *
 * Phase 6 will switch the log-only behavior to throw, after one full
 * release of telemetry confirms zero illegal-transition log lines in
 * prod. That's the safe migration path: observe, then enforce.
 */

import { WorkflowStatus } from '@jak-swarm/shared';

/**
 * Canonical transition table. Keys are the FROM state; values are the
 * set of legal TO states. Built once at module load — no runtime cost.
 *
 * Notes on specific edges:
 *   - PENDING → any non-terminal: a fresh enqueue can immediately go to
 *     PLANNING (Commander/Planner) or skip straight to EXECUTING
 *     (Builder pipeline that bypasses the planner).
 *   - PLANNING → AWAITING_APPROVAL: planner produced a high-risk task
 *     that needs human approval before any worker runs.
 *   - AWAITING_APPROVAL → CANCELLED: reviewer rejected the action.
 *   - EXECUTING → AWAITING_APPROVAL: a mid-workflow tool call needed
 *     additional approval (e.g. a publish-to-prod step).
 *   - VERIFYING → EXECUTING: verifier failed the task and routed back
 *     to the worker for a retry.
 *   - * → ROLLED_BACK: terminal state when a compensation flow undid
 *     prior side effects after a failure (Phase 7+ concept; reserved here).
 */
const TRANSITIONS: Record<WorkflowStatus, ReadonlySet<WorkflowStatus>> = {
  [WorkflowStatus.PENDING]: new Set([
    WorkflowStatus.PLANNING,
    WorkflowStatus.ROUTING,
    WorkflowStatus.EXECUTING,
    WorkflowStatus.AWAITING_APPROVAL,
    WorkflowStatus.FAILED,
    WorkflowStatus.CANCELLED,
  ]),
  [WorkflowStatus.PLANNING]: new Set([
    WorkflowStatus.ROUTING,
    WorkflowStatus.EXECUTING,
    WorkflowStatus.AWAITING_APPROVAL,
    WorkflowStatus.COMPLETED,
    WorkflowStatus.FAILED,
    WorkflowStatus.CANCELLED,
  ]),
  [WorkflowStatus.ROUTING]: new Set([
    WorkflowStatus.EXECUTING,
    WorkflowStatus.AWAITING_APPROVAL,
    WorkflowStatus.FAILED,
    WorkflowStatus.CANCELLED,
  ]),
  [WorkflowStatus.EXECUTING]: new Set([
    WorkflowStatus.VERIFYING,
    WorkflowStatus.AWAITING_APPROVAL,
    WorkflowStatus.PLANNING,
    WorkflowStatus.COMPLETED,
    WorkflowStatus.FAILED,
    WorkflowStatus.CANCELLED,
  ]),
  [WorkflowStatus.AWAITING_APPROVAL]: new Set([
    WorkflowStatus.EXECUTING,
    WorkflowStatus.PLANNING,
    WorkflowStatus.COMPLETED,
    WorkflowStatus.FAILED,
    WorkflowStatus.CANCELLED,
    WorkflowStatus.ROLLED_BACK,
  ]),
  [WorkflowStatus.VERIFYING]: new Set([
    WorkflowStatus.EXECUTING,
    WorkflowStatus.PLANNING,
    WorkflowStatus.AWAITING_APPROVAL,
    WorkflowStatus.COMPLETED,
    WorkflowStatus.FAILED,
    WorkflowStatus.CANCELLED,
  ]),
  // Terminal states — no further transitions.
  [WorkflowStatus.COMPLETED]: new Set(),
  [WorkflowStatus.FAILED]: new Set([WorkflowStatus.ROLLED_BACK]),
  [WorkflowStatus.CANCELLED]: new Set(),
  [WorkflowStatus.ROLLED_BACK]: new Set(),
};

const TERMINAL_STATES: ReadonlySet<WorkflowStatus> = new Set([
  WorkflowStatus.COMPLETED,
  WorkflowStatus.FAILED,
  WorkflowStatus.CANCELLED,
  WorkflowStatus.ROLLED_BACK,
]);

export function isTerminalStatus(status: WorkflowStatus): boolean {
  return TERMINAL_STATES.has(status);
}

export function isLegalTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  if (from === to) return true; // idempotent re-write of the same state
  return TRANSITIONS[from]?.has(to) ?? false;
}

/**
 * Default behavior: log-only on illegal transitions. Production telemetry
 * surfaces any code path that's mutating status outside the legal graph
 * without breaking in-flight workflows.
 *
 * Strict mode (JAK_STRICT_WORKFLOW_STATE=true): throws IllegalTransitionError
 * on any illegal transition. Operators who have already validated their
 * deployment with a clean log-only baseline can opt into strict to fail
 * loud the moment a regression slips in. Strict mode is OFF by default
 * because it would break any old workflow whose persisted DB status
 * doesn't appear in the canonical enum.
 *
 * `logger` is intentionally a minimal interface so any pino / fastify /
 * console-shaped logger satisfies it.
 */
export interface MinimalLogger {
  warn: (info: Record<string, unknown>, msg: string) => void;
  info: (info: Record<string, unknown>, msg: string) => void;
}

export class IllegalTransitionError extends Error {
  readonly from: WorkflowStatus;
  readonly to: WorkflowStatus;
  readonly workflowId: string;
  readonly legalNext: WorkflowStatus[];

  constructor(opts: {
    from: WorkflowStatus;
    to: WorkflowStatus;
    workflowId: string;
    legalNext: WorkflowStatus[];
    reason?: string;
  }) {
    super(
      `[run-lifecycle] illegal transition for workflow ${opts.workflowId}: ${opts.from} → ${opts.to}` +
      ` (legal next from ${opts.from}: ${opts.legalNext.join(', ') || '(terminal)'})` +
      (opts.reason ? `. reason: ${opts.reason}` : ''),
    );
    this.name = 'IllegalTransitionError';
    this.from = opts.from;
    this.to = opts.to;
    this.workflowId = opts.workflowId;
    this.legalNext = opts.legalNext;
  }
}

/**
 * Read the strict-mode flag at call time (not module-load time) so test
 * code and runtime ops can flip it without restarting the process.
 */
function isStrictMode(): boolean {
  return (process.env['JAK_STRICT_WORKFLOW_STATE'] ?? '').toLowerCase() === 'true';
}

export function assertTransition(
  from: WorkflowStatus,
  to: WorkflowStatus,
  context: { workflowId: string; logger?: MinimalLogger; reason?: string },
): void {
  if (isLegalTransition(from, to)) return;
  const legalNext = Array.from(TRANSITIONS[from] ?? []);
  const info = {
    workflowId: context.workflowId,
    from,
    to,
    reason: context.reason ?? '(unspecified)',
    legalNext,
    strict: isStrictMode(),
  };
  const log = context.logger;
  if (log) log.warn(info, '[run-lifecycle] illegal transition');
  else if (typeof console !== 'undefined') {
    // eslint-disable-next-line no-console
    console.warn('[run-lifecycle] illegal transition', info);
  }
  if (isStrictMode()) {
    throw new IllegalTransitionError({
      from,
      to,
      workflowId: context.workflowId,
      legalNext,
      reason: context.reason,
    });
  }
}

/**
 * Convenience helper — call this every time code mutates workflow.status.
 * Returns the new status so it can be inlined into a Prisma update payload.
 *
 *   data: { status: transition(currentStatus, 'EXECUTING', ctx) }
 *
 * Default mode: returns `to` even on illegal transitions (caller's intent
 * wins; assertTransition logs the warning). Strict mode: assertTransition
 * throws IllegalTransitionError before this function returns, which the
 * caller can catch + handle.
 */
export function transition(
  from: WorkflowStatus,
  to: WorkflowStatus,
  context: { workflowId: string; logger?: MinimalLogger; reason?: string },
): WorkflowStatus {
  assertTransition(from, to, context);
  return to;
}

export const TERMINAL = TERMINAL_STATES;
