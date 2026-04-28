'use client';

/**
 * ChatSidebar — 5-icon zone rail (Sprint S1 of the Cockpit-First Simplification).
 *
 * The previous sidebar packed 15 nav entries + 8 role toggles + the recent-
 * conversations list into a 280px panel. Layman-feedback called out that
 * non-technical users couldn't tell which entries were "safe" to click.
 *
 * This rewrite:
 *   - Collapses every nav target into 5 zones: Chat · Tasks · Files · Setup · Audit.
 *   - Each zone icon links to its primary route. Cmd+K palette
 *     (`CommandPalette.tsx`) reaches every other route — nothing is removed,
 *     just reorganized.
 *   - Recent-conversations list is still reachable: clicking the Chat zone
 *     icon while already on `/workspace` opens a popover with the convo
 *     history. While not on /workspace, the same icon navigates to /workspace.
 *   - Role gates exactly mirror the prior sidebar: Audit appears only for
 *     REVIEWER+ users; Admin/Platform are reachable via palette only (the
 *     icon rail does not crowd a layman with admin-only zones).
 *   - The 8 role toggles ("Functions") were duplicated with the in-cockpit
 *     `RolePicker`. They are removed here to avoid two sources of truth —
 *     the cockpit RolePicker remains the only role surface.
 *
 * Mobile: when `sidebarCollapsed === false`, the rail expands into an
 * overlay drawer with labels visible; otherwise it's hidden behind the
 * TopBar toggle. Desktop: always-visible 56px rail when expanded.
 */

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  FileText,
  LogOut,
  MessageSquare,
  Network,
  Plug,
  ScrollText,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { useConversationStore } from '@/store/conversation-store';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useAuth } from '@/lib/auth';
import { getRoleColor } from '@/lib/role-config';

// ─── Zone registry ─────────────────────────────────────────────────────────
// Five top-level zones. Every other dashboard page is reachable via the
// CommandPalette (Cmd+K). The `match` array decides which zone is highlighted
// for the current pathname — overlaps are resolved in registry order, so
// `/workspace` belongs to Chat even though it's also matched by other entries.

interface Zone {
  id: 'chat' | 'tasks' | 'files' | 'setup' | 'audit';
  label: string;
  href: string;
  icon: LucideIcon;
  /** Pathname prefixes that count as "in this zone" for active-state highlighting. */
  match: string[];
  /** If set, the zone only renders for users with this role gate. */
  gate?: 'reviewerOrAdmin';
}

const ZONES: Zone[] = [
  { id: 'chat', label: 'Chat', href: '/workspace', icon: MessageSquare, match: ['/workspace', '/home', '/inbox', '/social'] },
  { id: 'tasks', label: 'Tasks', href: '/swarm', icon: Network, match: ['/swarm', '/traces', '/analytics', '/schedules', '/calendar'] },
  { id: 'files', label: 'Files', href: '/files', icon: FileText, match: ['/files', '/knowledge'] },
  { id: 'setup', label: 'Setup', href: '/integrations', icon: Plug, match: ['/integrations', '/skills', '/builder', '/settings', '/billing'] },
  { id: 'audit', label: 'Audit', href: '/audit', icon: ScrollText, match: ['/audit', '/admin'], gate: 'reviewerOrAdmin' },
];

// ─── Sidebar ───────────────────────────────────────────────────────────────

