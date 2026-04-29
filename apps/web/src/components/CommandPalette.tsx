'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Home, LayoutDashboard, Network, FileText, BarChart3, BookOpen,
  ShieldCheck, Plug, Clock, Code2, Search, ArrowRight,
} from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  href?: string;
  action?: () => void;
  group: string;
}

const NAV_COMMANDS: CommandItem[] = [
  { id: 'home', label: 'Home', description: 'Dashboard overview', icon: <Home className="h-4 w-4" />, href: '/workspace', group: 'Navigation' },
  { id: 'workspace', label: 'Workspace', description: 'Command center', icon: <LayoutDashboard className="h-4 w-4" />, href: '/workspace', group: 'Navigation' },
  { id: 'builder', label: 'Builder', description: 'Vibe Coding IDE', icon: <Code2 className="h-4 w-4" />, href: '/builder', group: 'Navigation' },
  { id: 'swarm', label: 'Swarm Inspector', description: 'Workflow runs', icon: <Network className="h-4 w-4" />, href: '/swarm', group: 'Navigation' },
  { id: 'traces', label: 'Trace Viewer', description: 'Agent execution logs', icon: <FileText className="h-4 w-4" />, href: '/traces', group: 'Navigation' },
  { id: 'analytics', label: 'Analytics', description: 'Usage & cost metrics', icon: <BarChart3 className="h-4 w-4" />, href: '/analytics', group: 'Navigation' },
  { id: 'schedules', label: 'Schedules', description: 'Recurring workflows', icon: <Clock className="h-4 w-4" />, href: '/schedules', group: 'Navigation' },
  { id: 'standing-orders', label: 'Standing Orders', description: 'Autonomy boundaries', icon: <ShieldCheck className="h-4 w-4" />, href: '/standing-orders', group: 'Navigation' },
  { id: 'integrations', label: 'Integrations', description: 'Connected services', icon: <Plug className="h-4 w-4" />, href: '/integrations', group: 'Navigation' },
  { id: 'knowledge', label: 'Knowledge', description: 'Memory store', icon: <BookOpen className="h-4 w-4" />, href: '/knowledge', group: 'Navigation' },
  { id: 'admin', label: 'Admin Console', description: 'Settings & users', icon: <ShieldCheck className="h-4 w-4" />, href: '/admin', group: 'Navigation' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
        setQuery('');
        setSelectedIndex(0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const filtered = NAV_COMMANDS.filter(cmd =>
    cmd.label.toLowerCase().includes(query.toLowerCase()) ||
    cmd.description?.toLowerCase().includes(query.toLowerCase()),
  );

  const handleSelect = useCallback((cmd: CommandItem) => {
    setOpen(false);
    if (cmd.href) router.push(cmd.href);
    if (cmd.action) cmd.action();
  }, [router]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[selectedIndex]) { handleSelect(filtered[selectedIndex]); }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />

      {/* Palette */}
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 z-[91] w-full max-w-lg" role="dialog" aria-label="Command palette">
        <div className="rounded-xl border border-white/10 bg-card shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Search pages, actions..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Search commands"
            />
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-72 overflow-y-auto p-2" role="listbox">
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">No results found.</p>
            ) : (
              filtered.map((cmd, i) => (
                <button
                  key={cmd.id}
                  role="option"
                  aria-selected={i === selectedIndex}
                  onClick={() => handleSelect(cmd)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                    i === selectedIndex ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'
                  }`}
                >
                  <span className="shrink-0 text-muted-foreground">{cmd.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{cmd.label}</p>
                    {cmd.description && <p className="text-xs text-muted-foreground">{cmd.description}</p>}
                  </div>
                  {i === selectedIndex && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-white/5 px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span><kbd className="font-mono">↑↓</kbd> Navigate</span>
            <span><kbd className="font-mono">↵</kbd> Open</span>
            <span><kbd className="font-mono">ESC</kbd> Close</span>
          </div>
        </div>
      </div>
    </>
  );
}
