import type { JobFunction } from '@/types';

export const COMMAND_TEMPLATES: Record<string, string> = {
  // CEO
  'ceo-board-summary': 'Read my last 20 emails and calendar events this week. Draft a 1-page executive summary with key decisions, risks, and action items for the board.',
  'ceo-risk-scan': 'Research the top 5 risks facing our business right now: market, competitive, regulatory, and operational. Summarise each with a recommended response.',
  'ceo-competitive': 'Research our top 3 competitors. Find their recent product launches, funding, job postings, and pricing changes. Summarise the strategic implications.',

  // CTO
  'cto-pr-review': 'List all open GitHub pull requests. Summarise each by risk level and lines changed. Flag any touching security-critical files, missing tests, or open for more than 7 days.',
  'cto-incident': 'Review recent system errors and incidents from the last 24 hours. Summarise by severity, identify root causes where possible, and draft a post-mortem for the highest severity event.',
  'cto-arch-doc': 'Based on our codebase and recent changes, generate an up-to-date architecture overview document covering services, data flows, and dependencies.',

  // CMO
  'cmo-campaign': 'Analyse our marketing campaign performance this month. Summarise top-performing channels, content, and CTAs. Recommend 3 optimisations for next month.',
  'cmo-competitors': 'Research our top 5 competitors marketing strategies. Analyse their messaging, content, SEO keywords, and social presence. Identify gaps we can exploit.',
  'cmo-leads': 'Find 20 decision-makers at Series B SaaS companies that are hiring sales roles. Enrich their contact info, score them by ICP fit, and draft personalised cold outreach emails.',

  // ENGINEER
  'eng-triage': 'Read GitHub issues labelled "bug" created in the last 7 days. Categorise each by severity and affected component. Create a priority-ordered list with suggested owners.',
  'eng-pr-draft': 'Help me write a pull request description. I will describe my changes and you will generate: a clear summary, motivation, testing steps, and rollback instructions.',
  'eng-docs': 'Review our public-facing documentation for the last 3 months of code changes. Identify what is outdated or missing. Draft the updated sections.',

  // HR
  'hr-screening': 'Review the latest 10 job applications for our open roles. Score each applicant by fit, summarise their key strengths and gaps, and recommend who to interview.',
  'hr-onboarding': 'Generate a personalised onboarding checklist for a new engineer starting next Monday. Include: tools setup, team introductions, first-week projects, and key meetings.',
  'hr-reviews': 'Prepare a performance review cycle overview. Summarise team members by tenure, recent contributions, and any flagged concerns. Draft prompts for each 1:1.',

  // FINANCE
  'fin-pnl': 'Generate a monthly P&L summary. Analyse revenue trends, top cost centres, and variance against budget. Highlight 3 areas needing attention.',
  'fin-invoices': 'Review all outstanding invoices. Summarise overdue amounts by client, days outstanding, and total at risk. Draft follow-up emails for the top 5 overdue.',
  'fin-forecast': 'Build a 90-day cash flow forecast based on current revenue run rate, known expenses, and pipeline deals. Flag any periods of concern.',

  // SALES
  'sales-pipeline': 'Review our CRM pipeline. Summarise deals by stage, value, and probability. Identify the top 5 deals to focus on this week and suggest next actions for each.',

  // OPERATIONS
  'ops-bottlenecks': 'Analyse our workflows from the last 30 days. Identify the top 3 bottlenecks by time spent and frequency. Recommend process improvements for each.',
};

export interface QuickAction {
  label: string;
  template: string;
  description: string;
}

export const QUICK_ACTIONS: Record<JobFunction | 'OTHER', QuickAction[]> = {
  CEO: [
    { label: 'Weekly board summary', template: 'ceo-board-summary', description: 'Synthesise emails and calendar into exec brief' },
    { label: 'Strategic risk scan', template: 'ceo-risk-scan', description: 'Identify and respond to business risks' },
    { label: 'Competitive intel', template: 'ceo-competitive', description: 'Track competitor moves and positioning' },
  ],
  CTO: [
    { label: 'Review open PRs', template: 'cto-pr-review', description: 'Prioritise and flag pull requests by risk' },
    { label: 'Incident summary', template: 'cto-incident', description: 'Triage recent errors and draft post-mortems' },
    { label: 'Architecture doc', template: 'cto-arch-doc', description: 'Auto-generate up-to-date system overview' },
  ],
  CMO: [
    { label: 'Campaign performance', template: 'cmo-campaign', description: 'Analyse and optimise marketing campaigns' },
    { label: 'Competitor research', template: 'cmo-competitors', description: 'Track and respond to competitor marketing' },
    { label: 'Lead gen report', template: 'cmo-leads', description: 'Find, enrich, and reach out to prospects' },
  ],
  ENGINEER: [
    { label: 'Triage bug queue', template: 'eng-triage', description: 'Prioritise GitHub issues by severity' },
    { label: 'Draft PR description', template: 'eng-pr-draft', description: 'Generate clear PR docs from your changes' },
    { label: 'Update docs', template: 'eng-docs', description: 'Keep docs in sync with recent code changes' },
  ],
  HR: [
    { label: 'Screen applicants', template: 'hr-screening', description: 'Score and rank job applications' },
    { label: 'Onboarding checklist', template: 'hr-onboarding', description: 'Personalised new hire checklist' },
    { label: 'Performance reviews', template: 'hr-reviews', description: 'Prepare review cycle with team summaries' },
  ],
  FINANCE: [
    { label: 'Monthly P&L report', template: 'fin-pnl', description: 'Summarise financials and flag variances' },
    { label: 'Invoice summary', template: 'fin-invoices', description: 'Chase overdue payments with drafted emails' },
    { label: 'Budget forecast', template: 'fin-forecast', description: '90-day cash flow forecast and risk flags' },
  ],
  SALES: [
    { label: 'Pipeline review', template: 'sales-pipeline', description: 'Focus on highest-value deals this week' },
    { label: 'Lead gen', template: 'cmo-leads', description: 'Find and enrich new prospects' },
    { label: 'Competitive intel', template: 'ceo-competitive', description: 'Track competitor moves' },
  ],
  OPERATIONS: [
    { label: 'Bottleneck analysis', template: 'ops-bottlenecks', description: 'Find and fix workflow bottlenecks' },
    { label: 'Lead gen', template: 'cmo-leads', description: 'Find and enrich prospects' },
    { label: 'Weekly report', template: 'ceo-board-summary', description: 'Ops weekly summary' },
  ],
  OTHER: [
    { label: 'Research task', template: 'ceo-competitive', description: 'Deep research on any topic' },
    { label: 'Draft communication', template: 'ceo-board-summary', description: 'Write a professional summary' },
    { label: 'Data analysis', template: 'fin-pnl', description: 'Analyse data and surface insights' },
  ],
};
