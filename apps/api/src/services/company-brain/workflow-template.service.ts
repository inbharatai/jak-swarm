/**
 * workflow-template.service — pre-tuned workflow specifications matched
 * by intent. The Commander/Planner can look up a template by intent and
 * use its decomposition instead of asking the LLM to derive one from
 * scratch each time.
 *
 * Lookup precedence:
 *   1. Tenant-specific override (tenantId=X, intent=Y)
 *   2. System template (tenantId=null, intent=Y)
 *   3. No template — Planner falls back to dynamic decomposition
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { CompanyBrainSchemaUnavailableError } from './company-profile.service.js';

function rethrowIfSchemaMissing(err: unknown): never {
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(msg)) {
    throw new CompanyBrainSchemaUnavailableError();
  }
  throw err;
}

export interface WorkflowTemplateRow {
  id: string;
  tenantId: string | null;
  intent: string;
  name: string;
  description: string;
  tasksJson: unknown;
  requiredCompanyContext: unknown;
  requiredUserInputs: unknown;
  approvalGates: unknown;
  expectedArtifacts: unknown;
  status: string;
}

export class WorkflowTemplateService {
  constructor(
    private readonly db: PrismaClient,
    _log: FastifyBaseLogger,
  ) {}

  /**
   * Find the best matching template for an intent, preferring a tenant
   * override over the system default.
   */
  async findForIntent(input: { tenantId: string; intent: string }): Promise<WorkflowTemplateRow | null> {
    const tenantOverride = await (this.db.workflowTemplate.findFirst as unknown as (a: unknown) => Promise<WorkflowTemplateRow | null>)({
      where: { tenantId: input.tenantId, intent: input.intent, status: 'active' },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (tenantOverride) return tenantOverride;

    return (this.db.workflowTemplate.findFirst as unknown as (a: unknown) => Promise<WorkflowTemplateRow | null>)({
      where: { tenantId: null, intent: input.intent, status: 'active' },
    });
  }

  async list(input: { tenantId: string; intent?: string }): Promise<WorkflowTemplateRow[]> {
    const where: Record<string, unknown> = { status: 'active', OR: [{ tenantId: null }, { tenantId: input.tenantId }] };
    if (input.intent) where['intent'] = input.intent;
    return (this.db.workflowTemplate.findMany as unknown as (a: unknown) => Promise<WorkflowTemplateRow[]>)({
      where,
      orderBy: [{ tenantId: 'desc' }, { name: 'asc' }],
    }).catch((err) => rethrowIfSchemaMissing(err));
  }

  /**
   * Bootstrap the system templates if not already present. Idempotent —
   * upserts by (tenantId=null, intent, name).
   */
  async seedSystemTemplates(): Promise<{ seeded: number; skipped: number }> {
    const seeded = { count: 0, skipped: 0 };
    for (const tpl of SYSTEM_TEMPLATES) {
      const existing = await this.db.workflowTemplate.findFirst({
        where: { tenantId: null, intent: tpl.intent, name: tpl.name },
        select: { id: true },
      }).catch(() => null);
      if (existing) {
        seeded.skipped++;
        continue;
      }
      try {
        await this.db.workflowTemplate.create({
          data: {
            intent: tpl.intent,
            name: tpl.name,
            description: tpl.description,
            tasksJson: tpl.tasks as object,
            ...(tpl.requiredCompanyContext ? { requiredCompanyContext: tpl.requiredCompanyContext } : {}),
            ...(tpl.requiredUserInputs ? { requiredUserInputs: tpl.requiredUserInputs } : {}),
            ...(tpl.approvalGates ? { approvalGates: tpl.approvalGates } : {}),
            ...(tpl.expectedArtifacts ? { expectedArtifacts: tpl.expectedArtifacts } : {}),
          },
        });
        seeded.count++;
      } catch (err) {
        rethrowIfSchemaMissing(err);
      }
    }
    return { seeded: seeded.count, skipped: seeded.skipped };
  }
}

// ─── 6 seeded system templates ──────────────────────────────────────────
//
// Each template is a hand-tuned decomposition for one of the 18 named
// intents. The Planner uses the `tasks` array as its plan when the
// matching intent fires. These can be tenant-overridden.

interface TemplateSpec {
  intent: string;
  name: string;
  description: string;
  tasks: Array<{
    id: string;
    name: string;
    description: string;
    agentRole: string;
    toolsRequired: string[];
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    requiresApproval: boolean;
    dependsOn: string[];
    retryable: boolean;
    maxRetries: number;
  }>;
  requiredCompanyContext?: string[];
  requiredUserInputs?: string[];
  approvalGates?: string[];
  expectedArtifacts?: string[];
}

export const SYSTEM_TEMPLATES: TemplateSpec[] = [
  {
    intent: 'company_strategy_review',
    name: 'Strategic SWOT + executive brief',
    description: 'Reviews the company at a strategic level (SWOT + competitive position) and produces an executive brief.',
    requiredCompanyContext: ['name', 'industry', 'description'],
    expectedArtifacts: ['executive-brief.pdf'],
    tasks: [
      { id: 'research_market', name: 'Research market context', description: 'Gather recent industry trends + competitor moves relevant to this company.', agentRole: 'WORKER_RESEARCH', toolsRequired: ['web_search', 'web_fetch'], riskLevel: 'LOW', requiresApproval: false, dependsOn: [], retryable: true, maxRetries: 2 },
      { id: 'swot_analysis', name: 'SWOT analysis', description: 'Build SWOT using company profile + market research.', agentRole: 'WORKER_STRATEGIST', toolsRequired: [], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['research_market'], retryable: true, maxRetries: 1 },
      { id: 'financial_lens', name: 'Financial lens', description: 'Apply financial lens to the strategic options identified.', agentRole: 'WORKER_FINANCE', toolsRequired: [], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['swot_analysis'], retryable: true, maxRetries: 1 },
      { id: 'exec_brief', name: 'Compile executive brief', description: 'Write the final 1-2 page exec brief with prioritized recommendations.', agentRole: 'WORKER_DOCUMENT', toolsRequired: ['compile_executive_summary'], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['swot_analysis', 'financial_lens'], retryable: true, maxRetries: 1 },
    ],
  },
  {
    intent: 'marketing_campaign_generation',
    name: 'Multi-channel campaign plan',
    description: 'Produces a multi-channel marketing campaign with audience, message, channel mix, content drafts, and metrics.',
    requiredCompanyContext: ['name', 'brandVoice', 'targetCustomers'],
    requiredUserInputs: ['campaignGoal'],
    approvalGates: ['publish_assets'],
    expectedArtifacts: ['campaign-plan.pdf', 'asset-drafts.zip'],
    tasks: [
      { id: 'audience_segmentation', name: 'Audience segmentation', description: 'Refine target audience segments for this campaign.', agentRole: 'WORKER_MARKETING', toolsRequired: [], riskLevel: 'LOW', requiresApproval: false, dependsOn: [], retryable: true, maxRetries: 1 },
      { id: 'channel_mix', name: 'Channel mix + budget split', description: 'Recommend channels + budget allocation.', agentRole: 'WORKER_MARKETING', toolsRequired: [], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['audience_segmentation'], retryable: true, maxRetries: 1 },
      { id: 'content_drafts', name: 'Content drafts (per channel)', description: 'Write draft copy + headlines for each channel. DRAFT only — never sends.', agentRole: 'WORKER_CONTENT', toolsRequired: ['draft_email', 'draft_post'], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['channel_mix'], retryable: true, maxRetries: 1 },
      { id: 'metrics_plan', name: 'Metrics + tracking plan', description: 'Define what to measure + how.', agentRole: 'WORKER_ANALYTICS', toolsRequired: [], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['channel_mix'], retryable: true, maxRetries: 1 },
      { id: 'compile_plan', name: 'Compile campaign plan', description: 'Final campaign plan PDF.', agentRole: 'WORKER_DOCUMENT', toolsRequired: ['compile_executive_summary'], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['content_drafts', 'metrics_plan'], retryable: true, maxRetries: 1 },
    ],
  },
  {
    intent: 'website_review_and_improvement',
    name: 'Website review + improvement plan',
    description: 'Inspects the user\'s website and produces a UX/content/SEO/conversion improvement plan.',
    requiredUserInputs: ['websiteUrl'],
    expectedArtifacts: ['website-review.pdf', 'screenshots.zip'],
    tasks: [
      { id: 'crawl_pages', name: 'Crawl key pages', description: 'Visit the homepage + main product/about/pricing pages, capture screenshots.', agentRole: 'WORKER_BROWSER', toolsRequired: ['browser_navigate', 'browser_screenshot', 'browser_extract'], riskLevel: 'LOW', requiresApproval: false, dependsOn: [], retryable: true, maxRetries: 2 },
      { id: 'design_review', name: 'Design + UX review', description: 'Critique visual design, layout, accessibility, mobile responsiveness.', agentRole: 'WORKER_DESIGNER', toolsRequired: [], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['crawl_pages'], retryable: true, maxRetries: 1 },
      { id: 'content_review', name: 'Content + messaging review', description: 'Critique copy clarity, value prop, CTAs.', agentRole: 'WORKER_CONTENT', toolsRequired: [], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['crawl_pages'], retryable: true, maxRetries: 1 },
      { id: 'seo_audit', name: 'SEO + technical audit', description: 'Check meta tags, headings, page speed, structured data.', agentRole: 'WORKER_SEO', toolsRequired: ['audit_seo', 'analyze_serp'], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['crawl_pages'], retryable: true, maxRetries: 1 },
      { id: 'compile_review', name: 'Compile review report', description: 'Final improvement plan with prioritized fixes.', agentRole: 'WORKER_DOCUMENT', toolsRequired: ['compile_executive_summary'], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['design_review', 'content_review', 'seo_audit'], retryable: true, maxRetries: 1 },
    ],
  },
  {
    intent: 'codebase_review_and_patch',
    name: 'Code review + (optional) patch',
    description: 'Reviews code for bugs, security issues, style. Optionally produces a patch diff. Never pushes.',
    requiredUserInputs: ['repoOrSnippet'],
    approvalGates: ['apply_patch'],
    expectedArtifacts: ['review-report.md', 'patch.diff'],
    tasks: [
      { id: 'code_analysis', name: 'Static analysis', description: 'Run linters / type checks / pattern checks on the code.', agentRole: 'WORKER_CODER', toolsRequired: ['code_execute', 'file_read'], riskLevel: 'LOW', requiresApproval: false, dependsOn: [], retryable: true, maxRetries: 1 },
      { id: 'tech_review', name: 'Technical review', description: 'Architectural critique + security findings.', agentRole: 'WORKER_TECHNICAL', toolsRequired: [], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['code_analysis'], retryable: true, maxRetries: 1 },
      { id: 'verify', name: 'Verifier check', description: 'Verify the review is grounded in the actual code (no fabricated findings).', agentRole: 'VERIFIER', toolsRequired: [], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['tech_review'], retryable: false, maxRetries: 0 },
    ],
  },
  {
    intent: 'competitor_research',
    name: 'Competitor research matrix',
    description: 'Researches a list of competitors and produces a comparison matrix + insights brief.',
    requiredCompanyContext: ['competitors'],
    expectedArtifacts: ['competitor-matrix.csv', 'insights-brief.pdf'],
    tasks: [
      { id: 'discover_competitors', name: 'Discover + enrich competitors', description: 'For each competitor, gather positioning, pricing, key features.', agentRole: 'WORKER_RESEARCH', toolsRequired: ['web_search', 'web_fetch'], riskLevel: 'LOW', requiresApproval: false, dependsOn: [], retryable: true, maxRetries: 2 },
      { id: 'site_inspection', name: 'Inspect competitor websites', description: 'Visit + screenshot pricing + product pages.', agentRole: 'WORKER_BROWSER', toolsRequired: ['browser_navigate', 'browser_screenshot'], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['discover_competitors'], retryable: true, maxRetries: 2 },
      { id: 'matrix', name: 'Build comparison matrix', description: 'Structured side-by-side comparison.', agentRole: 'WORKER_CONTENT', toolsRequired: [], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['site_inspection'], retryable: true, maxRetries: 1 },
      { id: 'insights', name: 'Insights brief', description: 'Top 3-5 differentiators + opportunities.', agentRole: 'WORKER_STRATEGIST', toolsRequired: [], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['matrix'], retryable: true, maxRetries: 1 },
    ],
  },
  {
    intent: 'sales_outreach_draft_generation',
    name: 'Sales outreach drafts (no auto-send)',
    description: 'Drafts outbound sales emails / LinkedIn messages / follow-ups. Drafts ONLY — never sends.',
    requiredCompanyContext: ['name', 'productsServices', 'brandVoice'],
    requiredUserInputs: ['targetSegment'],
    approvalGates: ['send_outreach'],  // user must explicitly approve before any send
    expectedArtifacts: ['outreach-drafts.json'],
    tasks: [
      { id: 'segment_research', name: 'Research target segment', description: 'Pain points, language, channel preferences for this segment.', agentRole: 'WORKER_GROWTH', toolsRequired: ['web_search', 'enrich_company'], riskLevel: 'LOW', requiresApproval: false, dependsOn: [], retryable: true, maxRetries: 1 },
      { id: 'draft_initial', name: 'Draft initial email', description: 'Cold opener — draft only.', agentRole: 'WORKER_CONTENT', toolsRequired: ['draft_email'], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['segment_research'], retryable: true, maxRetries: 1 },
      { id: 'draft_followups', name: 'Draft follow-up sequence', description: 'Days +3, +7, +14 follow-ups.', agentRole: 'WORKER_CONTENT', toolsRequired: ['draft_email'], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['draft_initial'], retryable: true, maxRetries: 1 },
      { id: 'draft_linkedin', name: 'Draft LinkedIn variant', description: 'Short LinkedIn version.', agentRole: 'WORKER_CONTENT', toolsRequired: [], riskLevel: 'LOW', requiresApproval: false, dependsOn: ['draft_initial'], retryable: true, maxRetries: 1 },
    ],
  },
];
