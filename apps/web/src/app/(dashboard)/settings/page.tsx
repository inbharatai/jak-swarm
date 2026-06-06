'use client';

import React, { useState, useEffect } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';
import { useAuthProfile } from '@/lib/auth-profile';
import { useToast } from '@/components/ui/toast';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Badge, Spinner, ProfileGateSkeleton } from '@/components/ui';
import { Key, Check, Eye, EyeOff, Server, AlertTriangle, Shield, Brain, Sparkles } from 'lucide-react';

interface LLMProvider {
  id: string;
  name: string;
  providerKey?: string;
  configured: boolean;
  keyPreview?: string;
  model?: string;
  source?: 'database' | 'env' | 'local' | 'managed' | null;
  url?: string;
  editable?: boolean;
  preferred?: boolean;
}

const PROVIDER_META: Record<string, { icon: React.ReactNode; label: string; description: string; models: string[]; color: string }> = {
  openai: { icon: <Brain className="h-5 w-5" />, label: 'Agent Runtime', description: 'GPT-5.5 / GPT-5.4 — agentic runtime', models: ['gpt-5.5', 'gpt-5.4'], color: '#10a37f' },
  gemini: { icon: <Sparkles className="h-5 w-5" />, label: 'Gemini Runtime', description: 'Gemini 2.5 Pro / Flash — tool calling + thinking', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'], color: '#4285f4' },
};

export default function SettingsPage() {
  const toast = useToast();
  const { isLoading: isProfileLoading } = useAuthProfile();
  const { data, isLoading, mutate } = useSWR<{
    success: boolean;
    data: {
      providers: LLMProvider[];
      canViewProviderIdentity: boolean;
      preferredProvider?: string;
    };
  }>(
    '/settings/llm',
    (url: string) => apiFetch<{
      success: boolean;
      data: {
        providers: LLMProvider[];
        canViewProviderIdentity: boolean;
        preferredProvider?: string;
      };
    }>(url),
  );
  const providers = data?.data?.providers ?? [];
  const canViewProviderIdentity = data?.data?.canViewProviderIdentity ?? false;
  const apiPreferredProvider = data?.data?.preferredProvider ?? 'openai';

  const [preferredProvider, setPreferredProvider] = useState<string>('openai');
  const [switchingProvider, setSwitchingProvider] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync preferred provider from API response
  useEffect(() => {
    if (apiPreferredProvider) setPreferredProvider(apiPreferredProvider);
  }, [apiPreferredProvider]);

  const handleSetPreferredProvider = async (provider: string) => {
    if (provider === preferredProvider) return;
    setSwitchingProvider(true);
    try {
      await apiFetch('/settings/llm/preferred-provider', {
        method: 'PUT',
        body: { provider },
      });
      setPreferredProvider(provider);
      toast.success(`Preferred provider set to ${PROVIDER_META[provider]?.label ?? provider}`);
      mutate();
    } catch (e) {
      toast.error('Failed to set preferred provider', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSwitchingProvider(false);
    }
  };

  const handleSave = async (provider: LLMProvider) => {
    if (!provider.providerKey) {
      toast.error('Provider details are restricted');
      return;
    }

    setSaving(true);
    try {
      await apiFetch(`/settings/llm/${provider.providerKey}`, {
        method: 'PUT',
        body: {
          apiKey: apiKey || undefined,
          model: selectedModel || undefined,
        },
      });
      toast.success('Provider settings saved');
      setEditingProvider(null);
      setApiKey('');
      setSelectedModel('');
      mutate();
    } catch (e) {
      toast.error('Failed to save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Spinner size="lg" /></div>;
  }

  // Build a map from providerKey (when visible) to provider data for the toggle
  const providerByKey: Record<string, LLMProvider> = {};
  for (const p of providers) {
    if (p.providerKey) providerByKey[p.providerKey] = p;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-display font-bold">AI Backends</h1>
        <p className="text-muted-foreground text-sm mt-1 font-sans">
          Configure LLM providers and select your preferred runtime. Backend identity is owner-only.
        </p>
      </div>

      {/* Preferred provider toggle — always visible, details hidden for non-identity users */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm">
              <Server className="h-4 w-4 text-primary shrink-0" />
              <div>
                <span className="font-medium">Active provider</span>
                <span className="text-muted-foreground ml-1">— all agents will use this LLM runtime</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {Object.entries(PROVIDER_META).map(([name, meta]) => {
                const isActive = preferredProvider === name;
                const isConfigured = canViewProviderIdentity ? !!providerByKey[name]?.configured : true;
                return (
                  <button
                    key={name}
                    onClick={() => handleSetPreferredProvider(name)}
                    disabled={switchingProvider || !isConfigured}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : isConfigured
                          ? 'bg-muted text-muted-foreground hover:bg-muted/80'
                          : 'bg-muted/50 text-muted-foreground/50 cursor-not-allowed'
                    }`}
                    title={!isConfigured ? `${meta.label} is not configured — add an API key first` : `Switch to ${meta.label}`}
                  >
                    {meta.icon}
                    {meta.label}
                    {switchingProvider && isActive && <Spinner size="sm" />}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {!canViewProviderIdentity && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3 text-sm">
              <Shield className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Provider details hidden</p>
                <p className="text-muted-foreground mt-1">
                  Provider names and model details are hidden for account security. You can still switch the active runtime.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isProfileLoading && (
        <ProfileGateSkeleton className="h-16" />
      )}

      {/* Routing explanation */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 text-sm">
            <Server className="h-4 w-4 text-primary shrink-0" />
            <div>
              <span className="font-medium">Managed model routing:</span>
              <span className="text-muted-foreground ml-1">
                Task routing automatically chooses available backends while respecting tenant budget and reliability constraints.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Provider Cards */}
      <div className="space-y-4">
        {providers.map((provider) => {
          const isConfigured = provider?.configured ?? false;
          const isEditing = editingProvider === provider.id;
          const canEdit = canViewProviderIdentity && !!provider.editable;
          const isPreferred = canViewProviderIdentity && provider.providerKey === preferredProvider;

          return (
            <Card key={provider.id} className={`${isConfigured ? 'border-primary/20' : ''} ${isPreferred ? 'ring-2 ring-primary/50' : ''}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
                      {canViewProviderIdentity && provider.providerKey && PROVIDER_META[provider.providerKey]
                        ? PROVIDER_META[provider.providerKey].icon
                        : <Server className="h-5 w-5" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-display font-semibold">{provider.name}</h3>
                        {isPreferred && (
                          <Badge variant="default" className="text-[10px]">Active</Badge>
                        )}
                        {isConfigured && !isPreferred && (
                          <Badge variant="secondary" className="text-[10px]">Managed</Badge>
                        )}
                        {isConfigured && (
                          <Badge variant="success" className="text-[10px] gap-1">
                            <Check className="h-2.5 w-2.5" />
                            Connected
                          </Badge>
                        )}
                      </div>
                      {canViewProviderIdentity && provider.providerKey && PROVIDER_META[provider.providerKey] && (
                        <p className="text-xs text-muted-foreground mt-0.5">{PROVIDER_META[provider.providerKey].description}</p>
                      )}
                      {!canViewProviderIdentity && (
                        <p className="text-xs text-muted-foreground mt-0.5">Secure backend slot</p>
                      )}
                      {isConfigured && provider?.model && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Model: <span className="font-mono text-foreground">{provider.model}</span>
                          {provider.keyPreview && (
                            <span className="ml-2" aria-label="API key (redacted)">
                              Key: <span className="font-mono" aria-hidden="true">••••••••</span>
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canEdit}
                    onClick={() => {
                      if (isEditing) {
                        setEditingProvider(null);
                      } else {
                        setEditingProvider(provider.id);
                        setSelectedModel(provider?.model ?? '');
                        setApiKey('');
                      }
                    }}
                  >
                    {!canEdit ? 'Restricted' : isEditing ? 'Cancel' : isConfigured ? 'Update' : 'Configure'}
                  </Button>
                </div>

                {/* Edit form */}
                {isEditing && (
                  <div className="mt-4 pt-4 border-t space-y-3">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">API Key</label>
                      <div className="relative">
                        <Input
                          type={showKey ? 'text' : 'password'}
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={isConfigured ? 'Leave empty to keep current key' : 'Enter API key'}
                          className="pr-10 font-mono text-xs"
                        />
                        <button
                          onClick={() => setShowKey(!showKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Model</label>
                      <Input
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        placeholder="Optional model override"
                        className="font-mono text-xs"
                      />
                    </div>

                    <div className="flex justify-end">
                      <Button onClick={() => handleSave(provider)} disabled={saving} className="gap-1.5">
                        {saving ? <Spinner size="sm" /> : <Key className="h-3.5 w-3.5" />}
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {providers.length === 0 && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              No backend slots available.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}