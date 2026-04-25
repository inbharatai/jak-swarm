/**
 * export.service — orchestrates a workflow → exported artifact pipeline.
 *
 * Invariants:
 *   1. EVERY successful export creates a real WorkflowArtifact row with
 *      `status='READY'`. No metadata-only "exports" — the bytes exist.
 *   2. EVERY failed export creates a WorkflowArtifact row with
 *      `status='FAILED'` and `error` populated, so the cockpit shows
 *      the failure honestly.
 *   3. `markFinal=true` exports get `approvalState='REQUIRES_APPROVAL'` —
 *      they cannot be downloaded until a reviewer approves.
 *   4. Tenant isolation is enforced by ArtifactService. This service just
 *      passes tenantId through.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { ArtifactService, ArtifactSchemaUnavailableError } from './artifact.service.js';
import {
  exportByFormat,
  type ExportFormat,
} from './exporters/index.js';

/**
 * Pre-built export "kinds" that map a workflow's data to a converter input
 * shape. Each kind knows how to turn a workflow into the right document.
 *
 * - workflow_report: a prose PDF/DOCX of the workflow's plan + final output
 * - audit_evidence_index: a CSV/XLSX listing every artifact the workflow produced
 * - control_matrix: a CSV/XLSX of risk-level → status per task
 * - workpaper: a prose DOCX/PDF of plan + per-task notes (compliance workpaper format)
 * - audit_pack: a JSON dump of the entire workflow + traces + approvals + artifacts
 */
export type ExportKind =
  | 'workflow_report'
  | 'audit_evidence_index'
  | 'control_matrix'
  | 'workpaper'
  | 'audit_pack';

export interface ExportRequest {
  workflowId: string;
  tenantId: string;
  /** Operator producing the export — populates artifact.producedBy + audit row. */
  requestedBy: string;
  kind: ExportKind;
  format: ExportFormat;
  /**
   * When true, the export becomes a binding artifact that requires reviewer
   * approval before any download. When false (default), the export is a
   * draft and can be downloaded by anyone in the tenant.
   */
  markFinal?: boolean;
}

export interface ExportResultSummary {
  artifactId: string;
  status: 'READY' | 'FAILED';
  approvalState: 'NOT_REQUIRED' | 'REQUIRES_APPROVAL';
  fileName: string;
  sizeBytes: number;
  error?: string;
}

interface WorkflowDataForExport {
  workflow: {
    id: string;
    goal: string;
    status: string;
    industry: string | null;
    finalOutput: string | null;
    totalCostUsd: number;
    startedAt: Date;
    completedAt: Date | null;
    planJson: unknown;
    error: string | null;
  };
  traces: Array<{
    agentRole: string;
    stepIndex: number;
    durationMs: number | null;
    error: string | null;
    tokenUsage: unknown;
  }>;
  approvals: Array<{
    id: string;
    status: string;
    riskLevel: string;
    decidedAt: Date | null;
    reviewedBy: string | null;
  }>;
  artifacts: Array<{
    id: string;
    artifactType: string;
    fileName: string;
    sizeBytes: number | null;
    contentHash: string | null;
    approvalState: string;
    status: string;
    createdAt: Date;
  }>;
}

/**
 * Build the converter input shape for a given (kind, format) combination.
 * Tabular kinds (audit_evidence_index, control_matrix) produce {rows, columns}.
 * Document kinds (workflow_report, workpaper) produce {title, sections}.
 * audit_pack produces a JSON dump regardless of format choice — but we
 * still honour the requested format for sub-types where applicable.
 */
