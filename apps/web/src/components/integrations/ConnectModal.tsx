'use client';

import React, { useState, useEffect } from 'react';
import { X, ExternalLink, CheckCircle2, AlertCircle, Loader2, ShieldCheck, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { integrationApi } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import type { IntegrationMaturity, IntegrationProvider } from '@/types';
import { useAuth } from '@/lib/auth';
import { getConnectorPermissions } from '@/lib/connector-permissions';

interface CredentialField {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password';
  helpUrl?: string;
}

interface ConnectModalProps {
  provider: IntegrationProvider;
  providerName: string;
  providerEmoji: string;
  onClose: () => void;
  onConnected: () => void;
}

export function ConnectModal({ provider, providerName, providerEmoji, onClose, onConnected }: ConnectModalProps) {
  const { user } = useAuth();
  // Token-paste form is admin-only. Normal users see only the OAuth
  // "Sign in with X" button or a "Coming soon" empty state — never raw
  // credential placeholders like `xoxb-…` or `GOCSPX-…`. Defense in
  // depth: even an admin must explicitly toggle the form open.
  const isAdmin = user?.role === 'TENANT_ADMIN' || user?.role === 'SYSTEM_ADMIN';
  const [showAdvanced, setShowAdvanced] = useState(false);
  const permissions = getConnectorPermissions(provider);

  const [fields, setFields] = useState<CredentialField[]>([]);
  const [instructions, setInstructions] = useState('');
  const [maturity, setMaturity] = useState<IntegrationMaturity | null>(null);
  const [maturityNote, setMaturityNote] = useState('');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'loading' | 'testing' | 'connected' | 'error'>('idle');
  const [error, setError] = useState('');
  const [toolCount, setToolCount] = useState(0);
  const [registeredTools, setRegisteredTools] = useState<string[]>([]);

  // Load provider info
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const info = await integrationApi.getProviderInfo(provider);
        if (cancelled) return;
        const data = (info as Record<string, unknown>)?.data ?? info;
        const d = data as Record<string, unknown>;
        setFields((d.credentialFields as CredentialField[]) ?? []);
        setInstructions((d.setupInstructions as string) ?? '');
        const nextMaturity = d.maturity;
        setMaturity(typeof nextMaturity === 'string' ? nextMaturity as IntegrationMaturity : null);
        setMaturityNote(typeof d.note === 'string' ? d.note : '');
        setStatus('idle');
      } catch {
        if (cancelled) return;
        // Fallback: use hardcoded fields for known providers
        const fallbacks: Record<string, CredentialField[]> = {
          SLACK: [
            { key: 'botToken', label: 'Bot User OAuth Token', placeholder: 'xoxb-...', type: 'password', helpUrl: 'https://api.slack.com/apps' },
            { key: 'teamId', label: 'Team ID', placeholder: 'T01234567', type: 'text' },
          ],
          GITHUB: [
            { key: 'token', label: 'Personal Access Token', placeholder: 'ghp_...', type: 'password', helpUrl: 'https://github.com/settings/tokens' },
          ],
          NOTION: [
            { key: 'apiKey', label: 'Integration Secret', placeholder: 'ntn_...', type: 'password', helpUrl: 'https://www.notion.so/my-integrations' },
          ],
          GMAIL: [
            { key: 'clientId', label: 'OAuth Client ID', placeholder: 'xxxx.apps.googleusercontent.com', type: 'text', helpUrl: 'https://console.cloud.google.com/apis/credentials' },
            { key: 'clientSecret', label: 'OAuth Client Secret', placeholder: 'GOCSPX-...', type: 'password' },
          ],
          GCAL: [
            { key: 'clientId', label: 'OAuth Client ID', placeholder: 'xxxx.apps.googleusercontent.com', type: 'text', helpUrl: 'https://console.cloud.google.com/apis/credentials' },
            { key: 'clientSecret', label: 'OAuth Client Secret', placeholder: 'GOCSPX-...', type: 'password' },
          ],
          HUBSPOT: [
            { key: 'accessToken', label: 'Private App Access Token', placeholder: 'pat-...', type: 'password', helpUrl: 'https://developers.hubspot.com/docs/api/private-apps' },
          ],
          DRIVE: [
            { key: 'clientId', label: 'OAuth Client ID', placeholder: 'xxxx.apps.googleusercontent.com', type: 'text', helpUrl: 'https://console.cloud.google.com/apis/credentials' },
            { key: 'clientSecret', label: 'OAuth Client Secret', placeholder: 'GOCSPX-...', type: 'password' },
          ],
        };
        setFields(fallbacks[provider] ?? []);
        setMaturity('partial');
        setMaturityNote('Provider supports credential setup. Validate adapter depth before production reliance.');
        setStatus('idle');
      }
    })();
    return () => { cancelled = true; };
  }, [provider]);

  const allFieldsFilled = fields.length > 0 && fields.every(f => credentials[f.key]?.trim());

  // OAuth capability is now queried from the server — every provider in the
  // backend's OAUTH_PROVIDERS registry (Gmail, Slack, GitHub, Notion, Linear)
  // shows a "Sign in with X" button when its client_id/client_secret env vars
  // are set on the deployment. If the provider isn't in the registry OR isn't
  // configured, we fall back to the paste-credentials form.
  const [oauthProviders, setOauthProviders] = useState<Array<{ id: string; label: string; configured: boolean }>>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await integrationApi.listOAuthProviders();
        // apiDataFetch returns the unwrapped `.data` field directly, so
        // `res` is already the array. Keep the defensive .data fallback for
        // older code paths that still return the envelope.
        const data: unknown = Array.isArray(res)
          ? res
          : (res as unknown as { data?: unknown })?.data;
        if (!cancelled && Array.isArray(data)) {
          setOauthProviders(data as Array<{ id: string; label: string; configured: boolean }>);
        }
      } catch {
        // Non-fatal: without this list we just never show the OAuth button.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const oauthEntry = oauthProviders.find((p) => p.id === provider.toUpperCase());
  const supportsOAuth = Boolean(oauthEntry);
  const oauthConfigured = Boolean(oauthEntry?.configured);
  const oauthLabel = oauthEntry?.label ?? providerName;

  const handleOAuthConnect = async () => {
    setStatus('testing');
    setError('');
    try {
      const result = await integrationApi.oauthAuthorize(provider);
      const data = (result as Record<string, unknown>)?.data ?? result;
      const authUrl = (data as Record<string, unknown>)?.authUrl as string | undefined;
      if (!authUrl) {
        setError('Authorization URL not returned by server.');
        setStatus('error');
        return;
      }
      // Full-page redirect so the provider's consent screen doesn't get boxed
      // in a popup blocker. On return, /integrations/callback reads ?connected=
      // and refreshes the integrations list.
      window.location.href = authUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not start OAuth flow.';
      if (msg.toLowerCase().includes('not configured')) {
        setError(`${oauthLabel} OAuth is not configured on this deployment. Paste credentials manually below, or ask your admin to set the provider's CLIENT_ID / CLIENT_SECRET env vars.`);
        setStatus('error');
      } else {
        setError(msg);
        setStatus('error');
      }
    }
  };

  const maturityTone =
    maturity === 'production-ready' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
    maturity === 'beta' ? 'bg-sky-100 text-sky-700 border-sky-200' :
    maturity === 'placeholder' ? 'bg-zinc-100 text-zinc-700 border-zinc-200' :
    'bg-amber-100 text-amber-700 border-amber-200';

  const handleConnect = async () => {
    if (!allFieldsFilled) return;
    setStatus('testing');
    setError('');

    try {
      const result = await integrationApi.connect(provider, credentials);
      const data = (result as Record<string, unknown>)?.data ?? result;
      const d = data as Record<string, unknown>;
      setToolCount((d.toolsRegistered as string[])?.length ?? 0);
      setRegisteredTools((d.toolsRegistered as string[]) ?? []);
      setStatus('connected');
      // Auto-close after 2 seconds
      setTimeout(() => { onConnected(); onClose(); }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed. Check your credentials and try again.');
      setStatus('error');
    }
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="bg-background border rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden"
        role="dialog"
        aria-label={`Connect ${providerName}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{providerEmoji}</span>
            <div>
              <h2 className="font-semibold text-lg">Connect {providerName}</h2>
              <p className="text-xs text-muted-foreground">Set up integration credentials</p>
              {maturity && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', maturityTone)}>
                    {maturity.replace('-', ' ')}
                  </span>
                  {maturityNote && <span className="text-[11px] text-muted-foreground">{maturityNote}</span>}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Loading state */}
          {status === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Instructions */}
          {instructions && status !== 'connected' && status !== 'loading' && (
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Setup Instructions</p>
              <div className="text-sm space-y-1 whitespace-pre-line text-foreground/80">{instructions}</div>
            </div>
          )}

          {/* Connected state */}
          {status === 'connected' && (
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
              <p className="text-lg font-semibold text-green-600">{providerName} Connected!</p>
              <p className="text-sm text-muted-foreground">
                {toolCount > 0 ? `${toolCount} tools registered for your agents` : 'Integration is now active'}
              </p>
              {registeredTools.length > 0 && (
                <div className="flex flex-wrap gap-1 justify-center mt-2">
                  {registeredTools.slice(0, 6).map(t => (
                    <span key={t} className="text-[10px] bg-green-100 text-green-700 rounded-full px-2 py-0.5">{t}</span>
                  ))}
                  {registeredTools.length > 6 && (
                    <span className="text-[10px] text-muted-foreground">+{registeredTools.length - 6} more</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Plain-English permissions — what JAK can do, what needs
              approval. NEVER mentions OAuth scopes, tokens, or
              developer concepts. */}
          {status !== 'connected' && status !== 'loading' && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" aria-hidden />
                <div className="text-xs">
                  <p className="font-semibold text-foreground mb-0.5">JAK can</p>
                  <p className="text-muted-foreground">{permissions.jakCan}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden />
                <div className="text-xs">
                  <p className="font-semibold text-foreground mb-0.5">Approval required before</p>
                  <p className="text-muted-foreground">{permissions.approvalRequiredBefore}</p>
                </div>
              </div>
            </div>
          )}

          {/* Primary connect path — layman-first. Three branches:
              1. OAuth configured → big "Sign in with X" button
              2. OAuth supported but not configured → "Coming soon" empty
                 state for normal users; admins can toggle Advanced setup
              3. OAuth not supported → admins see Advanced setup; users
                 see "Coming soon" */}
          {status !== 'connected' && status !== 'loading' && supportsOAuth && oauthConfigured && (
            <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm font-medium">Sign in with {oauthLabel}</p>
              <p className="text-xs text-muted-foreground">
                You'll be sent to {oauthLabel} to allow access. JAK never sees your password.
              </p>
              <Button
                onClick={handleOAuthConnect}
                disabled={status === 'testing'}
                className="w-full"
                data-testid="oauth-connect-btn"
              >
                {status === 'testing' ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Redirecting to {oauthLabel}...</>
                ) : (
                  <>Sign in with {oauthLabel}</>
                )}
              </Button>
            </div>
          )}

          {/* Coming-soon empty state — shown to normal (non-admin) users
              when OAuth isn't configured for this provider. Honest copy:
              we don't pretend to be ready when we're not. */}
          {status !== 'connected' && status !== 'loading' &&
            (!supportsOAuth || !oauthConfigured) && !isAdmin && (
            <div className="rounded-lg border bg-muted/30 p-6 text-center space-y-2" data-testid="coming-soon-empty-state">
              <p className="text-sm font-medium">Coming soon</p>
              <p className="text-xs text-muted-foreground">
                {providerName} needs additional setup by your workspace admin before it can be connected.
                Ping your admin or check back soon.
              </p>
            </div>
          )}

          {/* Admin-only Advanced setup toggle — token-paste form lives
              behind this. Default collapsed even for admins so a casual
              click doesn't surface developer credentials. */}
          {status !== 'connected' && status !== 'loading' && isAdmin && fields.length > 0 && (
            <div className="border-t pt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                data-testid="admin-advanced-toggle"
                aria-expanded={showAdvanced}
              >
                <Settings2 className="h-3.5 w-3.5" />
                {showAdvanced ? 'Hide' : 'Show'} advanced setup (admin only)
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-3" data-testid="admin-token-paste-form">
                  <p className="text-[11px] text-muted-foreground">
                    Manual credential setup. For OAuth, ask your platform team to set
                    the deployment's <code className="rounded bg-muted px-1">CLIENT_ID</code>
                    {' / '}
                    <code className="rounded bg-muted px-1">CLIENT_SECRET</code> env vars,
                    then refresh.
                  </p>
                  {fields.map(field => (
                    <div key={field.key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm font-medium">{field.label}</label>
                        {field.helpUrl && (
                          <a
                            href={field.helpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                          >
                            Get this <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                      <input
                        type={field.type}
                        placeholder={field.placeholder}
                        value={credentials[field.key] ?? ''}
                        onChange={e => setCredentials(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className={cn(
                          'w-full rounded-md border bg-background px-3 py-2 text-sm',
                          'placeholder:text-muted-foreground',
                          'focus:outline-none focus:ring-2 focus:ring-primary/50',
                        )}
                        autoComplete="off"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {status === 'error' && error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 text-destructive p-3 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer — Cancel always shown. Connect button only when admin
            has the advanced token-paste form open (normal users use the
            big OAuth button or see Coming Soon). */}
        {status !== 'connected' && status !== 'loading' && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t bg-muted/30">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            {isAdmin && showAdvanced && fields.length > 0 && (
              <Button
                size="sm"
                onClick={handleConnect}
                disabled={!allFieldsFilled || status === 'testing'}
                data-testid="admin-connect-btn"
              >
                {status === 'testing' ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Connecting...</>
                ) : (
                  <>Connect {providerName}</>
                )}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
