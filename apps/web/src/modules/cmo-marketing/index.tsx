'use client';

import React, { useState } from 'react';
import { Megaphone, Send, BarChart3, Globe, Mail, Users, TrendingUp, Calendar, Sparkles, ExternalLink } from 'lucide-react';
import { Card, CardContent, Button, Badge, Spinner, Textarea, Input } from '@/components/ui';
import useSWR from 'swr';
import { workflowApi, fetcher } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { eventBus, SHELL_EVENTS } from '@/lib/event-bus';
import type { ModuleProps } from '@/modules/registry';

interface Campaign {
  id: string;
  name: string;
  channel: 'email' | 'social' | 'content' | 'seo' | 'ads';
  status: 'draft' | 'active' | 'paused' | 'completed';
  metrics?: { sent?: number; opened?: number; clicked?: number; converted?: number };
  createdAt: string;
}

interface ContentIdea {
  id: string;
  title: string;
  channel: string;
  score: number;
  status: 'idea' | 'drafting' | 'ready' | 'published';
}

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  social: <Globe className="h-3.5 w-3.5" />,
  content: <Sparkles className="h-3.5 w-3.5" />,
  seo: <TrendingUp className="h-3.5 w-3.5" />,
  ads: <BarChart3 className="h-3.5 w-3.5" />,
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-500/10 text-gray-500',
  active: 'bg-emerald-500/10 text-emerald-500',
  paused: 'bg-amber-500/10 text-amber-500',
  completed: 'bg-blue-500/10 text-blue-500',
  idea: 'bg-purple-500/10 text-purple-500',
  drafting: 'bg-amber-500/10 text-amber-500',
  ready: 'bg-emerald-500/10 text-emerald-500',
  published: 'bg-blue-500/10 text-blue-500',
};

const QUICK_ACTIONS = [
  { label: 'Draft blog post', goal: 'Write a blog post about our latest product update', icon: <Sparkles className="h-3.5 w-3.5" /> },
  { label: 'SEO audit', goal: 'Run SEO audit on our main landing page', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { label: 'Email campaign', goal: 'Create an email nurture sequence for new signups', icon: <Mail className="h-3.5 w-3.5" /> },
  { label: 'Social posts', goal: 'Generate a week of social media posts for Twitter and LinkedIn', icon: <Globe className="h-3.5 w-3.5" /> },
  { label: 'Competitor analysis', goal: 'Research top 3 competitors and summarize positioning differences', icon: <Users className="h-3.5 w-3.5" /> },
];

export default function CMOMarketingModule({ moduleId, isActive }: ModuleProps) {
  const toast = useToast();
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);

  const { data: campaignsData } = useSWR<{ data: Campaign[] }>('/marketing/campaigns', fetcher, { refreshInterval: 30000 });
  const { data: contentData } = useSWR<{ data: ContentIdea[] }>('/marketing/content-ideas', fetcher, { refreshInterval: 30000 });

  const campaigns: Campaign[] = campaignsData?.data ?? [];
  const contentIdeas: ContentIdea[] = contentData?.data ?? [];

  const launchTask = async (goal: string) => {
    setSending(true);
    try {
      await workflowApi.create(goal);
      eventBus.emit(SHELL_EVENTS.WORKFLOW_STARTED, { goal }, 'cmo-marketing');
      toast.success('Marketing task launched');
      setPrompt('');
    } catch {
      toast.error('Failed to launch task');
    } finally {
      setSending(false);
    }
  };

  const activeCampaigns = campaigns.filter(c => c.status === 'active');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Prompt bar */}
      <div className="p-4 border-b bg-gradient-to-r from-violet-500/5 to-transparent shrink-0">
        <div className="flex items-start gap-3">
          <Megaphone className="h-5 w-5 text-violet-500 mt-2 shrink-0" />
          <div className="flex-1">
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe a marketing task... e.g. 'Create a product launch email sequence for our new feature'"
              rows={2}
              className="text-sm resize-none"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) launchTask(prompt); }}
            />
            <div className="flex items-center justify-between mt-2">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_ACTIONS.map(action => (
                  <button
                    key={action.label}
                    onClick={() => launchTask(action.goal)}
                    className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                  >
                    {action.icon}{action.label}
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={() => launchTask(prompt)} disabled={sending || !prompt.trim()}>
                <Send className="h-3.5 w-3.5 mr-1" />{sending ? 'Sending...' : 'Launch'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Active Campaigns */}
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Calendar className="h-4 w-4" />Active Campaigns ({activeCampaigns.length})</h3>
          {activeCampaigns.length === 0 ? (
            <Card><CardContent className="p-4 text-center text-sm text-muted-foreground">No active campaigns. Launch one above.</CardContent></Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {activeCampaigns.map(campaign => (
                <Card key={campaign.id} className="hover:ring-1 hover:ring-primary/20 transition-all">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {CHANNEL_ICONS[campaign.channel]}
                        <span className="text-sm font-medium">{campaign.name}</span>
                      </div>
                      <Badge variant="secondary" className={`${STATUS_STYLES[campaign.status]} text-[10px] border-0`}>{campaign.status}</Badge>
                    </div>
                    {campaign.metrics && (
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div><p className="text-xs font-bold">{campaign.metrics.sent ?? 0}</p><p className="text-[9px] text-muted-foreground">Sent</p></div>
                        <div><p className="text-xs font-bold">{campaign.metrics.opened ?? 0}</p><p className="text-[9px] text-muted-foreground">Opened</p></div>
                        <div><p className="text-xs font-bold">{campaign.metrics.clicked ?? 0}</p><p className="text-[9px] text-muted-foreground">Clicked</p></div>
                        <div><p className="text-xs font-bold">{campaign.metrics.converted ?? 0}</p><p className="text-[9px] text-muted-foreground">Converted</p></div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* All Campaigns */}
        {campaigns.filter(c => c.status !== 'active').length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2">Other Campaigns</h3>
            <div className="space-y-2">
              {campaigns.filter(c => c.status !== 'active').map(campaign => (
                <Card key={campaign.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {CHANNEL_ICONS[campaign.channel]}
                      <span className="text-sm">{campaign.name}</span>
                    </div>
                    <Badge variant="secondary" className={`${STATUS_STYLES[campaign.status]} text-[10px] border-0`}>{campaign.status}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Content Ideas */}
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Sparkles className="h-4 w-4" />Content Pipeline ({contentIdeas.length})</h3>
          {contentIdeas.length === 0 ? (
            <Card><CardContent className="p-4 text-center text-sm text-muted-foreground">AI-generated content ideas will appear as campaigns run.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {contentIdeas.slice(0, 10).map(idea => (
                <Card key={idea.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">{idea.title}</span>
                      <Badge variant="secondary" className="text-[10px] shrink-0">{idea.channel}</Badge>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-muted-foreground">Score: {idea.score}</span>
                      <Badge variant="secondary" className={`${STATUS_STYLES[idea.status]} text-[10px] border-0`}>{idea.status}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