function buildConverterInput(kind: ExportKind, format: ExportFormat, data: WorkflowDataForExport): {
  payload: unknown;
  baseName: string;
} {
  const wf = data.workflow;
  const baseStem = `${kind}-${wf.id.slice(0, 8)}`;

  if (kind === 'audit_evidence_index') {
    const rows = data.artifacts.map((a) => ({
      artifactId: a.id,
      type: a.artifactType,
      fileName: a.fileName,
      sizeBytes: a.sizeBytes ?? 0,
      contentHash: a.contentHash ?? '',
      approvalState: a.approvalState,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
    }));
    return {
      payload: { rows, columns: ['artifactId', 'type', 'fileName', 'sizeBytes', 'contentHash', 'approvalState', 'status', 'createdAt'], sheetName: 'Evidence' },
      baseName: baseStem,
    };
  }

  if (kind === 'control_matrix') {
    const plan = (wf.planJson as { tasks?: Array<{ id?: string; name?: string; agentRole?: string; riskLevel?: string; requiresApproval?: boolean; status?: string }> } | null);
    const tasks = plan?.tasks ?? [];
    const rows = tasks.map((t) => ({
      taskId: t.id ?? '',
      name: t.name ?? '',
      agentRole: t.agentRole ?? '',
      riskLevel: t.riskLevel ?? '',
      requiresApproval: t.requiresApproval ? 'YES' : 'NO',
      status: t.status ?? '',
    }));
    return {
      payload: { rows, columns: ['taskId', 'name', 'agentRole', 'riskLevel', 'requiresApproval', 'status'], sheetName: 'Controls' },
      baseName: baseStem,
    };
  }

  if (kind === 'audit_pack') {
    return {
      payload: {
        version: 1,
        exportedAt: new Date().toISOString(),
        workflow: data.workflow,
        traces: data.traces,
        approvals: data.approvals,
        artifacts: data.artifacts,
      },
      baseName: baseStem,
    };
  }

  // workflow_report or workpaper — document layout
  const title = kind === 'workflow_report' ? `Workflow Report — ${wf.goal.slice(0, 80)}` : `Audit Workpaper — ${wf.goal.slice(0, 80)}`;
  const sections: Array<{ heading?: string; body: string }> = [];
  sections.push({ heading: 'Overview', body: [
    `Workflow ID: ${wf.id}`,
    `Status: ${wf.status}`,
    `Industry: ${wf.industry ?? '(general)'}`,
    `Started: ${wf.startedAt.toISOString()}`,
    `Completed: ${wf.completedAt ? wf.completedAt.toISOString() : '(not completed)'}`,
    `Total cost (USD): $${wf.totalCostUsd.toFixed(4)}`,
  ].join('\n') });
  sections.push({ heading: 'Goal', body: wf.goal });
  if (wf.finalOutput) sections.push({ heading: 'Final output', body: wf.finalOutput });
  if (wf.error) sections.push({ heading: 'Error', body: wf.error });

  // For workpaper, add per-step trace summary
  if (kind === 'workpaper' && data.traces.length > 0) {
    const traceLines = data.traces.map((t) => {
      const tu = (t.tokenUsage as { totalTokens?: number } | null)?.totalTokens ?? 0;
      return `- step ${t.stepIndex}: ${t.agentRole} — ${t.durationMs ?? 0}ms · ${tu} tokens${t.error ? ` · ERROR: ${t.error}` : ''}`;
    }).join('\n');
    sections.push({ heading: 'Step trace', body: traceLines });
  }

  if (data.approvals.length > 0) {
    const approvalLines = data.approvals.map((a) =>
      `- approval ${a.id}: ${a.status} (risk=${a.riskLevel})${a.reviewedBy ? `, reviewed by ${a.reviewedBy}` : ''}`,
    ).join('\n');
    sections.push({ heading: 'Approvals', body: approvalLines });
  }

  if (kind === 'workflow_report' && format === 'csv') {
    // Special case: csv-formatted workflow_report — fall back to a tabular
    // summary instead of a doc, because csv doesn't support headings.
    const rows = sections.map((s) => ({ section: s.heading ?? '(body)', content: s.body }));
    return { payload: { rows, columns: ['section', 'content'] }, baseName: baseStem };
  }
  if (kind === 'workflow_report' && format === 'xlsx') {
    const rows = sections.map((s) => ({ section: s.heading ?? '(body)', content: s.body }));
    return { payload: { rows, columns: ['section', 'content'], sheetName: 'Report' }, baseName: baseStem };
  }
  if (kind === 'workflow_report' && format === 'json') {
    return { payload: { title, sections }, baseName: baseStem };
  }
  // pdf / docx
  return { payload: { title, sections }, baseName: baseStem };
}

export class ExportService {
  private readonly artifacts: ArtifactService;

  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {
    this.artifacts = new ArtifactService(db, log);
  }

