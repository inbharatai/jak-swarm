'use client';

import React, { useState, useEffect } from 'react';
import { X, ExternalLink, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { integrationApi } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import type { IntegrationProvider } from '@/types';

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
        setStatus('idle');
      }
    })();
    return () => { cancelled = true; };
  }, [provider]);

  const allFieldsFilled = fields.length > 0 && fields.every(f => credentials[f.key]?.trim());

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
