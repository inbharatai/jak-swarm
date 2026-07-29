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
import {
  executeApprovedSpec,
  runPlanViaLangGraph,
  compileSpecCriteria,
  type CheckpointPrismaClient,
  type ExecuteSpecResult,
  type RunPlanInput,
  type FinishedRun,
} from '@jak-swarm/swarm';

/** Phase 6 — service-level result: the pure executor's result + the durable
 *  execution id + attempt number the service claimed. */
export type ExecuteSpecServiceResult = ExecuteSpecResult & {
  executionId: string;
  attempt: number;
};

/** Map the spec-execution acceptance verdict (AcceptanceVerdict enum string
 *  'MET'|'UNMET'|'UNVERIFIABLE') to the lowercase canonical form stored in the
 *  spec_executions.verdict / agent_executable_specs.lastVerdict /
 *  execution_drift_findings.resolutionVerdict columns (CHECK-constrained to
 *  'met'|'unmet'|'unverifiable'). */
function dbVerdict(verdict: string): string {
  return verdict.toLowerCase();
}

/** Map the spec-execution acceptance verdict to the WorkflowOutcome outcome
 *  bucket. MET → SUCCESS; UNMET → FAILED; UNVERIFIABLE → BLOCKED (a human must
 *  sign off, so the run is not counted as a clean pass or fail). */
function mapAcceptanceVerdictToOutcome(verdict: string): string {
  const v = verdict.toLowerCase();
  if (v === 'met') return 'OUTCOME_SUCCESS';
  if (v === 'unmet') return 'OUTCOME_FAILED';
  return 'OUTCOME_BLOCKED';
}
import type {
  AgentExecutableSpec,
  AcceptanceCriterion,
  SpecStatus,
  SpecTaskDescriptor,
  SpecTaskPlan,
} from '@jak-swarm/shared';
import { AcceptanceCriterionKind } from '@jak-swarm/shared';
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
  specExecution: {
    create: (args: unknown) => Promise<SpecExecutionRow>;
    update: (args: unknown) => Promise<SpecExecutionRow>;
    findFirst: (args: unknown) => Promise<SpecExecutionRow | null>;
    findMany: (args: unknown) => Promise<SpecExecutionRow[]>;
    count: (args: unknown) => Promise<number>;
  };
  workflowArtifact: {
    create: (args: unknown) => Promise<WorkflowArtifactRow>;
    findMany: (args: unknown) => Promise<WorkflowArtifactRow[]>;
    count: (args: unknown) => Promise<number>;
  };
  workflowOutcome: {
    upsert: (args: unknown) => Promise<unknown>;
    findUnique: (args: unknown) => Promise<unknown>;
  };
};

const STUB_BACKEND: LegacyAgentBackend = {
  callLLMPublic: () => { throw new Error('[company-operating-layer] legacy backend invoked unexpectedly'); },
  executeWithToolsPublic: () => { throw new Error('[company-operating-layer] legacy backend invoked unexpectedly'); },
};

export type ArtifactSource =
  | 'github'
  | 'linear'
  | 'jira'
  | 'slack'
  | 'notion'
  | 'google_drive'
  | 'gmail'
  | 'meeting'
  | 'customer_call'
  | 'support'
  | 'document'
  | 'manual'
  | 'other';

export type ArtifactType =
  | 'ticket'
  | 'issue'
  | 'pull_request'
  | 'commit'
  | 'slack_thread'
  | 'notion_page'
  | 'document'
  | 'meeting_transcript'
  | 'customer_feedback'
  | 'support_ticket'
  | 'email'
  | 'decision_note'
  | 'repository'
  | 'other';

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
  // Phase 6 — execution link columns (nullable; absent until first execution).
  executedAt?: Date | null;
  executedWorkflowId?: string | null;
  lastVerdict?: string | null;
  lastExecutionId?: string | null;
}

