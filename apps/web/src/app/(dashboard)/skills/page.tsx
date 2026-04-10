'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';
import { Button, Card, CardContent, Badge, Input, Spinner, EmptyState, Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogCloseButton } from '@/components/ui';
import { Textarea } from '@/components/ui';
import { Plus, Search, Package, Zap, Shield, Code2, CheckCircle, XCircle, Clock, ExternalLink, Download } from 'lucide-react';
import { useToast } from '@/components/ui/toast';

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

// Pre-built skill templates — ONLY skills backed by REAL tools in the codebase
const SKILL_MARKETPLACE = [
  // ── VERIFIED: Backed by real tool implementations ──────────────────────
  { id: 'pdf-analyzer', name: 'PDF Analyzer', description: 'Extract text from PDFs and analyze content with AI vision (pdf_extract_text + pdf_analyze tools)', tier: 1, riskLevel: 'LOW', category: 'Document' },
  { id: 'seo-audit', name: 'SEO Audit', description: 'Audit page SEO: title, meta description, H1 tags, images, viewport, canonical URLs, JSON-LD schema (audit_seo tool)', tier: 1, riskLevel: 'LOW', category: 'Marketing' },
  { id: 'customer-health', name: 'Customer Health Tracker', description: 'Track customer health scores over time, detect trends, and flag at-risk accounts (track_customer_health tool)', tier: 1, riskLevel: 'LOW', category: 'Success' },
  { id: 'web-extract', name: 'Web Content Extractor', description: 'Navigate to any URL and extract text content using CSS selectors via Playwright (browser_extract + browser_navigate tools)', tier: 1, riskLevel: 'LOW', category: 'Browser' },
  { id: 'social-poster', name: 'Social Media Poster', description: 'Post content to Twitter, LinkedIn, and Reddit via browser automation. Requires logged-in browser sessions. (post_to_twitter/linkedin/reddit tools)', tier: 1, riskLevel: 'MEDIUM', category: 'Marketing' },
  { id: 'email-sequences', name: 'Email Sequence Builder', description: 'Create multi-step email sequences with template variables like {{name}}, {{company}} and track engagement (create_email_sequence + personalize_email tools)', tier: 1, riskLevel: 'MEDIUM', category: 'Email' },
  { id: 'contact-enrichment', name: 'Contact Enrichment', description: 'Enrich contact records with company info and LinkedIn URLs via web search. Note: does not access social APIs directly. (enrich_contact + enrich_company tools)', tier: 1, riskLevel: 'LOW', category: 'CRM' },
  { id: 'tech-debt-scanner', name: 'Tech Debt Scanner', description: 'Scan code for TODO/FIXME/HACK comments, empty catch blocks, @ts-ignore directives, and deprecated API usage (estimate_tech_debt tool)', tier: 1, riskLevel: 'LOW', category: 'Engineering' },
  { id: 'competitor-news', name: 'Competitor News Monitor', description: 'Search for recent news and updates about competitors via DuckDuckGo. Returns news snippets, not feature/pricing tracking. (monitor_competitors tool)', tier: 1, riskLevel: 'LOW', category: 'Strategy' },
  { id: 'contract-compare', name: 'Contract Comparison', description: 'Compare two contracts side-by-side and extract key dates, obligations, and terms using pattern matching (compare_contracts + extract_obligations tools)', tier: 1, riskLevel: 'LOW', category: 'Legal' },
  { id: 'financial-csv', name: 'Financial CSV Parser', description: 'Parse financial CSV files into structured rows with column sums and averages. Note: not a modeling tool. (parse_financial_csv tool)', tier: 1, riskLevel: 'LOW', category: 'Finance' },
  { id: 'image-generator', name: 'AI Image Generator', description: 'Generate images using DALL-E 3 from text descriptions for social media, marketing, and design (generate_image tool)', tier: 1, riskLevel: 'LOW', category: 'Creative' },
  { id: 'keyword-research', name: 'SEO Keyword Research', description: 'Research keywords, analyze search intent, and find content opportunities with volume estimates (research_keywords + analyze_serp tools)', tier: 1, riskLevel: 'LOW', category: 'Marketing' },
  { id: 'lead-scoring', name: 'Lead Scoring', description: 'Score leads based on engagement, fit criteria, and behavioral signals for sales prioritization (score_lead + predict_churn tools)', tier: 1, riskLevel: 'LOW', category: 'Sales' },
  { id: 'sandbox-runner', name: 'Code Sandbox', description: 'Execute code in isolated E2B or Docker sandboxes with file system access, npm install, and dev server preview (sandbox_create + sandbox_exec tools)', tier: 1, riskLevel: 'HIGH', category: 'Engineering' },
  { id: 'webhook-sender', name: 'Webhook Sender', description: 'Send HTTP webhooks to any URL with custom headers, body, and method. Supports JSON and form-encoded payloads. (send_webhook + api_call tools)', tier: 1, riskLevel: 'MEDIUM', category: 'Integration' },
  // ── VERIFICATION & RISK INTELLIGENCE ──────────────────────────────────
  { id: 'email-threat-detector', name: 'Email Threat Detector', description: 'Detect phishing, spoofing, BEC, credential harvesting, and social engineering in emails. 4-layer analysis: rules → AI → premium → human review. (verify_email tool)', tier: 1, riskLevel: 'LOW', category: 'Security' },
  { id: 'document-verifier', name: 'Document Verifier', description: 'Check documents for tampering, forgery indicators, metadata anomalies, and fake certificates. (verify_document tool)', tier: 1, riskLevel: 'LOW', category: 'Security' },
  { id: 'transaction-risk', name: 'Transaction Risk Analyzer', description: 'Detect invoice fraud, payment anomalies, bank detail changes (BEC), duplicate invoices, and suspicious amounts. (verify_transaction tool)', tier: 1, riskLevel: 'LOW', category: 'Security' },
  { id: 'identity-verifier', name: 'Identity Verifier', description: 'Verify resumes, credentials, and identity documents for timeline consistency, impossible claims, and credential validity. (verify_identity tool)', tier: 1, riskLevel: 'LOW', category: 'Security' },
  { id: 'cross-evidence', name: 'Cross-Evidence Analyzer', description: 'Correlate findings across emails, documents, transactions, and identities to detect coordinated fraud like BEC attacks. (cross_verify tool)', tier: 1, riskLevel: 'LOW', category: 'Security' },
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

export default function SkillsPage() {
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'installed' | 'marketplace' | 'create'>('installed');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSkill, setNewSkill] = useState({
    name: '',
    description: '',
    riskLevel: 'MEDIUM',
    implementation: '',
  });

  const { data: skillsData, isLoading, mutate } = useSWR<{ success: boolean; data: Skill[] }>(
    '/skills',
    (url: string) => apiFetch<{ success: boolean; data: Skill[] }>(url),
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
      await apiFetch('/skills/propose', {
        method: 'POST',
        body: {
          name: newSkill.name,
          description: newSkill.description,
          riskLevel: newSkill.riskLevel,
          implementation: newSkill.implementation || undefined,
          tier: newSkill.implementation ? 3 : 2,
        },
      });
      setShowCreateDialog(false);
      setNewSkill({ name: '', description: '', riskLevel: 'MEDIUM', implementation: '' });
      mutate();
    } catch (e) {
      toast.error('Failed to create skill', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Skills</h1>
          <p className="text-muted-foreground text-sm mt-1 font-sans">Browse, install, and create custom skills for your agents.</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Create Skill
        </Button>
      </div>

      {/* Search + Tabs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search skills..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-1" role="tablist">
          {(['installed', 'marketplace', 'create'] as const).map(tab => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === tab ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'installed' ? `Installed (${skills.length})` : tab === 'marketplace' ? 'Marketplace' : 'Create'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {activeTab === 'installed' && (
        <div>
          {isLoading ? (
            <div className="flex items-center justify-center min-h-[200px]"><Spinner /></div>
          ) : filteredSkills.length === 0 ? (
            <EmptyState
              icon={<Package className="h-12 w-12" />}
              title="No skills installed"
              description="Browse the marketplace to add skills, or create your own."
              action={<Button onClick={() => setActiveTab('marketplace')} className="gap-2"><Download className="h-4 w-4" /> Browse Marketplace</Button>}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredSkills.map(skill => {
                const tierInfo = TIER_LABELS[skill.tier] ?? TIER_LABELS[1]!;
                const statusInfo = SKILL_STATUS_MAP[skill.status] ?? SKILL_STATUS_MAP.PROPOSED;
                return (
                  <Card key={skill.id} className="card-hover">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            {tierInfo.icon}
                          </div>
                          <div>
                            <h3 className="font-display font-semibold text-sm">{skill.name}</h3>
                            <span className="text-[10px] text-muted-foreground">{tierInfo.label}</span>
                          </div>
                        </div>
                        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{skill.description}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Shield className={`h-3 w-3 ${RISK_COLORS[skill.riskLevel] ?? ''}`} />
                        <span>{skill.riskLevel} risk</span>
                        {skill.implementation && (
                          <>
                            <span className="text-border">|</span>
                            <Code2 className="h-3 w-3" />
                            <span>Has code</span>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'marketplace' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMarketplace.map(skill => (
            <Card key={skill.id} className="card-hover">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-display font-semibold text-sm">{skill.name}</h3>
                    <span className="text-[10px] text-muted-foreground">{skill.category}</span>
                  </div>
                  <Badge variant="secondary">Tier {skill.tier}</Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-4">{skill.description}</p>
                <div className="flex items-center justify-between">
                  <span className={`text-xs flex items-center gap-1 ${RISK_COLORS[skill.riskLevel] ?? ''}`}>
                    <Shield className="h-3 w-3" />
                    {skill.riskLevel}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs h-7"
                    onClick={() => {
                      setNewSkill({ name: skill.name, description: skill.description, riskLevel: skill.riskLevel, implementation: '' });
                      setShowCreateDialog(true);
                    }}
                  >
                    <Download className="h-3 w-3" />
                    Install
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'create' && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="font-display font-semibold">Create a Custom Skill</h3>
            <p className="text-sm text-muted-foreground">Define a new skill that your agents can use. Tier 3 skills with code go through sandbox testing and admin approval before activation.</p>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Skill Name</label>
                <Input value={newSkill.name} onChange={(e) => setNewSkill(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g., Invoice Processor" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Description</label>
                <Textarea value={newSkill.description} onChange={(e) => setNewSkill(prev => ({ ...prev, description: e.target.value }))} placeholder="What does this skill do? What inputs does it need?" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Risk Level</label>
                <div className="flex gap-2">
                  {['LOW', 'MEDIUM', 'HIGH'].map(level => (
                    <button
                      key={level}
                      onClick={() => setNewSkill(prev => ({ ...prev, riskLevel: level }))}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        newSkill.riskLevel === level ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Implementation (TypeScript) <span className="text-muted-foreground font-normal">— optional, makes this Tier 3</span></label>
                <Textarea
                  value={newSkill.implementation}
                  onChange={(e) => setNewSkill(prev => ({ ...prev, implementation: e.target.value }))}
                  placeholder="export default async function execute(input: Record<string, unknown>): Promise<unknown> {&#10;  // Your skill logic here&#10;  return { result: 'done' };&#10;}"
                  className="font-mono text-xs min-h-[120px]"
                />
              </div>
              <Button onClick={handleCreateSkill} disabled={creating || !newSkill.name.trim()} className="gap-2">
                {creating ? <Spinner size="sm" /> : <Plus className="h-4 w-4" />}
                {newSkill.implementation ? 'Submit for Review' : 'Create Skill'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Skill Dialog (from Marketplace install) */}
      <Dialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)}>
        <DialogHeader>
          <DialogTitle>Install Skill</DialogTitle>
          <DialogCloseButton onClick={() => setShowCreateDialog(false)} />
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Name</label>
              <Input value={newSkill.name} onChange={(e) => setNewSkill(prev => ({ ...prev, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Description</label>
              <Textarea value={newSkill.description} onChange={(e) => setNewSkill(prev => ({ ...prev, description: e.target.value }))} />
            </div>
            <p className="text-xs text-muted-foreground">This skill will be installed and available to all agents in your workspace.</p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
          <Button onClick={handleCreateSkill} disabled={creating || !newSkill.name.trim()} className="gap-2">
            {creating ? <Spinner size="sm" /> : <Download className="h-4 w-4" />}
            Install
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
