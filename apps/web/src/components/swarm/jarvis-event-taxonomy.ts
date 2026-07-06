// ─── JARVIS Inspector — real SSE event taxonomy ─────────────────────────────
//
// These are the EXACT `type` values the backend emits from
// `swarm-execution.service.ts` emitLifecycle (grep-verified). The JARVIS
// EventFeed renders against this list so the UI never invents event types
// the engine doesn't produce. Unknown types fall through to a neutral
// "event" row (honest — never silently dropped, never faked).

export interface JarvisEventConfig {
  label: string;
  /** tailwind text color class for the timestamp + label accent */
  accent: string;
  /** short glyph — kept as a plain char so this file stays JSX-free + tree-shakeable */
  glyph: string;
  /** lifecycle bucket for grouping / filtering */
  bucket: 'lifecycle' | 'plan' | 'step' | 'tool' | 'approval' | 'verification' | 'intent' | 'other';
}

export const JARVIS_EVENT_CONFIG: Record<string, JarvisEventConfig> = {
  created:                 { label: 'Workflow created',     accent: 'text-sky-300',     glyph: '✦', bucket: 'lifecycle' },
  started:                 { label: 'Run started',          accent: 'text-emerald-300', glyph: '▶', bucket: 'lifecycle' },
  resumed:                 { label: 'Run resumed',          accent: 'text-emerald-300', glyph: '▶', bucket: 'lifecycle' },
  paused:                  { label: 'Paused — approval',    accent: 'text-amber-300',   glyph: '⏸', bucket: 'lifecycle' },
  completed:               { label: 'Run completed',        accent: 'text-emerald-300', glyph: '✓', bucket: 'lifecycle' },
  failed:                  { label: 'Run failed',           accent: 'text-rose-300',    glyph: '✕', bucket: 'lifecycle' },
  cancelled:               { label: 'Run cancelled',        accent: 'text-zinc-300',    glyph: '⊘', bucket: 'lifecycle' },

  intent_detected:         { label: 'Intent detected',      accent: 'text-cyan-300',    glyph: '◎', bucket: 'intent' },
  workflow_selected:       { label: 'Workflow selected',    accent: 'text-cyan-300',    glyph: '◎', bucket: 'intent' },
  clarification_required:  { label: 'Clarification needed', accent: 'text-amber-300',   glyph: '?', bucket: 'intent' },
  company_context_missing: { label: 'Company context missing', accent: 'text-amber-300', glyph: '!', bucket: 'intent' },

  planned:                 { label: 'Plan created',         accent: 'text-violet-300',  glyph: '⌥', bucket: 'plan' },
  context_summarized:      { label: 'Context summarized',   accent: 'text-violet-300',  glyph: '⌥', bucket: 'plan' },

  agent_assigned:          { label: 'Agent assigned',       accent: 'text-blue-300',    glyph: '→', bucket: 'step' },
  step_started:            { label: 'Step started',         accent: 'text-blue-300',    glyph: '▸', bucket: 'step' },
  step_completed:          { label: 'Step completed',       accent: 'text-emerald-300', glyph: '▸', bucket: 'step' },
  step_failed:             { label: 'Step failed',          accent: 'text-rose-300',    glyph: '▸', bucket: 'step' },

  approval_required:       { label: 'Approval required',    accent: 'text-amber-300',   glyph: '⚑', bucket: 'approval' },
  approval_granted:        { label: 'Approval granted',     accent: 'text-emerald-300', glyph: '⚑', bucket: 'approval' },
  approval_rejected:       { label: 'Approval rejected',    accent: 'text-rose-300',    glyph: '⚑', bucket: 'approval' },

  verification_started:    { label: 'Verification started', accent: 'text-teal-300',    glyph: '⟐', bucket: 'verification' },
  verification_completed:  { label: 'Verification done',    accent: 'text-teal-300',    glyph: '⟐', bucket: 'verification' },
};

const NEUTRAL: JarvisEventConfig = { label: 'Event', accent: 'text-zinc-300', glyph: '·', bucket: 'other' };

export function jarvisEventConfig(type: string): JarvisEventConfig {
  return JARVIS_EVENT_CONFIG[type] ?? { ...NEUTRAL, label: type || 'Event' };
}

// ─── Tool outcome badge config (mirrors packages/shared ToolOutcome) ────────

export interface ToolOutcomeConfig {
  label: string;
  badgeClass: string;
  dotClass: string;
}

export const TOOL_OUTCOME_CONFIG: Record<string, ToolOutcomeConfig> = {
  real_success:           { label: 'Real run',      badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', dotClass: 'bg-emerald-400' },
  draft_created:          { label: 'Draft',         badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',           dotClass: 'bg-sky-400' },
  mock_provider:          { label: 'Mock provider', badgeClass: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30', dotClass: 'bg-fuchsia-400' },
  not_configured:         { label: 'Not configured',badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',    dotClass: 'bg-amber-400' },
  blocked_requires_config:{ label: 'Blocked — config', badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30', dotClass: 'bg-amber-400' },
  approval_required:      { label: 'Approval req.', badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',    dotClass: 'bg-amber-400' },
  disabled_by_policy:     { label: 'Disabled by policy', badgeClass: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',  dotClass: 'bg-zinc-400' },
  failed:                 { label: 'Failed',        badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',       dotClass: 'bg-rose-400' },
};

const OUTCOME_NEUTRAL: ToolOutcomeConfig = {
  label: 'Ran',
  badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  dotClass: 'bg-emerald-400',
};

/** Resolve the outcome to display. Legacy toolCallsJson rows without an
 *  explicit `outcome` default to 'real_success' when there's no error (per
 *  the shared ToolResult contract) — but a row with an error is honestly
 *  'failed' regardless of a stale/missing outcome field. */
export function resolveToolOutcome(outcome: string | undefined, error: string | undefined): string {
  if (error) return 'failed';
  if (outcome && TOOL_OUTCOME_CONFIG[outcome]) return outcome;
  return 'real_success';
}

export function toolOutcomeConfig(outcome: string): ToolOutcomeConfig {
  return TOOL_OUTCOME_CONFIG[outcome] ?? OUTCOME_NEUTRAL;
}