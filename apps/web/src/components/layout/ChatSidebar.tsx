'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Plus,
  MessageSquare,
  Settings,
  CreditCard,
  Plug,
  BookOpen,
  Sparkles,
  Calendar,
  Hammer,
  BarChart3,
  Network,
  ShieldCheck,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ROLE_LIST, getRoleColor, type RoleId } from '@/lib/role-config';
import {
  useConversationStore,
} from '@/store/conversation-store';
import { useMediaQuery } from '@/hooks/useMediaQuery';

// ─── Nav Items ───────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { href: '/swarm', label: 'Runs', icon: Network },
  { href: '/schedules', label: 'Schedules', icon: Calendar },
  { href: '/builder', label: 'Builder', icon: Hammer },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { href: '/skills', label: 'Skills', icon: Sparkles },
  { href: '/admin', label: 'Admin', icon: ShieldCheck },
];

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function ChatSidebar() {
  const pathname = usePathname();
  const collapsed = useConversationStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useConversationStore((s) => s.setSidebarCollapsed);
  const conversations = useConversationStore((s) => s.conversations);
  const activeConversationId = useConversationStore((s) => s.activeConversationId);
  const switchConversation = useConversationStore((s) => s.switchConversation);
  const createConversation = useConversationStore((s) => s.createConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const activeRoles = useConversationStore((s) => s.activeRoles);
  const toggleRole = useConversationStore((s) => s.toggleRole);
  const isMobile = useMediaQuery('(max-width: 767px)');

  // Auto-close sidebar on mobile when navigating
  useEffect(() => {
    if (isMobile) {
      setSidebarCollapsed(true);
    }
  }, [pathname, isMobile, setSidebarCollapsed]);

  // Close mobile sidebar on Escape key
  useEffect(() => {
    if (collapsed || !isMobile) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarCollapsed(true);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [collapsed, isMobile, setSidebarCollapsed]);

  if (collapsed) return null;

  const sidebarContent = (
      <div className="flex h-full flex-col">
        {/* Mobile close button */}
        {isMobile && (
          <div className="flex items-center justify-between px-3 pt-3">
            <span className="font-display text-sm font-bold tracking-tight text-foreground">
              JAK<span className="text-primary ml-0.5">Swarm</span>
            </span>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Close sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* New Chat Button */}
        <div className="p-3">
          <button
            onClick={() => { createConversation(); if (isMobile) setSidebarCollapsed(true); }}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium',
              'bg-background hover:bg-muted text-foreground transition-colors',
            )}
          >
            <Plus className="h-4 w-4" />
            New chat
          </button>
        </div>

        {/* Recent Conversations */}
        <div className="flex-1 overflow-y-auto px-2">
          <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Recent
          </div>
          <div className="space-y-0.5">
            {conversations.slice(0, 20).map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  'group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
                  conv.id === activeConversationId
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <button
                  onClick={() => { switchConversation(conv.id); if (isMobile) setSidebarCollapsed(true); }}
                  className="flex flex-1 items-center gap-2 min-w-0"
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{conv.title}</span>
                </button>
                {/* Role color dots */}
                <div className="flex shrink-0 gap-0.5">
                  {conv.roles.slice(0, 3).map((r) => (
                    <span
                      key={r}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: getRoleColor(r).base }}
                    />
                  ))}
                </div>
                {/* Delete button — visible on hover */}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                  className="ml-0.5 hidden shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors group-hover:block"
                  aria-label={`Delete conversation: ${conv.title}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {conversations.length === 0 && (
              <p className="px-2.5 py-3 text-xs text-muted-foreground/60">
                No conversations yet. Start a new chat.
              </p>
            )}
          </div>

          {/* Roles / Functions */}
          <div className="mt-4 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Functions
          </div>
          <div className="space-y-0.5">
            {ROLE_LIST.map((role) => {
              const color = getRoleColor(role.id);
              const isActive = activeRoles.includes(role.id);
              const Icon = role.icon;
              return (
                <button
                  key={role.id}
                  onClick={() => toggleRole(role.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-all',
                    isActive
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  style={isActive ? { backgroundColor: color.muted } : undefined}
                >
                  <Icon
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: color.base }}
                  />
                  <span className="truncate">{role.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{role.domain}</span>
                </button>
              );
            })}
          </div>

          {/* Navigation */}
          <div className="mt-4 border-t border-border pt-3 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Navigate
          </div>
          <div className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Bottom: Settings + Billing */}
        <div className="border-t border-border p-2 space-y-0.5">
          <Link
            href="/settings"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </Link>
          <Link
            href="/settings?tab=billing"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <CreditCard className="h-3.5 w-3.5" />
            Billing
          </Link>
        </div>
      </div>
  );

  // Mobile: overlay with backdrop
  if (isMobile) {
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setSidebarCollapsed(true)}
          aria-hidden
        />
        <aside className="chat-sidebar fixed inset-y-0 left-0 z-50 w-[280px] shadow-2xl">
          {sidebarContent}
        </aside>
      </>
    );
  }

  // Desktop: inline sidebar
  return (
    <aside className="chat-sidebar w-[280px] shrink-0 overflow-hidden">
      {sidebarContent}
    </aside>
  );
}
