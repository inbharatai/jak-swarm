/**
 * workpaper.service — generates per-control workpaper PDFs for an audit run.
 *
 * Each workpaper is a real PDF (via existing exportPdf in services/exporters/
 * index.ts) that pulls together:
 *   - Control code + title + framework
 *   - Test procedure
 *   - Result + rationale + confidence
 *   - Evidence considered (auto + manual)
 *   - Linked exception summary (when applicable)
 *
 * The PDF is persisted as a WorkflowArtifact with:
 *   - artifactType = 'workpaper'
 *   - approvalState = 'REQUIRES_APPROVAL'  (always — workpapers are binding)
 *   - parentArtifactId = (none — top-level)
 *
 * The corresponding AuditWorkpaper row stores the artifactId pointer +
 * status. Status mirrors the WorkflowArtifact.approvalState, with an extra
 * 'final' state set when the workpaper is included in a final audit pack.
 *
 * Design choice: WorkflowArtifact requires a workflowId. Audit runs live
 * outside the standard workflow table, so we lazily create a single
 * "backing workflow" row per audit run on first workpaper generation.
 * The backing workflow's id is stamped into AuditRun.metadata.backingWorkflowId
 * for reuse on subsequent generations + final pack assembly.
 *
 * Tenant isolation enforced at every method.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { ArtifactService } from '../artifact.service.js';
import { exportPdf } from '../exporters/index.js';
import { AuditSchemaUnavailableError, type AuditLifecycleEmitter } from './audit-run.service.js';

function rethrowIfSchemaMissing(err: unknown): never {
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(msg)) {
    throw new AuditSchemaUnavailableError();
  }
  throw err;
}

// ─── Service ───────────────────────────────────────────────────────────

export interface GenerateAllInput {
  tenantId: string;
  auditRunId: string;
  generatedBy: string;
  /** When true, regenerate even when a workpaper already exists. */
  forceRegenerate?: boolean;
}

export interface GenerateAllResult {
  totalControls: number;
  generated: number;
  skipped: number;
  failed: number;
  durationMs: number;
}

export interface GenerateSingleInput {
  tenantId: string;
  auditRunId: string;
  controlTestId: string;
  generatedBy: string;
  forceRegenerate?: boolean;
}

