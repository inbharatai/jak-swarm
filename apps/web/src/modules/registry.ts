import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Home,
  LayoutDashboard,
  Code2,
  Network,
  FileText,
  BarChart3,
  Zap,
  BookOpen,
  Plug,
  Clock,
  Settings,
  ShieldCheck,
  Crown,
  Megaphone,
  Users,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ModuleCategory = 'WORK' | 'OBSERVE' | 'CONFIGURE' | 'ADMIN';

export interface ModuleDefinition {
  id: string;
  title: string;
  shortTitle: string;
  icon: LucideIcon;
  category: ModuleCategory;
  component: React.LazyExoticComponent<React.ComponentType<ModuleProps>>;
  defaultSize: { width: number; height: number };
  singleton: boolean;
  description: string;
  adminOnly?: boolean;
}

export interface ModuleProps {
  moduleId: string;
  isActive: boolean;
}

// ─── Category metadata ───────────────────────────────────────────────────────

export const CATEGORY_META: Record<ModuleCategory, { label: string; color: string; dotColor: string }> = {
  WORK:      { label: 'Work',      color: 'text-emerald-400', dotColor: 'bg-emerald-500' },
  OBSERVE:   { label: 'Observe',   color: 'text-amber-400',   dotColor: 'bg-amber-500' },
  CONFIGURE: { label: 'Configure', color: 'text-pink-400',    dotColor: 'bg-pink-400' },
  ADMIN:     { label: 'Admin',     color: 'text-red-400',     dotColor: 'bg-red-500' },
};

export const CATEGORY_ORDER: ModuleCategory[] = ['WORK', 'OBSERVE', 'CONFIGURE', 'ADMIN'];

// ─── Module lazy imports ─────────────────────────────────────────────────────

const lazyModule = (importFn: () => Promise<{ default: React.ComponentType<ModuleProps> }>) =>
  React.lazy(importFn);

// ─── Registry ────────────────────────────────────────────────────────────────

export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  // ── WORK ──
  {
    id: 'dashboard-home',
    title: 'Dashboard Home',
    shortTitle: 'Home',
    icon: Home,
    category: 'WORK',
    component: lazyModule(() => import('@/modules/dashboard-home')),
    defaultSize: { width: 800, height: 600 },
    singleton: true,
    description: 'Activity feed, running workflows, and quick actions',
  },
  {
    id: 'command-center',
    title: 'Command Center',
    shortTitle: 'Command',
    icon: LayoutDashboard,
    category: 'WORK',
    component: lazyModule(() => import('@/modules/command-center')),
    defaultSize: { width: 1000, height: 700 },
    singleton: true,
    description: 'Issue commands to your agent swarm',
  },
  {
    id: 'live-coding',
    title: 'Live Coding',
    shortTitle: 'Builder',
    icon: Code2,
    category: 'WORK',
    component: lazyModule(() => import('@/modules/live-coding')),
    defaultSize: { width: 1000, height: 700 },
    singleton: true,
    description: 'Build full-stack apps with AI agents',
  },
  {
    id: 'schedules',
    title: 'Schedules',
    shortTitle: 'Schedules',
    icon: Clock,
    category: 'WORK',
    component: lazyModule(() => import('@/modules/schedules')),
    defaultSize: { width: 700, height: 500 },
    singleton: true,
    description: 'Schedule recurring workflow executions',
  },
  {
    id: 'ceo-strategist',
    title: 'CEO / Strategist',
    shortTitle: 'CEO',
    icon: Crown,
    category: 'WORK',
    component: lazyModule(() => import('@/modules/ceo-strategist')),
    defaultSize: { width: 900, height: 650 },
    singleton: true,
    description: 'High-level business strategy and mission planning',
  },
  {
    id: 'cmo-marketing',
    title: 'CMO / Marketing',
    shortTitle: 'Marketing',
    icon: Megaphone,
    category: 'WORK',
    component: lazyModule(() => import('@/modules/cmo-marketing')),
    defaultSize: { width: 900, height: 650 },
    singleton: true,
    description: 'Campaign planner, content calendar, SEO dashboard',
  },
  {
    id: 'crm-sales',
    title: 'CRM / Sales',
    shortTitle: 'CRM',
    icon: Users,
    category: 'WORK',
    component: lazyModule(() => import('@/modules/crm-sales')),
    defaultSize: { width: 900, height: 650 },
    singleton: true,
    description: 'Contact management, deal pipeline, AI recommendations',
  },

  // ── OBSERVE ──
  {
    id: 'swarm-monitor',
    title: 'Swarm Monitor',
    shortTitle: 'Swarm',
    icon: Network,
    category: 'OBSERVE',
    component: lazyModule(() => import('@/modules/swarm-monitor')),
    defaultSize: { width: 900, height: 600 },
    singleton: true,
    description: 'Real-time agent swarm visualization and monitoring',
  },
  {
    id: 'terminal-logs',
    title: 'Terminal / Logs',
    shortTitle: 'Logs',
    icon: FileText,
    category: 'OBSERVE',
    component: lazyModule(() => import('@/modules/terminal-logs')),
    defaultSize: { width: 800, height: 500 },
    singleton: true,
    description: 'Execution traces, agent logs, and debugging',
  },
  {
    id: 'analytics',
    title: 'Analytics',
    shortTitle: 'Analytics',
    icon: BarChart3,
    category: 'OBSERVE',
    component: lazyModule(() => import('@/modules/analytics')),
    defaultSize: { width: 800, height: 600 },
    singleton: true,
    description: 'Usage metrics, cost tracking, performance graphs',
  },

  // ── CONFIGURE ──
  {
    id: 'integrations',
    title: 'Integrations',
    shortTitle: 'Integrations',
    icon: Plug,
    category: 'CONFIGURE',
    component: lazyModule(() => import('@/modules/integrations')),
    defaultSize: { width: 750, height: 550 },
    singleton: true,
    description: 'Connect Gmail, Slack, GitHub, Notion, and more',
  },
  {
    id: 'knowledge',
    title: 'Knowledge Base',
    shortTitle: 'Knowledge',
    icon: BookOpen,
    category: 'CONFIGURE',
    component: lazyModule(() => import('@/modules/knowledge')),
    defaultSize: { width: 750, height: 550 },
    singleton: true,
    description: 'RAG context management and document uploads',
  },
  {
    id: 'skills',
    title: 'Skills',
    shortTitle: 'Skills',
    icon: Zap,
    category: 'CONFIGURE',
    component: lazyModule(() => import('@/modules/skills')),
    defaultSize: { width: 750, height: 550 },
    singleton: true,
    description: 'Skill marketplace and custom skill management',
  },
  {
    id: 'settings',
    title: 'LLM Settings',
    shortTitle: 'Settings',
    icon: Settings,
    category: 'CONFIGURE',
    component: lazyModule(() => import('@/modules/settings')),
    defaultSize: { width: 700, height: 500 },
    singleton: true,
    description: 'LLM provider configuration and model selection',
  },

  // ── ADMIN ──
  {
    id: 'admin',
    title: 'Admin Console',
    shortTitle: 'Admin',
    icon: ShieldCheck,
    category: 'ADMIN',
    component: lazyModule(() => import('@/modules/admin')),
    defaultSize: { width: 900, height: 650 },
    singleton: true,
    adminOnly: true,
    description: 'Tenant settings, user management, API keys',
  },
];