export function ChatSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const collapsed = useConversationStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useConversationStore((s) => s.setSidebarCollapsed);
  const conversations = useConversationStore((s) => s.conversations);
  const activeConversationId = useConversationStore((s) => s.activeConversationId);
  const switchConversation = useConversationStore((s) => s.switchConversation);
  const createConversation = useConversationStore((s) => s.createConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const isMobile = useMediaQuery('(max-width: 767px)');

  // Same string-tolerant role logic as before — Supabase user_metadata can
  // carry legacy role strings ('ADMIN' from older register flows) that
  // don't match the current UserRole enum exactly.
  const roleStr = String(user?.role ?? '');
  const isAdmin = roleStr === 'TENANT_ADMIN' || roleStr === 'SYSTEM_ADMIN' || roleStr === 'ADMIN';
  const isReviewerOrAdmin = isAdmin || roleStr === 'REVIEWER' || roleStr === 'OPERATOR';

  const visibleZones = ZONES.filter((zone) => {
    if (zone.gate === 'reviewerOrAdmin' && !isReviewerOrAdmin) return false;
    return true;
  });

  // Recent-conversations popover: opens when the user clicks the Chat zone
  // while already on /workspace. Anchored to the Chat icon, dismissed on
  // outside click + Escape.
  const [convoPopoverOpen, setConvoPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!convoPopoverOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setConvoPopoverOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConvoPopoverOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [convoPopoverOpen]);

  // Auto-close mobile sidebar on navigation (preserved from prior behavior).
  useEffect(() => {
    if (isMobile) {
      setSidebarCollapsed(true);
    }
  }, [pathname, isMobile, setSidebarCollapsed]);

  // Close mobile sidebar on Escape.
  useEffect(() => {
    if (collapsed || !isMobile) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarCollapsed(true);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [collapsed, isMobile, setSidebarCollapsed]);

  const handleSignOut = React.useCallback(async () => {
    try {
      await logout();
    } catch {
      // Even if signOut throws, push to /login so UX doesn't get stuck.
    }
    router.push('/login');
    router.refresh();
  }, [logout, router]);

  const handleZoneClick = (zone: Zone) => (e: React.MouseEvent) => {
    // Special case: clicking the Chat zone while already on a chat page
    // opens the recent-conversations popover instead of re-navigating.
    if (zone.id === 'chat' && (pathname?.startsWith('/workspace') || pathname?.startsWith('/home'))) {
      e.preventDefault();
      setConvoPopoverOpen((v) => !v);
      return;
    }
    if (isMobile) setSidebarCollapsed(true);
  };

  if (collapsed) return null;

  // ─── Rail content ──────────────────────────────────────────────────────
  const railContent = (
    <div className="flex h-full flex-col items-center py-3">
      {/* Mobile close button (only on mobile drawer) */}
      {isMobile && (
        <button
          onClick={() => setSidebarCollapsed(true)}
          className="mb-2 self-end mr-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Close sidebar"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {/* New chat */}
      <button
        onClick={() => {
          createConversation();
          if (isMobile) setSidebarCollapsed(true);
          if (!pathname?.startsWith('/workspace')) router.push('/workspace');
        }}
        className={cn(
          'group relative mb-3 flex h-10 w-10 items-center justify-center rounded-lg',
          'bg-primary text-primary-foreground hover:opacity-90 transition-opacity',
        )}
        aria-label="New chat"
        title="New chat"
      >
        <MessageSquare className="h-4 w-4" />
        <span className="absolute left-full ml-2 hidden whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
          New chat
        </span>
      </button>

      {/* Zone rail */}
      <nav className="flex flex-col gap-1" aria-label="Primary zones">
        {visibleZones.map((zone) => {
          const Icon = zone.icon;
          const isActive = zone.match.some((m) => pathname?.startsWith(m));
          return (
            <div key={zone.id} className="relative">
              <Link
                href={zone.href}
                onClick={handleZoneClick(zone)}
                className={cn(
                  'group flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
                aria-label={zone.label}
                aria-current={isActive ? 'page' : undefined}
                title={zone.label}
              >
                <Icon className="h-4 w-4" />
                <span className="absolute left-full ml-2 z-50 hidden whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
                  {zone.label}
                </span>
              </Link>

              {/* Recent-conversations popover, anchored next to the Chat icon */}
              {zone.id === 'chat' && convoPopoverOpen && (
                <div
                  ref={popoverRef}
                  className="absolute left-full ml-2 top-0 z-[150] w-72 rounded-lg border border-border bg-card shadow-2xl"
                  role="dialog"
                  aria-label="Recent conversations"
                >
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Recent conversations
                    </span>
                    <button
                      onClick={() => setConvoPopoverOpen(false)}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      aria-label="Close"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto py-1">
                    {conversations.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-muted-foreground/70">
                        No conversations yet. Start a new chat.
                      </p>
                    ) : (
                      conversations.slice(0, 20).map((conv) => (
                        <div
                          key={conv.id}
                          className={cn(
                            'group/conv flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors',
                            conv.id === activeConversationId
                              ? 'bg-muted text-foreground'
                              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                          )}
                        >
                          <button
                            onClick={() => {
                              switchConversation(conv.id);
                              setConvoPopoverOpen(false);
                              if (!pathname?.startsWith('/workspace')) router.push('/workspace');
                            }}
                            className="flex flex-1 items-center gap-2 min-w-0 text-left"
                          >
                            <MessageSquare className="h-3 w-3 shrink-0" />
                            <span className="truncate">{conv.title}</span>
                          </button>
                          <div className="flex shrink-0 gap-0.5">
                            {conv.roles.slice(0, 3).map((r) => (
                              <span
                                key={r}
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: getRoleColor(r).base }}
                              />
                            ))}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteConversation(conv.id);
                            }}
                            className="ml-0.5 hidden shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors group-hover/conv:block"
                            aria-label={`Delete conversation: ${conv.title}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Spacer pushes footer icons to the bottom */}
      <div className="flex-1" />

      {/* Footer: Settings + Sign out */}
      <div className="flex flex-col gap-1">
        <Link
          href="/settings"
          className="group flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
          <span className="absolute left-full ml-2 hidden whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
            Settings
          </span>
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="group flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
          <span className="absolute left-full ml-2 hidden whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
            Sign out
          </span>
        </button>
      </div>
    </div>
  );

  // Mobile: overlay drawer with backdrop (preserves prior behavior)
  if (isMobile) {
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setSidebarCollapsed(true)}
          aria-hidden
        />
        <aside className="chat-sidebar fixed inset-y-0 left-0 z-50 w-[64px] shadow-2xl bg-background border-r border-border">
          {railContent}
        </aside>
      </>
    );
  }

  // Desktop: 56-64px always-visible rail
  return (
    <aside className="chat-sidebar w-[64px] shrink-0 border-r border-border bg-background overflow-visible">
      {railContent}
    </aside>
  );
}
