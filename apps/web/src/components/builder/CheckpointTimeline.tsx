'use client';

import React, { useState, useCallback } from 'react';
import { GitBranch, RotateCcw, ChevronDown, ChevronRight, Plus, Minus, Pencil, Loader2, AlertCircle } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { projectApi, type Checkpoint, type CheckpointStage } from '@/lib/api-client';

/**
 * Checkpoint timeline — a newest-first list of auto + manual checkpoints
 * created during Vibe Coder runs. Each row shows the stage, a file-change
 * summary (+N / -M / ~K), and a Restore button that reverts the project
 * to that snapshot. Restore creates a new rollback version so the operator
 * can un-revert.
 *
 * This component owns its own reload — after restore succeeds it refetches
 * the list so the newly-created rollback version appears on top. The
 * parent page can also pass onRestored so it can refetch the file tree.
 */

interface CheckpointTimelineProps {
  projectId: string;
  checkpoints: Checkpoint[];
  onRestored?: () => void;
  onReload?: () => void;
  className?: string;
}

const STAGE_COLORS: Record<CheckpointStage, string> = {
  architect: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  generator: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  debugger: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  deployer: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  manual: 'bg-muted text-muted-foreground border-border',
  rollback: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function CheckpointTimeline({
  projectId,
  checkpoints,
  onRestored,
  onReload,
  className,
}: CheckpointTimelineProps) {
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [confirmVersion, setConfirmVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleExpanded = useCallback((version: number) => {
    setExpandedVersion((prev) => (prev === version ? null : version));
  }, []);

  const handleRestore = useCallback(
    async (version: number) => {
      setRestoringVersion(version);
      setError(null);
      try {
        await projectApi.restoreCheckpoint(projectId, version);
        setConfirmVersion(null);
        onRestored?.();
        onReload?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Restore failed');
      } finally {
        setRestoringVersion(null);
      }
    },
    [projectId, onRestored, onReload],
  );

  if (checkpoints.length === 0) {
    return (
      <div className={`text-sm text-muted-foreground p-4 border border-dashed border-border rounded ${className ?? ''}`}>
        No checkpoints yet. The Vibe Coder workflow creates one after every
        stage (generator, debugger, deployer). You can also snapshot manually.
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      {error ? (
        <div className="flex items-start gap-2 p-3 rounded border border-destructive/30 bg-destructive/10 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button
            onClick={() => setError(null)}
            className="text-xs underline hover:no-underline"
          >
            dismiss
          </button>
        </div>
      ) : null}

      <ol className="relative border-l border-border ml-2 space-y-3">
        {checkpoints.map((cp) => {
          const isExpanded = expandedVersion === cp.version;
          const diff = cp.diff;
          const stage = cp.stage ?? 'manual';
          const isConfirming = confirmVersion === cp.version;
          const isRestoring = restoringVersion === cp.version;

          return (
            <li key={cp.id} className="pl-4 relative">
              <span
                className="absolute left-0 top-3 -translate-x-1/2 w-2.5 h-2.5 rounded-full border border-border bg-background"
                aria-hidden
              />
              <div className="rounded-md border border-border bg-card/40 p-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => toggleExpanded(cp.version)}
                    className="flex items-start gap-2 text-left flex-1 group"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${STAGE_COLORS[stage]}`}
                        >
                          {stage}
                        </Badge>
                        <span className="font-medium text-sm">v{cp.version}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelative(cp.createdAt)}
                        </span>
                      </div>
                      {cp.description ? (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1 group-hover:line-clamp-none">
                          {cp.description}
                        </div>
                      ) : null}
                      {diff ? <DiffSummary diff={diff} /> : null}
                    </div>
                  </button>

                  <div className="flex-shrink-0">
                    {isConfirming ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleRestore(cp.version)}
                          disabled={isRestoring}
                          className="h-7 px-2 text-xs"
                        >
                          {isRestoring ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmVersion(null)}
                          disabled={isRestoring}
                          className="h-7 px-2 text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmVersion(cp.version)}
                        className="h-7 px-2 text-xs gap-1"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Restore
                      </Button>
                    )}
                  </div>
                </div>

                {isExpanded && diff ? <DiffFileList diff={diff} /> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Compact one-line diff summary: "+2 ~1 -0 (12 files)".
 * Rendered inline on the collapsed row; full details available on expand.
 */
function DiffSummary({ diff }: { diff: import('@/lib/api-client').CheckpointDiff }) {
  const a = diff.added.length;
  const m = diff.modified.length;
  const d = diff.deleted.length;
  if (!diff.hasChanges) {
    return (
      <div className="text-[11px] text-muted-foreground mt-1">
        no changes · {diff.totalFiles} files
      </div>
    );
  }
  return (
    <div className="text-[11px] mt-1 flex items-center gap-2 flex-wrap">
      {a > 0 ? <span className="text-emerald-400">+{a} added</span> : null}
      {m > 0 ? <span className="text-amber-400">~{m} modified</span> : null}
      {d > 0 ? <span className="text-rose-400">-{d} deleted</span> : null}
      <span className="text-muted-foreground">· {diff.totalFiles} files total</span>
    </div>
  );
}

function DiffFileList({ diff }: { diff: import('@/lib/api-client').CheckpointDiff }) {
  const sections: Array<{
    label: string;
    color: string;
    Icon: typeof Plus;
    entries: import('@/lib/api-client').CheckpointDiffEntry[];
  }> = [
    { label: 'Added', color: 'text-emerald-400', Icon: Plus, entries: diff.added },
    { label: 'Modified', color: 'text-amber-400', Icon: Pencil, entries: diff.modified },
    { label: 'Deleted', color: 'text-rose-400', Icon: Minus, entries: diff.deleted },
  ];
  const visible = sections.filter((s) => s.entries.length > 0);
  if (visible.length === 0) {
    return (
      <div className="mt-3 pt-3 border-t border-border/50 text-[11px] text-muted-foreground">
        No file changes in this checkpoint.
      </div>
    );
  }
  return (
    <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
      {visible.map((s) => (
        <div key={s.label}>
          <div className={`text-[10px] font-semibold uppercase tracking-wider ${s.color} mb-1 flex items-center gap-1`}>
            <s.Icon className="h-3 w-3" />
            {s.label} ({s.entries.length})
          </div>
          <ul className="space-y-0.5">
            {s.entries.slice(0, 25).map((e) => (
              <li key={e.path} className="text-[11px] font-mono text-muted-foreground pl-4">
                {e.path}
                {e.prevSize !== undefined && e.nextSize !== undefined ? (
                  <span className="ml-2 text-[10px]">
                    {e.prevSize}B → {e.nextSize}B
                  </span>
                ) : null}
              </li>
            ))}
            {s.entries.length > 25 ? (
              <li className="text-[11px] text-muted-foreground pl-4 italic">
                … and {s.entries.length - 25} more
              </li>
            ) : null}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Small inline header / toolbar for the timeline panel, including a manual
 * snapshot button. Kept separate so the page can place the header where it
 * wants (often in a tab label row).
 */
export function CheckpointTimelineHeader({
  projectId,
  onSnapshot,
  disabled,
}: {
  projectId: string;
  onSnapshot?: (cp: Checkpoint) => void;
  disabled?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSnapshot = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const cp = await projectApi.createCheckpoint(projectId, { stage: 'manual' });
      onSnapshot?.(cp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Snapshot failed');
    } finally {
      setSaving(false);
    }
  }, [projectId, onSnapshot]);

  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <GitBranch className="h-4 w-4" />
        Checkpoints
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={handleSnapshot}
        disabled={disabled || saving}
        className="h-7 px-2 text-xs gap-1"
        title="Create a manual snapshot of the current files"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        Snapshot now
      </Button>
      {error ? (
        <span className="text-[11px] text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
