'use client';

/**
 * CommandPalette — Cmd+K / Ctrl+K universal navigator.
 *
 * Sprint S1 of the Cockpit-First Simplification: every existing dashboard
 * route stays reachable, but the sidebar shrinks to a 5-icon zone rail.
 * This palette is the escape hatch — type two letters of any route name
 * (or its zone) and hit Enter to navigate.
 *
 * Why a palette beats a deep sidebar for laymen:
 *   - One keyboard shortcut beats "where in the sidebar is X again?"
 *   - The list is filterable, so a layman searching "audit" finds
 *     `/audit` without needing to know what zone it lives in.
 *   - Role-gated entries simply don't render for users without the role,
 *     keeping the cognitive load low.
 *
 * Listens for two trigger sources:
 *   1. Native Cmd+K / Ctrl+K on `window` (documented shortcut).
 *   2. The synthesized keydown event the existing `TopBar` button
 *      dispatches (`apps/web/src/components/layout/TopBar.tsx:73`).
 *
 * Mounted once in `AppLayout` so it's always available across the
 * dashboard regardless of which page the user is on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calendar,
  CalendarDays,
  CreditCard,
  FileText,
  Globe2,
  Hammer,
  Mail,
  Megaphone,
  MessageSquare,
  Network,
  Plug,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';

// ─── Route registry ────────────────────────────────────────────────────────
// Matches the routes that used to live in `ChatSidebar.NAV_ITEMS` plus the
// chat hub itself. Keeping it in this file (not a separate module) so the
// palette is self-contained — anyone can add a new route by editing one
// place. Role gates mirror the prior sidebar gates exactly so behavior is
// preserved.

type Zone = 'Chat' | 'Tasks' | 'Files' | 'Setup' | 'Audit';

interface PaletteEntry {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  zone: Zone;
  /** Mirror of ChatSidebar gates so behavior is identical. */
  adminOnly?: boolean;
  reviewerOrAdmin?: boolean;
  systemAdminOnly?: boolean;
  /** Extra search terms — typing any of these matches this entry. */
  keywords?: string[];
}

export const PALETTE_ENTRIES: PaletteEntry[] = [
  // Chat zone — primary work surface
  { href: '/workspace', label: 'Chat', description: 'Talk to JAK — the cockpit', icon: MessageSquare, zone: 'Chat', keywords: ['home', 'workspace', 'cockpit'] },
  { href: '/inbox', label: 'Inbox', description: 'Triage emails and notifications', icon: Mail, zone: 'Chat' },
  { href: '/social', label: 'Social', description: 'Schedule and post social content', icon: Megaphone, zone: 'Chat' },

  // Tasks zone — observe, monitor, intervene
  { href: '/swarm', label: 'Runs', description: 'All workflow runs and their state', icon: Network, zone: 'Tasks', keywords: ['workflows', 'runs', 'jobs'] },
  { href: '/analytics', label: 'Analytics', description: 'Workflow metrics, cost, timing', icon: BarChart3, zone: 'Tasks', keywords: ['metrics', 'cost', 'usage'] },
  { href: '/schedules', label: 'Schedules', description: 'Recurring workflow scheduler', icon: Calendar, zone: 'Tasks', keywords: ['cron', 'recurring'] },
  { href: '/calendar', label: 'Calendar', description: 'Calendar integration and scheduling', icon: CalendarDays, zone: 'Tasks' },

  // Files zone — knowledge + documents
  { href: '/files', label: 'Files', description: 'Documents, uploads, generated artifacts', icon: FileText, zone: 'Files', keywords: ['documents', 'uploads', 'artifacts'] },
  { href: '/knowledge', label: 'Knowledge', description: 'Knowledge base — briefs, ADRs, notes', icon: BookOpen, zone: 'Files', keywords: ['memory', 'docs'] },

  // Setup zone — configuration
  { href: '/integrations', label: 'Integrations', description: 'Connect Slack, Gmail, GitHub, Notion, ...', icon: Plug, zone: 'Setup', keywords: ['oauth', 'connect'] },
  { href: '/connectors', label: 'Connectors', description: 'Connector marketplace — Remotion, Blender, MCP servers, runtime status', icon: Plug, zone: 'Setup', keywords: ['marketplace', 'mcp', 'remotion', 'blender', 'runtime'] },
  { href: '/skills', label: 'Skills', description: 'Custom agent skills and tool toggles', icon: Sparkles, zone: 'Setup', keywords: ['tools', 'capabilities'] },
  { href: '/builder', label: 'Builder', description: 'No-code project builder (vibe coder)', icon: Hammer, zone: 'Setup', keywords: ['app', 'vibe', 'code'] },
  { href: '/settings', label: 'Settings', description: 'Approvals, voice, domains, account', icon: ShieldCheck, zone: 'Setup', keywords: ['preferences', 'account'] },
  { href: '/billing', label: 'Billing', description: 'Subscription and credits', icon: CreditCard, zone: 'Setup', keywords: ['subscription', 'plan'] },

  // Audit zone — role-gated
  { href: '/audit', label: 'Audit', description: 'Compliance dashboard, reviewer queue, audit log', icon: ScrollText, zone: 'Audit', reviewerOrAdmin: true, keywords: ['compliance', 'soc2', 'hipaa'] },
  { href: '/audit/runs', label: 'Audit runs', description: 'SOC 2 / HIPAA / ISO 27001 engagements', icon: ScrollText, zone: 'Audit', reviewerOrAdmin: true, keywords: ['engagement', 'workpaper'] },
  { href: '/admin', label: 'Admin', description: 'Tenant administration', icon: ShieldCheck, zone: 'Audit', adminOnly: true, keywords: ['users', 'rbac'] },
  { href: '/admin/platform', label: 'Platform', description: 'System-admin cross-tenant view', icon: Globe2, zone: 'Audit', systemAdminOnly: true },
];