// ─── Lookup helpers ──────────────────────────────────────────────────────────

export const moduleRegistry = new Map<string, ModuleDefinition>(
  MODULE_DEFINITIONS.map(m => [m.id, m]),
);

export function getModule(id: string): ModuleDefinition | undefined {
  return moduleRegistry.get(id);
}

export function getModulesByCategory(category: ModuleCategory): ModuleDefinition[] {
  return MODULE_DEFINITIONS.filter(m => m.category === category);
}

// ─── Layout presets ──────────────────────────────────────────────────────────

export type LayoutPreset = {
  id: string;
  name: string;
  description: string;
  modules: string[];
  layoutTree: any;
};

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'ceo-view',
    name: 'CEO View',
    description: 'Strategy, swarm monitoring, and analytics',
    modules: ['ceo-strategist', 'swarm-monitor', 'analytics'],
    layoutTree: {
      type: 'split',
      direction: 'row',
      children: [
        'ceo-strategist',
        {
          type: 'split',
          direction: 'column',
          children: ['swarm-monitor', 'analytics'],
          splitPercentages: [55, 45],
        },
      ],
      splitPercentages: [45, 55],
    },
  },
  {
    id: 'dev-view',
    name: 'Dev View',
    description: 'Live coding, terminal, and swarm monitor',
    modules: ['live-coding', 'terminal-logs', 'swarm-monitor'],
    layoutTree: {
      type: 'split',
      direction: 'row',
      children: [
        'live-coding',
        {
          type: 'split',
          direction: 'column',
          children: ['swarm-monitor', 'terminal-logs'],
          splitPercentages: [50, 50],
        },
      ],
      splitPercentages: [55, 45],
    },
  },
  {
    id: 'marketing-view',
    name: 'Marketing View',
    description: 'Campaign planning, analytics, and CRM',
    modules: ['cmo-marketing', 'analytics', 'crm-sales'],
    layoutTree: {
      type: 'split',
      direction: 'row',
      children: [
        'cmo-marketing',
        {
          type: 'split',
          direction: 'column',
          children: ['analytics', 'crm-sales'],
          splitPercentages: [50, 50],
        },
      ],
      splitPercentages: [45, 55],
    },
  },
  {
    id: 'ops-view',
    name: 'Ops View',
    description: 'Command center, swarm monitor, and logs',
    modules: ['command-center', 'swarm-monitor', 'terminal-logs'],
    layoutTree: {
      type: 'split',
      direction: 'row',
      children: [
        'command-center',
        {
          type: 'split',
          direction: 'column',
          children: ['swarm-monitor', 'terminal-logs'],
          splitPercentages: [55, 45],
        },
      ],
      splitPercentages: [45, 55],
    },
  },
];
