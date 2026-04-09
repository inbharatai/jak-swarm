'use client';

import React, { useState, useCallback } from 'react';
import { Crown, Target, TrendingUp, AlertTriangle, CheckCircle2, Clock, Send, Lightbulb, BarChart3, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Spinner, Textarea } from '@/components/ui';
import useSWR from 'swr';
import { workflowApi, fetcher } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { eventBus, SHELL_EVENTS } from '@/lib/event-bus';
import type { ModuleProps } from '@/modules/registry';

interface StrategicGoal {
  id: string;
  title: string;
  status: 'active' | 'completed' | 'blocked';
  priority: 'critical' | 'high' | 'medium' | 'low';
  progress: number;
  assignedAgents: string[];
  dueDate?: string;
}

interface Insight {
  id: string;
  type: 'opportunity' | 'risk' | 'recommendation';
  title: string;
  body: string;
  source: string;
  createdAt: string;
}

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-red-500/10', text: 'text-red-500' },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-500' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-500' },
  low: { bg: 'bg-blue-500/10', text: 'text-blue-500' },
};

const INSIGHT_ICONS: Record<string, React.ReactNode> = {
  opportunity: <Lightbulb className="h-4 w-4 text-emerald-500" />,
  risk: <AlertTriangle className="h-4 w-4 text-red-500" />,
  recommendation: <Target className="h-4 w-4 text-blue-500" />,
};

export default function CEOStrategistModule({ moduleId, isActive }: ModuleProps) {
  const toast = useToast();
  const [directive, setDirective] = useState('');
  const [sending, setSending] = useState(false);

  const { data: goalsData, isLoading: goalsLoading } = useSWR<{ data: StrategicGoal[] }>('/ceo/goals', fetcher, { refreshInterval: 15000 });
  const { data: insightsData, isLoading: insightsLoading } = useSWR<{ data: Insight[] }>('/ceo/insights', fetcher, { refreshInterval: 30000 });
  const { data: kpiData } = useSWR<{ data: Record<string, number> }>('/analytics/kpi-summary', fetcher, { refreshInterval: 60000 });

  const goals: StrategicGoal[] = goalsData?.data ?? [];
  const insights: Insight[] = insightsData?.data ?? [];
  const kpis = kpiData?.data;

  const handleSendDirective = useCallback(async () => {
    if (!directive.trim()) return;
    setSending(true);
    try {
      await workflowApi.create(directive);
      eventBus.emit(SHELL_EVENTS.WORKFLOW_STARTED, { goal: directive }, 'ceo-strategist');
      eventBus.emit(SHELL_EVENTS.NOTIFICATION_PUSH, { title: 'Directive sent', body: directive, moduleId: 'ceo-strategist', priority: 'info' as const }, 'ceo-strategist');
      toast.success('Directive dispatched to swarm');
      setDirective('');
    } catch {
      toast.error('Failed to dispatch directive');
    } finally {
      setSending(false);
    }
  }, [directive, toast]);

  const activeGoals = goals.filter(g => g.status === 'active');
  const blockedGoals = goals.filter(g => g.status === 'blocked');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Directive input */}
      <div className="p-4 border-b bg-gradient-to-r from-amber-500/5 to-transparent shrink-0">
        <div className="flex items-start gap-3">
          <Crown className="h-5 w-5 text-amber-500 mt-2 shrink-0" />
          <div className="flex-1">
            <Textarea
              value={directive}
              onChange={e => setDirective(e.target.value)}
              placeholder="Enter a strategic directive... e.g. 'Research competitor pricing in the enterprise segment and draft a positioning memo'"
              rows={2}
              className="text-sm resize-none"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendDirective(); }}
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-[10px] text-muted-foreground">Ctrl+Enter to send</p>
              <Button size="sm" onClick={handleSendDirective} disabled={sending || !directive.trim()}>
                <Send className="h-3.5 w-3.5 mr-1" />{sending ? 'Sending...' : 'Dispatch'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* KPI Summary */}
        {kpis && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card><CardContent className="p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Workflows</p><p className="text-xl font-bold mt-1">{kpis.activeWorkflows ?? 0}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Today&apos;s Cost</p><p className="text-xl font-bold mt-1">${(kpis.todayCost ?? 0).toFixed(2)}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Approval Queue</p><p className="text-xl font-bold mt-1">{kpis.pendingApprovals ?? 0}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Tasks Done Today</p><p className="text-xl font-bold mt-1">{kpis.completedToday ?? 0}</p></CardContent></Card>
          </div>
        )}

        {/* Blocked Goals - urgent attention */}
        {blockedGoals.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-red-500 flex items-center gap-1.5 mb-2"><AlertTriangle className="h-4 w-4" />Blocked ({blockedGoals.length})</h3>
            <div className="space-y-2">
              {blockedGoals.map(goal => (
                <Card key={goal.id} className="border-red-500/20">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{goal.title}</p>
                      <p className="text-[10px] text-muted-foreground">{goal.assignedAgents.join(', ')}</p>
                    </div>
                    <Button size="sm" variant="outline" className="text-xs h-7">Unblock</Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Active Goals */}
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Target className="h-4 w-4" />Active Goals ({activeGoals.length})</h3>
          {activeGoals.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No active goals. Send a directive above to get started.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {activeGoals.map(goal => {
                const ps = PRIORITY_STYLES[goal.priority] ?? PRIORITY_STYLES.medium;
                return (
                  <Card key={goal.id}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{goal.title}</span>
                          <Badge variant="secondary" className={`${ps.bg} ${ps.text} text-[10px] border-0`}>{goal.priority}</Badge>
                        </div>
                        <span className="text-xs font-medium">{goal.progress}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${goal.progress}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{goal.assignedAgents.join(', ')}</span>
                        {goal.dueDate && <span>Due {goal.dueDate}</span>}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* AI Insights */}
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Lightbulb className="h-4 w-4" />AI Insights</h3>
          {insights.length === 0 ? (
            <Card><CardContent className="p-4 text-center text-sm text-muted-foreground">Insights will appear as workflows complete and patterns emerge.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {insights.slice(0, 8).map(insight => (
                <Card key={insight.id} className="group hover:ring-1 hover:ring-primary/20 transition-all">
                  <CardContent className="p-3 flex items-start gap-3">
                    {INSIGHT_ICONS[insight.type]}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{insight.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{insight.body}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">from {insight.source}</p>
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
