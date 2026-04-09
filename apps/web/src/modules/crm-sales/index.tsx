'use client';

import React, { useState } from 'react';
import { HandCoins, UserPlus, Search, Phone, Mail, Building2, TrendingUp } from 'lucide-react';
import { Card, CardContent, Button, Badge, Input, Spinner, EmptyState } from '@/components/ui';
import useSWR from 'swr';
import { workflowApi, fetcher } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { eventBus, SHELL_EVENTS } from '@/lib/event-bus';
import type { ModuleProps } from '@/modules/registry';

interface Lead {
  id: string;
  name: string;
  email: string;
  company?: string;
  title?: string;
  score: number;
  stage: 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'closed-won' | 'closed-lost';
  source?: string;
  lastActivity?: string;
  value?: number;
}

interface PipelineSummary {
  totalLeads: number;
  totalValue: number;
  byStage: Record<string, { count: number; value: number }>;
  conversionRate: number;
}

const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  'new': { label: 'New', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  'contacted': { label: 'Contacted', color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
  'qualified': { label: 'Qualified', color: 'text-violet-500', bg: 'bg-violet-500/10' },
  'proposal': { label: 'Proposal', color: 'text-amber-500', bg: 'bg-amber-500/10' },
  'negotiation': { label: 'Negotiation', color: 'text-orange-500', bg: 'bg-orange-500/10' },
  'closed-won': { label: 'Won', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  'closed-lost': { label: 'Lost', color: 'text-red-500', bg: 'bg-red-500/10' },
};

const PIPELINE_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'closed-won'] as const;

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-emerald-500 bg-emerald-500/10' : score >= 50 ? 'text-amber-500 bg-amber-500/10' : 'text-gray-500 bg-gray-500/10';
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${color}`}>{score}</span>;
}

export default function CRMSalesModule({ moduleId, isActive }: ModuleProps) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'score' | 'value' | 'recent'>('score');

  const { data: leadsData, isLoading, mutate } = useSWR<{ data: Lead[] }>('/crm/leads', fetcher, { refreshInterval: 30000 });
  const { data: pipelineData } = useSWR<{ data: PipelineSummary }>('/crm/pipeline-summary', fetcher, { refreshInterval: 30000 });

  const leads: Lead[] = leadsData?.data ?? [];
  const pipeline: PipelineSummary | undefined = pipelineData?.data;

  const filtered = leads
    .filter(l => {
      if (stageFilter && l.stage !== stageFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return l.name.toLowerCase().includes(q) || l.email.toLowerCase().includes(q) || (l.company?.toLowerCase().includes(q) ?? false);
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'score') return b.score - a.score;
      if (sortBy === 'value') return (b.value ?? 0) - (a.value ?? 0);
      return 0;
    });

  const handleEnrich = async (leadId: string) => {
    try {
      await workflowApi.create(`Enrich lead ${leadId} with company data`);
      eventBus.emit(SHELL_EVENTS.WORKFLOW_STARTED, { goal: 'Lead enrichment' }, 'crm-sales');
      toast.success('Enrichment workflow started');
    } catch {
      toast.error('Failed to start enrichment');
    }
  };

  const handleOutreach = async (lead: Lead) => {
    try {
      await workflowApi.create(`Draft personalized outreach email for ${lead.name} at ${lead.company}`);
      eventBus.emit(SHELL_EVENTS.WORKFLOW_STARTED, { goal: 'Outreach draft' }, 'crm-sales');
      toast.success('Outreach workflow started');
    } catch {
      toast.error('Failed to start outreach');
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Pipeline overview */}
      <div className="p-4 border-b shrink-0">
        <div className="flex items-center gap-3 overflow-x-auto pb-1">
          {PIPELINE_STAGES.map(stage => {
            const config = STAGE_CONFIG[stage];
            const stageData = pipeline?.byStage?.[stage];
            return (
              <button
                key={stage}
                onClick={() => setStageFilter(stageFilter === stage ? '' : stage)}
                className={`flex flex-col items-center p-2 rounded-lg min-w-[80px] transition-all border ${stageFilter === stage ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/50'}`}
              >
                <span className={`text-lg font-bold ${config.color}`}>{stageData?.count ?? 0}</span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">{config.label}</span>
                {stageData?.value ? <span className="text-[9px] text-muted-foreground">{formatCurrency(stageData.value)}</span> : null}
              </button>
            );
          })}
          {pipeline && (
            <div className="flex flex-col items-center p-2 ml-auto min-w-[80px]">
              <span className="text-lg font-bold text-primary">{formatCurrency(pipeline.totalValue)}</span>
              <span className="text-[10px] text-muted-foreground">Total Pipeline</span>
              <span className="text-[9px] text-muted-foreground">{pipeline.conversionRate}% conv.</span>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="pl-8 h-7 text-xs" placeholder="Search leads..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {(['score', 'value', 'recent'] as const).map(s => (
            <button key={s} onClick={() => setSortBy(s)} className={`px-2 py-1 rounded text-[10px] ${sortBy === s ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
              {s}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs"><UserPlus className="h-3 w-3 mr-1" />Add Lead</Button>
      </div>

      {/* Lead list */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<HandCoins className="h-10 w-10" />} title="No leads found" description={search ? 'Try a different search term' : 'Leads will appear as enrichment workflows complete'} />
        ) : (
          <div className="divide-y">
            {filtered.map(lead => {
              const stageConfig = STAGE_CONFIG[lead.stage] ?? STAGE_CONFIG['new'];
              return (
                <div key={lead.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{lead.name}</span>
                      <ScoreBadge score={lead.score} />
                      <Badge variant="secondary" className={`${stageConfig.bg} ${stageConfig.color} text-[10px] border-0`}>{stageConfig.label}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                      {lead.company && <span className="flex items-center gap-0.5"><Building2 className="h-3 w-3" />{lead.company}</span>}
                      {lead.title && <span>{lead.title}</span>}
                      <span className="flex items-center gap-0.5"><Mail className="h-3 w-3" />{lead.email}</span>
                    </div>
                  </div>
                  {lead.value && <span className="text-sm font-medium shrink-0">{formatCurrency(lead.value)}</span>}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={() => handleOutreach(lead)} className="p-1.5 rounded hover:bg-muted" title="AI Outreach"><Mail className="h-3.5 w-3.5" /></button>
                    <button onClick={() => handleEnrich(lead.id)} className="p-1.5 rounded hover:bg-muted" title="Enrich"><TrendingUp className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
