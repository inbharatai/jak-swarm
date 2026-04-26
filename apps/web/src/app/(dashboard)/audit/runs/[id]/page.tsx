'use client';

/**
 * /audit/runs/[id] — Audit run detail workspace
 *
 * Five panels (real backend wiring throughout — no mock data):
 *   1. Status / coverage / risk strip + lifecycle action buttons
 *      (Plan, Auto-map, Test controls, Generate workpapers, Generate final pack)
 *   2. Control matrix table (one row per ControlTest)
 *   3. Workpaper panel (per-control workpaper PDFs with reviewer approve/reject)
 *   4. Exception panel (open exceptions + remediation status)
 *   5. Final pack panel (signed bundle download once generated)
 *
 * All actions are real and gated by RBAC at the API layer. This page only
 * disables buttons cosmetically based on lifecycle state — the API enforces.
 */

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';
import {
  ArrowLeft, ClipboardCheck, RefreshCw, AlertCircle, AlertTriangle,
  CheckCircle, XCircle, FileText, Download, Play, Map as MapIcon,
  Package, ShieldCheck, FilePlus,
} from 'lucide-react';
import {
  auditRunsApi,
  type AuditRunDetail,
  type AuditRunStatusClient,
  type ControlTestRow,
  type AuditExceptionRow,
  type AuditWorkpaperRow,
} from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  EmptyState, Spinner, Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui';
import { useToast } from '@/components/ui/toast';

const STATUS_BADGE: Record<AuditRunStatusClient, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  PLANNING: { variant: 'outline', label: 'Planning' },
  PLANNED: { variant: 'secondary', label: 'Planned' },
  MAPPING: { variant: 'secondary', label: 'Mapping' },
  TESTING: { variant: 'secondary', label: 'Testing' },
  REVIEWING: { variant: 'secondary', label: 'Reviewing' },
  READY_TO_PACK: { variant: 'default', label: 'Ready to pack' },
  FINAL_PACK: { variant: 'default', label: 'Final pack' },
  COMPLETED: { variant: 'default', label: 'Completed' },
  FAILED: { variant: 'destructive', label: 'Failed' },
  CANCELLED: { variant: 'outline', label: 'Cancelled' },
};

const RESULT_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; icon: React.ReactNode }> = {
  pass: { variant: 'default', label: 'Pass', icon: <CheckCircle className="h-3 w-3" /> },
  fail: { variant: 'destructive', label: 'Fail', icon: <XCircle className="h-3 w-3" /> },
  exception: { variant: 'destructive', label: 'Exception', icon: <AlertTriangle className="h-3 w-3" /> },
  needs_evidence: { variant: 'outline', label: 'Needs evidence', icon: <AlertCircle className="h-3 w-3" /> },
};

