'use client';

import React, { useState, useEffect } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Badge, Spinner } from '@/components/ui';
import { Key, Check, AlertCircle, Eye, EyeOff, Zap, Brain, Cpu, Server, Globe, Box } from 'lucide-react';

interface LLMProvider {
  name: string;
  configured: boolean;
  keyPreview?: string;
  model?: string;
  source?: 'database' | 'env';
  url?: string;
}

const PROVIDER_META: Record<string, { icon: React.ReactNode; label: string; description: string; models: string[]; color: string; tier: string }> = {
  openai: {
    icon: <Brain className="h-5 w-5" />,
    label: 'OpenAI',
    description: 'GPT-4o, GPT-4o-mini, o1, o3',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'],
    color: '#10a37f',
    tier: 'Tier 2-3',
  },
  anthropic: {
    icon: <Zap className="h-5 w-5" />,
    label: 'Anthropic',
    description: 'Claude Sonnet 4, Claude Opus 4, Haiku',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-3-20250414'],
    color: '#d97706',
    tier: 'Tier 3',
  },
  gemini: {
    icon: <Globe className="h-5 w-5" />,
    label: 'Google Gemini',
    description: 'Gemini 2.5 Pro, Flash, Flash-Lite',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    color: '#4285f4',
    tier: 'Tier 2',
  },
  deepseek: {
    icon: <Cpu className="h-5 w-5" />,
    label: 'DeepSeek',
    description: 'DeepSeek V3, R1 — cost-optimized',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    color: '#00a67e',
    tier: 'Tier 1',
  },
  ollama: {
    icon: <Server className="h-5 w-5" />,
    label: 'Ollama (Local)',
    description: 'Run models locally — zero API cost',
    models: ['llama3.1', 'llama3.2', 'mistral', 'codellama', 'phi3', 'qwen2.5'],
    color: '#000000',
    tier: 'Tier 1',
  },
  openrouter: {
    icon: <Box className="h-5 w-5" />,
    label: 'OpenRouter',
    description: '100+ models via single API key',
    models: ['meta-llama/llama-3.1-70b-instruct', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro'],
    color: '#6366f1',
    tier: 'Tier 1-2',
  },
};

export default function SettingsPage() {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ success: boolean; data: { providers: LLMProvider[] } }>(
    '/settings/llm',
    (url: string) => apiFetch<{ success: boolean; data: { providers: LLMProvider[] } }>(url),
  );
  const providers = data?.data?.providers ?? [];

  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async (providerName: string) => {
    setSaving(true);
    try {
      await apiFetch(`/settings/llm/${providerName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey || undefined,
          model: selectedModel || undefined,
        }),
      });
      toast.success(`${PROVIDER_META[providerName]?.label ?? providerName} saved`);
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
        <h1 className="text-2xl font-display font-bold">LLM Providers</h1>
        <p className="text-muted-foreground text-sm mt-1 font-sans">
          Configure your AI model providers. JAK Swarm uses 3-tier routing to optimize cost — set up multiple providers and the system automatically selects the best model for each task.
        </p>
      </div>

      {/* Routing explanation */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 text-sm">
            <Zap className="h-4 w-4 text-primary shrink-0" />
            <div>
              <span className="font-medium">3-Tier Cost Optimization:</span>
              <span className="text-muted-foreground ml-1">
                Tier 1 (cheap workers) &rarr; Tier 2 (balanced) &rarr; Tier 3 (premium reasoning). Each agent automatically uses the right tier.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Provider Cards */}
      <div className="space-y-4">
        {Object.entries(PROVIDER_META).map(([name, meta]) => {
          const provider = providers.find(p => p.name === name);
          const isConfigured = provider?.configured ?? false;
          const isEditing = editingProvider === name;

          return (
            <Card key={name} className={isConfigured ? 'border-primary/20' : ''}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${meta.color}15`, color: meta.color }}>
                      {meta.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-display font-semibold">{meta.label}</h3>
                        <Badge variant="secondary" className="text-[10px]">{meta.tier}</Badge>
                        {isConfigured && (
                          <Badge variant="success" className="text-[10px] gap-1">
                            <Check className="h-2.5 w-2.5" />
                            Connected
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
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
                    onClick={() => {
                      if (isEditing) {
                        setEditingProvider(null);
                      } else {
                        setEditingProvider(name);
                        setSelectedModel(provider?.model ?? meta.models[0] ?? '');
                        setApiKey('');
                      }
                    }}
                  >
                    {isEditing ? 'Cancel' : isConfigured ? 'Update' : 'Configure'}
                  </Button>
                </div>

                {/* Edit form */}
                {isEditing && (
                  <div className="mt-4 pt-4 border-t space-y-3">
                    {name !== 'ollama' && (
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">API Key</label>
                        <div className="relative">
                          <Input
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={isConfigured ? 'Leave empty to keep current key' : `Enter your ${meta.label} API key`}
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
                    )}

                    {name === 'ollama' && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                        <Server className="h-4 w-4 shrink-0" />
                        <span>Ollama runs locally. Make sure Ollama is running at <code className="font-mono">localhost:11434</code></span>
                      </div>
                    )}

                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Model</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {meta.models.map(model => (
                          <button
                            key={model}
                            onClick={() => setSelectedModel(model)}
                            className={`rounded-lg border px-3 py-2 text-xs font-mono text-left transition-colors ${
                              selectedModel === model
                                ? 'border-primary bg-primary/5 text-primary'
                                : 'border-border hover:border-primary/30'
                            }`}
                          >
                            {model}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button onClick={() => handleSave(name)} disabled={saving} className="gap-1.5">
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
      </div>
    </div>
  );
}
