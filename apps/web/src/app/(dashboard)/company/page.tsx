'use client';

/**
 * /company — Company Brain (Migration 16).
 *
 * Single-tenant page where the user manages their CompanyProfile:
 *   - View current profile (any status)
 *   - Trigger LLM extraction from uploaded documents (status='extracted')
 *   - Approve the extracted profile (with optional edits) (status='user_approved')
 *   - Reject + clear the profile to start over
 *   - Manually type the profile by hand (status='manual')
 *
 * Only profiles with status='user_approved' or 'manual' are loaded into
 * agent prompts via BaseAgent.injectCompanyContext — this page makes
 * that gate visible to the user.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  Brain, RefreshCw, CheckCircle, XCircle, AlertCircle, FileText, Sparkles, ShieldCheck, Network, Target, ListChecks,
} from 'lucide-react';
import {
  companyBrainApi,
  type AgentExecutableSpecClient,
  type CompanyArtifactClient,
  type CompanyConnectorSyncStatusClient,
  type CompanyGraphEntityClient,
  type CompanyProfileClient,
  type CompanyProfileFields,
  type ExecutionDriftFindingClient,
} from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  EmptyState, Spinner, Textarea,
} from '@/components/ui';
import { useToast } from '@/components/ui/toast';

const STATUS_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string; description: string }> = {
  extracted:     { variant: 'secondary', label: 'Extracted — needs review', description: 'JAK auto-extracted this from your documents. Approve to make agents use it.' },
  user_approved: { variant: 'default',   label: 'Approved',                 description: 'Agents will ground their work in this profile.' },
  manual:        { variant: 'default',   label: 'Manual',                   description: 'You typed this profile by hand. Agents will use it.' },
};

const CONNECTOR_LABEL: Record<CompanyConnectorSyncStatusClient['provider'], string> = {
  GITHUB: 'GitHub',
  GMAIL: 'Gmail',
  GOOGLE_DRIVE: 'Google Drive',
};

const SYNC_STATUS_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  running: { variant: 'secondary', label: 'Running' },
  idle: { variant: 'default', label: 'Idle' },
  error: { variant: 'destructive', label: 'Error' },
  not_connected: { variant: 'outline', label: 'Not connected' },
  disabled: { variant: 'secondary', label: 'Disabled' },
};

type ArtifactDraft = {
  sourceType: Parameters<typeof companyBrainApi.createArtifact>[0]['sourceType'];
  artifactType: Parameters<typeof companyBrainApi.createArtifact>[0]['artifactType'];
  title: string;
  body: string;
};

export default function CompanyBrainPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, isLoading, mutate: refresh } = useSWR(
    'company:profile',
    () => companyBrainApi.getProfile(),
    { refreshInterval: 0 },
  );

  if (isAuthLoading || isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>;
  }

  const role = String(user?.role ?? '').toUpperCase();
  const canEdit = role === 'TENANT_ADMIN' || role === 'SYSTEM_ADMIN' || role === 'ADMIN' || role === 'REVIEWER' || role === 'OPERATOR';

  async function action(name: string, fn: () => Promise<unknown>): Promise<void> {
    setBusy(name);
    try {
      await fn();
      await refresh();
      toast.success(`${name} succeeded`);
    } catch (e) {
      toast.error(`${name} failed`, e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  const profile = data?.profile ?? null;
  const status = profile ? STATUS_BADGE[profile.status] : null;

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6" />
            Company Brain
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your company context, used by every agent for grounding. Only approved profiles are loaded into agent prompts.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refresh()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3 text-destructive">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Could not load Company Brain</p>
                <p className="text-sm mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
                <p className="text-xs mt-2 text-muted-foreground">If the schema is missing, deploy migration 16_company_brain_intent_templates.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : !profile ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<Brain className="h-8 w-8" />}
              title="No company profile yet"
              description="Upload company documents (pitch deck, brand guide, product docs) on the Files page, then come back here to extract a profile. Or type one by hand below."
              {...(canEdit ? {
                action: (
                  <div className="flex gap-2 justify-center">
                    <Button onClick={() => action('Extract from documents', () => companyBrainApi.extractProfile())} disabled={busy !== null}>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Extract from documents
                    </Button>
                  </div>
                ),
              } : {})}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Status strip */}
          <Card className="mb-6" style={{ borderLeft: profile.status === 'extracted' ? '3px solid #fbbf24' : '3px solid #34d399' }}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-lg truncate">{profile.name ?? '(no name)'}</h2>
                    {status && <Badge variant={status.variant}>{status.label}</Badge>}
                    {profile.extractionConfidence !== null && (
                      <Badge variant="outline">Confidence {(profile.extractionConfidence * 100).toFixed(0)}%</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{status?.description}</p>
                  {profile.industry && <p className="text-xs text-muted-foreground mt-1">Industry: {profile.industry}</p>}
                </div>
                {canEdit && profile.status === 'extracted' && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => action('Reject + clear', () => companyBrainApi.rejectProfile())}>
                      <XCircle className="h-4 w-4 mr-2" />
                      Reject
                    </Button>
                    <Button size="sm" disabled={busy !== null} onClick={() => action('Approve', () => companyBrainApi.approveProfile())}>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Approve
                    </Button>
                  </div>
                )}
                {canEdit && profile.status !== 'extracted' && (
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => action('Re-extract', () => companyBrainApi.extractProfile())}>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Re-extract from docs
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Profile fields */}
          <ProfileFieldsCard profile={profile} canEdit={canEdit} busy={busy !== null}
            onSaveManual={(fields) => action('Save manual edits', () => companyBrainApi.saveManualProfile(fields))}
          />
        </>
      )}

      <ClosedLoopOsCard canEdit={canEdit} />
      <ConnectorAutosyncCard canEdit={canEdit} />

      {/* Honest disclaimer */}
      <Card className="mt-6 border-blue-500/30 bg-blue-500/5">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 flex-shrink-0 mt-0.5 text-blue-400" />
            <div className="text-sm">
              <p className="font-medium text-blue-300">How agent grounding works</p>
              <ul className="text-xs text-slate-400 mt-2 space-y-1 list-disc list-inside">
                <li>Only profiles with status <code className="font-mono">user_approved</code> or <code className="font-mono">manual</code> are loaded into agent prompts.</li>
                <li>An <code className="font-mono">extracted</code> profile is for you to review — agents do NOT see it until you approve.</li>
                <li>Re-extraction always flips back to <code className="font-mono">extracted</code>; you must re-approve.</li>
                <li>The <code className="font-mono">company_context_loaded</code> lifecycle event fires on every agent run that grounds in this profile — visible in the cockpit.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ClosedLoopOsCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [artifactDraft, setArtifactDraft] = useState<ArtifactDraft>({
    sourceType: 'manual',
    artifactType: 'decision_note',
    title: '',
    body: '',
  });

  const artifacts = useSWR('company:operating-layer:artifacts', () => companyBrainApi.listArtifacts({ limit: 10 }));
  const entities = useSWR('company:operating-layer:entities', () => companyBrainApi.listEntities({ limit: 10 }));
  const drift = useSWR('company:operating-layer:drift', () => companyBrainApi.listDriftFindings({ status: 'open', limit: 10 }));
  const specs = useSWR('company:operating-layer:specs', () => companyBrainApi.listSpecs({ limit: 10 }));

  const refreshAll = async () => {
    await Promise.all([artifacts.mutate(), entities.mutate(), drift.mutate(), specs.mutate()]);
  };

  async function run(name: string, fn: () => Promise<unknown>): Promise<void> {
    setBusy(name);
    try {
      await fn();
      await refreshAll();
      toast.success(`${name} succeeded`);
    } catch (e) {
      toast.error(`${name} failed`, e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  }

  const recentArtifacts = artifacts.data?.items ?? [];
  const recentEntities = entities.data?.items ?? [];
  const openDrift = drift.data?.items ?? [];
  const recentSpecs = specs.data?.items ?? [];
  const firstOpenDrift = openDrift[0] ?? null;
  const isLoading = artifacts.isLoading || entities.isLoading || drift.isLoading || specs.isLoading;
  const loadError = artifacts.error ?? entities.error ?? drift.error ?? specs.error;

  return (
    <Card className="mt-6 border-emerald-500/30 bg-emerald-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="h-5 w-5" />
          Closed-loop Company OS
        </CardTitle>
        <CardDescription>
          Evidence artifacts, company graph entities, drift findings, and agent-executable specs. This is the closed-loop operating layer, not a marketing-only claim.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loadError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {loadError instanceof Error ? loadError.message : 'Could not load closed-loop Company OS data.'}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-4">
          <MetricTile icon={<FileText className="h-4 w-4" />} label="Artifacts" value={artifacts.data?.total ?? 0} />
          <MetricTile icon={<Brain className="h-4 w-4" />} label="Entities" value={entities.data?.total ?? 0} />
          <MetricTile icon={<Target className="h-4 w-4" />} label="Open drift" value={drift.data?.total ?? 0} />
          <MetricTile icon={<ListChecks className="h-4 w-4" />} label="Specs" value={specs.data?.total ?? 0} />
        </div>

        {canEdit ? (
          <div className="rounded-lg border border-slate-700/70 bg-slate-950/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-sm">Ingest evidence</p>
                <p className="text-xs text-muted-foreground">Use this for meeting notes, customer calls, GitHub/Linear summaries, Slack decisions, or support feedback.</p>
              </div>
              <Button
                size="sm"
                disabled={busy !== null || artifactDraft.title.trim().length === 0 || artifactDraft.body.trim().length < 20}
                onClick={() => run('Ingest artifact', async () => {
                  await companyBrainApi.createArtifact(artifactDraft);
                  setArtifactDraft({ ...artifactDraft, title: '', body: '' });
                })}
              >
                Ingest
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs font-medium text-slate-400">
                Source
                <select
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  value={artifactDraft.sourceType}
                  onChange={(e) => setArtifactDraft({ ...artifactDraft, sourceType: e.target.value as ArtifactDraft['sourceType'] })}
                >
                  <option value="manual">Manual note</option>
                  <option value="github">GitHub</option>
                  <option value="linear">Linear</option>
                  <option value="jira">Jira</option>
                  <option value="slack">Slack</option>
                  <option value="notion">Notion</option>
                  <option value="google_drive">Google Drive</option>
                  <option value="gmail">Gmail</option>
                  <option value="meeting">Meeting</option>
                  <option value="customer_call">Customer call</option>
                  <option value="support">Support</option>
                  <option value="document">Document</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-400">
                Artifact type
                <select
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  value={artifactDraft.artifactType}
                  onChange={(e) => setArtifactDraft({ ...artifactDraft, artifactType: e.target.value as ArtifactDraft['artifactType'] })}
                >
                  <option value="decision_note">Decision note</option>
                  <option value="meeting_transcript">Meeting transcript</option>
                  <option value="customer_feedback">Customer feedback</option>
                  <option value="support_ticket">Support ticket</option>
                  <option value="ticket">Ticket</option>
                  <option value="issue">Issue</option>
                  <option value="pull_request">Pull request</option>
                  <option value="commit">Commit</option>
                  <option value="email">Email</option>
                  <option value="slack_thread">Slack thread</option>
                  <option value="notion_page">Notion page</option>
                  <option value="document">Document</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
            <input
              className="mt-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              value={artifactDraft.title}
              onChange={(e) => setArtifactDraft({ ...artifactDraft, title: e.target.value })}
              placeholder="Evidence title, e.g. Customer calls show onboarding confusion"
            />
            <Textarea
              className="mt-3"
              rows={5}
              value={artifactDraft.body}
              onChange={(e) => setArtifactDraft({ ...artifactDraft, body: e.target.value })}
              placeholder="Paste the actual evidence. JAK stores the body hash and uses this as cited context for entities, drift, and specs."
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">You can view the Company OS graph, but your role cannot ingest or approve records.</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => refreshAll()} disabled={busy !== null || isLoading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh OS
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => run('Analyze drift', () => companyBrainApi.analyzeAlignment())}>
              <Target className="h-4 w-4 mr-2" />
              Analyze drift
            </Button>
          )}
          {canEdit && firstOpenDrift && (
            <Button size="sm" disabled={busy !== null} onClick={() => run('Generate spec', () => companyBrainApi.generateSpec({ driftFindingId: firstOpenDrift.id }))}>
              <Sparkles className="h-4 w-4 mr-2" />
              Generate spec from top drift
            </Button>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <OsList
            title="Recent artifacts"
            empty="No evidence artifacts yet."
            items={recentArtifacts}
            render={(item) => (
              <ArtifactRow
                artifact={item}
                canEdit={canEdit}
                busy={busy !== null}
                onExtract={() => run('Extract entities', () => companyBrainApi.extractArtifactEntities(item.id))}
              />
            )}
          />
          <OsList
            title="Recent entities"
            empty="No graph entities yet."
            items={recentEntities}
            render={(item) => <EntityRow entity={item} />}
          />
          <OsList
            title="Open drift findings"
            empty="No open drift findings. Run analysis after entities exist."
            items={openDrift}
            render={(item) => <DriftRow finding={item} />}
          />
          <OsList
            title="Executable specs"
            empty="No specs generated yet."
            items={recentSpecs}
            render={(item) => (
              <SpecRow
                spec={item}
                canEdit={canEdit}
                busy={busy !== null}
                onDecide={(decision) => run(`${decision === 'APPROVED' ? 'Approve' : 'Reject'} spec`, () => companyBrainApi.decideSpec(item.id, { decision }))}
              />
            )}
          />
        </div>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100">
          Blunt truth: the closed-loop substrate is real and shipping. Auto-sync is now live for GitHub, Gmail, and Google Drive; other connectors still rely on manual ingestion until their provider pipelines are implemented.
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectorAutosyncCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const sync = useSWR(
    'company:connector-sync-statuses',
    () => companyBrainApi.listConnectorSyncStatuses(),
    { refreshInterval: 15_000 },
  );

  const orderedProviders: Array<CompanyConnectorSyncStatusClient['provider']> = ['GITHUB', 'GMAIL', 'GOOGLE_DRIVE'];
  const byProvider = new Map((sync.data?.items ?? []).map((item) => [item.provider, item]));
  const rows: CompanyConnectorSyncStatusClient[] = orderedProviders.map((provider) => (
    byProvider.get(provider) ?? {
      provider,
      integrationProvider: null,
      connected: false,
      enabled: false,
      status: 'not_connected',
      lastSyncedAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      cursor: null,
      latestRun: null,
    }
  ));

  async function runAction(name: string, key: string, fn: () => Promise<unknown>): Promise<void> {
    setBusyKey(key);
    try {
      await fn();
      await sync.mutate();
      toast.success(`${name} succeeded`);
    } catch (e) {
      toast.error(`${name} failed`, e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card className="mt-6 border-cyan-500/30 bg-cyan-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="h-5 w-5" />
          Connector autosync
        </CardTitle>
        <CardDescription>
          Leader-gated background sync for GitHub, Gmail, and Google Drive. This keeps the Company OS evidence stream fresh without manual triggering.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sync.error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {sync.error instanceof Error ? sync.error.message : 'Could not load connector sync status.'}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={busyKey !== null || sync.isLoading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh sync state
          </Button>
          <p className="text-xs text-slate-400">Scheduler cadence is deployment-controlled; status here updates every 15 seconds.</p>
        </div>

        <div className="space-y-3">
          {rows.map((row) => {
            const status = SYNC_STATUS_BADGE[row.status] ?? { variant: 'outline' as const, label: row.status };
            const rowBusy = busyKey !== null && busyKey.startsWith(`${row.provider}:`);

            return (
              <div key={row.provider} className="rounded-md border border-slate-700/70 bg-slate-950/35 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{CONNECTOR_LABEL[row.provider]}</p>
                    <p className="text-xs text-slate-400">
                      {row.connected
                        ? `Connected via ${row.integrationProvider ?? row.provider}`
                        : 'Not connected in Integrations'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <Badge variant={row.enabled ? 'default' : 'secondary'}>
                      {row.enabled ? 'Auto-sync enabled' : 'Auto-sync disabled'}
                    </Badge>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2 xl:grid-cols-4">
                  <p>Last sync: {formatDateTime(row.lastSyncedAt)}</p>
                  <p>Last success: {formatDateTime(row.lastSuccessAt)}</p>
                  <p>Last error: {formatDateTime(row.lastErrorAt)}</p>
                  <p>Consecutive failures: {row.consecutiveFailures}</p>
                </div>

                {row.latestRun && (
                  <p className="mt-2 text-xs text-cyan-200">
                    Latest run: {row.latestRun.status} · fetched {row.latestRun.fetchedCount} · ingested {row.latestRun.ingestedCount} · skipped {row.latestRun.skippedCount}
                  </p>
                )}

                {row.lastError && (
                  <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-100">
                    {row.lastError}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {!row.connected ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href="/integrations">Connect in Integrations</Link>
                    </Button>
                  ) : canEdit ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyKey !== null}
                        onClick={() => runAction(
                          row.enabled ? 'Disable auto-sync' : 'Enable auto-sync',
                          `${row.provider}:toggle`,
                          () => row.enabled
                            ? companyBrainApi.disableConnectorSync(row.provider)
                            : companyBrainApi.enableConnectorSync(row.provider),
                        )}
                      >
                        {row.enabled ? 'Disable auto-sync' : 'Enable auto-sync'}
                      </Button>
                      <Button
                        size="sm"
                        disabled={busyKey !== null || !row.enabled || row.status === 'running'}
                        onClick={() => runAction(
                          'Run incremental sync',
                          `${row.provider}:trigger`,
                          () => companyBrainApi.triggerConnectorSync(row.provider, { mode: 'incremental' }),
                        )}
                      >
                        Run now
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyKey !== null || !row.enabled || row.status === 'running'}
                        onClick={() => runAction(
                          'Run full sync',
                          `${row.provider}:full`,
                          () => companyBrainApi.triggerConnectorSync(row.provider, { mode: 'full' }),
                        )}
                      >
                        Full sync
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400">Your role can view sync state but cannot trigger or change it.</p>
                  )}
                  {rowBusy && <Spinner size="sm" />}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-950/40 p-3">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function OsList<T>({ title, empty, items, render }: { title: string; empty: string; items: T[]; render: (item: T) => React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-950/30 p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 italic">{empty}</p>
      ) : (
        <div className="space-y-3">{items.map((item, index) => <React.Fragment key={index}>{render(item)}</React.Fragment>)}</div>
      )}
    </div>
  );
}

function ArtifactRow({ artifact, canEdit, busy, onExtract }: { artifact: CompanyArtifactClient; canEdit: boolean; busy: boolean; onExtract: () => void }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{artifact.title}</p>
          <p className="text-xs text-slate-500">{artifact.sourceType} / {artifact.artifactType} · {artifact.ingestionStatus}</p>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onExtract}>
            Extract
          </Button>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-slate-400">{artifact.body}</p>
    </div>
  );
}

function EntityRow({ entity }: { entity: CompanyGraphEntityClient }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline">{entity.entityType}</Badge>
        {entity.priority && <Badge variant={entity.priority === 'critical' || entity.priority === 'high' ? 'destructive' : 'secondary'}>{entity.priority}</Badge>}
      </div>
      <p className="mt-2 text-sm font-medium">{entity.title}</p>
      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{entity.summary}</p>
    </div>
  );
}

function DriftRow({ finding }: { finding: ExecutionDriftFindingClient }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-center gap-2">
        <Badge variant={finding.severity === 'critical' || finding.severity === 'high' ? 'destructive' : 'secondary'}>{finding.severity}</Badge>
        <Badge variant="outline">{finding.driftType}</Badge>
      </div>
      <p className="mt-2 text-sm font-medium">{finding.title}</p>
      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{finding.summary}</p>
      <p className="mt-2 text-xs text-emerald-300">{finding.recommendation}</p>
    </div>
  );
}

function SpecRow({ spec, canEdit, busy, onDecide }: { spec: AgentExecutableSpecClient; canEdit: boolean; busy: boolean; onDecide: (decision: 'APPROVED' | 'REJECTED') => void }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant={spec.status === 'approved' ? 'default' : spec.status === 'rejected' ? 'destructive' : 'secondary'}>{spec.status}</Badge>
            <span className="text-xs text-slate-500">{formatShortDate(spec.createdAt)}</span>
          </div>
          <p className="mt-2 text-sm font-medium">{spec.title}</p>
        </div>
        {canEdit && spec.status === 'draft' && (
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onDecide('REJECTED')}>Reject</Button>
            <Button size="sm" disabled={busy} onClick={() => onDecide('APPROVED')}>Approve</Button>
          </div>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{spec.objective}</p>
      {spec.acceptanceCriteria && spec.acceptanceCriteria.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">{spec.acceptanceCriteria.length} acceptance criteria · {spec.approvalGates?.length ?? 0} approval gates</p>
      )}
    </div>
  );
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ProfileFieldsCard({
  profile, canEdit, busy, onSaveManual,
}: {
  profile: CompanyProfileClient;
  canEdit: boolean;
  busy: boolean;
  onSaveManual: (fields: CompanyProfileFields) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CompanyProfileFields>({
    name: profile.name ?? '',
    industry: profile.industry ?? '',
    description: profile.description ?? '',
    targetCustomers: profile.targetCustomers ?? '',
    brandVoice: profile.brandVoice ?? '',
    pricing: profile.pricing ?? '',
    websiteUrl: profile.websiteUrl ?? '',
    goals: profile.goals ?? '',
    constraints: profile.constraints ?? '',
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-5 w-5" />
          Profile fields
        </CardTitle>
        <CardDescription>{editing ? 'Edit fields, then save.' : 'Click any field to edit. Saving changes flips status to "manual".'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Description" value={profile.description}      editing={editing} onChange={(v) => setDraft({ ...draft, description: v })} draft={draft.description} />
        <Field label="Brand voice" value={profile.brandVoice}      editing={editing} onChange={(v) => setDraft({ ...draft, brandVoice: v })} draft={draft.brandVoice} placeholder="e.g. confident, jargon-light, candid" />
        <Field label="Target customers" value={profile.targetCustomers} editing={editing} onChange={(v) => setDraft({ ...draft, targetCustomers: v })} draft={draft.targetCustomers} />
        <Field label="Pricing" value={profile.pricing}              editing={editing} onChange={(v) => setDraft({ ...draft, pricing: v })} draft={draft.pricing} />
        <Field label="Website URL" value={profile.websiteUrl}      editing={editing} onChange={(v) => setDraft({ ...draft, websiteUrl: v })} draft={draft.websiteUrl} />
        <Field label="Goals" value={profile.goals}                  editing={editing} onChange={(v) => setDraft({ ...draft, goals: v })} draft={draft.goals} />
        <Field label="Constraints" value={profile.constraints}      editing={editing} onChange={(v) => setDraft({ ...draft, constraints: v })} draft={draft.constraints} />

        {/* JSON-shape fields — read-only view for now */}
        <ListField label="Products / services"  items={profile.productsServices?.map((p) => p.name) ?? []} />
        <ListField label="Competitors"          items={profile.competitors?.map((c) => c.name) ?? []} />
        <ListField label="Preferred channels"   items={profile.preferredChannels ?? []} />

        {canEdit && (
          <div className="flex gap-2 pt-3">
            {!editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit fields</Button>}
            {editing && (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" disabled={busy} onClick={() => { onSaveManual(draft); setEditing(false); }}>
                  Save (flips to manual)
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, editing, onChange, draft, placeholder }: { label: string; value: string | null; editing: boolean; onChange: (v: string) => void; draft?: string; placeholder?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      {editing ? (
        <Textarea value={draft ?? ''} onChange={(e) => onChange(e.target.value)} rows={2} {...(placeholder ? { placeholder } : {})} />
      ) : (
        <p className="text-sm text-slate-200">{value && value.trim().length > 0 ? value : <em className="text-slate-500">(not set)</em>}</p>
      )}
    </div>
  );
}

function ListField({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 italic">(none)</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((it, i) => <Badge key={i} variant="outline">{it}</Badge>)}
        </div>
      )}
    </div>
  );
}
