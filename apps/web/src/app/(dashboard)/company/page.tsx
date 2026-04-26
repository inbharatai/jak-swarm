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
import useSWR from 'swr';
import {
  Brain, RefreshCw, CheckCircle, XCircle, AlertCircle, FileText, Sparkles, ShieldCheck,
} from 'lucide-react';
import {
  companyBrainApi,
  type CompanyProfileClient,
  type CompanyProfileFields,
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
