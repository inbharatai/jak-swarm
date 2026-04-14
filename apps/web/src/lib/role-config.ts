import type { LucideIcon } from 'lucide-react';
import { Monitor, Megaphone, Crown, Code, Search, Palette, Workflow } from 'lucide-react';

// ─── Role Definitions ────────────────────────────────────────────────────────

export type RoleId = 'cto' | 'cmo' | 'ceo' | 'coding' | 'research' | 'design' | 'automation';

export interface RoleConfig {
  id: RoleId;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  description: string;
  domain: string;
  examplePrompts: string[];
  /** HSL values: [hue, saturation%, lightness%] */
  color: { h: number; s: number; l: number };
}

export const ROLES: Record<RoleId, RoleConfig> = {
  cto: {
    id: 'cto',
    label: 'CTO',
    shortLabel: 'CTO',
    icon: Monitor,
    description: 'Architecture, systems design, APIs, and debugging',
    domain: 'Technical',
    examplePrompts: [
      'Audit our API for security vulnerabilities',
      'Design a microservices architecture for payment processing',
      'Review this codebase for performance bottlenecks',
    ],
    color: { h: 220, s: 75, l: 55 },
  },
  cmo: {
    id: 'cmo',
    label: 'CMO',
    shortLabel: 'CMO',
    icon: Megaphone,
    description: 'Marketing strategy, campaigns, brand, and content',
    domain: 'Marketing',
    examplePrompts: [
      'Create a go-to-market plan for our product launch',
      'Write a LinkedIn post series about AI automation',
      'Analyze competitor positioning in our market',
    ],
    color: { h: 340, s: 70, l: 60 },
  },
  ceo: {
    id: 'ceo',
    label: 'CEO',
    shortLabel: 'CEO',
    icon: Crown,
    description: 'Strategy, roadmap, business planning, and decisions',
    domain: 'Strategy',
    examplePrompts: [
      'Build a 90-day strategic plan for Series A',
      'Evaluate our pricing model against market data',
      'Draft a board presentation for Q3 results',
    ],
    color: { h: 42, s: 85, l: 55 },
  },
  coding: {
    id: 'coding',
    label: 'Coding',
    shortLabel: 'Code',
    icon: Code,
    description: 'Implementation, code generation, and execution',
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
    label: 'Research',
    shortLabel: 'Research',
    icon: Search,
    description: 'Analysis, evidence gathering, and market intelligence',
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
    label: 'Design',
    shortLabel: 'Design',
    icon: Palette,
    description: 'UI/UX, product flows, wireframes, and visual structure',
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
    label: 'Automation',
    shortLabel: 'Auto',
    icon: Workflow,
    description: 'Workflows, triggers, scheduling, and integrations',
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
