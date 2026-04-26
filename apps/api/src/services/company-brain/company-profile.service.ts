/**
 * company-profile.service — Company Brain core.
 *
 * Owns the lifecycle of a tenant's `CompanyProfile`:
 *   1. EXTRACTED   : LLM-extracted from uploaded TenantDocuments. NOT used
 *                    by agents until reviewed.
 *   2. USER_APPROVED: reviewer/user has confirmed the extracted profile;
 *                    BaseAgent grounding loads only profiles in this state.
 *   3. MANUAL      : user typed everything by hand, no extraction needed.
 *
 * Honesty:
 *   - No silent overwrite. Extraction can refresh fields, but each
 *     write to a tenant's existing profile flips status back to 'extracted'
 *     and requires re-approval.
 *   - When `OPENAI_API_KEY` is absent, extraction throws — we don't ship
 *     a "deterministic" CompanyProfile because the whole point is LLM
 *     understanding of free-text docs.
 *   - The `extractionConfidence` field is the LLM's self-reported value;
 *     we surface it to the user so they can decide what to override.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { AgentContext, getRuntime, type LLMRuntime, type LegacyAgentBackend } from '@jak-swarm/agents';
import { AuditLogger, AuditAction } from '@jak-swarm/security';
import type { AuditPrismaClient } from '@jak-swarm/security';

// ─── Schema-missing fail-safe ─────────────────────────────────────────

export class CompanyBrainSchemaUnavailableError extends Error {
  constructor() {
    super(
      '[company-brain] company_profiles / company_knowledge_sources tables not present. ' +
      'Apply migration 16 via `pnpm db:migrate:deploy`.',
    );
    this.name = 'CompanyBrainSchemaUnavailableError';
  }
}

function rethrowIfSchemaMissing(err: unknown): never {
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(msg)) {
    throw new CompanyBrainSchemaUnavailableError();
  }
  throw err;
}

// ─── LLM extraction contract ──────────────────────────────────────────

const ExtractedProfileSchema = z.object({
  name: z.string().nullable(),
  industry: z.string().nullable(),
  description: z.string().nullable(),
  productsServices: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
  })).max(20),
  targetCustomers: z.string().nullable(),
  brandVoice: z.string().nullable(),
  competitors: z.array(z.object({
    name: z.string(),
    url: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })).max(20),
  pricing: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  goals: z.string().nullable(),
  constraints: z.string().nullable(),
  preferredChannels: z.array(z.string()).max(10),
  // 0-1 LLM self-rated confidence in the overall extraction quality.
  // Below 0.6 we flag the profile for heavier review.
  extractionConfidence: z.number().min(0).max(1),
});

export type ExtractedProfile = z.infer<typeof ExtractedProfileSchema>;

// ─── Service ──────────────────────────────────────────────────────────

const STUB_BACKEND: LegacyAgentBackend = {
  callLLMPublic: () => { throw new Error('[company-brain] legacy backend invoked unexpectedly'); },
  executeWithToolsPublic: () => { throw new Error('[company-brain] legacy backend invoked unexpectedly'); },
};

export interface CompanyProfileRow {
  id: string;
  tenantId: string;
  name: string | null;
  industry: string | null;
  description: string | null;
  productsServices: unknown;
  targetCustomers: string | null;
  brandVoice: string | null;
  competitors: unknown;
  pricing: string | null;
  websiteUrl: string | null;
  goals: string | null;
  constraints: string | null;
  preferredChannels: unknown;
  status: string;
  extractionConfidence: number | null;
  sourceDocumentIds: unknown;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class CompanyProfileService {
  private readonly audit: AuditLogger;
  private cachedRuntime: LLMRuntime | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {
    this.audit = new AuditLogger(db as unknown as AuditPrismaClient);
  }

  private getLLM(): LLMRuntime | null {
    if (this.cachedRuntime) return this.cachedRuntime;
    if (!process.env['OPENAI_API_KEY']) return null;
    try {
      this.cachedRuntime = getRuntime('COMPANY_BRAIN_EXTRACTOR', STUB_BACKEND);
      return this.cachedRuntime;
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, '[company-brain] LLM runtime unavailable');
      return null;
    }
  }

  async get(tenantId: string): Promise<CompanyProfileRow | null> {
    return (this.db.companyProfile.findUnique as unknown as (a: unknown) => Promise<CompanyProfileRow | null>)({
      where: { tenantId },
    }).catch((err) => rethrowIfSchemaMissing(err));
  }

  /**
   * Get only when the profile is in a state agents can use.
   * Returns null when no profile exists or status='extracted' (still needs approval).
   * BaseAgent grounding calls this — it intentionally refuses to load
   * unapproved profiles into agent prompts.
   */
  async getApproved(tenantId: string): Promise<CompanyProfileRow | null> {
    const profile = await this.get(tenantId);
    if (!profile) return null;
    if (profile.status !== 'user_approved' && profile.status !== 'manual') return null;
    return profile;
  }

  /**
   * User-typed manual profile. No extraction. Status='manual'.
   * Idempotent — upserts the singleton row.
   */
  async upsertManual(input: {
    tenantId: string;
    userId: string;
    fields: Partial<Omit<CompanyProfileRow, 'id' | 'tenantId' | 'status' | 'extractionConfidence' | 'sourceDocumentIds' | 'reviewedBy' | 'reviewedAt' | 'createdAt' | 'updatedAt'>>;
  }): Promise<CompanyProfileRow> {
    const row = await (this.db.companyProfile.upsert as unknown as (a: unknown) => Promise<CompanyProfileRow>)({
      where: { tenantId: input.tenantId },
      create: {
        tenantId: input.tenantId,
        ...input.fields,
        status: 'manual',
        reviewedBy: input.userId,
        reviewedAt: new Date(),
      },
      update: {
        ...input.fields,
        status: 'manual',
        reviewedBy: input.userId,
        reviewedAt: new Date(),
      },
    }).catch((err) => rethrowIfSchemaMissing(err));

    void this.audit.log({
      action: AuditAction.WORKFLOW_CREATED,
      tenantId: input.tenantId,
      userId: input.userId,
      resource: 'company_profile',
      resourceId: row.id,
      details: { mode: 'manual', fieldsTouched: Object.keys(input.fields) },
    }).catch(() => {});

    return row;
  }

  /**
   * Extract profile from uploaded TenantDocuments via LLM.
   * Persists with status='extracted' — REQUIRES user approval to be
   * usable by agents. Refuses when no LLM key (extraction is
   * fundamentally LLM-dependent — no honest deterministic fallback).
   *
   * Idempotent on (tenantId): re-running flips the existing profile back
   * to status='extracted' and overwrites the fields.
   */
  async extractFromDocuments(input: {
    tenantId: string;
    userId: string;
    documentIds?: string[];  // limit to specific docs; default all
  }): Promise<CompanyProfileRow> {
    const llm = this.getLLM();
    if (!llm) {
      throw new Error('[company-brain] OPENAI_API_KEY required for profile extraction. Set the key or use upsertManual() to type the profile by hand.');
    }

    // Load source documents (text content already extracted by ingest)
    const docsWhere: Record<string, unknown> = {
      tenantId: input.tenantId,
      deletedAt: null,
      // Only ingested docs with extracted text content
      status: 'INDEXED',
    };
    if (input.documentIds && input.documentIds.length > 0) {
      docsWhere['id'] = { in: input.documentIds };
    }
    const docs = await this.db.tenantDocument.findMany({
      where: docsWhere,
      select: { id: true, fileName: true, tags: true },
      take: 25,
      orderBy: { createdAt: 'desc' },
    }).catch((err) => rethrowIfSchemaMissing(err));

    if (docs.length === 0) {
      throw new Error('[company-brain] No indexed documents to extract from. Upload at least one PDF/text file first.');
    }

    // Pull a sample of vector chunks per document to ground the extraction.
    // Cap total context at ~30 chunks (keep prompt cost bounded).
    const chunks = await this.db.vectorDocument.findMany({
      where: {
        tenantId: input.tenantId,
        documentId: { in: docs.map((d) => d.id) },
      },
      select: { documentId: true, content: true },
      take: 30,
      orderBy: { createdAt: 'asc' },
    });

    if (chunks.length === 0) {
      throw new Error('[company-brain] Documents are uploaded but have no extracted text chunks (vector indexing may not have completed). Try again in a minute.');
    }

    const sourceMaterial = chunks
      .map((c, i) => `--- chunk ${i + 1} (doc ${c.documentId}) ---\n${(c.content ?? '').slice(0, 2000)}`)
      .join('\n\n');

    const ctx = new AgentContext({
      tenantId: input.tenantId,
      userId: input.userId,
      workflowId: 'company-brain-extraction',
    });

    const extracted = await llm.respondStructured(
      [
        {
          role: 'system',
          content: `You are a company-profile extractor. Read the source material (chunks from the user's company documents) and produce a structured CompanyProfile. NEVER fabricate fields — set null when the source material doesn't mention the field. extractionConfidence is your honest 0-1 self-rating of how complete + accurate this extraction is given the source material.`,
        },
        {
          role: 'user',
          content: `Source material from ${docs.length} document(s):\n\n${sourceMaterial}\n\nReturn a CompanyProfile JSON object matching the schema.`,
        },
      ],
      ExtractedProfileSchema,
      {
        temperature: 0.1,
        maxTokens: 2000,
        schemaName: 'company_profile_extraction',
      },
      ctx,
    );

    const row = await (this.db.companyProfile.upsert as unknown as (a: unknown) => Promise<CompanyProfileRow>)({
      where: { tenantId: input.tenantId },
      create: {
        tenantId: input.tenantId,
        name: extracted.name,
        industry: extracted.industry,
        description: extracted.description,
        productsServices: extracted.productsServices as object,
        targetCustomers: extracted.targetCustomers,
        brandVoice: extracted.brandVoice,
        competitors: extracted.competitors as object,
        pricing: extracted.pricing,
        websiteUrl: extracted.websiteUrl,
        goals: extracted.goals,
        constraints: extracted.constraints,
        preferredChannels: extracted.preferredChannels,
        status: 'extracted',
        extractionConfidence: extracted.extractionConfidence,
        sourceDocumentIds: docs.map((d) => d.id),
      },
      update: {
        name: extracted.name,
        industry: extracted.industry,
        description: extracted.description,
        productsServices: extracted.productsServices as object,
        targetCustomers: extracted.targetCustomers,
        brandVoice: extracted.brandVoice,
        competitors: extracted.competitors as object,
        pricing: extracted.pricing,
        websiteUrl: extracted.websiteUrl,
        goals: extracted.goals,
        constraints: extracted.constraints,
        preferredChannels: extracted.preferredChannels,
        // CRITICAL: re-extraction always flips back to 'extracted' so the
        // user must re-approve. No silent overwrite of an approved profile.
        status: 'extracted',
        extractionConfidence: extracted.extractionConfidence,
        sourceDocumentIds: docs.map((d) => d.id),
        reviewedBy: null,
        reviewedAt: null,
      },
    });

    void this.audit.log({
      action: AuditAction.WORKFLOW_CREATED,
      tenantId: input.tenantId,
      userId: input.userId,
      resource: 'company_profile',
      resourceId: row.id,
      details: { mode: 'extracted', sourceDocCount: docs.length, sourceChunkCount: chunks.length, confidence: extracted.extractionConfidence },
    }).catch(() => {});

    return row;
  }

  /**
   * User reviewed an extracted profile and approved it (with optional
   * field edits). Status → 'user_approved'. Agents can now load it.
   */
  async approve(input: {
    tenantId: string;
    userId: string;
    edits?: Partial<Omit<CompanyProfileRow, 'id' | 'tenantId' | 'status' | 'reviewedBy' | 'reviewedAt' | 'createdAt' | 'updatedAt'>>;
  }): Promise<CompanyProfileRow> {
    const existing = await this.get(input.tenantId);
    if (!existing) throw new Error(`No company profile to approve for tenant ${input.tenantId}`);

    const row = await (this.db.companyProfile.update as unknown as (a: unknown) => Promise<CompanyProfileRow>)({
      where: { tenantId: input.tenantId },
      data: {
        ...(input.edits ?? {}),
        status: 'user_approved',
        reviewedBy: input.userId,
        reviewedAt: new Date(),
      },
    });

    void this.audit.log({
      action: AuditAction.APPROVAL_GRANTED,
      tenantId: input.tenantId,
      userId: input.userId,
      resource: 'company_profile',
      resourceId: row.id,
      details: { fieldsEdited: input.edits ? Object.keys(input.edits) : [] },
    }).catch(() => {});

    return row as CompanyProfileRow;
  }

  /**
   * User reviewed an extracted profile and rejected it. Profile is
   * cleared (deleted) so the next extraction starts fresh.
   */
  async reject(input: { tenantId: string; userId: string }): Promise<void> {
    const existing = await this.get(input.tenantId);
    if (!existing) return;
    await this.db.companyProfile.delete({ where: { tenantId: input.tenantId } });
    void this.audit.log({
      action: AuditAction.APPROVAL_REJECTED,
      tenantId: input.tenantId,
      userId: input.userId,
      resource: 'company_profile',
      resourceId: existing.id,
      details: {},
    }).catch(() => {});
  }
}
