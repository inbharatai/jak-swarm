/**
 * Per-provider "Run audit" workflow goals.
 *
 * Brief mandate: "Run audit / Generate report" must produce useful
 * output for normal users — not technical jargon. Each goal is a
 * plain-English instruction the Commander/Planner pipeline will
 * decompose into the right specialist agent (CMO/CTO/CFO/etc.) for the
 * connector's domain.
 *
 * The goal text is also what shows in the user's run history, so it
 * doubles as a description of what was run.
 */

export const CONNECTOR_AUDIT_GOALS: Record<string, string> = {
  GMAIL:
    'Audit my Gmail inbox: summarize the last 7 days of emails, flag urgent threads, identify unread important messages, and suggest a triage plan. Do not send or delete anything — only generate a report.',
  GCAL:
    'Audit my Google Calendar for the next 14 days: identify scheduling conflicts, back-to-back meetings, low-prep events, and suggest improvements. Do not create, edit, or delete events — only generate a report.',
  SLACK:
    'Audit Slack channels JAK is invited to: summarize key conversations, flag unanswered threads needing attention, and suggest follow-up priorities. Do not post or DM anything — only generate a report.',
  GITHUB:
    'Audit my GitHub: review open pull requests, recent commits, and stale branches in selected repositories. Identify code-quality issues, suggest fixes, and propose next steps. Do not push, merge, or close anything — only generate a report.',
  NOTION:
    'Audit Notion pages JAK has access to: identify outdated docs, broken links, missing structure, and suggest improvements. Do not edit or delete pages — only generate a report.',
  HUBSPOT:
    'Audit my HubSpot CRM: identify stale deals, contacts missing data, pipeline bottlenecks, and suggest follow-up actions. Do not modify records or send emails — only generate a report.',
  DRIVE:
    'Audit shared Google Drive folders: identify large files, duplicates, outdated docs, and suggest cleanup priorities. Do not edit, move, or delete files — only generate a report.',
  LINKEDIN:
    'Audit my LinkedIn presence: review my profile, recent posts, engagement quality, and suggest improvements to bio, content cadence, and brand consistency. Do not publish or message anyone — only generate a report.',
  SALESFORCE:
    'Audit my Salesforce: identify stale opportunities, accounts missing data, pipeline gaps, and suggest follow-up actions. Do not modify records or send emails — only generate a report.',
};

/**
 * Generic fallback for connectors not in the table — keeps a new
 * connector usable until its tailored goal lands.
 */
export const DEFAULT_AUDIT_GOAL =
  'Audit this connection: read what is permitted, summarize key findings, identify weaknesses or risks, and suggest priority actions. Do not make external changes — only generate a report.';

export function getAuditGoal(provider: string): string {
  return CONNECTOR_AUDIT_GOALS[provider.toUpperCase()] ?? DEFAULT_AUDIT_GOAL;
}