// ─── Component ─────────────────────────────────────────────────────────────

export function CommandPalette() {
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Same string-tolerant role logic as ChatSidebar — Supabase user_metadata
  // can carry legacy literals ('ADMIN' from older register flows) that don't
  // match the current UserRole enum exactly.
  const roleStr = String(user?.role ?? '');
  const isAdmin = roleStr === 'TENANT_ADMIN' || roleStr === 'SYSTEM_ADMIN' || roleStr === 'ADMIN';
  const isReviewerOrAdmin = isAdmin || roleStr === 'REVIEWER' || roleStr === 'OPERATOR';
  const isSystemAdmin = roleStr === 'SYSTEM_ADMIN';

  const visibleEntries = useMemo(() => {
    return PALETTE_ENTRIES.filter((entry) => {
      if (entry.adminOnly && !isAdmin) return false;
      if (entry.reviewerOrAdmin && !isReviewerOrAdmin) return false;
      if (entry.systemAdminOnly && !isSystemAdmin) return false;
      return true;
    });
  }, [isAdmin, isReviewerOrAdmin, isSystemAdmin]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visibleEntries;
    return visibleEntries.filter((entry) => {
      const haystack = [
        entry.label,
        entry.description,
        entry.zone,
        entry.href,
        ...(entry.keywords ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query, visibleEntries]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  // Global keydown listener: opens on Cmd+K / Ctrl+K, closes on Escape,
  // arrow-keys move selection, Enter navigates. Listens on `window` so the
  // synthesized event from TopBar (`window.dispatchEvent(... key: 'k', metaKey: true ...)`)
  // also opens the palette without an extra hook.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isCmdK) {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered[activeIndex]) {
        e.preventDefault();
        navigate(filtered[activeIndex]!.href);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, close, filtered, activeIndex, navigate]);

  // Reset selection when the filtered list changes so the highlight stays
  // on a valid index even after the user types more characters.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Focus the input when the palette opens — without this the user has to
  // click into it before typing, which defeats the purpose of a shortcut.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  // Group filtered results by zone for readability. Order is deterministic
  // so the user's mental map stays stable even as filtering narrows the list.
  const ZONE_ORDER: Zone[] = ['Chat', 'Tasks', 'Files', 'Setup', 'Audit'];
  const grouped = ZONE_ORDER.map((zone) => ({
    zone,
    entries: filtered.filter((e) => e.zone === zone),
  })).filter((g) => g.entries.length > 0);

  // Build a flat index → entry map so arrow-key navigation across groups
  // matches the rendered order.
  let runningIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={close}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, tasks, settings..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            aria-label="Search"
          />
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground border border-border">
            Esc
          </kbd>
          <button
            onClick={close}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close palette"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-2">
          {grouped.length === 0 ? (
            <p className="px-4 py-6 text-sm text-center text-muted-foreground">
              No matches for &quot;{query}&quot;.
            </p>
          ) : (
            grouped.map((group) => (
              <div key={group.zone} className="mb-2 last:mb-0">
                <div className="px-4 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
                  {group.zone}
                </div>
                <ul role="listbox">
                  {group.entries.map((entry) => {
                    runningIndex += 1;
                    const isActive = runningIndex === activeIndex;
                    const Icon = entry.icon;
                    return (
                      <li key={entry.href}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onClick={() => navigate(entry.href)}
                          onMouseEnter={() => setActiveIndex(runningIndex)}
                          className={cn(
                            'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors',
                            isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50',
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-medium text-foreground truncate">{entry.label}</span>
                            <span className="block text-[11px] text-muted-foreground truncate">{entry.description}</span>
                          </span>
                          {isActive && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-3">
            <span>
              <kbd className="rounded bg-muted px-1 py-0.5 font-mono border border-border">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="rounded bg-muted px-1 py-0.5 font-mono border border-border">↵</kbd> open
            </span>
          </span>
          <span>
            <kbd className="rounded bg-muted px-1 py-0.5 font-mono border border-border">⌘K</kbd> toggle
          </span>
        </div>
      </div>
    </div>
  );
}
