/**
 * followup-parser — natural-language follow-up command classifier.
 *
 * Maps short user inputs typed inside an active workflow context to one
 * of 14 named follow-up actions. Rule-based (no LLM) — fast, deterministic,
 * cheap.
 *
 * Scope: only the SHORT, OBVIOUS commands the spec calls out. Anything
 * ambiguous returns null and the caller should treat the input as a new
 * goal (route through Commander as usual).
 *
 * Used by the chat input handler — when an active workflow exists on the
 * conversation and the user types a short message, try this parser first
 * before spinning up a new workflow.
 */

export type FollowupCommand =
  | { kind: 'approve';        target: 'last_pending' | 'workflow' }
  | { kind: 'reject';         target: 'last_pending' | 'workflow' }
  | { kind: 'continue' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'cancel' }
  | { kind: 'show_graph' }
  | { kind: 'show_status'; agentRole?: string }   // "what is the CMO doing?" → agentRole='WORKER_MARKETING'
  | { kind: 'show_failed' }
  | { kind: 'show_cost' }
  | { kind: 'download_report' }
  | { kind: 'finalize_workpaper' }
  | { kind: 'why_waiting' };

interface ParserOptions {
  /** When true, the active workflow is paused awaiting approval — bias
   *  the parser toward approval-related commands. */
  hasPendingApproval?: boolean;
}

const NORMALIZE = (s: string) => s.trim().toLowerCase().replace(/[.!?]+$/, '');

const ROLE_KEYWORDS: Record<string, string> = {
  cto: 'WORKER_TECHNICAL',
  cmo: 'WORKER_MARKETING',
  cfo: 'WORKER_FINANCE',
  ceo: 'WORKER_STRATEGIST',
  coo: 'WORKER_OPS',
  vibe: 'WORKER_APP_GENERATOR',
  vibecoder: 'WORKER_APP_GENERATOR',
  coder: 'WORKER_CODER',
  designer: 'WORKER_DESIGNER',
  research: 'WORKER_RESEARCH',
  researcher: 'WORKER_RESEARCH',
  browser: 'WORKER_BROWSER',
  verifier: 'VERIFIER',
  planner: 'PLANNER',
  commander: 'COMMANDER',
};

/**
 * Parse a chat input as a follow-up command. Returns null when the input
 * isn't an obvious command (caller should route as a new goal).
 *
 * Examples:
 *   "approve"                → { kind: 'approve', target: 'last_pending' }
 *   "ok approve it"          → { kind: 'approve', target: 'last_pending' }
 *   "continue"               → { kind: 'continue' }
 *   "show graph" / "show me the dag"  → { kind: 'show_graph' }
 *   "what is the CMO doing?" → { kind: 'show_status', agentRole: 'WORKER_MARKETING' }
 *   "show failed steps"      → { kind: 'show_failed' }
 *   "show cost" / "tokens"   → { kind: 'show_cost' }
 *   "why is this waiting"    → { kind: 'why_waiting' }
 *   "download report"        → { kind: 'download_report' }
 */
export function parseFollowup(input: string, opts: ParserOptions = {}): FollowupCommand | null {
  const text = NORMALIZE(input);
  if (text.length === 0 || text.length > 200) return null;

  // Approve / reject (both have approval-pending bias)
  if (/^(approve|approved|approve it|ok approve it?|approve please|yes approve|approve this|approve the (last|workflow))$/.test(text)) {
    return { kind: 'approve', target: 'last_pending' };
  }
  if (/^(reject|rejected|reject it|reject please|no reject|reject this|reject the (last|workflow))$/.test(text)) {
    return { kind: 'reject', target: 'last_pending' };
  }

  // Single-word common commands
  if (/^(continue|go|proceed|next|keep going)$/.test(text)) return { kind: 'continue' };
  if (/^(pause|hold|stop here|wait)$/.test(text)) return { kind: 'pause' };
  if (/^(resume|unpause|carry on|keep going)$/.test(text)) return { kind: 'resume' };
  if (/^(cancel|cancel it|cancel this|stop|abort)$/.test(text)) return { kind: 'cancel' };

  // Show commands
  if (/^show( me)? (the )?(graph|dag|workflow graph|execution graph)$/.test(text)) return { kind: 'show_graph' };
  if (/^(show )?(failed|errored?|broken)( steps?| tasks?| nodes?)?$/.test(text)) return { kind: 'show_failed' };
  if (/^(show |what'?s the )?(cost|tokens?|spend|usage|cost so far|total cost)$/.test(text)) return { kind: 'show_cost' };
  if (/^download( the)? (final )?(report|output|result|summary)$/.test(text)) return { kind: 'download_report' };
  if (/^(why( is)? (this|it) waiting|why( is)? (this|it) (paused|stuck))/.test(text)) return { kind: 'why_waiting' };
  if (/^finalize( the)? workpaper|approve( the)? workpaper$/.test(text)) return { kind: 'finalize_workpaper' };

  // "what is the X doing?" / "what's the X up to" / "X status"
  const statusMatch = /^(what(?:'s| is)? (?:the )?|status of (?:the )?)?(\w+)(?:\s+(?:doing|status|up to|working on))?\??$/.exec(text);
  if (statusMatch) {
    const role = ROLE_KEYWORDS[statusMatch[2] ?? ''];
    if (role) {
      return { kind: 'show_status', agentRole: role };
    }
  }
  // "what is X doing?" specifically (caught above already, but explicit pattern as fallback)
  const xDoing = /\b(cto|cmo|cfo|ceo|coo|vibecoder|vibe|coder|designer|research|researcher|browser|verifier|planner|commander)\b/.exec(text);
  if (xDoing && (text.includes('doing') || text.includes('status') || text.includes('working'))) {
    const role = ROLE_KEYWORDS[xDoing[1] ?? ''];
    if (role) return { kind: 'show_status', agentRole: role };
  }

  // Approval-pending bias: short positive responses lean toward approve
  if (opts.hasPendingApproval) {
    if (/^(yes|yep|yeah|sure|ok|okay|sounds good|do it|ship it|go ahead)$/.test(text)) {
      return { kind: 'approve', target: 'last_pending' };
    }
    if (/^(no|nope|don't|do not|cancel)$/.test(text)) {
      return { kind: 'reject', target: 'last_pending' };
    }
  }

  return null;
}

/**
 * Friendly action label for the cockpit ("Approving the last pending action…",
 * "Showing the workflow graph…").
 */
export function describeFollowup(cmd: FollowupCommand): string {
  switch (cmd.kind) {
    case 'approve':            return 'Approving the last pending action…';
    case 'reject':             return 'Rejecting the last pending action…';
    case 'continue':           return 'Continuing the workflow…';
    case 'pause':              return 'Pausing the workflow…';
    case 'resume':             return 'Resuming the workflow…';
    case 'cancel':             return 'Cancelling the workflow…';
    case 'show_graph':         return 'Showing the workflow graph (DAG view).';
    case 'show_status':        return cmd.agentRole ? `Showing what ${cmd.agentRole} is doing.` : 'Showing agent status.';
    case 'show_failed':        return 'Showing failed steps.';
    case 'show_cost':          return 'Showing token usage and cost.';
    case 'download_report':    return 'Preparing the final report download…';
    case 'finalize_workpaper': return 'Finalizing the workpaper for review…';
    case 'why_waiting':        return 'Showing why the workflow is waiting…';
  }
}