export class WorkpaperService {
  private readonly artifacts: ArtifactService;

  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
    private readonly emit: AuditLifecycleEmitter = () => {},
  ) {
    this.artifacts = new ArtifactService(db, log);
  }

  /**
   * Ensure a backing Workflow row exists for the audit run. Stores its id
   * in AuditRun.metadata.backingWorkflowId. Returns the workflow id.
   */
  async ensureBackingWorkflow(input: { tenantId: string; auditRunId: string; userId: string }): Promise<string> {
    const run = await (this.db.auditRun.findFirst as unknown as (a: unknown) => Promise<{
      id: string; tenantId: string; userId: string; title: string; metadata: Record<string, unknown> | null;
    } | null>)({
      where: { id: input.auditRunId, tenantId: input.tenantId },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (!run) throw new Error(`Audit run ${input.auditRunId} not found in tenant ${input.tenantId}`);

    const meta = (run.metadata ?? {}) as { backingWorkflowId?: string };
    if (meta.backingWorkflowId) {
      // Validate the cached workflow still exists + belongs to this tenant.
      const wf = await this.db.workflow.findFirst({
        where: { id: meta.backingWorkflowId, tenantId: input.tenantId },
        select: { id: true },
      });
      if (wf) return wf.id;
    }

    const wf = await this.db.workflow.create({
      data: {
        tenantId: input.tenantId,
        userId: run.userId,
        goal: `audit_run:${run.id} — ${run.title}`,
        status: 'COMPLETED', // backing-only; real lifecycle lives on AuditRun
      },
    });

    // Stamp the new id back into AuditRun.metadata
    const newMeta = { ...meta, backingWorkflowId: wf.id };
    await this.db.auditRun.update({
      where: { id: run.id },
      data: { metadata: newMeta as object },
    });
    return wf.id;
  }

  /**
   * Generate workpapers for every control test in the audit run that has a
   * terminal result. Skips controls still in 'not_started' / 'testing'.
   */
  async generateAll(input: GenerateAllInput): Promise<GenerateAllResult> {
    const start = Date.now();
    const tests = await (this.db.controlTest.findMany as unknown as (a: unknown) => Promise<Array<{ id: string; status: string; result: string | null }>>)({
      where: {
        auditRunId: input.auditRunId,
        tenantId: input.tenantId,
        status: { in: ['passed', 'failed', 'exception_found', 'evidence_missing', 'reviewer_required', 'approved', 'rejected', 'remediated'] },
      },
      select: { id: true, status: true, result: true },
      orderBy: { createdAt: 'asc' },
    }).catch((err) => rethrowIfSchemaMissing(err));

    const summary: GenerateAllResult = {
      totalControls: tests.length,
      generated: 0,
      skipped: 0,
      failed: 0,
      durationMs: 0,
    };

    for (const t of tests) {
      try {
        const r = await this.generateSingle({
          tenantId: input.tenantId,
          auditRunId: input.auditRunId,
          controlTestId: t.id,
          generatedBy: input.generatedBy,
          ...(input.forceRegenerate ? { forceRegenerate: true } : {}),
        });
        if (r.action === 'generated') summary.generated++;
        else summary.skipped++;
      } catch (err) {
        summary.failed++;
        this.log.error({ controlTestId: t.id, err: err instanceof Error ? err.message : String(err) }, '[workpaper] generation failed');
      }
    }

    summary.durationMs = Date.now() - start;
    return summary;
  }

  /**
   * Generate (or regenerate) one workpaper. Idempotent on (auditRunId,
   * controlId): re-running without forceRegenerate returns the existing
   * workpaper unchanged.
   */
  async generateSingle(input: GenerateSingleInput): Promise<{ action: 'generated' | 'skipped'; workpaperId: string; artifactId: string | null }> {
    const test = await (this.db.controlTest.findFirst as unknown as (a: unknown) => Promise<{
      id: string; tenantId: string; auditRunId: string; controlId: string; controlCode: string; controlTitle: string;
      testProcedure: string | null; status: string; result: string | null; rationale: string | null; confidence: number | null;
      evidenceConsidered: unknown; evidenceCount: number; exceptionId: string | null;
    } | null>)({
      where: { id: input.controlTestId, tenantId: input.tenantId, auditRunId: input.auditRunId },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (!test) throw new Error(`ControlTest ${input.controlTestId} not found`);

    // Existing workpaper short-circuit
    const existing = await (this.db.auditWorkpaper.findFirst as unknown as (a: unknown) => Promise<{ id: string; artifactId: string | null; status: string } | null>)({
      where: { auditRunId: input.auditRunId, controlId: test.controlId },
    });
    if (existing && !input.forceRegenerate) {
      return { action: 'skipped', workpaperId: existing.id, artifactId: existing.artifactId };
    }

    const run = await (this.db.auditRun.findFirst as unknown as (a: unknown) => Promise<{
      id: string; userId: string; title: string; frameworkSlug: string; periodStart: Date; periodEnd: Date;
    } | null>)({
      where: { id: input.auditRunId, tenantId: input.tenantId },
    });
    if (!run) throw new Error(`Audit run ${input.auditRunId} not found`);

    const exception = test.exceptionId
      ? await this.db.auditException.findUnique({ where: { id: test.exceptionId } })
      : null;

    // Build PDF
    const sections = this.buildPdfSections({ test, run, exception });
    const pdf = await exportPdf(
      { title: `Workpaper — ${test.controlCode} — ${test.controlTitle}`, sections },
      { baseName: `workpaper-${test.controlCode}-${test.id.slice(0, 8)}` },
    );

    const workflowId = await this.ensureBackingWorkflow({ tenantId: input.tenantId, auditRunId: input.auditRunId, userId: run.userId });

    const artifact = (await this.artifacts.createArtifact({
      tenantId: input.tenantId,
      workflowId,
      producedBy: input.generatedBy,
      artifactType: 'workpaper',
      fileName: pdf.fileName,
      mimeType: pdf.mimeType,
      bytes: pdf.bytes,
      approvalState: 'REQUIRES_APPROVAL',
      metadata: {
        auditRunId: input.auditRunId,
        controlTestId: test.id,
        controlCode: test.controlCode,
        controlId: test.controlId,
        result: test.result,
        confidence: test.confidence,
      },
    })) as { id: string };

    // Upsert AuditWorkpaper row
    const workpaper = await this.db.auditWorkpaper.upsert({
      where: { auditRunId_controlId: { auditRunId: input.auditRunId, controlId: test.controlId } },
      create: {
        tenantId: input.tenantId,
        auditRunId: input.auditRunId,
        controlTestId: test.id,
        controlId: test.controlId,
        controlCode: test.controlCode,
        controlTitle: test.controlTitle,
        artifactId: artifact.id,
        status: 'needs_review',
        generatedBy: input.generatedBy,
      },
      update: {
        artifactId: artifact.id,
        status: 'needs_review',
        generatedBy: input.generatedBy,
        approvedAt: null,
        reviewedBy: null,
      },
    });

    this.emit({
      type: 'workpaper_generated',
      auditRunId: input.auditRunId,
      agentRole: 'WORKPAPER_WRITER',
      timestamp: new Date().toISOString(),
      details: {
        controlCode: test.controlCode,
        controlId: test.controlId,
        artifactId: artifact.id,
        workpaperId: workpaper.id,
        sizeBytes: pdf.sizeBytes,
      },
    });

    this.emit({
      type: 'reviewer_action_required',
      auditRunId: input.auditRunId,
      agentRole: 'WORKPAPER_WRITER',
      timestamp: new Date().toISOString(),
      details: { workpaperId: workpaper.id, artifactId: artifact.id, controlCode: test.controlCode },
    });

    return { action: 'generated', workpaperId: workpaper.id, artifactId: artifact.id };
  }

  /**
   * Reviewer approve/reject — also propagates the decision to the underlying
   * WorkflowArtifact.approvalState so download gates align.
   */
  async setReviewDecision(input: {
    workpaperId: string;
    tenantId: string;
    decision: 'approved' | 'rejected';
    reviewerNotes?: string;
    reviewedBy: string;
  }): Promise<unknown> {
    const wp = await (this.db.auditWorkpaper.findFirst as unknown as (a: unknown) => Promise<{
      id: string; tenantId: string; auditRunId: string; artifactId: string | null; status: string;
    } | null>)({
      where: { id: input.workpaperId, tenantId: input.tenantId },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (!wp) throw new Error(`Workpaper ${input.workpaperId} not found in tenant ${input.tenantId}`);

    if (wp.artifactId) {
      await this.artifacts.setApprovalState({
        artifactId: wp.artifactId,
        tenantId: input.tenantId,
        decision: input.decision === 'approved' ? 'APPROVED' : 'REJECTED',
        reviewedBy: input.reviewedBy,
      });
    }

    const updated = await this.db.auditWorkpaper.update({
      where: { id: wp.id },
      data: {
        status: input.decision,
        reviewedBy: input.reviewedBy,
        ...(input.decision === 'approved' ? { approvedAt: new Date() } : {}),
        ...(input.reviewerNotes ? { reviewerNotes: input.reviewerNotes } : {}),
      },
    });

    // When ALL workpapers approved, promote AuditRun → READY_TO_PACK
    if (input.decision === 'approved') {
      await this.maybePromoteToReadyToPack(wp.auditRunId, input.tenantId);
    }
    return updated;
  }

  async list(input: { tenantId: string; auditRunId: string }): Promise<unknown[]> {
    return (this.db.auditWorkpaper.findMany as unknown as (a: unknown) => Promise<unknown[]>)({
      where: { tenantId: input.tenantId, auditRunId: input.auditRunId },
      orderBy: { controlCode: 'asc' },
    }).catch((err) => rethrowIfSchemaMissing(err));
  }

  async get(input: { tenantId: string; id: string }): Promise<unknown> {
    const row = await (this.db.auditWorkpaper.findFirst as unknown as (a: unknown) => Promise<unknown | null>)({
      where: { id: input.id, tenantId: input.tenantId },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (!row) throw new Error(`Workpaper ${input.id} not found`);
    return row;
  }

  /**
   * If every workpaper for an audit run is `approved`, transition the audit
   * run to READY_TO_PACK. Idempotent.
   */
  private async maybePromoteToReadyToPack(auditRunId: string, tenantId: string): Promise<void> {
    const wps = await (this.db.auditWorkpaper.findMany as unknown as (a: unknown) => Promise<Array<{ status: string }>>)({
      where: { auditRunId, tenantId },
      select: { status: true },
    });
    if (wps.length === 0) return;
    const allApproved = wps.every((w) => w.status === 'approved');
    if (!allApproved) return;

    const cur = await (this.db.auditRun.findFirst as unknown as (a: unknown) => Promise<{ status: string } | null>)({
      where: { id: auditRunId, tenantId },
      select: { status: true },
    });
    if (!cur) return;
    if (cur.status !== 'REVIEWING') return; // only valid forward path
    await this.db.auditRun.update({ where: { id: auditRunId }, data: { status: 'READY_TO_PACK' } });
  }

  // ─── PDF section builder ─────────────────────────────────────────────

  private buildPdfSections(input: {
    test: {
      controlCode: string; controlTitle: string; testProcedure: string | null;
      status: string; result: string | null; rationale: string | null; confidence: number | null;
      evidenceConsidered: unknown; evidenceCount: number;
    };
    run: { title: string; frameworkSlug: string; periodStart: Date; periodEnd: Date };
    exception: { description: string; severity: string; remediationPlan: string | null; status: string } | null;
  }): Array<{ heading?: string; body: string }> {
    const t = input.test;
    const r = input.run;

    const evidence = (t.evidenceConsidered ?? {}) as {
      autoMappingCount?: number; manualEvidenceCount?: number;
      autoMappingIds?: Array<{ type?: string; evidenceId?: string; at?: string }>;
      manualEvidenceIds?: Array<{ title?: string }>;
    };

    const sections: Array<{ heading?: string; body: string }> = [
      {
        heading: 'Audit run',
        body: [
          `- Title: ${r.title}`,
          `- Framework: ${r.frameworkSlug}`,
          `- Period: ${r.periodStart.toISOString().slice(0, 10)} → ${r.periodEnd.toISOString().slice(0, 10)}`,
        ].join('\n'),
      },
      {
        heading: 'Control',
        body: [
          `- Code: ${t.controlCode}`,
          `- Title: ${t.controlTitle}`,
        ].join('\n'),
      },
      {
        heading: 'Test procedure',
        body: t.testProcedure ?? '(no procedure recorded)',
      },
      {
        heading: 'Result',
        body: [
          `- Status: ${t.status}`,
          `- Result: ${t.result ?? '(not yet evaluated)'}`,
          `- Confidence: ${t.confidence !== null ? t.confidence.toFixed(2) : '(unknown)'}`,
          '',
          'Rationale:',
          t.rationale ?? '(no rationale recorded)',
        ].join('\n'),
      },
      {
        heading: 'Evidence considered',
        body: [
          `- Auto-mapped rows: ${evidence.autoMappingCount ?? 0}`,
          `- Manual evidence rows: ${evidence.manualEvidenceCount ?? 0}`,
          `- Total evidence count: ${t.evidenceCount}`,
          '',
          ...(evidence.autoMappingIds ?? []).slice(0, 25).map((m, i) => `- Auto ${i + 1}: ${m.type ?? '?'} ${m.evidenceId ?? '?'} @ ${m.at ?? '?'}`),
          ...(evidence.manualEvidenceIds ?? []).slice(0, 25).map((m, i) => `- Manual ${i + 1}: "${m.title ?? '?'}"`),
        ].join('\n'),
      },
    ];

    if (input.exception) {
      sections.push({
        heading: 'Exception',
        body: [
          `- Severity: ${input.exception.severity}`,
          `- Status: ${input.exception.status}`,
          '',
          'Description:',
          input.exception.description,
          '',
          'Remediation plan:',
          input.exception.remediationPlan ?? '(none recorded yet)',
        ].join('\n'),
      });
    }

    sections.push({
      heading: 'Reviewer signoff',
      body: '(reviewer notes will appear here after sign-off)',
    });

    return sections;
  }
}