  /**
   * Generate an export and persist it as a WorkflowArtifact. Failures are
   * captured into the artifact row (status='FAILED' + error) — never
   * silently dropped. Throws ArtifactSchemaUnavailableError if the
   * artifact table is missing (route translates to 503).
   */
  async export(req: ExportRequest): Promise<ExportResultSummary> {
    // Load the workflow + everything needed for the export shape. Tenant
    // isolation enforced via the where clause.
    const workflow = await (this.db.workflow.findFirst as unknown as (a: unknown) => Promise<WorkflowDataForExport['workflow'] | null>)({
      where: { id: req.workflowId, tenantId: req.tenantId },
      select: {
        id: true, goal: true, status: true, industry: true, finalOutput: true,
        totalCostUsd: true, startedAt: true, completedAt: true, planJson: true, error: true,
      },
    });
    if (!workflow) throw new Error(`Workflow ${req.workflowId} not found in tenant ${req.tenantId}`);

    const traces = await (this.db.agentTrace.findMany as unknown as (a: unknown) => Promise<WorkflowDataForExport['traces']>)({
      where: { workflowId: req.workflowId, tenantId: req.tenantId },
      orderBy: { stepIndex: 'asc' },
      select: { agentRole: true, stepIndex: true, durationMs: true, error: true, tokenUsage: true },
    });

    const approvals = await (this.db.approvalRequest.findMany as unknown as (a: unknown) => Promise<WorkflowDataForExport['approvals']>)({
      where: { workflowId: req.workflowId, tenantId: req.tenantId },
      select: { id: true, status: true, riskLevel: true, decidedAt: true, reviewedBy: true },
    });

    let artifacts: WorkflowDataForExport['artifacts'] = [];
    try {
      artifacts = await (this.db.workflowArtifact.findMany as unknown as (a: unknown) => Promise<WorkflowDataForExport['artifacts']>)({
        where: { workflowId: req.workflowId, tenantId: req.tenantId, deletedAt: null },
        select: { id: true, artifactType: true, fileName: true, sizeBytes: true, contentHash: true, approvalState: true, status: true, createdAt: true },
      });
    } catch (err) {
      // If the artifact table doesn't exist, fail the export cleanly.
      const code = (err as { code?: string }).code;
      if (code === 'P2021' || /does not exist/i.test(err instanceof Error ? err.message : String(err))) {
        throw new ArtifactSchemaUnavailableError();
      }
      throw err;
    }

    const data: WorkflowDataForExport = { workflow, traces, approvals, artifacts };
    const { payload, baseName } = buildConverterInput(req.kind, req.format, data);

    const draftSuffix = req.markFinal ? '' : '-DRAFT';
    const opts = { baseName: `${baseName}${draftSuffix}`, title: `${req.kind} (${req.markFinal ? 'final' : 'draft'})` };

    let exportResult: { bytes: Uint8Array; mimeType: string; fileName: string; sizeBytes: number };
    try {
      exportResult = await exportByFormat(req.format, payload, opts);
    } catch (convErr) {
      // Honest failure path: create a FAILED artifact row so the cockpit
      // surfaces the failure instead of returning a generic 500.
      const errMsg = convErr instanceof Error ? convErr.message : String(convErr);
      const failedRow = await (this.db.workflowArtifact.create as unknown as (a: unknown) => Promise<{ id: string }>)({
        data: {
          tenantId: req.tenantId,
          workflowId: req.workflowId,
          producedBy: req.requestedBy,
          artifactType: 'export',
          fileName: `${baseName}.${req.format}`,
          mimeType: 'application/octet-stream',
          status: 'FAILED',
          approvalState: 'NOT_REQUIRED',
          error: `Converter failure (${req.format}): ${errMsg}`,
          metadata: { exportKind: req.kind, exportFormat: req.format, markFinal: Boolean(req.markFinal) },
        },
      });
      this.log.warn({ workflowId: req.workflowId, kind: req.kind, format: req.format, err: errMsg }, '[export] converter failed');
      return {
        artifactId: failedRow.id,
        status: 'FAILED',
        approvalState: 'NOT_REQUIRED',
        fileName: `${baseName}.${req.format}`,
        sizeBytes: 0,
        error: errMsg,
      };
    }

    // Success path — materialize a real artifact via ArtifactService.
    const created = await this.artifacts.createArtifact({
      tenantId: req.tenantId,
      workflowId: req.workflowId,
      producedBy: req.requestedBy,
      artifactType: 'export',
      fileName: exportResult.fileName,
      mimeType: exportResult.mimeType,
      bytes: exportResult.bytes,
      approvalState: req.markFinal ? 'REQUIRES_APPROVAL' : 'NOT_REQUIRED',
      metadata: { exportKind: req.kind, exportFormat: req.format, markFinal: Boolean(req.markFinal) },
    }) as { id: string };

    return {
      artifactId: created.id,
      status: 'READY',
      approvalState: req.markFinal ? 'REQUIRES_APPROVAL' : 'NOT_REQUIRED',
      fileName: exportResult.fileName,
      sizeBytes: exportResult.sizeBytes,
    };
  }
}
