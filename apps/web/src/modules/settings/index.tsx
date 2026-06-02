'use client';

import React, { useState, useEffect } from 'react';
import useSWR from 'swr';
import { apiFetch, fetcher } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button, Card, CardContent, Input, Badge, Spinner } from '@/components/ui';
import { Key, Check, Eye, EyeOff, Brain, Sparkles } from 'lucide-react';
import type { ModuleProps } from '@/modules/registry';

interface LLMProvider {
  name: string;
  configured: boolean;
  keyPreview?: string;
  model?: string;
  source?: 'database' | 'env' | 'managed';
  preferred?: boolean;
  url?: string;
}

const PROVIDER_META: Record<string, { icon: React.ReactNode; label: string; description: string; models: string[]; color: string }> = {
  openai: { icon: <Brain className="h-5 w-5" />, label: 'Agent Runtime', description: 'GPT-5.5 / GPT-5.4 — agentic runtime', models: ['gpt-5.5', 'gpt-5.4'], color: '#10a37f' },
  gemini: { icon: <Sparkles className="h-5 w-5" />, label: 'Gemini Runtime', description: 'Gemini 2.5 Pro / Flash — tool calling + thinking', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'], color: '#4285f4' },
};

export default function SettingsModule({ moduleId, isActive }: ModuleProps) {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ success: boolean; data: { providers: LLMProvider[]; preferredProvider?: string } }>(
    '/settings/llm',
    fetcher,
  );
  const providers = data?.data?.providers ?? [];
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
    setSwitchingProvider(true);
    try {
      await apiFetch('/settings/llm/preferred-provider', {
        method: 'PUT',
        body: { provider },
      });
      setPreferredProvider(provider);
      toast.success(`Preferred provider set to ${PROVIDER_META[provider]?.label ?? provider}`);
      mutate();
    } catch {
      toast.error('Failed to set preferred provider');
    } finally {
      setSwitchingProvider(false);
    }
  };

  const handleSave = async (providerName: string) => {
    setSaving(true);
    try {
      await apiFetch(`/settings/llm/${providerName}`, {
        method: 'PUT',
        body: { apiKey: apiKey || undefined, model: selectedModel || undefined },
      });
      toast.success(`${PROVIDER_META[providerName]?.label ?? providerName} saved`);
      setEditingProvider(null);
      setApiKey('');
      setSelectedModel('');
      mutate();
    } catch {
      toast.error('Failed to save provider settings');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>;

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-auto">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Key className="h-5 w-5 text-primary" />Settings</h2>
        <p className="text-xs text-muted-foreground">Configure LLM providers and select your preferred runtime.</p>
      </div>

      {/* Preferred provider toggle */}
      <div className="shrink-0 flex items-center gap-3 max-w-3xl">
        <span className="text-xs text-muted-foreground font-medium">Active provider:</span>
        <div className="flex items-center gap-1.5">
          {Object.entries(PROVIDER_META).map(([name, meta]) => (
            <button
              key={name}
              onClick={() => handleSetPreferredProvider(name)}
              disabled={switchingProvider}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                preferredProvider === name
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {meta.icon}
              {meta.label}
              {switchingProvider && preferredProvider !== name && <Spinner size="sm" />}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
        {Object.entries(PROVIDER_META).map(([name, meta]) => {
          const provider = providers.find(p => p.name === name);
          const isEditing = editingProvider === name;
          const isActiveProvider = preferredProvider === name;

          return (
            <Card key={name} className={`transition-all ${provider?.configured ? 'ring-1 ring-emerald-500/30' : ''} ${isActiveProvider ? 'ring-2 ring-primary/50' : ''}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded" style={{ color: meta.color }}>{meta.icon}</div>
                    <div>
                      <p className="font-medium text-sm flex items-center gap-1.5">
                        {meta.label}
                        {isActiveProvider && <Badge variant="default" className="text-[9px] px-1.5 py-0">Active</Badge>}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{meta.description}</p>
                    </div>
                  </div>
                  {provider?.configured ? (
                    <Badge variant="success" className="text-[10px]"><Check className="h-3 w-3 mr-0.5" />Connected</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">Not configured</Badge>
                  )}
                </div>

                {provider?.configured && !isEditing && (
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {provider.keyPreview && (
                      <p>Key: <span className="font-mono" aria-hidden="true">••••••••</span></p>
                    )}
                    {provider.model && <p>Model: {provider.model}</p>}
                  </div>
                )}

                {isEditing ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <Input type={showKey ? 'text' : 'password'} placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} className="pr-8 text-xs" />
                      <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-2">{showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
                    </div>
                    <select className="w-full h-8 rounded-md border bg-background px-2 text-xs" value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
                      <option value="">Select model...</option>
                      {meta.models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => { setEditingProvider(null); setApiKey(''); }} className="h-7 text-xs">Cancel</Button>
                      <Button size="sm" onClick={() => handleSave(name)} disabled={saving} className="h-7 text-xs">{saving ? 'Saving...' : 'Save'}</Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={() => { setEditingProvider(name); setSelectedModel(provider?.model ?? ''); }}>
                    {provider?.configured ? 'Edit' : 'Configure'}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}