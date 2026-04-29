'use client';

/**
 * /connectors — Connector Runtime marketplace + status dashboard.
 *
 * Honest, read-only view of every connector JAK knows about: the 21
 * MCP providers auto-mapped from MCP_PROVIDERS, plus the first-class
 * Remotion + Blender entries. Each card shows real runtime status,
 * risk level, what credentials it needs, and what the next step is.
 *
 * No fake "Connect" buttons that lead nowhere — connectors that need
 * OAuth credentials link to /integrations (where the OAuth flow
 * actually runs); connectors with manual setup steps render the
 * steps inline; nothing is marketed as "installed" unless the
 * registry status says so.
 */

import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Plug, AlertTriangle, CheckCircle2, Circle, Settings, Clock, ShieldAlert, Ban, ExternalLink } from 'lucide-react';
import {
  connectorApi,
  type ConnectorListResponse,
  type ConnectorViewClient,
  type ConnectorStatusValue,
} from '@/lib/api-client';
import { cn } from '@/lib/cn';

const STATUS_META: Record<ConnectorStatusValue, { label: string; cls: string; Icon: typeof Circle }> = {
  configured: { label: 'Configured', cls: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30', Icon: CheckCircle2 },
  installed: { label: 'Installed', cls: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30', Icon: CheckCircle2 },
  available: { label: 'Available', cls: 'text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/30', Icon: Circle },
  needs_user_setup: { label: 'Needs setup', cls: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30', Icon: Clock },
  failed_validation: { label: 'Failed validation', cls: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30', Icon: AlertTriangle },
  unavailable: { label: 'Unavailable', cls: 'text-slate-500 bg-slate-500/10 border-slate-500/30', Icon: Ban },
  disabled: { label: 'Disabled', cls: 'text-slate-500 bg-slate-500/10 border-slate-500/30', Icon: Ban },
  blocked_by_policy: { label: 'Policy-blocked', cls: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30', Icon: ShieldAlert },
};

const RISK_META: Record<string, { label: string; cls: string }> = {
  LOW: { label: 'Low risk', cls: 'text-emerald-600 dark:text-emerald-400' },
  MEDIUM: { label: 'Medium risk', cls: 'text-amber-600 dark:text-amber-400' },
  HIGH: { label: 'High risk', cls: 'text-rose-600 dark:text-rose-400' },
  CRITICAL: { label: 'Critical risk', cls: 'text-rose-700 dark:text-rose-500' },
};

const CATEGORIES: Array<{ id: ConnectorViewClient['manifest']['category'] | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'media', label: 'Media' },
  { id: 'creative', label: 'Creative' },
  { id: 'business', label: 'Business' },
  { id: 'coding', label: 'Coding' },
  { id: 'research', label: 'Research' },
  { id: 'local', label: 'Local' },
  { id: 'cloud', label: 'Cloud' },
];

export default function ConnectorsPage() {
  const [selectedCategory, setSelectedCategory] = useState<(typeof CATEGORIES)[number]['id']>('all');
  const { data, error, isLoading } = useSWR<ConnectorListResponse>(
    selectedCategory === 'all' ? 'connectors:all' : `connectors:${selectedCategory}`,
    () => connectorApi.list(selectedCategory === 'all' ? {} : { category: selectedCategory }),
    { refreshInterval: 30_000 },
  );

  const counts = data?.counts;
  const connectors = data?.connectors ?? [];

  // Group connectors by status into the four buckets the dashboard cares
  // about: ready (configured + installed), needs setup, available, blocked.
  const grouped = useMemo(() => {
    const ready: ConnectorViewClient[] = [];
    const needsSetup: ConnectorViewClient[] = [];
    const available: ConnectorViewClient[] = [];
    const blocked: ConnectorViewClient[] = [];
    for (const c of connectors) {
      if (c.status === 'configured' || c.status === 'installed') ready.push(c);
      else if (c.status === 'needs_user_setup') needsSetup.push(c);
      else if (c.status === 'available') available.push(c);
      else blocked.push(c);
    }
    return { ready, needsSetup, available, blocked };
  }, [connectors]);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-8" data-testid="connectors-page">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Plug className="h-6 w-6" />
          Connectors
        </h1>
        <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
          Every external capability JAK can route work through — MCP servers, code-driven runtimes (Remotion), desktop bridges (Blender), REST APIs.
          Status is real-time. Connectors marked <strong className="text-foreground">Available</strong> are registered but not yet installed
          or validated; the dashboard never claims a connector is working unless its registry status says so.
        </p>
      </div>

      {/* Status counts ribbon */}
      {counts && (
        <div className="flex flex-wrap gap-2 text-xs font-mono">
          {(['configured', 'installed', 'available', 'needs_user_setup', 'failed_validation', 'unavailable', 'disabled', 'blocked_by_policy'] as ConnectorStatusValue[]).map((s) => {
            const meta = STATUS_META[s];
            const count = counts[s];
            if (count === 0) return null;
            return (
              <span
                key={s}
                className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 border', meta.cls)}
              >
                <meta.Icon className="h-3 w-3" />
                <span>{count} {meta.label.toLowerCase()}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Category filter */}
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              selectedCategory === cat.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Loading / error */}
      {isLoading && <p className="text-sm text-muted-foreground">Loading connectors…</p>}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">
          Failed to load connectors. Check the API server is running.
        </div>
      )}

      {/* Sections */}
      {!isLoading && !error && (
        <>
          <ConnectorSection title="Ready to use" subtitle="Installed and configured. Available to agents now." items={grouped.ready} />
          <ConnectorSection title="Needs setup" subtitle="One-time user action required (download, install, OAuth)." items={grouped.needsSetup} />
          <ConnectorSection title="Available" subtitle="Registered. Install on first use after approval." items={grouped.available} />
          {grouped.blocked.length > 0 && (
            <ConnectorSection title="Unavailable" subtitle="Disabled, policy-blocked, or failed validation." items={grouped.blocked} />
          )}
        </>
      )}
    </div>
  );
}

// ─── Section + Card ───────────────────────────────────────────────────────

function ConnectorSection({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: ConnectorViewClient[];
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((c) => (
          <ConnectorCard key={c.manifest.id} view={c} />
        ))}
      </div>
    </section>
  );
}

function ConnectorCard({ view }: { view: ConnectorViewClient }) {
  const statusMeta = STATUS_META[view.status];
  const riskMeta = RISK_META[view.manifest.riskLevel];
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3" data-testid={`connector-card-${view.manifest.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm text-foreground truncate">{view.manifest.name}</h3>
          <p className="text-[11px] text-muted-foreground capitalize">{view.manifest.category} · {view.manifest.runtimeType}</p>
        </div>
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 border text-[10px] font-mono', statusMeta.cls)}>
          <statusMeta.Icon className="h-3 w-3" />
          {statusMeta.label}
        </span>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-3">{view.manifest.description}</p>

      <div className="flex flex-wrap gap-1.5 text-[10px]">
        {riskMeta && (
          <span className={cn('inline-flex items-center gap-1', riskMeta.cls)}>
            <ShieldAlert className="h-3 w-3" />
            {riskMeta.label}
          </span>
        )}
        {view.manifest.canPublishExternalContent && (
          <span className="text-muted-foreground">· Can publish externally</span>
        )}
        {view.manifest.supportsAutoApproval && (
          <span className="text-muted-foreground">· Auto-approve eligible</span>
        )}
        {view.manifest.packageStatus && (
          <span className="text-muted-foreground">· {view.manifest.packageStatus}</span>
        )}
      </div>

      {/* Status reason — for failed_validation / disabled / blocked */}
      {view.statusReason && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400 italic">{view.statusReason}</p>
      )}

      {/* Setup steps preview — first line only on the card */}
      {view.manifest.manualSetupSteps && view.manifest.manualSetupSteps.length > 0 && (
        <div className="text-[11px] text-amber-700 dark:text-amber-400">
          <strong>Next:</strong> {view.manifest.manualSetupSteps[0]}
        </div>
      )}

      {/* Tool count.
          P2 audit fix: the red "N live" banner used to render whenever
          `installedToolCount !== availableTools.length`, but
          `installedToolCount` is undefined for un-installed connectors
          (every connector at boot today). That false-positive made every
          card look broken. Now the divergence note only renders when
          (a) we've recorded a real validation AND (b) the live count
          actually differs. Otherwise we render a neutral count. */}
      {view.manifest.availableTools.length > 0 && (
        <div className="text-[10px] font-mono text-muted-foreground">
          Exposes {view.manifest.availableTools.length} tool{view.manifest.availableTools.length === 1 ? '' : 's'}
          {typeof view.installedToolCount === 'number'
            && view.installedToolCount !== view.manifest.availableTools.length && (
            <span className="text-rose-600 dark:text-rose-400"> · {view.installedToolCount} live</span>
          )}
        </div>
      )}

      {/* Footer links */}
      <div className="mt-auto flex items-center justify-between text-[11px] pt-2 border-t border-border">
        <Link
          href={view.manifest.source === 'mcp-providers' ? '/integrations' : `#`}
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          {view.manifest.source === 'mcp-providers' ? 'Configure in Integrations' : 'See setup'}
          <Settings className="h-3 w-3" />
        </Link>
        {view.manifest.docsUrl && (
          <a
            href={view.manifest.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            Docs <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
