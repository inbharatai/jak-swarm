import type { LucideIcon } from 'lucide-react';
import { Monitor, Megaphone, Crown, Code, Search, Palette, Workflow } from 'lucide-react';

// ─── Role Definitions ────────────────────────────────────────────────────────

export type RoleId = 'cto' | 'cmo' | 'ceo' | 'coding' | 'research' | 'design' | 'automation';

/**
 * Canonical `AgentRole` string each UX role maps to. The dashboard role picker
 * is a UX abstraction; the runtime executes against an `AgentRole` enum value
 * from `packages/shared/src/types/agent.ts`. Keeping the mapping explicit here
 * (not just a prompt prepend) lets the Commander + Planner prefer the right
 * worker + the TenantToolRegistry gate tools by the selected role's declared
 * tool array instead of giving every role access to every tool.
 *
 * This is the string value of the enum, not an import, to keep this client
 * module free of agent-package imports. The backend resolves it to the
 * corresponding AgentRole enum via `packages/shared/src/types/agent.ts`.
 */
export type CanonicalAgentRole =
  | 'WORKER_TECHNICAL'
  | 'WORKER_MARKETING'
  | 'WORKER_STRATEGIST'
  | 'WORKER_CODER'
  | 'WORKER_RESEARCH'
  | 'WORKER_DESIGNER'
  | 'WORKER_OPS';

export interface RoleConfig {
  id: RoleId;
  /** Canonical runtime agent this UX role routes to. */
  canonicalAgentRole: CanonicalAgentRole;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  description: string;
  /** Short bullet list of the actual tools this role can call at runtime. */
  capabilities: string[];
  domain: string;
  examplePrompts: string[];
  /** HSL values: [hue, saturation%, lightness%] */
  color: { h: number; s: number; l: number };
}

export const ROLES: Record<RoleId, RoleConfig> = {
  cto: {
    id: 'cto',
    canonicalAgentRole: 'WORKER_TECHNICAL',
    label: 'CTO',
    shortLabel: 'CTO',
    icon: Monitor,
    description: 'Architecture, code review, and technical decisions with real repo-read access',
    capabilities: [
      'Read public + private GitHub repos (list files + read source)',
      'Review pull requests with full diff',
      'Find uploaded ADRs, design docs, code files',
      'Search the web for benchmarks and best practices',
    ],
    domain: 'Technical',
    examplePrompts: [
      'Review my repo at github.com/my-org/my-app for security issues',
      'Walk through PR #42 on my repo and flag risky changes',
      'Read our ADR on auth and suggest 3 improvements',
    ],
    color: { h: 220, s: 75, l: 55 },
  },
  cmo: {
    id: 'cmo',
    canonicalAgentRole: 'WORKER_MARKETING',
    label: 'CMO',
    shortLabel: 'CMO',
    icon: Megaphone,
    description: 'Marketing strategy, campaigns, and brand — with access to your uploaded briefs',
    capabilities: [
      'Find uploaded briefs, brand guidelines, competitor reports',
      'Search the web for market trends and competitor moves',
      'Generate structured campaign plans and reports',
    ],
    domain: 'Marketing',
    examplePrompts: [
      'Read the Q3 launch brief I uploaded and draft a GTM plan',
      'Create a go-to-market plan for our product launch',
      'Analyze competitor positioning in our market',
    ],
    color: { h: 340, s: 70, l: 60 },
  },
  ceo: {
    id: 'ceo',
    canonicalAgentRole: 'WORKER_STRATEGIST',
    label: 'CEO',
    shortLabel: 'CEO',
    icon: Crown,
    description: 'Strategy, roadmap, and cross-functional decisions informed by your real workflow data',
    capabilities: [
      'Compile executive summaries from recent workflows + traces',
      'Search internal knowledge + external market data',
      'Generate structured strategic reports',
    ],
    domain: 'Strategy',
    examplePrompts: [
      'Compile an executive summary of the last 30 days of activity',
      'Build a 90-day strategic plan for Series A',
      'Draft a board presentation for Q3 results',
    ],
    color: { h: 42, s: 85, l: 55 },
  },
  coding: {
    id: 'coding',
    canonicalAgentRole: 'WORKER_CODER',
    label: 'Coding',
    shortLabel: 'Code',
    icon: Code,
    description: 'Implementation, code generation, sandboxed execution',
    capabilities: [
      'Generate complete files from specs (no-truncation invariant)',
      'Execute JavaScript / Python in an E2B sandbox',
      'Read uploaded code files for context',
    ],
    domain: 'Engineering',
    examplePrompts: [
      'Build a REST API with authentication and rate limiting',
      'Refactor this component to use server components',
      'Write tests for the checkout flow',
    ],
    color: { h: 150, s: 70, l: 45 },
  },
  research: {
    id: 'research',
    canonicalAgentRole: 'WORKER_RESEARCH',
    label: 'Research',
    shortLabel: 'Research',
    icon: Search,
    description: 'Web + internal-knowledge research with source-quality grading',
    capabilities: [
      'Multi-provider web search (Serper → Tavily → DuckDuckGo fallback)',
      'Semantic search over your uploaded documents',
      'Tiered source quality grading (Tier 1 authoritative → Tier 3 anecdotal)',
    ],
    domain: 'Research',
    examplePrompts: [
      'Research the latest trends in AI-powered automation',
      'Compare top 5 competitors in our space',
      'Summarize this whitepaper and extract key insights',
    ],
    color: { h: 270, s: 60, l: 55 },
  },
  design: {
    id: 'design',
    canonicalAgentRole: 'WORKER_DESIGNER',
    label: 'Design',
    shortLabel: 'Design',
    icon: Palette,
    description: 'UI/UX specs, accessibility audits, component schemas',
    capabilities: [
      'Generate UI component specs with accessibility notes',
      'Produce design-system tokens (colors, typography, spacing)',
      'Read uploaded design briefs and screenshots',
    ],
    domain: 'Design',
    examplePrompts: [
      'Design a user onboarding flow for a SaaS product',
      'Create a component library spec for our design system',
      'Audit our UX for accessibility issues',
    ],
    color: { h: 175, s: 65, l: 50 },
  },
  automation: {
    id: 'automation',
    canonicalAgentRole: 'WORKER_OPS',
    label: 'Automation',
    shortLabel: 'Auto',
    icon: Workflow,
    description: 'Workflow orchestration, scheduling, and integration ops',
    capabilities: [
      'Schedule cron-based workflows',
      'Orchestrate multi-step integration pipelines',
      'Emit webhooks on workflow completion',
    ],
    domain: 'Operations',
    examplePrompts: [
      'Set up a weekly report generation workflow',
      'Create an automated lead qualification pipeline',
      'Build a monitoring alert system for our APIs',
    ],
    color: { h: 25, s: 80, l: 55 },
  },
};

