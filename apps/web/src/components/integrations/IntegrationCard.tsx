'use client';

import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Card, CardContent, Button, StatusDot } from '@/components/ui';
import type { Integration, IntegrationProvider } from '@/types';

export interface ProviderMeta {
  name: string;
  emoji: string;
  description: string;
  agents: string[];
}

export const PROVIDER_META: Record<IntegrationProvider, ProviderMeta> = {
  GMAIL: {
    name: 'Gmail',
    emoji: '\u2709\uFE0F',
    description: 'Send, read, and manage emails',
    agents: ['Email Agent', 'Support Agent'],
  },
  GCAL: {
    name: 'Google Calendar',
    emoji: '\uD83D\uDCC5',
    description: 'Manage calendar events and scheduling',
    agents: ['Calendar Agent', 'Ops Agent'],
  },
  SLACK: {
    name: 'Slack',
    emoji: '\uD83D\uDCAC',
    description: 'Send messages and manage channels',
    agents: ['Communication Agent'],
  },
  GITHUB: {
    name: 'GitHub',
    emoji: '\uD83D\uDC19',
    description: 'Manage repositories, PRs, and issues',
    agents: ['Coder Agent', 'Research Agent'],
  },
  NOTION: {
    name: 'Notion',
    emoji: '\uD83D\uDCD3',
    description: 'Read and write Notion pages and databases',
    agents: ['Knowledge Agent', 'Document Agent'],
  },
  HUBSPOT: {
    name: 'HubSpot',
    emoji: '\uD83E\uDDF2',
    description: 'Manage CRM contacts, deals, and pipelines',
    agents: ['CRM Agent', 'Sales Agent'],
  },
  DRIVE: {
    name: 'Google Drive',
    emoji: '\uD83D\uDCC1',
    description: 'Access and manage files in Google Drive',
    agents: ['Document Agent', 'Research Agent'],
  },
  LINKEDIN: {
    name: 'LinkedIn',
    emoji: '\uD83D\uDCBC',
    description: 'Post updates, fetch profile data, and enrich contacts',
    agents: ['CMO Agent', 'Marketing Agent', 'CRM Agent'],
  },
  SALESFORCE: {
    name: 'Salesforce',
    emoji: '\u2601\uFE0F',
    description: 'Sync leads, contacts, opportunities, and pipeline activity',
    agents: ['CRM Agent', 'Sales Agent'],
  },
};

interface IntegrationCardProps {
  provider: IntegrationProvider;
  integration?: Integration;
  onConnect: (provider: IntegrationProvider) => void;
  onDisconnect: (id: string) => void;
  /**
   * Phase 2 — fires when the user clicks "Run audit" on a connected
   * card. Wired from page.tsx to the existing `workflowApi.create`
   * with a layman-friendly per-provider goal. Optional so the card
   * keeps working in places that don't yet wire the audit button
   * (e.g., onboarding previews).
   */
  onRunAudit?: (provider: IntegrationProvider) => void;
  isLoading?: boolean;
  /** True while the parent is creating the audit workflow. */
  auditLoading?: boolean;
}

export function IntegrationCard({
  provider,
  integration,
  onConnect,
  onDisconnect,
  onRunAudit,
  isLoading,
  auditLoading,
}: IntegrationCardProps) {
  const meta = PROVIDER_META[provider];
  const isConnected = integration?.status === 'CONNECTED';
  const needsReauth = integration?.status === 'NEEDS_REAUTH';
  const hasError = integration?.status === 'ERROR';
  const maturity = integration?.maturity;
  const maturityTone =
    maturity === 'production-ready'
      ? 'text-green-700 bg-green-50'
      : maturity === 'beta'
        ? 'text-blue-700 bg-blue-50'
        : maturity === 'partial'
          ? 'text-amber-700 bg-amber-50'
          : 'text-slate-700 bg-slate-100';

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <span className="text-3xl">{meta.emoji}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{meta.name}</h3>
              {isConnected && <StatusDot variant="online" />}
              {needsReauth && <StatusDot variant="warning" />}
              {hasError && <StatusDot variant="error" />}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
            {maturity && (
              <div className="mt-1 flex items-center gap-2">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${maturityTone}`}>
                  {maturity}
                </span>
              </div>
            )}
            {integration?.note && (
              <p className="mt-1 text-[10px] text-muted-foreground">{integration.note}</p>
            )}
            {isConnected && integration?.metadata && typeof (integration.metadata as Record<string, unknown>).toolCount === 'number' && (integration.metadata as Record<string, unknown>).toolCount as number > 0 && (
              <p className="text-[10px] text-green-600 mt-1">
                {(integration.metadata as Record<string, unknown>).toolCount as number} tools active
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {meta.agents.map((agent) => (
                <span
                  key={agent}
                  className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                >
                  {agent}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {isConnected ? (
            <>
              {/* Phase 2 — primary "Run audit" CTA on connected cards.
                  Optional: only renders when a parent wires onRunAudit.
                  Layman copy ("Run audit") matches the brief; the
                  underlying call is the existing workflow API. */}
              {onRunAudit && (
                <Button
                  variant="default"
                  size="sm"
                  className="w-full gap-1.5"
                  disabled={auditLoading}
                  onClick={() => onRunAudit(provider)}
                  data-testid={`run-audit-${provider.toLowerCase()}`}
                >
                  {auditLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3" />
                      Run audit
                    </>
                  )}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={isLoading}
                onClick={() => integration && onDisconnect(integration.id)}
              >
                {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Disconnect'}
              </Button>
            </>
          ) : needsReauth ? (
            <Button
              variant="default"
              size="sm"
              className="w-full"
              disabled={isLoading}
              onClick={() => onConnect(provider)}
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reconnect'}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              className="w-full"
              disabled={isLoading}
              onClick={() => onConnect(provider)}
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Connect'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
