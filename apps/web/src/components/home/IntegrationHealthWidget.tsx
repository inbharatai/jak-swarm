'use client';

import React from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Plug, ArrowRight, Loader2 } from 'lucide-react';
import { dataFetcher } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardContent, StatusDot, EmptyState } from '@/components/ui';
import type { Integration, IntegrationProvider } from '@/types';

const PROVIDER_EMOJI: Record<IntegrationProvider, string> = {
  GMAIL: '\u2709\uFE0F',
  GCAL: '\uD83D\uDCC5',
  SLACK: '\uD83D\uDCAC',
  GITHUB: '\uD83D\uDC19',
  NOTION: '\uD83D\uDCD3',
  HUBSPOT: '\uD83E\uDDF2',
  DRIVE: '\uD83D\uDCC1',
};

export function IntegrationHealthWidget() {
  const { data, isLoading } = useSWR<Integration[]>(
    '/integrations',
    dataFetcher,
    { refreshInterval: 60000 },
  );

  const integrations = data ?? [];
  const connected = integrations.filter((i) => i.status === 'CONNECTED');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" />
          Integrations
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : connected.length === 0 ? (
          <EmptyState
            icon={<Plug className="h-5 w-5" />}
            title="No tools connected"
            description="Connect integrations to supercharge your agents"
            action={
              <Link
                href="/integrations"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Connect tools <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
        ) : (
          <div className="space-y-2">
            {connected.map((integration) => (
              <div
                key={integration.id}
                className="flex items-center gap-3 rounded-lg border p-2.5"
              >
                <span className="text-lg">
                  {PROVIDER_EMOJI[integration.provider] ?? '\uD83D\uDD27'}
                </span>
                <span className="flex-1 text-sm font-medium">
                  {integration.displayName ?? integration.provider}
                </span>
                <StatusDot
                  variant={
                    integration.status === 'CONNECTED'
                      ? 'online'
                      : integration.status === 'NEEDS_REAUTH'
                        ? 'warning'
                        : integration.status === 'ERROR'
                          ? 'error'
                          : 'offline'
                  }
                />
              </div>
            ))}
            <Link
              href="/integrations"
              className="block pt-1 text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Manage integrations
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
