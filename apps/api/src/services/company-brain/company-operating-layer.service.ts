/**
 * company-operating-layer.service — YC "AI Operating System" foundation.
 *
 * This is deliberately not a chatbot wrapper. It gives JAK a tenant-scoped
 * evidence graph:
 *   1. Raw artifacts from company tools (Slack, GitHub, Linear, Notion, calls).
 *   2. Normalized entities extracted from those artifacts.
 *   3. Deterministic drift findings that compare intent/customer pain to work.
 *   4. Agent-executable specs generated from cited evidence and human-reviewed.
 *
 * Honesty guardrails:
 *   - No fake connector success: ingestion stores caller-provided evidence only.
 *   - Entity extraction and spec generation require OpenAI when invoked.
 *   - Drift detection is deterministic comparator logic, not an LLM guess.
 *   - Every entity/spec/finding cites artifact/entity ids for auditability.
 */

import { createHash } from 'node:crypto';
import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { AgentContext, getRuntime, type LLMRuntime, type LegacyAgentBackend } from '@jak-swarm/agents';
import { AuditAction, AuditLogger, type AuditPrismaClient } from '@jak-swarm/security';
import { CompanyBrainSchemaUnavailableError } from './company-profile.service.js';

type DbWithCompanyOs = PrismaClient & {
  companyArtifact: {
    create: (args: unknown) => Promise<CompanyArtifactRow>;
    upsert: (args: unknown) => Promise<CompanyArtifactRow>;
    findMany: (args: unknown) => Promise<CompanyArtifactRow[]>;
    findFirst: (args: unknown) => Promise<CompanyArtifactRow | null>;
    update: (args: unknown) => Promise<CompanyArtifactRow>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
    count: (args: unknown) => Promise<number>;
  };
  companyGraphEntity: {
    create: (args: unknown) => Promise<CompanyGraphEntityRow>;
    createMany: (args: unknown) => Promise<{ count: number }>;
    findMany: (args: unknown) => Promise<CompanyGraphEntityRow[]>;
    findFirst: (args: unknown) => Promise<CompanyGraphEntityRow | null>;
    count: (args: unknown) => Promise<number>;
  };
  executionDriftFinding: {
    upsert: (args: unknown) => Promise<ExecutionDriftFindingRow>;
    findMany: (args: unknown) => Promise<ExecutionDriftFindingRow[]>;
    findFirst: (args: unknown) => Promise<ExecutionDriftFindingRow | null>;
    count: (args: unknown) => Promise<number>;
  };
  agentExecutableSpec: {
    create: (args: unknown) => Promise<AgentExecutableSpecRow>;
    findMany: (args: unknown) => Promise<AgentExecutableSpecRow[]>;
    findFirst: (args: unknown) => Promise<AgentExecutableSpecRow | null>;
    update: (args: unknown) => Promise<AgentExecutableSpecRow>;
    count: (args: unknown) => Promise<number>;
  };
};

const STUB_BACKEND: LegacyAgentBackend = {
  callLLMPublic: () => { throw new Error('[company-operating-layer] legacy backend invoked unexpectedly'); },
  executeWithToolsPublic: () => { throw new Error('[company-operating-layer] legacy backend invoked unexpectedly'); },
};

const ArtifactSourceSchema = z.enum([
  'github',
  'linear',
  'jira',
  'slack',
  'notion',
  'google_drive',
  'gmail',
  'meeting',
  'customer_call',
  'support',
  'document',
  'manual',
  'other',
]);

const ArtifactTypeSchema = z.enum([
  'ticket',
  'issue',
  'pull_request',
  'commit',
  'slack_thread',
  'notion_page',
  'document',
  'meeting_transcript',
  'customer_feedback',
  'support_ticket',
  'email',
  'decision_note',
  'other',
]);

const EntityTypeSchema = z.enum([
  'decision',
  'task',
  'spec',
  'customer_signal',
  'risk',
  'owner',
  'deadline',
  'code_change',
  'customer',
  'metric',
  'requirement',
]);

const PrioritySchema = z.enum(['low', 'medium', 'high', 'critical']).nullable();

const ExtractedEntitiesSchema = z.object({
  entities: z.array(z.object({
    entityType: EntityTypeSchema,
    title: z.string().min(1).max(240),
    summary: z.string().min(1).max(2000),
    status: z.string().min(1).max(80).default('active'),
    ownerName: z.string().max(160).nullable(),
    priority: PrioritySchema,
    confidence: z.number().min(0).max(1),
    occurredAt: z.string().datetime().nullable(),
    dueAt: z.string().datetime().nullable(),
    relatedEntityTitles: z.array(z.string().max(240)).max(25),
    properties: z.record(z.unknown()),
  }).strict()).max(30),
}).strict();

