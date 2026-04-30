/**
 * Friendly executive-team names for the 38 internal agent roles.
 *
 * Brief: layman users should see "CMO Agent is reviewing Instagram",
 * "CTO Agent is checking the website" — NOT `WORKER_MARKETING` or
 * `WORKER_TECHNICAL`. Internal codes stay; this is the UI translation.
 *
 * Mapping rationale (executive-team analogy):
 *   CEO    — sets strategy, summarizes business health, prioritizes
 *   CMO    — marketing, brand, social, content, growth, SEO, PR
 *   CTO    — engineering, infrastructure, app builds, deployments
 *   CFO    — finance, billing, revenue
 *   COO    — operations, support, customer success, project mgmt
 *   Research — competitive intel, market research, knowledge work
 *   Designer — visual design, UI/UX, asset generation
 *   Legal  — compliance, contracts, terms review
 *   People — HR, hiring, internal team coordination
 *
 * Orchestrator agents (commander/planner/router/verifier/guardrail/
 * approval) keep neutral labels — users don't need a CXO metaphor for
 * "the planner is decomposing your goal".
 */

export interface AgentFriendlyName {
  /** Layman label, e.g. "CMO Agent". */
  label: string;
  /** One-line description for hover/tooltip. */
  description: string;
}

const FRIENDLY_NAMES: Record<string, AgentFriendlyName> = {
  // Orchestrator layer
  COMMANDER: { label: 'Strategy Lead', description: 'Reads your goal and frames the mission.' },
  PLANNER: { label: 'Planner', description: 'Breaks the goal into ordered steps.' },
  ROUTER: { label: 'Router', description: 'Assigns each step to the right specialist.' },
  GUARDRAIL: { label: 'Guardrail', description: 'Checks each step against your safety rules.' },
  VERIFIER: { label: 'Verifier', description: 'Checks the result is honest and grounded.' },
  APPROVAL: { label: 'Approval Gate', description: 'Pauses for your sign-off on risky actions.' },
  REPLANNER: { label: 'Replanner', description: 'Adjusts the plan when something fails.' },
  VALIDATOR: { label: 'Validator', description: 'Validates output structure.' },

  // CEO-flavored
  WORKER_STRATEGIST: { label: 'CEO Agent', description: 'Sets priorities and summarizes business health.' },

  // CMO-flavored
  WORKER_MARKETING: { label: 'CMO Agent', description: 'Marketing, campaigns, audience strategy.' },
  WORKER_GROWTH: { label: 'CMO Agent — Growth', description: 'Growth experiments and funnel review.' },
  WORKER_PR: { label: 'CMO Agent — PR', description: 'PR drafts and outreach.' },
  WORKER_SEO: { label: 'CMO Agent — SEO', description: 'SEO audits and keyword work.' },
  WORKER_CONTENT: { label: 'CMO Agent — Content', description: 'Content drafts and copy.' },
  WORKER_BROWSER: { label: 'CMO Agent — Web Review', description: 'Reviewing pages in the browser.' },

  // CTO-flavored
  WORKER_CODER: { label: 'CTO Agent', description: 'Code review and changes.' },
  WORKER_TECHNICAL: { label: 'CTO Agent — Architecture', description: 'Technical architecture review.' },
  WORKER_APP_ARCHITECT: { label: 'CTO Agent — App Architect', description: 'App design and structure.' },
  WORKER_APP_GENERATOR: { label: 'CTO Agent — App Builder', description: 'Generates app scaffolding.' },
  WORKER_APP_DEBUGGER: { label: 'CTO Agent — Debug', description: 'Diagnoses and fixes bugs.' },
  WORKER_APP_DEPLOYER: { label: 'CTO Agent — Deploy', description: 'Builds and deploys updates.' },
  WORKER_SCREENSHOT_TO_CODE: { label: 'CTO Agent — Vision-to-Code', description: 'Turns mockups into code.' },

  // CFO-flavored
  WORKER_FINANCE: { label: 'CFO Agent', description: 'Finance review and revenue dashboards.' },

  // COO-flavored
  WORKER_OPS: { label: 'COO Agent', description: 'Operations and process review.' },
  WORKER_SUPPORT: { label: 'Support Agent', description: 'Customer support and tickets.' },
  WORKER_SUCCESS: { label: 'Customer Success Agent', description: 'Customer success workflows.' },
  WORKER_PROJECT: { label: 'Project Manager Agent', description: 'Project tracking and coordination.' },
  WORKER_PRODUCT: { label: 'Product Manager Agent', description: 'Product priorities and roadmap.' },

  // Research / Knowledge
  WORKER_RESEARCH: { label: 'Research Agent', description: 'Market research and competitive intel.' },
  WORKER_KNOWLEDGE: { label: 'Knowledge Agent', description: 'Reads your documents and notes.' },
  WORKER_ANALYTICS: { label: 'Analytics Agent', description: 'Reads dashboards and prepares charts.' },

  // Specialists
  WORKER_DESIGNER: { label: 'Designer Agent', description: 'Visual design and UI work.' },
  WORKER_LEGAL: { label: 'Legal Agent', description: 'Contracts and compliance review.' },
  WORKER_HR: { label: 'HR Agent', description: 'Hiring and people operations.' },

  // Channel workers
  WORKER_EMAIL: { label: 'Email Agent', description: 'Reads and drafts emails.' },
  WORKER_CALENDAR: { label: 'Calendar Agent', description: 'Manages calendar and scheduling.' },
  WORKER_CRM: { label: 'CRM Agent', description: 'Reads and updates CRM records.' },
  WORKER_DOCUMENT: { label: 'Documents Agent', description: 'Drafts and reviews documents.' },
  WORKER_SPREADSHEET: { label: 'Spreadsheets Agent', description: 'Reads and writes spreadsheets.' },
  WORKER_VOICE: { label: 'Voice Agent', description: 'Voice transcription and dictation.' },
};

const FALLBACK: AgentFriendlyName = {
  label: 'JAK Agent',
  description: 'Working on a step.',
};

export function getAgentFriendlyName(role: string | null | undefined): AgentFriendlyName {
  if (!role) return FALLBACK;
  return FRIENDLY_NAMES[role.toUpperCase()] ?? {
    label: role.replace(/^WORKER_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) + ' Agent',
    description: 'Working on a step.',
  };
}

/** Bare label only — handy where the description isn't needed. */
export function getAgentFriendlyLabel(role: string | null | undefined): string {
  return getAgentFriendlyName(role).label;
}