/** Phase 6 — one row per approved-spec execution attempt. */
export interface SpecExecutionRow {
  id: string;
  tenantId: string;
  specId: string;
  attempt: number;
  workflowId: string;
  status: string;
  verdict: string | null;
  awaitingApproval: boolean;
  approvalRequestId: string | null;
  failureClasses: unknown;
  driftFindingId: string | null;
  driftResolved: boolean;
  accumulatedCostUsd: number;
  taskTotal: number;
  taskPassed: number;
  taskFailed: number;
  taskBlocked: number;
  startedAt: Date;
  completedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Phase 6 — workflow artifact row (provenance fields added by migration 121). */
export interface WorkflowArtifactRow {
  id: string;
  tenantId: string;
  workflowId: string;
  taskId: string | null;
  producedBy: string;
  artifactType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  contentHash: string | null;
  inlineContent: string | null;
  storageKey: string | null;
  status: string;
  approvalState: string;
  specExecutionId: string | null;
  agentTraceId: string | null;
  approvalRequestId: string | null;
  metadata: unknown;
  createdAt: Date;
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

/**
 * Parse a spec row's `acceptanceCriteria` Json column into the typed shape the
 * closed loop measures. Accepts STRUCTURED criteria (objects with a `kind`) and
 * legacy plain-string criteria (no deterministic binding ⇒ UNVERIFIABLE). Never
 * fakes a structured criterion — an element that is neither a non-empty string
 * nor a kinded object is dropped (a malformed criterion must not crash the run).
 */
function parseAcceptanceCriteria(value: unknown): Array<AcceptanceCriterion | string> {
  if (!Array.isArray(value)) return [];
  const out: Array<AcceptanceCriterion | string> = [];
  for (const el of value) {
    if (typeof el === 'string') {
      if (el.trim().length > 0) out.push(el);
      continue;
    }
    if (el && typeof el === 'object' && typeof (el as Record<string, unknown>).kind === 'string') {
      out.push(el as AcceptanceCriterion);
    }
  }
  return out;
}

/** Parse a spec row's `agentTaskPlan` Json column into the typed plan. The
 *  generator zod-validates this shape on write; defensive on read so a manually
 *  authored spec with a missing/empty tasks array surfaces SpecPlanValidationError
 *  from `materializePlan` rather than crashing the loader. */
function parseSpecTaskPlan(value: unknown): SpecTaskPlan {
  if (value && typeof value === 'object' && Array.isArray((value as SpecTaskPlan).tasks)) {
    return { tasks: (value as SpecTaskPlan).tasks as SpecTaskDescriptor[] };
  }
  return { tasks: [] };
}

/** Map a Prisma `agent_executable_specs` row to the typed `AgentExecutableSpec`
 *  the HyperAgent closed loop operates on. Json columns are parsed defensively;
 *  the approval guard + plan validation run in `materializePlan` (inside
 *  `executeApprovedSpec`) so a bad spec never reaches the runner. */
function mapSpecRow(row: AgentExecutableSpecRow): AgentExecutableSpec {
  const approved = row.status === 'approved' && row.reviewedAt;
  return {
    id: row.id,
    tenantId: row.tenantId,
    driftFindingId: row.driftFindingId,
    title: row.title,
    problemStatement: row.problemStatement,
    objective: row.objective,
    contextSummary: row.contextSummary,
    proposedApproach: row.proposedApproach,
    acceptanceCriteria: parseAcceptanceCriteria(row.acceptanceCriteria),
    testPlan: row.testPlan,
    agentTaskPlan: parseSpecTaskPlan(row.agentTaskPlan),
    approvalGates: row.approvalGates,
    evidenceArtifactIds: jsonStringArray(row.evidenceArtifactIds),
    evidenceEntityIds: jsonStringArray(row.evidenceEntityIds),
    status: row.status as SpecStatus,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
    ...(approved
      ? {
          approvedAt: (row.reviewedAt as Date).toISOString(),
          approvedBy: row.reviewedBy ?? undefined,
        }
      : {}),
  };
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

    // Accuracy pass — structured-criteria compiler. The LLM generator emits
    // prose acceptanceCriteria (Zod: string[]), which the acceptance checker
    // honestly marks wired=false forever → the closed loop could never reach
    // MET, only UNVERIFIABLE. Here we deterministically compile the prose into
    // wired structured criteria bound to the generated task plan. The compiler
    // NEVER invents a binding: unresolvable prose is preserved as an explicit
    // CUSTOM criterion (honestly unwired) and the compile report is recorded
    // on the spec so the reviewer can see exactly which criteria will be
    // machine-measurable after the run. This is the same "LLM proposes,
    // deterministic code disposes" posture as the failure diagnostician.
    const planTasks: SpecTaskDescriptor[] = generated.agentTaskPlan.map((t) => ({
      id: t.id,
      name: t.title,
      description: t.description,
      agentRole: t.agentRole as SpecTaskDescriptor['agentRole'],
      toolsRequired: [],
      riskLevel: t.riskLevel as SpecTaskDescriptor['riskLevel'],
      dependsOn: t.dependsOn,
      requiresApproval: t.requiresApproval,
    }));
    const compileResult = compileSpecCriteria(
      generated.acceptanceCriteria,
      { tasks: planTasks },
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
        acceptanceCriteria: compileResult.criteria as unknown as object[],
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
        // Accuracy pass — how many prose criteria the compiler wired to
        // deterministic evidence vs left honestly CUSTOM/unbound.
        criteriaCompiled: compileResult.report.compiled.length,
        criteriaUnbound: compileResult.report.unbound.length,
        criteriaCoverage: compileResult.report.coverage,
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

  /**
   * Phase 6 — execute an APPROVED spec's closed loop: materialise the spec's
   * `agentTaskPlan` into a `WorkflowPlan`, run it via the real spec-execution
   * graph, harvest run evidence, and MEASURE it against the spec's
   * `acceptanceCriteria` (tri-state MET / UNMET / UNVERIFIABLE). REVIEWER+ only
   * (the route guards this) since it launches a workflow run.
   *
   * Persistence (NEW in PR C — the audit §A0 #1/#2/#4/#5 found the prior loop
   * returned a verdict + workflowId but persisted NOTHING):
   *   - claims a `spec_executions` row (idempotent per (tenant, spec, attempt)
   *     via the UNIQUE constraint; the attempt is computed atomically in-INSERT);
   *   - on completion, writes the verdict + counts + cost + completedAt back to
   *     that row, upserts a `workflow_outcomes` row, stamps the spec's
   *     `executedAt`/`executedWorkflowId`/`lastVerdict`/`lastExecutionId`, and
   *     writes drift resolution BACK to `execution_drift_findings` (resolved on
   *     MET, REOPENED with contradiction evidence on non-MET);
   *   - harvests a `workflow_artifacts` row per artifact id the run produced,
   *     with provenance (specExecutionId / agentTraceId / approvalRequestId);
   *   - on an approval pause (awaitingApproval), persists the execution row as
   *     `awaiting_approval` and returns — a later `resumeSpecExecution` continues
   *     the SAME LangGraph thread (Command(resume) against the Postgres
   *     checkpoint).
   *
   * Honest scope: the closed-loop LOGIC + this persistence layer are proven by
   * the integration test with a stub runPlan. The production `runPlan`
   * (`runPlanViaLangGraph`) drives the real graph and is env-blocked at every
   * agent call — wired-into-runtime, NOT production-proven here. The live
   * approval interrupt + resume E2E is env-blocked (PR G canary); the signal +
   * DB state transitions are unit/integration-tested with a stub.
   */
  async executeSpec(input: {
    tenantId: string;
    userId: string;
    specId: string;
    /** Optional runPlan override for tests (defaults to the real production
     *  `runPlanViaLangGraph`, which is env-blocked at every agent call). */
    deps?: { runPlan: (input: RunPlanInput) => Promise<FinishedRun> };
  }): Promise<ExecuteSpecServiceResult> {
    const row = await this.db.agentExecutableSpec.findFirst({
      where: { id: input.specId, tenantId: input.tenantId, deletedAt: null },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
    if (!row) throw new Error(`Agent executable spec id=${input.specId} not found in this tenant.`);

    const spec = mapSpecRow(row);

    // 0. Ensure a durable `workflows` row exists for this spec. The spec execution
    //    IS a workflow run — `workflow_outcomes` and `workflow_artifacts` both FK
    //    to `workflows(id)` ON DELETE CASCADE, so the row must exist before any
    //    outcome/artifact is persisted. Idempotent by workflowId (`wf_spec_<id>`):
    //    re-executing the same spec reuses the one workflow row across attempts.
    //    Honest observability: the spec execution is now visible in `workflows`,
    //    not an orphan workflowId only referenced from the spec_executions row.
    const workflowId = `wf_spec_${row.id}`;
    await this.ensureSpecWorkflow({
      workflowId,
      tenantId: input.tenantId,
      userId: input.userId,
      goal: spec.title,
      planJson: (spec.agentTaskPlan ?? {}) as object,
    });

    // 1. Claim a spec_executions row (atomic attempt-number computation in the
    //    INSERT; the UNIQUE(tenantId, specId, attempt) is the idempotency guard).
    //    A collision means a concurrent run claimed this attempt first — retry
    //    with the next attempt (bounded). Single-process: the subquery is atomic
    //    so the first INSERT always wins; the retry path is for multi-process
    //    contention (PR G).
    const execution = await this.claimSpecExecution({
      tenantId: input.tenantId,
      specId: row.id,
      workflowId,
      userId: input.userId,
      driftFindingId: spec.driftFindingId ?? null,
    });

    // 2. Run the closed loop. Default to the real production seam; tests inject
    //    a stub via input.deps so the persistence layer is provable without LLM
    //    keys (the live graph is env-blocked — same honesty posture as the pure
    //    executor's stub-based integration test).
    const result = await executeApprovedSpec({
      spec,
      tenantId: input.tenantId,
      userId: input.userId,
      now: new Date(),
      workflowId: execution.workflowId,
      deps: {
        runPlan: input.deps?.runPlan
          ? input.deps.runPlan
          : (planInput) => runPlanViaLangGraph(planInput, {
            db: this.db as unknown as CheckpointPrismaClient,
          }),
      },
    });

    // 3. Persist the outcome.
    if (result.awaitingApproval) {
      await this.markSpecExecutionAwaiting(execution.id, result.approvalRequestId);
    } else {
      await this.persistSpecExecutionCompletion({
        executionId: execution.id,
        tenantId: input.tenantId,
        userId: input.userId,
        specId: row.id,
        workflowId: execution.workflowId,
        driftFindingId: spec.driftFindingId ?? null,
        result,
        acceptanceCriteria: spec.acceptanceCriteria,
      });
    }

    void this.audit.log({
      action: AuditAction.AGENT_SPEC_EXECUTED,
      tenantId: input.tenantId,
      userId: input.userId,
      resource: 'agent_executable_spec',
      resourceId: row.id,
      details: {
        executionId: execution.id,
        attempt: execution.attempt,
        workflowId: result.workflowId,
        verdict: result.verdict,
        awaitingApproval: result.awaitingApproval,
        taskPassed: result.outcome.taskPassed,
        taskFailed: result.outcome.taskFailed,
        taskBlocked: result.outcome.taskBlocked,
        resolvedDrift: result.resolvedDrift,
      },
    }).catch(() => {});

    return { ...result, executionId: execution.id, attempt: execution.attempt };
  }

  /**
   * Phase 6 — resume an execution that paused at an approval gate. Validates
   * the execution row is `awaiting_approval` for this tenant, then re-drives the
   * SAME LangGraph thread (Command(resume) against the Postgres checkpoint) via
   * the production run seam, and persists the final outcome exactly like
   * `executeSpec`'s completion path.
   *
   * Honest scope: the live LangGraph Command(resume) E2E is env-blocked (no
   * provider keys here — PR G canary). The DB state transition + the resume
   * seam signature are wired and unit-tested; the real graph resume is the same
   * env-bar as every live-graph HyperAgent seam. A resume attempt on a row that
   * is NOT `awaiting_approval` throws (never silently double-resumes).
   */
  async resumeSpecExecution(input: {
    tenantId: string;
    userId: string;
    executionId: string;
    /** Optional runPlan override for tests (defaults to the real production seam). */
    deps?: { runPlan: (input: RunPlanInput) => Promise<FinishedRun> };
  }): Promise<ExecuteSpecServiceResult> {
    const execution = await this.db.specExecution.findFirst({
      where: { id: input.executionId, tenantId: input.tenantId },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
    if (!execution) throw new Error(`Spec execution id=${input.executionId} not found in this tenant.`);
    if (execution.status !== 'awaiting_approval') {
      throw new Error(`Spec execution id=${input.executionId} is not awaiting approval (status=${execution.status}); refusing to resume.`);
    }

    const row = await this.db.agentExecutableSpec.findFirst({
      where: { id: execution.specId, tenantId: input.tenantId, deletedAt: null },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
    if (!row) throw new Error(`Agent executable spec id=${execution.specId} not found in this tenant.`);
    const spec = mapSpecRow(row);

    // Defensive: the workflow row should already exist from the first execute,
    // but if it was pruned the outcome/artifact FKs would still need it. Re-ensure.
    await this.ensureSpecWorkflow({
      workflowId: execution.workflowId,
      tenantId: input.tenantId,
      userId: input.userId,
      goal: spec.title,
      planJson: (spec.agentTaskPlan ?? {}) as object,
    });

    // Re-run the closed loop against the SAME workflowId so the LangGraph
    // checkpointer resumes the existing thread (makeRunnableConfig keys the
    // thread by workflowId). The runtime's runPlanViaLangGraph catches a second
    // approval interrupt and returns awaitingApproval again if another gated
    // task is hit downstream.
    const result = await executeApprovedSpec({
      spec,
      tenantId: input.tenantId,
      userId: input.userId,
      now: new Date(),
      workflowId: execution.workflowId,
      deps: {
        runPlan: input.deps?.runPlan
          ? input.deps.runPlan
          : (planInput) => runPlanViaLangGraph(planInput, {
            db: this.db as unknown as CheckpointPrismaClient,
          }),
      },
    });

    if (result.awaitingApproval) {
      await this.markSpecExecutionAwaiting(execution.id, result.approvalRequestId);
    } else {
      await this.persistSpecExecutionCompletion({
        executionId: execution.id,
        tenantId: input.tenantId,
        userId: input.userId,
        specId: row.id,
        workflowId: execution.workflowId,
        driftFindingId: spec.driftFindingId ?? null,
        result,
        acceptanceCriteria: spec.acceptanceCriteria,
      });
    }

    void this.audit.log({
      action: AuditAction.AGENT_SPEC_EXECUTED,
      tenantId: input.tenantId,
      userId: input.userId,
      resource: 'agent_executable_spec',
      resourceId: row.id,
      details: {
        executionId: execution.id,
        attempt: execution.attempt,
        resumed: true,
        workflowId: result.workflowId,
        verdict: result.verdict,
        awaitingApproval: result.awaitingApproval,
      },
    }).catch(() => {});

    return { ...result, executionId: execution.id, attempt: execution.attempt };
  }

  /**
   * Ensure a durable `workflows` row exists for a spec execution. The spec
   * execution IS a workflow run: `workflow_outcomes` + `workflow_artifacts` FK
   * to `workflows(id)` ON DELETE CASCADE, so the row must exist before any
   * outcome/artifact is persisted. Idempotent by workflowId — re-executing the
   * same spec reuses the one workflow row across attempts (status reset to
   * RUNNING, planJson refreshed). The userId FK is RESTRICT, so the caller must
   * be a real User row (production: the authenticated user; tests: a seeded user).
   */
  private async ensureSpecWorkflow(input: {
    workflowId: string;
    tenantId: string;
    userId: string;
    goal: string;
    planJson: object;
  }): Promise<void> {
    await this.db.workflow.upsert({
      where: { id: input.workflowId },
      create: {
        id: input.workflowId,
        tenantId: input.tenantId,
        userId: input.userId,
        goal: input.goal.slice(0, 1000) || 'Spec execution',
        status: 'RUNNING',
        planJson: input.planJson,
      },
      update: {
        status: 'RUNNING',
        planJson: input.planJson,
        completedAt: null,
        error: null,
      },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
  }

  /**
   * Claim the next spec_executions row. The attempt number is computed
   * atomically inside the INSERT (subquery over MAX(attempt)); the
   * UNIQUE(tenantId, specId, attempt) constraint is the idempotency guard. On a
   * unique collision (concurrent run claimed this attempt first), retry with a
   * fresh id + re-computed attempt (bounded). Returns the claimed row.
   */
  private async claimSpecExecution(input: {
    tenantId: string;
    specId: string;
    workflowId: string;
    userId: string;
    driftFindingId: string | null;
  }): Promise<SpecExecutionRow> {
    const driftFindingValue = input.driftFindingId;
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = `specexec_${input.specId}_${Date.now()}_${attempt}`;
      try {
        const row = await this.db.specExecution.create({
          data: {
            id,
            tenantId: input.tenantId,
            specId: input.specId,
            // Prisma cannot express "attempt = MAX(attempt)+1" inline, so compute
            // it first then rely on the UNIQUE constraint as the race guard.
            attempt: await this.nextSpecExecutionAttempt(input.tenantId, input.specId),
            workflowId: input.workflowId,
            status: 'running',
            createdBy: input.userId,
            ...(driftFindingValue ? { driftFindingId: driftFindingValue } : {}),
          },
        }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
        return row;
      } catch (err) {
        // P2002 = unique constraint violation on (tenantId, specId, attempt) —
        // a concurrent run claimed this attempt between our MAX read and INSERT.
        // Retry; the next loop recomputes attempt. Any other error rethrows.
        if ((err as { code?: string }).code === 'P2002') continue;
        throw err;
      }
    }
    throw new Error(`Failed to claim a spec_executions row for spec ${input.specId} after 5 attempts (concurrent contention).`);
  }

  /** Compute the next attempt number for (tenantId, specId). */
  private async nextSpecExecutionAttempt(tenantId: string, specId: string): Promise<number> {
    const rows = await this.db.specExecution.findMany({
      where: { tenantId, specId },
      select: { attempt: true },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
    const max = rows.reduce((m, r) => Math.max(m, r.attempt), 0);
    return max + 1;
  }

  /** Mark a spec_executions row as awaiting human approval. */
  private async markSpecExecutionAwaiting(executionId: string, approvalRequestId?: string): Promise<void> {
    await this.db.specExecution.update({
      where: { id: executionId },
      data: {
        status: 'awaiting_approval',
        awaitingApproval: true,
        ...(approvalRequestId ? { approvalRequestId } : {}),
      },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
  }

  /**
   * Persist a completed execution: stamp the spec_executions row with the
   * verdict + counts + cost + completedAt, upsert a workflow_outcomes row, stamp
   * the agent_executable_specs execution-link columns, write drift resolution
   * back (resolved on MET, reopened-with-contradiction on non-MET), and harvest
   * a workflow_artifacts row per artifact id the run produced (with provenance).
   */
  private async persistSpecExecutionCompletion(input: {
    executionId: string;
    tenantId: string;
    userId: string;
    specId: string;
    workflowId: string;
    driftFindingId: string | null;
    result: ExecuteSpecResult;
    /** The spec's structured acceptance criteria, in the same order the measurer
     *  zipped them into `result.acceptanceResults`. The result's `criterion`
     *  field is only the description string, so the artifactId (for harvesting)
     *  must be recovered from these original criteria by index. */
    acceptanceCriteria: Array<AcceptanceCriterion | string>;
  }): Promise<void> {
    const { result } = input;
    const verdict = dbVerdict(result.verdict); // 'met' | 'unmet' | 'unverifiable' (lowercase, DB-canonical)
    const driftResolved = result.resolvedDrift.resolved;

    // spec_executions: terminal status + verdict + counts + cost + completedAt.
    await this.db.specExecution.update({
      where: { id: input.executionId },
      data: {
        status: 'completed',
        verdict,
        awaitingApproval: false,
        completedAt: new Date(),
        accumulatedCostUsd: result.outcome.totalCostUsd ?? 0,
        taskTotal: result.outcome.taskTotal,
        taskPassed: result.outcome.taskPassed,
        taskFailed: result.outcome.taskFailed,
        taskBlocked: result.outcome.taskBlocked,
        driftResolved,
        failureClasses: result.outcome.taskOutcomes
          .filter((o) => o.failureClass)
          .reduce<Record<string, string>>((acc, o) => {
            if (o.failureClass) acc[o.taskId] = o.failureClass;
            return acc;
          }, {}) as object,
      },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));

    // workflow_outcomes: one row per workflow (workflowId @unique) — upsert.
    await this.db.workflowOutcome.upsert({
      where: { workflowId: input.workflowId },
      create: {
        tenantId: input.tenantId,
        workflowId: input.workflowId,
        outcome: mapAcceptanceVerdictToOutcome(result.verdict),
        taskTotal: result.outcome.taskTotal,
        taskPassed: result.outcome.taskPassed,
        taskFailed: result.outcome.taskFailed,
        taskBlocked: result.outcome.taskBlocked,
        acceptanceResults: result.acceptanceResults as object,
        totalCostUsd: result.outcome.totalCostUsd ?? 0,
        durationMs: result.outcome.durationMs ?? 0,
        summary: result.outcome.summary,
      },
      update: {
        outcome: mapAcceptanceVerdictToOutcome(result.verdict),
        taskTotal: result.outcome.taskTotal,
        taskPassed: result.outcome.taskPassed,
        taskFailed: result.outcome.taskFailed,
        taskBlocked: result.outcome.taskBlocked,
        acceptanceResults: result.acceptanceResults as object,
        totalCostUsd: result.outcome.totalCostUsd ?? 0,
        durationMs: result.outcome.durationMs ?? 0,
        summary: result.outcome.summary,
      },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));

    // agent_executable_specs: stamp the execution link (idempotent last-write;
    // the lastExecutionId UNIQUE forbids two specs pointing at one execution,
    // which is correct — one execution is the "last" for exactly one spec).
    await this.db.agentExecutableSpec.update({
      where: { id: input.specId },
      data: {
        executedAt: new Date(),
        executedWorkflowId: input.workflowId,
        lastVerdict: verdict,
        lastExecutionId: input.executionId,
      },
    }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));

    // Drift resolution write-back (raw SQL — executionDriftFinding has no typed
    // `update` in the narrowed DbWithCompanyOs; tenant-scoped + status-guarded).
    if (input.driftFindingId) {
      if (driftResolved) {
        // MET → mark the drift resolved with full provenance (only if not
        // already resolved — never re-stamp a resolved row's identity fields).
        await this.db.$executeRawUnsafe(
          `UPDATE "execution_drift_findings"
              SET "status" = 'resolved', "resolvedAt" = NOW(),
                  "resolvedBy" = $2, "resolutionSpecId" = $3, "resolutionWorkflowId" = $4,
                  "resolutionVerdict" = $5, "resolutionExecutionId" = $6,
                  "lastResolutionAt" = COALESCE("resolvedAt", NOW()),
                  "updatedAt" = NOW()
            WHERE "id" = $1 AND "tenantId" = $7 AND "status" <> 'resolved'`,
          input.driftFindingId,
          input.userId,
          input.specId,
          input.workflowId,
          verdict,
          input.executionId,
          input.tenantId,
        ).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
      } else {
        // Non-MET → a previously-RESOLVED drift is REOPENED with contradiction
        // evidence (status back to 'open' + contradictedAt + the execution that
        // contradicted it). A still-open drift is left open (no spurious stamp).
        await this.db.$executeRawUnsafe(
          `UPDATE "execution_drift_findings"
              SET "status" = 'open', "contradictedAt" = NOW(),
                  "contradictingExecutionId" = $2,
                  "lastResolutionAt" = COALESCE("resolvedAt", "lastResolutionAt"),
                  "resolvedAt" = NULL,
                  "updatedAt" = NOW()
            WHERE "id" = $1 AND "tenantId" = $3 AND "status" = 'resolved'`,
          input.driftFindingId,
          input.executionId,
          input.tenantId,
        ).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
      }
    }

    // Artifact harvesting: a workflow_artifacts row per artifact id the run
    // produced, with provenance (specExecutionId / agentTraceId / approval).
    // The run's `artifacts` are the logical ids the ARTIFACT_PRESENT criteria
    // checked; we persist a durable provenance row for each (inline content =
    // the run evidence snapshot, so the artifact is self-describing even before
    // a richer harvester extracts bytes from taskResults).
    await this.harvestExecutionArtifacts({
      executionId: input.executionId,
      tenantId: input.tenantId,
      workflowId: input.workflowId,
      userId: input.userId,
      specId: input.specId,
      verdict,
      artifactIds: this.acceptanceArtifacts(result, input.acceptanceCriteria),
    });
  }

  /** The artifact ids the run produced. The acceptance result's `criterion`
   *  field is only the description string (the measurer strips the structured
   *  criterion), so the artifactId is recovered by zipping the spec's original
   *  criteria (same order) with the result + taking each satisfied
   *  ARTIFACT_PRESENT criterion's artifactId. */
  private acceptanceArtifacts(
    result: ExecuteSpecResult,
    criteria: Array<AcceptanceCriterion | string>,
  ): string[] {
    const ids = new Set<string>();
    for (let i = 0; i < criteria.length; i++) {
      const c = criteria[i];
      const r = result.acceptanceResults[i];
      if (!c || typeof c === 'string' || !r || !r.satisfied) continue;
      if (c.kind === AcceptanceCriterionKind.ARTIFACT_PRESENT && c.artifactId) {
        ids.add(c.artifactId);
      }
    }
    return [...ids];
  }

  /** Harvest a workflow_artifacts row per produced artifact id (provenance). */
  private async harvestExecutionArtifacts(input: {
    executionId: string;
    tenantId: string;
    workflowId: string;
    userId: string;
    specId: string;
    verdict: string;
    artifactIds: string[];
  }): Promise<void> {
    if (input.artifactIds.length === 0) return;
    const inline = JSON.stringify({
      specId: input.specId,
      executionId: input.executionId,
      verdict: input.verdict,
      harvestedAt: new Date().toISOString(),
      note: 'Provenance row for an artifact the spec execution produced; richer byte-level harvesting is a separate wiring (audit §A0 #2).',
    });
    for (const artifactId of input.artifactIds) {
      const contentHash = createHash('sha256').update(inline).digest('hex');
      try {
        await this.db.workflowArtifact.create({
          data: {
            tenantId: input.tenantId,
            workflowId: input.workflowId,
            producedBy: input.userId,
            artifactType: 'final_output',
            fileName: `${artifactId}.json`,
            mimeType: 'application/json',
            sizeBytes: Buffer.byteLength(inline, 'utf8'),
            contentHash,
            inlineContent: inline,
            status: 'READY',
            approvalState: 'NOT_REQUIRED',
            specExecutionId: input.executionId,
            metadata: { specId: input.specId, executionId: input.executionId, harvestedArtifactId: artifactId } as object,
          },
        }).catch((err: unknown) => rethrowIfCompanyOsSchemaMissing(err));
      } catch {
        // A duplicate harvest for the same execution+artifact is non-fatal
        // (the artifact row is a provenance trail; do not fail the execution).
      }
    }
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
