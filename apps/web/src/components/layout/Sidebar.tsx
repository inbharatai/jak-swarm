'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Home,
  LayoutDashboard,
  Network,
  FileText,
  BarChart3,
  BookOpen,
  ShieldCheck,
  Settings,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Zap,
  Plug,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { Avatar, Badge } from '@/components/ui';

type NavGroup = 'WORK' | 'OBSERVE' | 'CONFIGURE' | 'ADMIN';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: NavGroup;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  // WORK
  { label: 'Home',         href: '/home',         icon: Home,          group: 'WORK' },
  { label: 'Workspace',    href: '/workspace',    icon: LayoutDashboard, group: 'WORK' },
  { label: 'Schedules',    href: '/schedules',    icon: Clock,           group: 'WORK' },
  // OBSERVE
  { label: 'Swarm',        href: '/swarm',        icon: Network,       group: 'OBSERVE' },
  { label: 'Traces',       href: '/traces',       icon: FileText,      group: 'OBSERVE' },
  { label: 'Analytics',    href: '/analytics',    icon: BarChart3,     group: 'OBSERVE' },
  // CONFIGURE
  { label: 'Integrations', href: '/integrations', icon: Plug,          group: 'CONFIGURE' },
  { label: 'Knowledge',    href: '/knowledge',    icon: BookOpen,      group: 'CONFIGURE' },
  // ADMIN
  { label: 'Admin',        href: '/admin',        icon: ShieldCheck,   group: 'ADMIN', adminOnly: true },
];

const GROUP_LABELS: Record<NavGroup, string> = {
  WORK: 'Work',
  OBSERVE: 'Observe',
  CONFIGURE: 'Configure',
  ADMIN: 'Admin',
};

const GROUP_DOT_COLORS: Record<NavGroup, string> = {
  WORK: 'bg-blue-500',
  OBSERVE: 'bg-emerald-500',
  CONFIGURE: 'bg-purple-500',
  ADMIN: 'bg-amber-500',
};

const GROUP_ORDER: NavGroup[] = ['WORK', 'OBSERVE', 'CONFIGURE', 'ADMIN'];

const INDUSTRY_LABELS: Record<string, string> = {
  FINANCE: 'Finance',
  HEALTHCARE: 'Healthcare',
  LEGAL: 'Legal',
  RETAIL: 'Retail',
  LOGISTICS: 'Logistics',
  MANUFACTURING: 'Manufacturing',
  TECHNOLOGY: 'Technology',
  REAL_ESTATE: 'Real Estate',
  EDUCATION: 'Education',
  HOSPITALITY: 'Hospitality',
};

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();

  const visibleItems = NAV_ITEMS.filter(
    item => !item.adminOnly || user?.role === 'TENANT_ADMIN',
  );

  // Group items by group field
  const groupedItems = GROUP_ORDER.reduce<Record<NavGroup, NavItem[]>>(
    (acc, group) => {
      acc[group] = visibleItems.filter(item => item.group === group);
      return acc;
    },
    { WORK: [], OBSERVE: [], CONFIGURE: [], ADMIN: [] },
  );

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn('flex items-center border-b p-4', collapsed ? 'justify-center' : 'gap-3')}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary drop-shadow-[0_0_8px_rgba(59,130,246,0.4)]">
          <Zap className="h-4 w-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div>
            <span className="text-sm font-bold text-primary drop-shadow-[0_0_8px_rgba(59,130,246,0.4)]">JAK Swarm</span>
            <p className="text-xs text-muted-foreground">Agent Platform</p>
          </div>
        )}
      </div>

      {/* Nav items grouped */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-4">
        {GROUP_ORDER.map(group => {
          const items = groupedItems[group];
          if (items.length === 0) return null;
          return (
            <div key={group}>
              {!collapsed && (
                <p className="flex items-center px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span className={cn('inline-block w-1.5 h-1.5 rounded-full mr-2', GROUP_DOT_COLORS[group])} />
                  {GROUP_LABELS[group]}
                </p>
              )}
              <div className="space-y-1">
                {items.map(item => {
                  const isActive = pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all',
                        collapsed ? 'justify-center' : '',
                        isActive
                          ? 'nav-active bg-primary/10 text-primary font-medium'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Industry badge */}
      {!collapsed && user?.industry && (
        <div className="border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Industry</span>
            <Badge variant="secondary" className="text-xs">
              {INDUSTRY_LABELS[user.industry] ?? user.industry}
            </Badge>
          </div>
        </div>
      )}

      {/* Bottom section */}
      <div className={cn('border-t p-3 space-y-1')}>
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors',
            collapsed ? 'justify-center' : '',
          )}
          title={collapsed ? 'Toggle theme' : undefined}
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4 shrink-0" />
          ) : (
            <Moon className="h-4 w-4 shrink-0" />
          )}
          {!collapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>

        {/* Settings */}
        <Link
          href="/settings"
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors',
            collapsed ? 'justify-center' : '',
          )}
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>

        {/* User info */}
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2',
            collapsed ? 'justify-center' : '',
          )}
        >
          <Avatar name={user?.name} size="sm" className="shrink-0" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{user?.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              {user?.jobFunction && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {user.jobFunction}
                </span>
              )}
            </div>
          )}
          {!collapsed && (
            <button
              onClick={logout}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Out
            </button>
          )}
        </div>
      </div>

      {/* Collapse toggle (desktop) */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full border bg-background p-1 shadow-sm md:flex"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronLeft className="h-3 w-3" />
        )}
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="fixed left-4 top-4 z-50 rounded-md border bg-background p-2 md:hidden"
        onClick={() => setMobileOpen(true)}
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 border-r bg-card transition-transform duration-300 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <button
          className="absolute right-3 top-3 p-1 text-muted-foreground hover:text-foreground"
          onClick={() => setMobileOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>
        <SidebarContent />
      </div>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'relative hidden flex-shrink-0 border-r border-border/50 bg-background/95 backdrop-blur-sm transition-all duration-300 md:block',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <SidebarContent />
      </aside>
    </>
  );
}
