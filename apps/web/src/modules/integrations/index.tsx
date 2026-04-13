'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import { Plug } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { dataFetcher, integrationApi } from '@/lib/api-client';
import { IntegrationCard, PROVIDER_META } from '@/components/integrations/IntegrationCard';
import { ConnectModal } from '@/components/integrations/ConnectModal';
import type { Integration, IntegrationProvider } from '@/types';
import type { ModuleProps } from '@/modules/registry';

const ALL_PROVIDERS: IntegrationProvider[] = [
  'GMAIL', 'GCAL', 'SLACK', 'GITHUB', 'NOTION', 'HUBSPOT', 'DRIVE',
];

export default function IntegrationsModule({ moduleId, isActive }: ModuleProps) {
  const toast = useToast();
  const { data, mutate } = useSWR<Integration[]>('/integrations', dataFetcher, { refreshInterval: 30000 });

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<IntegrationProvider | null>(null);

  const integrations = data ?? [];

  const integrationByProvider = (provider: IntegrationProvider) =>
    integrations.find(i => i.provider === provider);

  const connectedProviders = ALL_PROVIDERS.filter(p => integrationByProvider(p)?.status === 'CONNECTED');
  const availableProviders = ALL_PROVIDERS.filter(p => integrationByProvider(p)?.status !== 'CONNECTED');

  const handleConnect = (provider: IntegrationProvider) => {
    setConnectingProvider(provider);
  };

  const handleDisconnect = async (id: string) => {
    setLoadingId(id);
    try {
      await integrationApi.disconnect(id);
      await mutate();
    } catch (err) {
      toast.error('Failed to disconnect', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setLoadingId(null);
    }
  };

  const meta = connectingProvider ? PROVIDER_META[connectingProvider] : null;

  return (
    <div className="flex flex-col h-full p-4 gap-6 overflow-auto">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Plug className="h-5 w-5 text-primary" />Integrations
        </h2>
        <p className="text-xs text-muted-foreground">Connect tools to enable agents to work across your stack</p>
      </div>

      {connectedProviders.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-3">Connected</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {connectedProviders.map(provider => (
              <IntegrationCard
                key={provider}
                provider={provider}
                integration={integrationByProvider(provider)}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                isLoading={loadingId === provider || loadingId === integrationByProvider(provider)?.id}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold mb-3">Available</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {availableProviders.map(provider => (
            <IntegrationCard
              key={provider}
              provider={provider}
              integration={integrationByProvider(provider)}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              isLoading={loadingId === provider}
            />
          ))}
        </div>
      </section>

      {connectingProvider && meta && (
        <ConnectModal
          provider={connectingProvider}
          providerName={meta.name}
          providerEmoji={meta.emoji}
          onClose={() => setConnectingProvider(null)}
          onConnected={() => { setConnectingProvider(null); mutate(); }}
        />
      )}
    </div>
  );
}
