/**
 * Canonical intent vocabulary for the JAK company-OS conversation surface.
 *
 * This is the SINGLE SOURCE OF TRUTH for the 18 named intents. The
 * Commander's `respondStructured` schema constrains its output to one of
 * these, the IntentRecord persistence layer indexes by them, the
 * WorkflowTemplate library matches templates to them, and the cockpit
 * displays a clean badge per intent.
 *
 * Adding a new intent: append to COMPANY_OS_INTENTS, add a description in
 * INTENT_DESCRIPTIONS, and (optionally) seed a matching WorkflowTemplate
 * in seed-data/workflow-templates.ts.
 *
 * Removing one: removing breaks any persisted IntentRecord rows that
 * reference it. Use `status='deprecated'` on the matching template instead.
 */

import { z } from 'zod';

export const COMPANY_OS_INTENTS = [
  // High-level business workflows
  'company_strategy_review',
  'marketing_campaign_generation',
  'website_review_and_improvement',
  'codebase_review_and_patch',
  'competitor_research',
  'investor_material_generation',
  'content_calendar_generation',
  'audit_compliance_workflow',
  'pricing_and_unit_economics_review',
  'operations_sop_generation',
  'customer_persona_generation',
  'sales_outreach_draft_generation',
  'product_positioning_review',
  // Atomic / low-risk operations
  'document_analysis',
  'browser_inspection',
  'research_and_report',
  // Conversational fallbacks
  'general_question',
  'ambiguous_request',
] as const;

export type CompanyOSIntent = typeof COMPANY_OS_INTENTS[number];

export const CompanyOSIntentSchema = z.enum(COMPANY_OS_INTENTS);

/**
 * One-line description per intent. Used in:
 *   - The Commander's system prompt (so the LLM understands what each
 *     intent means before classifying)
 *   - The cockpit tooltip when the intent badge is hovered
 *   - The /intents API listing for analytics dashboards
 */
export const INTENT_DESCRIPTIONS: Record<CompanyOSIntent, string> = {
  company_strategy_review:
    'Review the user\'s company at a strategic level — strengths, weaknesses, opportunities, risks. Output: executive brief.',
  marketing_campaign_generation:
    'Produce a marketing campaign plan — audience, channels, message, timeline, content drafts. Output: campaign plan + draft assets.',
  website_review_and_improvement:
    'Inspect the user\'s website (URL required) and produce an improvement plan covering UX, content, SEO, conversion. Output: review report + recommendations.',
  codebase_review_and_patch:
    'Review code in a repository or pasted snippet. Identify bugs, security issues, style violations. Optionally produce a patch. Output: review report + (when requested) patch diff.',
  competitor_research:
    'Research a list of competitors. Compare positioning, pricing, features, audience. Output: comparison matrix + insights brief.',
  investor_material_generation:
    'Produce or refine investor materials — pitch deck outline, one-pager, financials narrative, FAQ. Output: drafts in markdown / pdf.',
  content_calendar_generation:
    'Generate a content calendar (topics, channels, dates, formats) for a given period. Output: calendar table + per-post brief.',
  audit_compliance_workflow:
    'Run a compliance audit engagement — control planning, evidence mapping, control testing, workpaper generation, signed final pack. Routes to the dedicated /audit/runs API.',
  pricing_and_unit_economics_review:
    'Review pricing, unit economics, gross margin, CAC/LTV. Recommend changes. Output: financial review + scenario model.',
  operations_sop_generation:
    'Produce a standard operating procedure (SOP) document for a named operation. Output: SOP markdown / pdf.',
  customer_persona_generation:
    'Build customer personas from interviews, support data, or website inputs. Output: 2-5 persona cards with motivations, pain points, channels.',
  sales_outreach_draft_generation:
    'Draft outbound sales outreach (email, LinkedIn, follow-ups) for a target segment. Output: drafts only — never sent without explicit user approval.',
  product_positioning_review:
    'Review and refine product positioning, messaging hierarchy, value prop. Output: positioning canvas + revised copy.',
  document_analysis:
    'Read user-uploaded documents and produce a summary, extraction, or comparison. Output: structured summary or extracted data.',
  browser_inspection:
    'Visit a URL and produce structured data — screenshot, content extraction, link map, performance signals. Output: report + screenshots.',
  research_and_report:
    'General-purpose research task — gather information from web + knowledge base, synthesize a report. Output: research brief + sources.',
  general_question:
    'A conversational question that doesn\'t need a workflow — Commander short-circuits with a direct answer.',
  ambiguous_request:
    'The user\'s request is too vague or has multiple plausible interpretations. Commander asks a clarification question before proceeding.',
};