export default function AuditRunDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user, isLoading: isAuthLoading } = useAuth();
  const toast = useToast();
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const { data, error, isLoading, mutate: refresh } = useSWR<AuditRunDetail>(
    id ? `audit:runs:${id}` : null,
    () => auditRunsApi.get(id),
    // 15s SWR poll as fallback. Live updates come via the SSE channel
    // `audit_run:{id}` wired below — when an event arrives we mutate
    // immediately, so the poll is only for safety net + initial load.
    { refreshInterval: 15_000 },
  );

  // Live SSE on the audit_run:{id} channel — drops the per-action wait
  // from "up to 15s" to "immediate". Backend already emits all 13 audit
  // lifecycle events on this channel via fastify.swarm.emit() in
  // audit-runs.routes.ts. We just need to listen.
  React.useEffect(() => {
    if (!id) return;
    // Pull a JWT for the EventSource query param (EventSource can't set
    // headers). The api-client cookie/header path doesn't help here.
    let es: EventSource | null = null;
    try {
      const token = typeof window !== 'undefined'
        ? (window.localStorage.getItem('jak_token') ?? document.cookie.split('; ').find((c) => c.startsWith('jak_token='))?.split('=')[1] ?? '')
        : '';
      const apiBase = (process.env['NEXT_PUBLIC_API_URL'] ?? '').replace(/\/$/, '');
      if (!apiBase) return;
      const url = `${apiBase}/audit/runs/${encodeURIComponent(id)}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      es = new EventSource(url);
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data) as { type?: string };
          if (typeof ev?.type === 'string') {
            // Any audit lifecycle event → refetch the detail. Cheap because
            // the cockpit shows a single audit run, and the GET is small.
            void refresh();
          }
        } catch { /* ignore malformed */ }
      };
      es.onerror = () => {
        // Silent — SWR poll picks up the slack.
        es?.close();
        es = null;
      };
    } catch { /* SSE unavailable — fall back to SWR poll */ }
    return () => { es?.close(); };
  }, [id, refresh]);

  if (isAuthLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3 text-destructive">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Could not load audit run</p>
                <p className="text-sm mt-1">{error instanceof Error ? error.message : 'Run not found or schema not deployed'}</p>
                <div className="mt-3">
                  <Link href="/audit/runs">
                    <Button variant="outline" size="sm">
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to runs
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const role = String(user?.role ?? '').toUpperCase();
  const canEdit = role === 'TENANT_ADMIN' || role === 'SYSTEM_ADMIN' || role === 'ADMIN' || role === 'REVIEWER';

  const { run, controlTests, exceptions, workpapers } = data;
  const status = STATUS_BADGE[run.status] ?? { variant: 'outline' as const, label: run.status };

  async function action(name: string, fn: () => Promise<unknown>): Promise<void> {
    setBusyAction(name);
    try {
      await fn();
      await refresh();
      toast.success(`${name} succeeded`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      toast.error(`${name} failed`, msg);
    } finally {
      setBusyAction(null);
    }
  }

  const pendingTests = controlTests.filter((t) => !['passed', 'failed', 'exception_found', 'evidence_missing', 'approved', 'rejected', 'remediated'].includes(t.status));
  const generatedWorkpapers = workpapers.length;
  const approvedWorkpapers = workpapers.filter((w) => w.status === 'approved').length;
  const allApproved = generatedWorkpapers > 0 && approvedWorkpapers === generatedWorkpapers;

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="mb-4">
        <Link href="/audit/runs">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            All runs
          </Button>
        </Link>
      </div>

      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardCheck className="h-6 w-6" />
              {run.title}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {run.frameworkSlug} · {new Date(run.periodStart).toISOString().slice(0, 10)} → {new Date(run.periodEnd).toISOString().slice(0, 10)}
            </p>
            {run.scope && <p className="text-xs text-muted-foreground mt-1">{run.scope}</p>}
            <div className="flex items-center gap-2 mt-3">
              <Badge variant={status.variant}>{status.label}</Badge>
              {run.coveragePercent !== null && (
                <Badge variant="outline">Coverage {run.coveragePercent.toFixed(1)}%</Badge>
              )}
              {run.riskSummary && (
                <Badge variant={run.riskSummary === 'critical' || run.riskSummary === 'high' ? 'destructive' : 'secondary'}>
                  {run.riskSummary} risk
                </Badge>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refresh()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Lifecycle actions */}
      {canEdit && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Engagement actions</CardTitle>
            <CardDescription>
              Drive the audit through PLANNING → PLANNED → TESTING → REVIEWING → READY_TO_PACK → COMPLETED.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busyAction !== null || !['PLANNING'].includes(run.status)}
                onClick={() => action('Plan', () => auditRunsApi.plan(id))}
              >
                {busyAction === 'Plan' ? <Spinner size="sm" className="mr-2" /> : <FilePlus className="h-4 w-4 mr-2" />}
                Plan ({controlTests.length} controls)
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyAction !== null || !['PLANNED', 'TESTING', 'REVIEWING'].includes(run.status)}
                onClick={() => action('Auto-map', () => auditRunsApi.autoMap(id))}
              >
                {busyAction === 'Auto-map' ? <Spinner size="sm" className="mr-2" /> : <MapIcon className="h-4 w-4 mr-2" />}
                Auto-map evidence
              </Button>
              <Button
                size="sm"
                disabled={busyAction !== null || pendingTests.length === 0}
                onClick={() => action('Test controls', () => auditRunsApi.testControls(id))}
              >
                {busyAction === 'Test controls' ? <Spinner size="sm" className="mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                Run tests ({pendingTests.length} pending)
              </Button>
              <Button
                size="sm"
                disabled={busyAction !== null || !['REVIEWING', 'READY_TO_PACK'].includes(run.status) || controlTests.length === 0}
                onClick={() => action('Workpapers', () => auditRunsApi.generateWorkpapers(id))}
              >
                {busyAction === 'Workpapers' ? <Spinner size="sm" className="mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
                Generate workpapers ({generatedWorkpapers} so far)
              </Button>
              <Button
                size="sm"
                variant={allApproved ? 'default' : 'outline'}
                disabled={busyAction !== null || !allApproved || run.status === 'COMPLETED'}
                onClick={() => action('Final pack', () => auditRunsApi.finalPack(id))}
              >
                {busyAction === 'Final pack' ? <Spinner size="sm" className="mr-2" /> : <Package className="h-4 w-4 mr-2" />}
                {allApproved ? 'Generate signed final pack' : `Final pack (${approvedWorkpapers}/${generatedWorkpapers} approved)`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Final pack download (when generated) */}
      {run.finalPackArtifactId && (
        <Card className="mb-6 border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-6 w-6 text-emerald-500" />
                <div>
                  <p className="font-medium">Signed final pack ready</p>
                  <p className="text-xs text-muted-foreground">Artifact id: {run.finalPackArtifactId}</p>
                </div>
              </div>
              <Link href={`/artifacts?id=${run.finalPackArtifactId}`}>
                <Button size="sm" variant="outline">
                  <Download className="h-4 w-4 mr-2" />
                  Open artifact
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="controls">
        <TabsList>
          <TabsTrigger value="controls">Control matrix ({controlTests.length})</TabsTrigger>
          <TabsTrigger value="workpapers">Workpapers ({workpapers.length})</TabsTrigger>
          <TabsTrigger value="exceptions">Exceptions ({exceptions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="controls">
          <ControlMatrix
            tests={controlTests}
            disabled={busyAction !== null || !canEdit}
            onRetestSingle={(testId) => action('Re-test control', () => auditRunsApi.testSingle(id, testId))}
          />
        </TabsContent>
        <TabsContent value="workpapers">
          <WorkpaperPanel
            workpapers={workpapers}
            canEdit={canEdit}
            busy={busyAction !== null}
            onDecide={(wpId, decision) =>
              action(decision === 'approved' ? 'Approve workpaper' : 'Reject workpaper',
                () => auditRunsApi.decideWorkpaper(id, wpId, { decision }))
            }
          />
        </TabsContent>
        <TabsContent value="exceptions">
          <ExceptionPanel
            exceptions={exceptions}
            canEdit={canEdit}
            busy={busyAction !== null}
            onDecide={(exId, to) =>
              action(`Exception → ${to}`, () => auditRunsApi.decideException(id, exId, { to }))
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Control matrix ────────────────────────────────────────────────────

function ControlMatrix({ tests, disabled, onRetestSingle }: {
  tests: ControlTestRow[]; disabled: boolean; onRetestSingle: (id: string) => void;
}) {
  if (tests.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="pt-6">
          <EmptyState
            title="No controls planned yet"
            description="Click 'Plan' above to seed the control matrix from the framework catalog."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <CardContent className="pt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Title</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Result</th>
                <th className="py-2 pr-3 text-right">Confidence</th>
                <th className="py-2 pr-3 text-right">Evidence</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => {
                const result = t.result ? RESULT_BADGE[t.result] : null;
                return (
                  <tr key={t.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">{t.controlCode}</td>
                    <td className="py-2 pr-3 max-w-md">
                      <p className="font-medium truncate">{t.controlTitle}</p>
                      {t.rationale && <p className="text-xs text-muted-foreground truncate">{t.rationale}</p>}
                    </td>
                    <td className="py-2 pr-3"><Badge variant="outline">{t.status}</Badge></td>
                    <td className="py-2 pr-3">
                      {result ? (
                        <Badge variant={result.variant} className="gap-1">
                          {result.icon}{result.label}
                        </Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {t.confidence !== null ? t.confidence.toFixed(2) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{t.evidenceCount}</td>
                    <td className="py-2 pr-3 text-right">
                      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onRetestSingle(t.id)}>
                        Re-test
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Workpaper panel ───────────────────────────────────────────────────

function WorkpaperPanel({ workpapers, canEdit, busy, onDecide }: {
  workpapers: AuditWorkpaperRow[]; canEdit: boolean; busy: boolean;
  onDecide: (wpId: string, decision: 'approved' | 'rejected') => void;
}) {
  if (workpapers.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="pt-6">
          <EmptyState
            title="No workpapers generated yet"
            description="After tests are complete, click 'Generate workpapers' to render PDFs that reviewers can approve."
          />
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 mt-4">
      {workpapers.map((w) => (
        <Card key={w.id}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{w.controlCode}</span>
                  <span className="font-medium truncate">{w.controlTitle}</span>
                  <WorkpaperStatusBadge status={w.status} />
                </div>
                {w.reviewerNotes && <p className="text-xs text-muted-foreground mt-2 italic">"{w.reviewerNotes}"</p>}
                {w.reviewedBy && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Reviewed by {w.reviewedBy}{w.approvedAt ? ` on ${new Date(w.approvedAt).toISOString().slice(0, 10)}` : ''}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {w.artifactId && (
                  <Link href={`/artifacts?id=${w.artifactId}`}>
                    <Button size="sm" variant="ghost">
                      <Download className="h-4 w-4" />
                    </Button>
                  </Link>
                )}
                {canEdit && w.status !== 'approved' && w.status !== 'rejected' && w.status !== 'final' && (
                  <>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide(w.id, 'rejected')}>
                      Reject
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => onDecide(w.id, 'approved')}>
                      Approve
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function WorkpaperStatusBadge({ status }: { status: AuditWorkpaperRow['status'] }) {
  const map: Record<AuditWorkpaperRow['status'], { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
    draft: { variant: 'outline', label: 'Draft' },
    needs_evidence: { variant: 'outline', label: 'Needs evidence' },
    needs_review: { variant: 'secondary', label: 'Needs review' },
    approved: { variant: 'default', label: 'Approved' },
    rejected: { variant: 'destructive', label: 'Rejected' },
    final: { variant: 'default', label: 'Final' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

// ─── Exception panel ───────────────────────────────────────────────────

function ExceptionPanel({ exceptions, canEdit, busy, onDecide }: {
  exceptions: AuditExceptionRow[]; canEdit: boolean; busy: boolean;
  onDecide: (exId: string, to: 'accepted' | 'rejected' | 'closed') => void;
}) {
  if (exceptions.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="pt-6">
          <EmptyState
            title="No exceptions"
            description="Exceptions are auto-created when control tests fail. Reviewers can also raise manual exceptions via the API."
          />
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 mt-4">
      {exceptions.map((e) => {
        const sevColor = e.severity === 'critical' ? 'destructive' as const : e.severity === 'high' ? 'destructive' as const : e.severity === 'medium' ? 'secondary' as const : 'outline' as const;
        return (
          <Card key={e.id}>
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5 text-amber-500" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs">{e.controlCode}</span>
                    <Badge variant={sevColor}>{e.severity}</Badge>
                    <Badge variant="outline">{e.status}</Badge>
                  </div>
                  <p className="text-sm mt-2">{e.description}</p>
                  {e.cause && <p className="text-xs text-muted-foreground mt-2"><strong>Cause:</strong> {e.cause}</p>}
                  {e.remediationPlan && <p className="text-xs text-muted-foreground mt-1"><strong>Remediation:</strong> {e.remediationPlan}</p>}
                  {e.remediationOwner && <p className="text-xs text-muted-foreground mt-1">Owner: {e.remediationOwner}{e.remediationDueDate ? ` · due ${e.remediationDueDate.slice(0, 10)}` : ''}</p>}
                  {canEdit && !['accepted', 'rejected', 'closed'].includes(e.status) && (
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide(e.id, 'rejected')}>
                        Reject
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide(e.id, 'accepted')}>
                        Accept
                      </Button>
                      <Button size="sm" disabled={busy} onClick={() => onDecide(e.id, 'closed')}>
                        Close
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
