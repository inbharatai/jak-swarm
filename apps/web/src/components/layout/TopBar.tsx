'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Search, Sun, Moon, PanelLeftClose, PanelLeft, LogOut, User, Settings } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { useConversationStore } from '@/store/conversation-store';

export function TopBar() {
  const { resolvedTheme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();
  const sidebarCollapsed = useConversationStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useConversationStore((s) => s.setSidebarCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // `next-themes` reads from a cookie/localStorage on the client only,
  // so `resolvedTheme` is undefined during SSR and the first hydration
  // pass. Rendering the theme-dependent Sun/Moon icon under that
  // condition produced a hydration mismatch every page load (server
  // emitted Moon, client immediately re-rendered Sun once theme
  // resolved). The `mounted` flag pins the SSR + first-client render
  // to the SAME placeholder; the actual icon swaps in after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    router.push('/login');
  };

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '?';

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/80 backdrop-blur-md px-4">
      {/* Left: sidebar toggle + logo */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>

        <span className="font-display text-sm font-bold tracking-tight text-foreground">
          JAK<span className="text-primary ml-0.5">Swarm</span>
        </span>
      </div>

      {/* Center: command palette trigger.
          Mobile-first fix (P1-7): the trigger used to be `hidden sm:flex`
          which made the palette unreachable on phones — laymen on mobile
          had no way to navigate beyond the 5 zone-rail icons. Now the
          button is always visible: full search-bar form on tablet/desktop,
          icon-only square on mobile. Both dispatch the same keydown event
          the palette listens to, so behavior is identical across viewports. */}
      <button
        onClick={() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
        }}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-border bg-muted/50 text-xs text-muted-foreground',
          'hover:bg-muted hover:text-foreground transition-colors',
          // Mobile: icon-only 36x36 square button
          'p-2 sm:px-3 sm:py-1.5',
          'sm:gap-2',
        )}
        aria-label="Open command palette"
      >
        <Search className="h-4 w-4 sm:h-3 sm:w-3" />
        <span className="hidden sm:inline">Search or command...</span>
        <kbd className="hidden sm:inline-block ml-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-mono border border-border">⌘K</kbd>
      </button>

      {/* Right: theme + user */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label={
            // Until mounted, pin the label so SSR/client agree.
            !mounted
              ? 'Toggle theme'
              : resolvedTheme === 'dark'
                ? 'Switch to light mode'
                : 'Switch to dark mode'
          }
        >
          {/* Render a stable placeholder during SSR + first hydration
              pass; swap in the theme-dependent icon after `mounted`. */}
          {!mounted ? (
            <Moon className="h-4 w-4 opacity-50" aria-hidden="true" />
          ) : resolvedTheme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary hover:bg-primary/25 transition-colors"
            aria-label="User menu"
            aria-expanded={menuOpen}
            aria-haspopup="true"
          >
            {initials}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-48 rounded-lg border border-border bg-card shadow-lg z-50 py-1 animate-fade-up">
              {user?.email && (
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-xs font-medium text-foreground truncate">{user.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
                </div>
              )}
              <button
                onClick={() => { setMenuOpen(false); router.push('/settings'); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </button>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