/**
 * Maps an intent to the agent-roles likely to be involved when the
 * Planner decomposes the workflow. Used by the cockpit to show "expected
 * agents" early (before Planner runs) and by `requiredCompanyContext`
 * checks to warn about missing inputs.
 *
 * This is a HINT, not a constraint — the Planner can deviate. The
 * WorkflowTemplate library has the authoritative agent list per intent.
 */
export const INTENT_TO_LIKELY_AGENTS: Record<CompanyOSIntent, string[]> = {
  company_strategy_review:        ['WORKER_STRATEGIST', 'WORKER_RESEARCH', 'WORKER_FINANCE'],
  marketing_campaign_generation:  ['WORKER_MARKETING', 'WORKER_CONTENT', 'WORKER_DESIGNER'],
  website_review_and_improvement: ['WORKER_BROWSER', 'WORKER_DESIGNER', 'WORKER_TECHNICAL'],
  codebase_review_and_patch:      ['WORKER_CODER', 'WORKER_TECHNICAL', 'VERIFIER'],
  competitor_research:            ['WORKER_RESEARCH', 'WORKER_BROWSER', 'WORKER_CONTENT'],
  investor_material_generation:   ['WORKER_CONTENT', 'WORKER_FINANCE', 'WORKER_DESIGNER'],
  content_calendar_generation:    ['WORKER_CONTENT', 'WORKER_SEO', 'WORKER_MARKETING'],
  audit_compliance_workflow:      ['AUDIT_COMMANDER', 'COMPLIANCE_MAPPER', 'CONTROL_TEST_AGENT', 'WORKPAPER_WRITER'],
  pricing_and_unit_economics_review: ['WORKER_FINANCE', 'WORKER_STRATEGIST'],
  operations_sop_generation:      ['WORKER_OPS', 'WORKER_DOCUMENT'],
  customer_persona_generation:    ['WORKER_RESEARCH', 'WORKER_MARKETING'],
  sales_outreach_draft_generation: ['WORKER_GROWTH', 'WORKER_CONTENT'],
  product_positioning_review:     ['WORKER_PRODUCT', 'WORKER_STRATEGIST'],
  document_analysis:              ['WORKER_DOCUMENT'],
  browser_inspection:             ['WORKER_BROWSER'],
  research_and_report:            ['WORKER_RESEARCH', 'WORKER_DOCUMENT'],
  general_question:               [],  // Direct-answer short-circuit
  ambiguous_request:              [],  // Clarification gate
};

/**
 * Required company-context fields per intent — used to warn the user
 * "we need your brand voice before generating a marketing campaign".
 * Empty array = no specific requirement (uses what's available).
 */
export const INTENT_REQUIRED_CONTEXT: Record<CompanyOSIntent, string[]> = {
  company_strategy_review:        ['name', 'industry', 'description'],
  marketing_campaign_generation:  ['name', 'brandVoice', 'targetCustomers'],
  website_review_and_improvement: ['websiteUrl'],
  codebase_review_and_patch:      [],  // user provides repo/snippet
  competitor_research:            ['competitors'],
  investor_material_generation:   ['name', 'description', 'productsServices'],
  content_calendar_generation:    ['brandVoice', 'targetCustomers'],
  audit_compliance_workflow:      [],  // routed to /audit/runs
  pricing_and_unit_economics_review: ['pricing', 'productsServices'],
  operations_sop_generation:      [],
  customer_persona_generation:    ['targetCustomers'],
  sales_outreach_draft_generation: ['name', 'productsServices', 'brandVoice'],
  product_positioning_review:     ['productsServices', 'targetCustomers', 'competitors'],
  document_analysis:              [],
  browser_inspection:             [],
  research_and_report:            [],
  general_question:               [],
  ambiguous_request:              [],
};
