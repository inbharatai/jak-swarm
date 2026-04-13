'use client';

import React from 'react';
import { X, Bell, Sun, Moon, Layout, Search, StopCircle, ChevronDown } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/cn';
import { useShellStore } from '@/store/shell-store';
import { useNotificationStore } from '@/store/notification-store';
import { getModule, LAYOUT_PRESETS } from '@/modules/registry';
import { useAuth } from '@/lib/auth';
import { UsageIndicator } from '@/components/billing/UsageIndicator';
import { Avatar, Badge, Button } from '@/components/ui';
import { useApprovals } from '@/hooks/useWorkflow';
import { workflowApi } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';

// ─── Module Tabs ─────────────────────────────────────────────────────────────

function ModuleTab({ moduleId }: { moduleId: string }) {
  const moduleDef = getModule(moduleId);
  const activeModuleId = useShellStore(s => s.activeModuleId);
  const setActiveModule = useShellStore(s => s.setActiveModule);
  const closeModule = useShellStore(s => s.closeModule);
  const minimizedModules = useShellStore(s => s.minimizedModules);

  if (!moduleDef) return null;

  const isActive = activeModuleId === moduleId;
  const isMinimized = minimizedModules.has(moduleId);
  const Icon = moduleDef.icon;

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs font-medium transition-all whitespace-nowrap',
        isActive
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/50 hover:text-foreground',
        isMinimized && 'opacity-50 italic',
      )}
    >
      <button
        type="button"
        onClick={() => setActiveModule(moduleId)}
        onAuxClick={(e) => { if (e.button === 1) closeModule(moduleId); }}
        aria-label={`Open ${moduleDef.title}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{moduleDef.shortTitle}</span>
      </button>
      <button
        type="button"
        aria-label={`Close ${moduleDef.shortTitle}`}
        onClick={() => closeModule(moduleId)}
        className="rounded-sm p-0.5 opacity-0 transition-all hover:bg-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

// ─── Notification Bell ───────────────────────────────────────────────────────

function NotificationBell() {
  const { unreadCount, toggle } = useNotificationStore();

  return (
    <button
      onClick={toggle}
      aria-label="Open notifications"
      className="relative p-2 rounded-lg hover:bg-muted/50 transition-colors"
      title={`${unreadCount} unread notifications`}
    >
      <Bell className="h-4 w-4 text-muted-foreground" />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
}

// ─── Layout Preset Selector ─────────────────────────────────────────────────

function PresetSelector() {
  const [open, setOpen] = React.useState(false);
  const applyPreset = useShellStore(s => s.applyPreset);

  const handleApply = (preset: typeof LAYOUT_PRESETS[0]) => {
    applyPreset(preset.modules, preset.layoutTree);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        title="Layout presets"
      >
        <Layout className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">Layouts</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-[61] w-64 rounded-lg border bg-popover p-1.5 shadow-xl">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Preset Layouts
            </p>
            {LAYOUT_PRESETS.map(preset => (
              <button
                key={preset.id}
                onClick={() => handleApply(preset)}
                className="w-full text-left px-2 py-2 rounded-md hover:bg-accent transition-colors"
              >
                <p className="text-xs font-medium">{preset.name}</p>
                <p className="text-[10px] text-muted-foreground">{preset.description}</p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Shell Header ────────────────────────────────────────────────────────────

export function ShellHeader() {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const { pendingCount } = useApprovals();
  const openModules = useShellStore(s => s.openModules);
  const toast = useToast();
  const [isKilling, setIsKilling] = React.useState(false);
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);

  const openModuleIds = Array.from(openModules.keys());

  const handleKillAll = async () => {
    if (!confirm('Stop ALL running workflows? This cannot be undone.')) return;
    setIsKilling(true);
    try {
      await workflowApi.stopAll();
    } catch (err) {
      toast.error('Failed to stop workflows', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setIsKilling(false);
    }
  };

  return (
    <header className="flex h-12 items-center border-b border-border/40 bg-background/80 backdrop-blur-xl px-3 gap-3 shrink-0">
      {/* Module tabs - scrollable */}
      <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto scrollbar-none">
        {openModuleIds.length === 0 ? (
          <span className="px-2 text-xs text-muted-foreground">Open a module from the dock to begin.</span>
        ) : (
          openModuleIds.map(id => (
            <ModuleTab key={id} moduleId={id} />
          ))
        )}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Search trigger — opens command center */}
        <button
          onClick={() => useShellStore.getState().openModule('command-center')}
          aria-label="Open command center"
          className="flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Command Center</span>
        </button>

        <PresetSelector />

        {/* Usage credits indicator */}
        <UsageIndicator />

        {/* Kill all */}
        <Button
          variant="destructive"
          size="sm"
          onClick={handleKillAll}
          disabled={isKilling}
          className="gap-1 h-7 text-xs px-2"
        >
          <StopCircle className="h-3 w-3" />
          <span className="hidden sm:inline">Kill All</span>
        </Button>

        {/* Approvals badge */}
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={() => useShellStore.getState().openModule('command-center')}
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-700 transition-colors hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300"
          >
            {pendingCount} pending
          </button>
        )}

        <NotificationBell />

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="p-2 rounded-lg hover:bg-muted/50 transition-colors"
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Moon className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            aria-label="Open user menu"
            className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted/50 transition-colors"
          >
            <Avatar name={user?.name} size="sm" />
          </button>

          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setUserMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-[61] w-52 rounded-lg border bg-popover p-1.5 shadow-xl">
                <div className="px-3 py-2 border-b border-border/40 mb-1">
                  <p className="text-xs font-medium">{user?.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{user?.email}</p>
                </div>
                <button
                  onClick={() => { logout(); setUserMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