const AgentExecutableSpecOutputSchema = z.object({
  title: z.string().min(1).max(240),
  problemStatement: z.string().min(1).max(4000),
  objective: z.string().min(1).max(3000),
  contextSummary: z.string().min(1).max(6000),
  proposedApproach: z.string().min(1).max(6000),
  acceptanceCriteria: z.array(z.string().min(1).max(1000)).min(1).max(20),
  testPlan: z.array(z.object({
    name: z.string().min(1).max(160),
    type: z.enum(['unit', 'integration', 'e2e', 'manual', 'security', 'data_quality']),
    description: z.string().min(1).max(1000),
  }).strict()).min(1).max(20),
  agentTaskPlan: z.array(z.object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(200),
    agentRole: z.string().min(1).max(120),
    description: z.string().min(1).max(1500),
    dependsOn: z.array(z.string().max(80)).max(10),
    riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    requiresApproval: z.boolean(),
  }).strict()).min(1).max(30),
  approvalGates: z.array(z.object({
    gate: z.string().min(1).max(160),
    reason: z.string().min(1).max(1000),
    riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  }).strict()).min(1).max(20),
}).strict();

export type ArtifactSource = z.infer<typeof ArtifactSourceSchema>;
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
export type EntityType = z.infer<typeof EntityTypeSchema>;

export interface CompanyArtifactRow {
  id: string;
  tenantId: string;
  sourceType: string;
  artifactType: string;
  externalId: string | null;
  sourceUrl: string | null;
  title: string;
  body: string;
  bodyHash: string;
  authorName: string | null;
  occurredAt: Date | null;
  metadata: unknown;
  ingestionStatus: string;
  extractedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
export interface CompanyGraphEntityRow {
  id: string;
  tenantId: string;
  primaryArtifactId: string | null;
  entityType: string;
  title: string;
  summary: string;
  status: string;
  ownerName: string | null;
  priority: string | null;
  confidence: number;
  occurredAt: Date | null;
  dueAt: Date | null;
  sourceArtifactIds: unknown;
  relatedEntityIds: unknown;
  properties: unknown;
  extractedBy: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ExecutionDriftFindingRow {
  id: string;
  tenantId: string;
  fingerprint: string;
  driftType: string;
  severity: string;
  status: string;
  title: string;
  summary: string;
  recommendation: string;
  evidenceArtifactIds: unknown;
  evidenceEntityIds: unknown;
  confidence: number;
  detectedAt: Date;
  resolvedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentExecutableSpecRow {
  id: string;
  tenantId: string;
  driftFindingId: string | null;
  title: string;
  problemStatement: string;
  objective: string;
  contextSummary: string;
  proposedApproach: string;
  acceptanceCriteria: unknown;
  testPlan: unknown;
  agentTaskPlan: unknown;
  approvalGates: unknown;
  evidenceArtifactIds: unknown;
  evidenceEntityIds: unknown;
  status: string;
  generatedBy: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewComment: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DriftCandidate {
  fingerprint: string;
  driftType: 'customer_signal_unaddressed' | 'decision_not_operationalized' | 'ungrounded_execution' | 'stale_high_priority_task';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  summary: string;
  recommendation: string;
  evidenceArtifactIds: string[];
  evidenceEntityIds: string[];
  confidence: number;
  metadata: Record<string, unknown>;
}

function rethrowIfCompanyOsSchemaMissing(err: unknown): never {
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(msg)) {
    throw new CompanyBrainSchemaUnavailableError();
  }
  throw err;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function jsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.trim().length > 0))].sort();
}

