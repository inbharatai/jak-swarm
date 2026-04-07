'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Sun,
  Moon,
  Bell,
  StopCircle,
  ChevronDown,
  User,
  LogOut,
  Settings,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { useApprovals } from '@/hooks/useWorkflow';
import { workflowApi } from '@/lib/api-client';
import { Avatar, Badge, Button } from '@/components/ui';

const ROUTE_LABELS: Record<string, string> = {
  '/workspace': 'Workspace',
  '/swarm': 'Swarm Inspector',
  '/traces': 'Trace Viewer',
  '/knowledge': 'Knowledge Console',
  '/admin': 'Admin Console',
  '/settings': 'Settings',
};

export function Header() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const { pendingCount } = useApprovals();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isKilling, setIsKilling] = useState(false);

  const pageTitle = ROUTE_LABELS[pathname] ?? 'JAK Swarm';
  const showBreadcrumb = pathname !== '/home' && ROUTE_LABELS[pathname];

  const handleKillAll = async () => {
    if (!confirm('Stop ALL running workflows? This cannot be undone.')) return;
    setIsKilling(true);
    try {
      await workflowApi.stopAll();
    } catch {
      // ignore
    } finally {
      setIsKilling(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border/50 bg-background/80 backdrop-blur-xl px-4 md:px-6">
      {/* Page title / breadcrumb */}
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-display font-bold tracking-tight truncate">
          {showBreadcrumb && (
            <>
              <Link href="/home" className="text-muted-foreground hover:text-foreground transition-colors">Home</Link>
              <span className="text-muted-foreground mx-2 font-sans text-sm">/</span>
            </>
          )}
          {pageTitle}
        </h1>
      </div>

      {/* Cmd+K Search Trigger */}
      <button
        onClick={() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })); }}
        className="hidden sm:flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
        aria-label="Search (Cmd+K)"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search</span>
        <kbd className="ml-2 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-[10px] font-mono">⌘K</kbd>
      </button>

      <div className="flex items-center gap-2">
        {/* Emergency Kill All */}
        <Button
          variant="destructive"
          size="sm"
          onClick={handleKillAll}
          disabled={isKilling}
          className="gap-1.5 font-semibold"
          title="Stop all running workflows immediately"
        >
          <StopCircle className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Kill All</span>
        </Button>

        {/* Notifications Bell */}
        <Link
          href="/workspace"
          className="relative flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
          title="Pending approvals"
        >
          <Bell className="h-4 w-4" />
          {pendingCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 animate-pulse text-[10px] font-bold text-white">
              {pendingCount > 9 ? '9+' : pendingCount}
            </span>
          )}
        </Link>

        {/* Theme Toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title="Toggle theme"
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            <Avatar name={user?.name} size="sm" />
            <span className="hidden md:block max-w-[120px] truncate text-xs font-medium">
              {user?.name}
            </span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>

          {userMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setUserMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border bg-card shadow-lg glass-card">
                <div className="border-b px-3 py-2">
                  <p className="text-xs font-medium">{user?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                  {user?.role && (
                    <Badge variant="secondary" className="mt-1 text-[10px]">
                      {user.role}
                    </Badge>
                  )}
                </div>
                <div className="p-1">
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <User className="h-3.5 w-3.5" />
                    Profile
                  </Link>
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 rounded px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Settings
                  </Link>
                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      logout();
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors',
                    )}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Logout
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
