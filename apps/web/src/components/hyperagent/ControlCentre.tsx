/**
 * ControlCentre.tsx — HyperAgent Phase 13 shared presentational components.
 *
 * Honest by construction:
 *   - `BucketList` renders REAL counts from `HonestBucket[]` as plain
 *     "label — count" rows. No bar widths, no percentages, no fabricated
 *     "health" gauges. A bucket with count 0 is not rendered.
 *   - `HonestEmpty` renders the view's own `note` (an explanation, never a
 *     fake "all systems healthy") when `dataAvailable === false`.
 *   - `StatTile` shows a real integer/string value, or an em-dash when the
 *     value is absent — never a placeholder percentage.
 *   - `ViewShell` shows a `dataAvailable` badge so the operator can see at a
 *     glance whether a surface is backed by real rows.
 */
import React from 'react';
import { cn } from '@/lib/cn';
import { Card, CardContent, CardHeader, CardTitle, Badge, Spinner, EmptyState } from '@/components/ui';
import { AlertCircle, Database } from 'lucide-react';
import type { HonestBucket } from '@jak-swarm/shared';

// ─── ViewShell ──────────────────────────────────────────────────────────────

export function ViewShell({
  title,
  description,
  dataAvailable,
  generatedAt,
  note,
  children,
}: {
  title: string;
  description: string;
  dataAvailable: boolean;
  generatedAt?: string;
  note?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <Badge variant={dataAvailable ? 'default' : 'secondary'}>
            {dataAvailable ? 'Real data' : 'No data yet'}
          </Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        {generatedAt && (
          <p className="text-xs text-muted-foreground">
            Generated {new Date(generatedAt).toLocaleString()} from live backend rows.
          </p>
        )}
      </div>
      {note && !dataAvailable ? (
        <HonestEmpty note={note} />
      ) : (
        children
      )}
    </div>
  );
}

// ─── HonestEmpty ────────────────────────────────────────────────────────────

export function HonestEmpty({ note }: { note: string }) {
  return (
    <Card>
      <CardContent>
        <EmptyState
          icon={<Database className="h-5 w-5" />}
          title="No data available"
          description={note}
        />
      </CardContent>
    </Card>
  );
}

// ─── LoadingState / ErrorState ──────────────────────────────────────────────

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner size="lg" />
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-start gap-3 py-6">
          <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
          <div>
            <p className="text-sm font-semibold">Failed to load this view</p>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── StatTile ───────────────────────────────────────────────────────────────

export function StatTile({ label, value, hint }: { label: string; value: number | string | null; hint?: string }) {
  return (
    <Card>
      <CardContent>
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">{value === null || value === undefined ? '—' : value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── BucketList — real counts only, no fake graph ───────────────────────────

export function BucketList({ buckets, emptyHint }: { buckets: HonestBucket[]; emptyHint?: string }) {
  if (buckets.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyHint ?? 'No buckets.'}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {buckets.map((b) => (
        <li key={b.key} className="flex items-center justify-between text-sm">
          <span className="font-mono text-xs text-muted-foreground">{b.key}</span>
          <span className="tabular-nums font-medium">{b.count}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── DataTable — generic honest row table ───────────────────────────────────

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyHint,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  emptyHint?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyHint ?? 'No rows.'}</p>;
  }
  return (
    <div className={cn('overflow-x-auto rounded-md border')}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn('px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="text-sm">
              {columns.map((c) => (
                <td key={c.key} className={cn('px-3 py-2 align-top', c.className)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── SectionCard — titled section within a view ─────────────────────────────

export function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          {action}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ─── RoadmapNote — honest "not yet wired" callout ───────────────────────────

export function RoadmapNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 p-3 text-xs text-muted-foreground">
      {children}
    </div>
  );
}