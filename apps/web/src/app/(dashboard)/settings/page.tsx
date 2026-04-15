'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Badge, Spinner } from '@/components/ui';
import { Key, Check, Eye, EyeOff, Server, AlertTriangle, Shield } from 'lucide-react';

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
}

export default function SettingsPage() {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ success: boolean; data: { providers: LLMProvider[]; canViewProviderIdentity: boolean } }>(
    '/settings/llm',
    (url: string) => apiFetch<{ success: boolean; data: { providers: LLMProvider[]; canViewProviderIdentity: boolean } }>(url),
  );
  const providers = data?.data?.providers ?? [];
  const canViewProviderIdentity = data?.data?.canViewProviderIdentity ?? false;

  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-display font-bold">AI Backends</h1>
        <p className="text-muted-foreground text-sm mt-1 font-sans">
          Backend provider identity is restricted. Access to provider-level configuration is owner-only.
        </p>
      </div>

      {!canViewProviderIdentity && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3 text-sm">
              <Shield className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Provider identity hidden</p>
                <p className="text-muted-foreground mt-1">
                  Provider names and model details are intentionally hidden for account security.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
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

          return (
            <Card key={provider.id} className={isConfigured ? 'border-primary/20' : ''}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
                      <Server className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-display font-semibold">{provider.name}</h3>
                        <Badge variant="secondary" className="text-[10px]">Managed</Badge>
                        {isConfigured && (
                          <Badge variant="success" className="text-[10px] gap-1">
                            <Check className="h-2.5 w-2.5" />
                            Connected
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">Secure backend slot</p>
                      {isConfigured && provider?.model && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Model: <span className="font-mono text-foreground">{provider.model}</span>
                          {provider.keyPreview && <span className="ml-2">Key: {provider.keyPreview}</span>}
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