function normalizeLabel(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function lower(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function entityKind(entity: Pick<CompanyGraphEntityRow, 'entityType'>): string {
  const t = normalizeLabel(entity.entityType);
  if (['customer_signal', 'customer_feedback', 'customer_pain', 'support_ticket', 'customer_call'].includes(t)) return 'customer_signal';
  if (['decision', 'founder_decision', 'product_decision', 'strategy_decision'].includes(t)) return 'decision';
  if (['task', 'ticket', 'issue', 'linear_ticket', 'jira_issue'].includes(t)) return 'task';
  if (['spec', 'prd', 'technical_spec', 'requirement'].includes(t)) return 'spec';
  if (['code_change', 'commit', 'pull_request', 'github_pr', 'pr'].includes(t)) return 'code_change';
  return t;
}

function isOpenLike(status: string | null | undefined): boolean {
  const s = lower(status);
  return !['done', 'closed', 'completed', 'resolved', 'cancelled', 'deleted', 'rejected'].includes(s);
}

function isExecutionEntity(entity: CompanyGraphEntityRow): boolean {
  return ['task', 'spec', 'code_change'].includes(entityKind(entity));
}

function isRationaleEntity(entity: CompanyGraphEntityRow): boolean {
  return ['customer_signal', 'decision', 'spec'].includes(entityKind(entity));
}

function countsAsExecutionEvidence(entity: CompanyGraphEntityRow): boolean {
  const status = lower(entity.status);
  return isExecutionEntity(entity) && !['cancelled', 'canceled', 'deleted', 'rejected'].includes(status);
}

function prioritySeverity(priority: string | null | undefined, fallback: DriftCandidate['severity']): DriftCandidate['severity'] {
  const p = lower(priority);
  if (p === 'critical') return 'critical';
  if (p === 'high') return 'high';
  if (p === 'medium') return 'medium';
  if (p === 'low') return 'low';
  return fallback;
}

function sourceIds(entity: Pick<CompanyGraphEntityRow, 'sourceArtifactIds' | 'primaryArtifactId'>): string[] {
  return uniqueStrings([
    ...jsonStringArray(entity.sourceArtifactIds),
    ...(entity.primaryArtifactId ? [entity.primaryArtifactId] : []),
  ]);
}

function relatedIds(entity: Pick<CompanyGraphEntityRow, 'relatedEntityIds' | 'properties'>): string[] {
  const ids = jsonStringArray(entity.relatedEntityIds);
  const props = jsonObject(entity.properties);
  const propKeys = [
    'relatedEntityIds',
    'linkedEntityIds',
    'sourceEntityIds',
    'customerSignalIds',
    'decisionIds',
    'specIds',
    'taskIds',
    'codeChangeIds',
    'references',
  ];
  for (const key of propKeys) {
    ids.push(...jsonStringArray(props[key]));
  }
  return uniqueStrings(ids);
}

function overlaps(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((id) => set.has(id));
}

function directOrEvidenceLinked(a: CompanyGraphEntityRow, b: CompanyGraphEntityRow): boolean {
  if (a.id === b.id) return false;
  const aRelated = relatedIds(a);
  const bRelated = relatedIds(b);
  return (
    aRelated.includes(b.id) ||
    bRelated.includes(a.id) ||
    overlaps(sourceIds(a), sourceIds(b))
  );
}

function hasLinkedExecution(entity: CompanyGraphEntityRow, entities: CompanyGraphEntityRow[]): boolean {
  return entities.some((candidate) =>
    countsAsExecutionEvidence(candidate) &&
    directOrEvidenceLinked(entity, candidate),
  );
}

function hasLinkedRationale(entity: CompanyGraphEntityRow, entities: CompanyGraphEntityRow[]): boolean {
  return entities.some((candidate) =>
    isRationaleEntity(candidate) &&
    directOrEvidenceLinked(entity, candidate),
  );
}

export function driftFingerprint(tenantId: string, driftType: string, evidenceEntityIds: string[]): string {
  return sha256(`${tenantId}:${driftType}:${uniqueStrings(evidenceEntityIds).join(',')}`);
}

function candidate(input: Omit<DriftCandidate, 'fingerprint'> & { tenantId: string }): DriftCandidate {
  return {
    ...input,
    evidenceArtifactIds: uniqueStrings(input.evidenceArtifactIds),
    evidenceEntityIds: uniqueStrings(input.evidenceEntityIds),
    fingerprint: driftFingerprint(input.tenantId, input.driftType, input.evidenceEntityIds),
  };
}

export function buildDriftCandidates(input: {
  tenantId: string;
  entities: CompanyGraphEntityRow[];
  now?: Date;
}): DriftCandidate[] {
  const now = input.now ?? new Date();
  const live = input.entities.filter((e) => e.deletedAt === null);
  const active = live.filter((e) => isOpenLike(e.status));
  const candidates: DriftCandidate[] = [];

  for (const signal of active.filter((e) => entityKind(e) === 'customer_signal')) {
    if (hasLinkedExecution(signal, live)) continue;
    const severity = prioritySeverity(signal.priority, 'high');
    candidates.push(candidate({
      tenantId: input.tenantId,
      driftType: 'customer_signal_unaddressed',
      severity,
      title: `Customer signal is not tied to execution: ${signal.title}`,
      summary: `JAK found customer evidence "${signal.title}" but no linked task, spec, or code-change entity. This is exactly the YC closed-loop gap: customer pain exists, but execution may not reflect it.`,
      recommendation: 'Create or link an executable spec/task with acceptance criteria and an owner, then attach it to this customer signal.',
      evidenceArtifactIds: sourceIds(signal),
      evidenceEntityIds: [signal.id],
      confidence: severity === 'critical' ? 0.82 : 0.76,
      metadata: { entityType: signal.entityType, priority: signal.priority },
    }));
  }

  for (const decision of active.filter((e) => entityKind(e) === 'decision')) {
    if (hasLinkedExecution(decision, live)) continue;
    const severity = prioritySeverity(decision.priority, 'medium');
    candidates.push(candidate({
      tenantId: input.tenantId,
      driftType: 'decision_not_operationalized',
      severity,
      title: `Decision has not become execution work: ${decision.title}`,
      summary: `JAK found a decision "${decision.title}" but no linked task, spec, or code-change entity. Founder/product intent can drift when decisions are not converted into execution artifacts.`,
      recommendation: 'Convert this decision into an agent-executable spec or link it to an existing ticket/code change that proves execution is happening.',
      evidenceArtifactIds: sourceIds(decision),
      evidenceEntityIds: [decision.id],
      confidence: 0.74,
      metadata: { entityType: decision.entityType, priority: decision.priority },
    }));
  }

  for (const work of active.filter(isExecutionEntity)) {
    const kind = entityKind(work);
    if (kind === 'spec') continue;
    if (hasLinkedRationale(work, active)) continue;
    candidates.push(candidate({
      tenantId: input.tenantId,
      driftType: 'ungrounded_execution',
      severity: prioritySeverity(work.priority, kind === 'code_change' ? 'high' : 'medium'),
      title: `Execution work lacks visible rationale: ${work.title}`,
      summary: `JAK found execution work "${work.title}" without a linked customer signal, decision, or spec. This may mean the team is building without traceable company context.`,
      recommendation: 'Link this work to the decision/customer evidence that justifies it, or pause it until the rationale is explicit.',
      evidenceArtifactIds: sourceIds(work),
      evidenceEntityIds: [work.id],
      confidence: kind === 'code_change' ? 0.72 : 0.68,
      metadata: { entityType: work.entityType, priority: work.priority },
    }));
  }

  for (const task of active.filter((e) => entityKind(e) === 'task')) {
    const dueAt = task.dueAt instanceof Date ? task.dueAt : null;
    if (!dueAt || dueAt.getTime() >= now.getTime()) continue;
    const priority = prioritySeverity(task.priority, 'medium');
    if (priority !== 'high' && priority !== 'critical') continue;
    candidates.push(candidate({
      tenantId: input.tenantId,
      driftType: 'stale_high_priority_task',
      severity: priority,
      title: `High-priority task is overdue: ${task.title}`,
      summary: `JAK found high-priority work "${task.title}" with a due date in the past and no terminal status. This is execution drift against committed deadlines.`,
      recommendation: 'Assign an owner, update status, or generate a recovery spec with a smaller next action and approval gate.',
      evidenceArtifactIds: sourceIds(task),
      evidenceEntityIds: [task.id],
      confidence: 0.8,
      metadata: { dueAt: dueAt.toISOString(), priority: task.priority },
    }));
  }

  return candidates;
}

export class CompanyOperatingLayerService {
  private readonly db: DbWithCompanyOs;
  private readonly audit: AuditLogger;
  private cachedRuntime: LLMRuntime | null = null;

  constructor(
    db: PrismaClient,
    private readonly log?: FastifyBaseLogger,
  ) {
    this.db = db as DbWithCompanyOs;
    this.audit = new AuditLogger(db as unknown as AuditPrismaClient);
  }

  private getLLM(): LLMRuntime | null {
    if (this.cachedRuntime) return this.cachedRuntime;
    if (!process.env['OPENAI_API_KEY']) return null;
    try {
      this.cachedRuntime = getRuntime('COMPANY_OPERATING_LAYER', STUB_BACKEND);
      return this.cachedRuntime;
    } catch (err) {
      this.log?.warn({ err: err instanceof Error ? err.message : String(err) }, '[company-operating-layer] LLM runtime unavailable');
      return null;
    }
  }

  async createArtifact(input: {
    tenantId: string;
    userId: string;
    sourceType: ArtifactSource;
    artifactType: ArtifactType;
    title: string;
    body: string;
    externalId?: string;
    sourceUrl?: string;
    authorName?: string;
    occurredAt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<CompanyArtifactRow> {
    const body = input.body.trim();
    if (body.length < 20) throw new Error('Company artifact body must contain at least 20 characters of evidence.');
    const title = input.title.trim();
    if (title.length === 0) throw new Error('Company artifact title is required.');
    const data = {
      tenantId: input.tenantId,
      sourceType: input.sourceType,
      artifactType: input.artifactType,
      externalId: input.externalId?.trim() || null,
      sourceUrl: input.sourceUrl?.trim() || null,
      title,
      body,
      bodyHash: sha256(body),
      authorName: input.authorName?.trim() || null,
      occurredAt: safeDate(input.occurredAt),
      metadata: input.metadata ?? {},
      ingestionStatus: 'ingested',
      createdBy: input.userId,
      deletedAt: null,
    };

    const row = data.externalId
      ? await this.db.companyArtifact.upsert({
        where: {
          tenantId_sourceType_externalId: {
            tenantId: input.tenantId,
            sourceType: input.sourceType,
            externalId: data.externalId,
          },
        },
        create: data,
        update: {
          ...data,
          extractedAt: null,
        },
      }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err))
      : await this.db.companyArtifact.create({ data }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));

    void this.audit.log({
      action: AuditAction.COMPANY_ARTIFACT_INGESTED,
      tenantId: input.tenantId,
      userId: input.userId,
      resource: 'company_artifact',
      resourceId: row.id,
      details: {
        sourceType: row.sourceType,
        artifactType: row.artifactType,
        externalId: row.externalId,
        bodyHash: row.bodyHash,
      },
    }).catch(() => {});

    return row;
  }

  async listArtifacts(input: {
    tenantId: string;
    sourceType?: string;
    artifactType?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: CompanyArtifactRow[]; total: number }> {
    const where = {
      tenantId: input.tenantId,
      deletedAt: null,
      ...(input.sourceType ? { sourceType: input.sourceType } : {}),
      ...(input.artifactType ? { artifactType: input.artifactType } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.companyArtifact.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: input.limit,
        skip: input.offset,
      }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err)),
      this.db.companyArtifact.count({ where }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err)),
    ]);
    return { items, total };
  }

  async createEntity(input: {
    tenantId: string;
    userId: string;
    entityType: EntityType;
    title: string;
    summary: string;
    sourceArtifactIds: string[];
    primaryArtifactId?: string;
    status?: string;
    ownerName?: string | null;
    priority?: 'low' | 'medium' | 'high' | 'critical' | null;
    confidence?: number;
    occurredAt?: string;
    dueAt?: string;
    relatedEntityIds?: string[];
    properties?: Record<string, unknown>;
    extractedBy?: 'manual' | 'connector' | 'openai' | 'system';
  }): Promise<CompanyGraphEntityRow> {
    const title = input.title.trim();
    const summary = input.summary.trim();
    if (title.length === 0) throw new Error('Company graph entity title is required.');
    if (summary.length === 0) throw new Error('Company graph entity summary is required.');
    const confidence = input.confidence ?? 0.75;
    if (confidence < 0 || confidence > 1) {
      throw new Error('Company graph entity confidence must be between 0 and 1.');
    }

    const sourceArtifactIds = uniqueStrings([
      ...input.sourceArtifactIds,
      ...(input.primaryArtifactId ? [input.primaryArtifactId] : []),
    ]);
    if (sourceArtifactIds.length === 0) {
      throw new Error('Company graph entities must cite at least one sourceArtifactId.');
    }
    await this.assertArtifactsBelongToTenant(input.tenantId, sourceArtifactIds);
    if (input.primaryArtifactId) await this.assertArtifactsBelongToTenant(input.tenantId, [input.primaryArtifactId]);

    const row = await this.db.companyGraphEntity.create({
      data: {
        tenantId: input.tenantId,
        primaryArtifactId: input.primaryArtifactId ?? sourceArtifactIds[0] ?? null,
        entityType: input.entityType,
        title,
        summary,
        status: input.status?.trim() || 'active',
        ownerName: input.ownerName?.trim() || null,
        priority: input.priority ?? null,
        confidence,
        occurredAt: safeDate(input.occurredAt),
        dueAt: safeDate(input.dueAt),
        sourceArtifactIds,
        relatedEntityIds: uniqueStrings(input.relatedEntityIds ?? []),
        properties: input.properties ?? {},
        extractedBy: input.extractedBy ?? 'manual',
        createdBy: input.userId,
      },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));

    void this.audit.log({
      action: AuditAction.COMPANY_ENTITY_EXTRACTED,
      tenantId: input.tenantId,
      userId: input.userId,
      resource: 'company_graph_entity',
      resourceId: row.id,
      details: {
        entityType: row.entityType,
        sourceArtifactIds,
        extractedBy: row.extractedBy,
      },
    }).catch(() => {});

    return row;
  }

  async listEntities(input: {
    tenantId: string;
    entityType?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: CompanyGraphEntityRow[]; total: number }> {
    const where = {
      tenantId: input.tenantId,
      deletedAt: null,
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.status ? { status: input.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.companyGraphEntity.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        take: input.limit,
        skip: input.offset,
      }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err)),
      this.db.companyGraphEntity.count({ where }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err)),
    ]);
    return { items, total };
  }

  async extractEntitiesFromArtifact(input: {
    tenantId: string;
    userId: string;
    artifactId: string;
  }): Promise<{ artifact: CompanyArtifactRow; entities: CompanyGraphEntityRow[] }> {
    const llm = this.getLLM();
    if (!llm) {
      throw new Error('[company-operating-layer] OPENAI_API_KEY required for entity extraction. Ingest artifacts manually or set OpenAI before extraction.');
    }

    const artifact = await this.db.companyArtifact.findFirst({
      where: { id: input.artifactId, tenantId: input.tenantId, deletedAt: null },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
    if (!artifact) throw new Error(`Company artifact id=${input.artifactId} not found in this tenant.`);

    const ctx = new AgentContext({
      agentRole: 'COMPANY_GRAPH_EXTRACTOR',
      tenantId: input.tenantId,
      userId: input.userId,
      workflowId: 'company-operating-layer-extraction',
    });

    const extracted = await llm.respondStructured(
      [
        {
          role: 'system',
          content: 'You extract a company operating graph from one evidence artifact. Extract only explicit facts. Do not invent decisions, tasks, owners, due dates, customer pain, or code changes. If nothing useful exists, return an empty entities array.',
        },
        {
          role: 'user',
          content: [
            `Source: ${artifact.sourceType}/${artifact.artifactType}`,
            `Title: ${artifact.title}`,
            artifact.sourceUrl ? `URL: ${artifact.sourceUrl}` : '',
            '',
            artifact.body.slice(0, 24000),
          ].filter(Boolean).join('\n'),
        },
      ],
      ExtractedEntitiesSchema,
      {
        temperature: 0.1,
        maxTokens: 4500,
        schemaName: 'company_graph_extraction',
      },
      ctx,
    );

    const created: CompanyGraphEntityRow[] = [];
    for (const entity of extracted.entities) {
      const row = await this.db.companyGraphEntity.create({
        data: {
          tenantId: input.tenantId,
          primaryArtifactId: artifact.id,
          entityType: entity.entityType,
          title: entity.title,
          summary: entity.summary,
          status: entity.status || 'active',
          ownerName: entity.ownerName,
          priority: entity.priority,
          confidence: entity.confidence,
          occurredAt: safeDate(entity.occurredAt),
          dueAt: safeDate(entity.dueAt),
          sourceArtifactIds: [artifact.id],
          relatedEntityIds: [],
          properties: {
            ...entity.properties,
            relatedEntityTitles: entity.relatedEntityTitles,
          },
          extractedBy: 'openai',
          createdBy: input.userId,
        },
      }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
      created.push(row);
    }

    const updatedArtifact = await this.db.companyArtifact.update({
      where: { id: artifact.id },
      data: {
        ingestionStatus: 'extracted',
        extractedAt: new Date(),
      },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));

    void this.audit.log({
      action: AuditAction.COMPANY_ENTITY_EXTRACTED,
      tenantId: input.tenantId,
      userId: input.userId,
      resource: 'company_artifact',
      resourceId: artifact.id,
      details: {
        extractedEntityCount: created.length,
        sourceType: artifact.sourceType,
        artifactType: artifact.artifactType,
      },
    }).catch(() => {});

    return { artifact: updatedArtifact, entities: created };
  }

  async analyzeAlignment(input: {
    tenantId: string;
    userId: string;
    limit?: number;
  }): Promise<{ findings: ExecutionDriftFindingRow[]; candidates: DriftCandidate[] }> {
    const entities = await this.db.companyGraphEntity.findMany({
      where: { tenantId: input.tenantId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: input.limit ?? 1000,
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));

    const candidates = buildDriftCandidates({ tenantId: input.tenantId, entities });
    const findings: ExecutionDriftFindingRow[] = [];
    for (const c of candidates) {
      const row = await this.db.executionDriftFinding.upsert({
        where: {
          tenantId_fingerprint: {
            tenantId: input.tenantId,
            fingerprint: c.fingerprint,
          },
        },
        create: {
          tenantId: input.tenantId,
          fingerprint: c.fingerprint,
          driftType: c.driftType,
          severity: c.severity,
          status: 'open',
          title: c.title,
          summary: c.summary,
          recommendation: c.recommendation,
          evidenceArtifactIds: c.evidenceArtifactIds,
          evidenceEntityIds: c.evidenceEntityIds,
          confidence: c.confidence,
          metadata: c.metadata,
        },
        update: {
          driftType: c.driftType,
          severity: c.severity,
          status: 'open',
          title: c.title,
          summary: c.summary,
          recommendation: c.recommendation,
          evidenceArtifactIds: c.evidenceArtifactIds,
          evidenceEntityIds: c.evidenceEntityIds,
          confidence: c.confidence,
          metadata: c.metadata,
          detectedAt: new Date(),
          resolvedAt: null,
        },
      }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
      findings.push(row);
    }

    if (findings.length > 0) {
      void this.audit.log({
        action: AuditAction.EXECUTION_DRIFT_DETECTED,
        tenantId: input.tenantId,
        userId: input.userId,
        resource: 'execution_drift_finding',
        details: {
          findingCount: findings.length,
          driftTypes: uniqueStrings(findings.map((f) => f.driftType)),
        },
        severity: findings.some((f) => f.severity === 'critical') ? 'CRITICAL' : 'WARN',
      }).catch(() => {});
    }

    return { findings, candidates };
  }

  async listDriftFindings(input: {
    tenantId: string;
    status?: string;
    severity?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: ExecutionDriftFindingRow[]; total: number }> {
    const where = {
      tenantId: input.tenantId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.severity ? { severity: input.severity } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.executionDriftFinding.findMany({
        where,
        orderBy: [{ detectedAt: 'desc' }, { createdAt: 'desc' }],
        take: input.limit,
        skip: input.offset,
      }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err)),
      this.db.executionDriftFinding.count({ where }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err)),
    ]);
    return { items, total };
  }

  async generateSpec(input: {
    tenantId: string;
    userId: string;
    driftFindingId?: string;
    entityIds?: string[];
  }): Promise<AgentExecutableSpecRow> {
    const llm = this.getLLM();
    if (!llm) {
      throw new Error('[company-operating-layer] OPENAI_API_KEY required for agent-executable spec generation. No template fallback is used.');
    }

    const finding = input.driftFindingId
      ? await this.db.executionDriftFinding.findFirst({
        where: { id: input.driftFindingId, tenantId: input.tenantId },
      }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err))
      : null;
    if (input.driftFindingId && !finding) throw new Error(`Execution drift finding id=${input.driftFindingId} not found in this tenant.`);

    const evidenceEntityIds = uniqueStrings([
      ...jsonStringArray(finding?.evidenceEntityIds),
      ...(input.entityIds ?? []),
    ]);
    if (evidenceEntityIds.length === 0) {
      throw new Error('Spec generation requires a driftFindingId with evidence or explicit entityIds.');
    }

    const entities = await this.db.companyGraphEntity.findMany({
      where: { tenantId: input.tenantId, id: { in: evidenceEntityIds }, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
    if (entities.length === 0) throw new Error('No tenant-scoped evidence entities found for spec generation.');

    const evidenceArtifactIds = uniqueStrings([
      ...jsonStringArray(finding?.evidenceArtifactIds),
      ...entities.flatMap((e) => sourceIds(e)),
    ]);
    const artifacts = evidenceArtifactIds.length > 0
      ? await this.db.companyArtifact.findMany({
        where: { tenantId: input.tenantId, id: { in: evidenceArtifactIds }, deletedAt: null },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err))
      : [];

    const ctx = new AgentContext({
      agentRole: 'COMPANY_SPEC_GENERATOR',
      tenantId: input.tenantId,
      userId: input.userId,
      workflowId: 'company-operating-layer-spec-generation',
    });

    const evidenceText = [
      finding
        ? `DRIFT FINDING\nType: ${finding.driftType}\nSeverity: ${finding.severity}\nTitle: ${finding.title}\nSummary: ${finding.summary}\nRecommendation: ${finding.recommendation}`
        : 'DRIFT FINDING\nNo persisted drift finding supplied. Use the evidence entities directly.',
      '',
      'ENTITIES',
      ...entities.map((e, i) => [
        `#${i + 1} ${e.entityType}: ${e.title}`,
        `Status: ${e.status}; Priority: ${e.priority ?? 'unknown'}; Owner: ${e.ownerName ?? 'unknown'}`,
        `Summary: ${e.summary}`,
        `Source artifacts: ${sourceIds(e).join(', ') || '(none)'}`,
      ].join('\n')),
      '',
      'ARTIFACT EXCERPTS',
      ...artifacts.map((a, i) => [
        `#${i + 1} ${a.sourceType}/${a.artifactType}: ${a.title}`,
        a.sourceUrl ? `URL: ${a.sourceUrl}` : '',
        a.body.slice(0, 2500),
      ].filter(Boolean).join('\n')),
    ].join('\n\n');

    const generated = await llm.respondStructured(
      [
        {
          role: 'system',
          content: 'You generate agent-executable specs for a company operating layer. Stay grounded in the supplied evidence. Include acceptance criteria, test plans, and approval gates. Do not claim integrations or permissions that evidence does not support.',
        },
        {
          role: 'user',
          content: `${evidenceText}\n\nReturn one implementation-ready spec. The spec must be safe for agent execution and must include human approval gates for risky external/destructive actions.`,
        },
      ],
      AgentExecutableSpecOutputSchema,
      {
        temperature: 0.15,
        maxTokens: 5000,
        schemaName: 'agent_executable_spec',
      },
      ctx,
    );

    const row = await this.db.agentExecutableSpec.create({
      data: {
        tenantId: input.tenantId,
        driftFindingId: finding?.id ?? null,
        title: generated.title,
        problemStatement: generated.problemStatement,
        objective: generated.objective,
        contextSummary: generated.contextSummary,
        proposedApproach: generated.proposedApproach,
        acceptanceCriteria: generated.acceptanceCriteria,
        testPlan: generated.testPlan,
        agentTaskPlan: generated.agentTaskPlan,
        approvalGates: generated.approvalGates,
        evidenceArtifactIds,
        evidenceEntityIds: entities.map((e) => e.id),
        status: 'draft',
        generatedBy: 'openai',
      },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));

    void this.audit.log({
      action: AuditAction.AGENT_SPEC_GENERATED,
      tenantId: input.tenantId,
      userId: input.userId,
      resource: 'agent_executable_spec',
      resourceId: row.id,
      details: {
        driftFindingId: row.driftFindingId,
        evidenceEntityCount: entities.length,
        evidenceArtifactCount: artifacts.length,
      },
    }).catch(() => {});

    return row;
  }

  async listSpecs(input: {
    tenantId: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: AgentExecutableSpecRow[]; total: number }> {
    const where = {
      tenantId: input.tenantId,
      deletedAt: null,
      ...(input.status ? { status: input.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.agentExecutableSpec.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: input.limit,
        skip: input.offset,
      }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err)),
      this.db.agentExecutableSpec.count({ where }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err)),
    ]);
    return { items, total };
  }

  async decideSpec(input: {
    tenantId: string;
    userId: string;
    specId: string;
    decision: 'APPROVED' | 'REJECTED';
    comment?: string;
  }): Promise<AgentExecutableSpecRow> {
    const existing = await this.db.agentExecutableSpec.findFirst({
      where: { id: input.specId, tenantId: input.tenantId, deletedAt: null },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
    if (!existing) throw new Error(`Agent executable spec id=${input.specId} not found in this tenant.`);
    if (existing.status !== 'draft') {
      throw new Error(`Agent executable spec id=${input.specId} was already reviewed with status=${existing.status}. Review decisions are immutable.`);
    }

    const status = input.decision === 'APPROVED' ? 'approved' : 'rejected';
    const row = await this.db.agentExecutableSpec.update({
      where: { id: input.specId },
      data: {
        status,
        reviewedBy: input.userId,
        reviewedAt: new Date(),
        reviewComment: input.comment?.trim() || null,
      },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));

    void this.audit.log({
      action: input.decision === 'APPROVED' ? AuditAction.AGENT_SPEC_APPROVED : AuditAction.AGENT_SPEC_REJECTED,
      tenantId: input.tenantId,
      userId: input.userId,
      resource: 'agent_executable_spec',
      resourceId: row.id,
      details: {
        decision: input.decision,
        comment: input.comment ?? null,
      },
    }).catch(() => {});

    return row;
  }

  private async assertArtifactsBelongToTenant(tenantId: string, artifactIds: string[]): Promise<void> {
    const ids = uniqueStrings(artifactIds);
    if (ids.length === 0) return;
    const rows = await this.db.companyArtifact.findMany({
      where: { tenantId, id: { in: ids }, deletedAt: null },
      select: { id: true },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new Error(`Source artifact(s) not found in this tenant: ${missing.join(', ')}`);
    }
  }
}
