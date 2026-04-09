'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import { skillApi, fetcher } from '@/lib/api-client';
import { Button, Card, CardContent, Badge, Input, Spinner, EmptyState, Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogCloseButton, Textarea } from '@/components/ui';
import { Plus, Search, Package, Zap, Shield, Code2, Download } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import type { ModuleProps } from '@/modules/registry';

const SKILL_STATUS_MAP: Record<string, { label: string; variant: 'default' | 'success' | 'destructive' | 'warning' | 'secondary' }> = {
  ACTIVE: { label: 'Active', variant: 'success' },
  PROPOSED: { label: 'Proposed', variant: 'warning' },
  SANDBOX_TESTING: { label: 'Testing', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
  DEPRECATED: { label: 'Deprecated', variant: 'secondary' },
};

const RISK_COLORS: Record<string, string> = {
  LOW: 'text-emerald-400',
  MEDIUM: 'text-amber-400',
  HIGH: 'text-red-400',
};

const TIER_LABELS: Record<number, { label: string; icon: React.ReactNode; desc: string }> = {
  1: { label: 'Built-in', icon: <Zap className="h-3.5 w-3.5" />, desc: 'Platform-provided, always available' },
  2: { label: 'Community', icon: <Package className="h-3.5 w-3.5" />, desc: 'Generated or community-contributed' },
  3: { label: 'Custom', icon: <Code2 className="h-3.5 w-3.5" />, desc: 'Your custom skills with sandboxed code' },
};

const SKILL_MARKETPLACE = [
  { id: 'pdf-analyzer', name: 'PDF Analyzer', description: 'Extract text from PDFs and analyze content with AI vision', tier: 1, riskLevel: 'LOW', category: 'Document' },
  { id: 'seo-audit', name: 'SEO Audit', description: 'Audit page SEO: title, meta, H1 tags, images, viewport', tier: 1, riskLevel: 'LOW', category: 'Marketing' },
  { id: 'customer-health', name: 'Customer Health Tracker', description: 'Track customer health scores and flag at-risk accounts', tier: 1, riskLevel: 'LOW', category: 'Success' },
  { id: 'web-extract', name: 'Web Content Extractor', description: 'Navigate to URLs and extract text using CSS selectors', tier: 1, riskLevel: 'LOW', category: 'Browser' },
  { id: 'social-poster', name: 'Social Media Poster', description: 'Post content to Twitter, LinkedIn, Reddit via automation', tier: 1, riskLevel: 'MEDIUM', category: 'Marketing' },
  { id: 'email-sequences', name: 'Email Sequence Builder', description: 'Create multi-step email sequences with template variables', tier: 1, riskLevel: 'MEDIUM', category: 'Email' },
  { id: 'contact-enrichment', name: 'Contact Enrichment', description: 'Enrich contacts with company info and LinkedIn URLs', tier: 1, riskLevel: 'LOW', category: 'CRM' },
  { id: 'tech-debt-scanner', name: 'Tech Debt Scanner', description: 'Scan code for TODO/FIXME/HACK and deprecated API usage', tier: 1, riskLevel: 'LOW', category: 'Engineering' },
  { id: 'lead-scoring', name: 'Lead Scoring', description: 'Score leads based on engagement and behavioral signals', tier: 1, riskLevel: 'LOW', category: 'Sales' },
  { id: 'sandbox-runner', name: 'Code Sandbox', description: 'Execute code in isolated sandboxes with file system access', tier: 1, riskLevel: 'HIGH', category: 'Engineering' },
];

interface Skill {
  id: string;
  name: string;
  description: string;
  tier: number;
  status: string;
  riskLevel: string;
  permissions: string[];
  implementation?: string;
  createdAt: string;
}

export default function SkillsModule({ moduleId, isActive }: ModuleProps) {
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'installed' | 'marketplace' | 'create'>('installed');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSkill, setNewSkill] = useState({ name: '', description: '', riskLevel: 'MEDIUM', implementation: '' });

  const { data: skillsData, isLoading, mutate } = useSWR<{ success: boolean; data: Skill[] }>(
    '/skills',
    fetcher,
  );
  const skills = skillsData?.data ?? [];

  const filteredSkills = skills.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredMarketplace = SKILL_MARKETPLACE.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.category.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleCreateSkill = async () => {
    if (!newSkill.name.trim()) return;
    setCreating(true);
    try {
      await skillApi.propose({
        name: newSkill.name,
        description: newSkill.description,
        riskLevel: newSkill.riskLevel,
        implementation: newSkill.implementation,
      });
      toast.success('Skill proposed for review');
      setShowCreateDialog(false);
      setNewSkill({ name: '', description: '', riskLevel: 'MEDIUM', implementation: '' });
      mutate();
    } catch {
      toast.error('Failed to create skill');
    } finally {
      setCreating(false);
    }
  };

  const handleInstallMarketplace = async (skill: typeof SKILL_MARKETPLACE[0]) => {
    try {
      await skillApi.propose({
        name: skill.name,
        description: skill.description,
        tier: skill.tier,
        riskLevel: skill.riskLevel,
      });
      toast.success(`${skill.name} installed`);
      mutate();
    } catch {
      toast.error('Failed to install skill');
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-full"><Spinner size="lg" /></div>;

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          {(['installed', 'marketplace', 'create'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`text-sm font-medium pb-1 border-b-2 transition-colors ${activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {tab === 'installed' ? `Installed (${skills.length})` : tab === 'marketplace' ? 'Marketplace' : 'Create'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input className="pl-8 h-8 w-48 text-xs" placeholder="Search skills..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
          {activeTab === 'create' && <Button size="sm" onClick={() => setShowCreateDialog(true)}><Plus className="h-3.5 w-3.5 mr-1" />New Skill</Button>}
        </div>
      </div>

      {/* Content */}
      {activeTab === 'installed' && (
        filteredSkills.length === 0
          ? <EmptyState icon={<Package className="h-10 w-10" />} title="No skills installed" description="Install skills from the marketplace or create your own" />
          : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredSkills.map(skill => (
                <Card key={skill.id} className="group">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {TIER_LABELS[skill.tier]?.icon}
                        <span className="font-medium text-sm">{skill.name}</span>
                      </div>
                      <Badge variant={SKILL_STATUS_MAP[skill.status]?.variant ?? 'default'} className="text-[10px]">{SKILL_STATUS_MAP[skill.status]?.label ?? skill.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <Shield className={`h-3 w-3 ${RISK_COLORS[skill.riskLevel] ?? ''}`} />
                      <span className="text-muted-foreground">{skill.riskLevel} risk</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
      )}

      {activeTab === 'marketplace' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMarketplace.map(skill => (
            <Card key={skill.id} className="group hover:ring-1 hover:ring-primary/30 transition-all">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <span className="font-medium text-sm">{skill.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{skill.category}</Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <Shield className={`h-3 w-3 ${RISK_COLORS[skill.riskLevel] ?? ''}`} />
                    <span className="text-muted-foreground">{skill.riskLevel}</span>
                  </div>
                  <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => handleInstallMarketplace(skill)}>
                    <Download className="h-3 w-3 mr-1" />Install
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'create' && (
        <div className="max-w-lg space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">Create custom skills with sandboxed code execution. Skills go through a review process before activation.</p>
              <Button onClick={() => setShowCreateDialog(true)}><Plus className="h-4 w-4 mr-2" />Create Custom Skill</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)}>
        <DialogHeader>
          <DialogTitle>Create Custom Skill</DialogTitle>
          <DialogCloseButton onClick={() => setShowCreateDialog(false)} />
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Input label="Name" value={newSkill.name} onChange={e => setNewSkill(p => ({ ...p, name: e.target.value }))} placeholder="my-custom-skill" />
          <Input label="Description" value={newSkill.description} onChange={e => setNewSkill(p => ({ ...p, description: e.target.value }))} placeholder="What does this skill do?" />
          <Textarea label="Implementation (TypeScript)" value={newSkill.implementation} onChange={e => setNewSkill(p => ({ ...p, implementation: e.target.value }))} rows={8} className="font-mono text-sm" placeholder="export default async function execute(input: any) { ... }" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
          <Button onClick={handleCreateSkill} disabled={creating}>{creating ? 'Creating...' : 'Submit for Review'}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
