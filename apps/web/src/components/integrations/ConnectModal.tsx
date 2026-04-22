'use client';

import React, { useState, useEffect } from 'react';
import { X, ExternalLink, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { integrationApi } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import type { IntegrationMaturity, IntegrationProvider } from '@/types';

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

  // Providers that support the OAuth PKCE redirect flow instead of the
  // paste-credentials form. Kept in the frontend as a small allowlist so
  // we don't accidentally show a "Sign in with Google" button for a
  // provider where the backend route doesn't exist.
  const supportsOAuth = provider === 'GMAIL';

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
      // Full-page redirect so Google consent doesn't get boxed in a popup
      // blocker. When Google redirects back, the /dashboard route reads
      // `?oauth=status=connected&provider=gmail` and the parent refreshes
      // its integrations list.
      window.location.href = authUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not start OAuth flow.';
      // The 503 case — Google OAuth env vars not set — is common in self-hosted
      // dev deploys. Fall back gracefully to the cred-paste form.
      if (msg.toLowerCase().includes('not configured')) {
        setError('Google OAuth is not configured on this deployment. Paste credentials manually below, or ask your admin to set GOOGLE_OAUTH_CLIENT_ID.');
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

          {/* OAuth PKCE quick-connect (Gmail today) */}
          {supportsOAuth && status !== 'connected' && status !== 'loading' && (
            <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div>
                <p className="text-sm font-medium">Sign in with Google</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Recommended. Authorize through Google&apos;s consent screen — no app passwords
                  to copy, refresh tokens rotate automatically.
                </p>
              </div>
              <Button
                onClick={handleOAuthConnect}
                disabled={status === 'testing'}
                className="w-full"
              >
                {status === 'testing' ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Redirecting to Google...</>
                ) : (
                  <>Sign in with Google</>
                )}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center pt-1">
                Or paste app-password credentials below
              </p>
            </div>
          )}

          {/* Credential fields */}
          {status !== 'connected' && status !== 'loading' && (
            <div className="space-y-3">
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

          {/* Error */}
          {status === 'error' && error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 text-destructive p-3 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        {status !== 'connected' && status !== 'loading' && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t bg-muted/30">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={!allFieldsFilled || status === 'testing'}
            >
              {status === 'testing' ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Connecting...</>
              ) : (
                <>Connect {providerName}</>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