export const ROLE_LIST: RoleConfig[] = Object.values(ROLES);
export const ROLE_IDS: RoleId[] = Object.keys(ROLES) as RoleId[];

// ─── Recommended Combinations ────────────────────────────────────────────────

export interface RoleCombination {
  roles: RoleId[];
  label: string;
  description: string;
}

export const RECOMMENDED_COMBOS: RoleCombination[] = [
  {
    roles: ['cto', 'coding'],
    label: 'Build & Ship',
    description: 'Architecture decisions with immediate implementation',
  },
  {
    roles: ['ceo', 'cmo'],
    label: 'Go-to-Market',
    description: 'Strategic planning with marketing execution',
  },
  {
    roles: ['cto', 'research'],
    label: 'Technical Deep Dive',
    description: 'Architecture analysis backed by evidence',
  },
  {
    roles: ['cmo', 'design'],
    label: 'Brand & Experience',
    description: 'Marketing strategy with UX/visual design',
  },
  {
    roles: ['ceo', 'cto', 'cmo'],
    label: 'Leadership Roundtable',
    description: 'Cross-functional strategic decisions',
  },
  {
    roles: ['coding', 'automation'],
    label: 'DevOps Pipeline',
    description: 'Code with automated deployment and monitoring',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getRoleColor(roleId: RoleId) {
  const { h, s, l } = ROLES[roleId].color;
  return {
    base: `hsl(${h}, ${s}%, ${l}%)`,
    muted: `hsl(${h}, ${s}%, ${l}%, 0.12)`,
    accent: `hsl(${h}, ${s}%, ${l}%, 0.25)`,
    /** CSS custom property value (without hsl wrapper) */
    raw: `${h} ${s}% ${l}%`,
  };
}

export function getRoleIcon(roleId: RoleId): LucideIcon {
  return ROLES[roleId].icon;
}

export const MAX_RECOMMENDED_ROLES = 4;
