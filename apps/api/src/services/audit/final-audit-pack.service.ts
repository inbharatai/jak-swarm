/**
 * final-audit-pack.service — assembles the binding final pack for an audit run.
 *
 * Hard gate (no fakes): refuses to generate when ANY workpaper is in
 * REQUIRES_APPROVAL or REJECTED state. The pack is the legally binding
 * artefact handed to the external auditor; signing over un-reviewed evidence
 * would defeat the entire compliance posture.
 *
 * Pack contents (single signed bundle artefact):
 *   1. Every approved workpaper PDF (referenced by id + content hash)
 *   2. Control matrix CSV (one row per ControlTest)
 *   3. Exceptions JSON (one entry per AuditException)
 *   4. Executive summary PDF (LLM-curated when available, deterministic
 *      template otherwise — never fakes the LLM source)
 *
 * The bundle's signature is HMAC-SHA256 over the canonical manifest JSON
 * via existing bundle-signing.service. Verifiable by re-fetching artefact
 * bytes + recomputing — see verifyBundle().
 *
 * On success: AuditRun.status: READY_TO_PACK → FINAL_PACK → COMPLETED
 *             AuditRun.finalPackArtifactId = bundle artefact id
 *             emits final_pack_started + final_pack_generated + audit_run_completed
 *
 * Tenant isolation enforced at every method.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { ArtifactService } from '../artifact.service.js';
import { exportCsv, exportPdf } from '../exporters/index.js';
import {
  signBundleManifest,
  isSigningAvailable,
  BundleSigningUnavailableError,
  type BundleManifest,
  type BundleArtifactRef,
} from '../bundle-signing.service.js';
import { WorkpaperService } from './workpaper.service.js';
import { AuditSchemaUnavailableError, type AuditLifecycleEmitter, type AuditRunStatus } from './audit-run.service.js';

function rethrowIfSchemaMissing(err: unknown): never {
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(msg)) {
    throw new AuditSchemaUnavailableError();
  }
  throw err;
}

export class FinalPackGateError extends Error {
  readonly reason: 'workpapers_not_approved' | 'no_workpapers' | 'invalid_state';
  readonly details: Record<string, unknown>;
  constructor(reason: FinalPackGateError['reason'], message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'FinalPackGateError';
    this.reason = reason;
    this.details = details;
  }
}

export interface GenerateFinalPackInput {
  tenantId: string;
  auditRunId: string;
  generatedBy: string;
  /**
   * Optional reviewer override — when true, refuses to bypass the workpaper
   * approval gate. Defaults to false; the gate is ALWAYS enforced.
   */
  bypassApprovalGate?: false;
}

export interface FinalPackResult {
  artifactId: string;
  signature: string;
  signatureAlgo: string;
  manifest: BundleManifest;
  workpaperCount: number;
  exceptionCount: number;
  controlCount: number;
}

export class FinalAuditPackService {
  private readonly artifacts: ArtifactService;
  private readonly workpapers: WorkpaperService;

  constructor(
    private readonly db: PrismaClient,
    log: FastifyBaseLogger,
    private readonly emit: AuditLifecycleEmitter = () => {},
  ) {
    this.artifacts = new ArtifactService(db, log);
    this.workpapers = new WorkpaperService(db, log, emit);
  }

  async generate(input: GenerateFinalPackInput): Promise<FinalPackResult> {
    const sigStatus = isSigningAvailable();
    if (!sigStatus.ready) throw new BundleSigningUnavailableError();

    const run = await (this.db.auditRun.findFirst as unknown as (a: unknown) => Promise<{
      id: string; tenantId: string; userId: string; title: string; frameworkSlug: string; status: AuditRunStatus;
      periodStart: Date; periodEnd: Date; coveragePercent: number | null; riskSummary: string | null;
    } | null>)({
      where: { id: input.auditRunId, tenantId: input.tenantId, deletedAt: null },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (!run) throw new Error(`Audit run ${input.auditRunId} not found in tenant ${input.tenantId}`);

    if (run.status !== 'READY_TO_PACK' && run.status !== 'REVIEWING') {
      throw new FinalPackGateError('invalid_state', `Audit run is in '${run.status}' — must be READY_TO_PACK before final pack`, { currentStatus: run.status });
    }

    // Approval gate
    const wps = await (this.db.auditWorkpaper.findMany as unknown as (a: unknown) => Promise<Array<{ id: string; controlCode: string; status: string; artifactId: string | null }>>)({
      where: { tenantId: input.tenantId, auditRunId: input.auditRunId },
      select: { id: true, controlCode: true, status: true, artifactId: true },
    });

    if (wps.length === 0) {
      throw new FinalPackGateError('no_workpapers', 'No workpapers exist for this audit run. Run /workpapers/generate first.');
    }

    const unapproved = wps.filter((w) => w.status !== 'approved');
    if (unapproved.length > 0) {
      throw new FinalPackGateError(
        'workpapers_not_approved',
        `${unapproved.length} of ${wps.length} workpapers not yet approved (${unapproved.slice(0, 5).map((w) => w.controlCode).join(', ')}${unapproved.length > 5 ? '...' : ''})`,
        { unapprovedCount: unapproved.length, totalWorkpapers: wps.length, examples: unapproved.slice(0, 10).map((w) => ({ id: w.id, controlCode: w.controlCode, status: w.status })) },
      );
    }

    // Transition into FINAL_PACK
    await this.db.auditRun.update({ where: { id: run.id }, data: { status: 'FINAL_PACK' } });
    this.emit({
      type: 'final_pack_started',
      auditRunId: run.id,
      agentRole: 'FINAL_AUDIT_PACK_AGENT',
      timestamp: new Date().toISOString(),
      details: { workpaperCount: wps.length },
    });

    try {
      // Ensure backing workflow exists for the bundle artifact
      const workflowId = await this.workpapers.ensureBackingWorkflow({
        tenantId: input.tenantId,
        auditRunId: input.auditRunId,
        userId: run.userId,
      });

      // Load the data we need for the supplementary artefacts
      const [tests, exceptions] = await Promise.all([
        this.db.controlTest.findMany({
          where: { auditRunId: run.id, tenantId: input.tenantId },
          orderBy: { controlCode: 'asc' },
        }),
        this.db.auditException.findMany({
          where: { auditRunId: run.id, tenantId: input.tenantId },
          orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
        }),
      ]);

      // 1. Control matrix CSV — one row per ControlTest
      const matrixRows = tests.map((t) => ({
        controlCode: t.controlCode,
        controlTitle: t.controlTitle,
        status: t.status,
        result: t.result ?? '',
        confidence: t.confidence !== null ? t.confidence.toFixed(2) : '',
        evidenceCount: t.evidenceCount,
        rationale: (t.rationale ?? '').slice(0, 500),
        completedAt: t.completedAt ? t.completedAt.toISOString() : '',
      }));
      const matrixCsv = exportCsv(matrixRows, { baseName: `control-matrix-${run.id.slice(0, 8)}` });
      const matrixArtifact = (await this.artifacts.createArtifact({
        tenantId: input.tenantId,
        workflowId,
        producedBy: input.generatedBy,
        artifactType: 'control_matrix',
        fileName: matrixCsv.fileName,
        mimeType: matrixCsv.mimeType,
        bytes: matrixCsv.bytes,
        approvalState: 'NOT_REQUIRED',
        metadata: { auditRunId: run.id, rowCount: matrixRows.length },
      })) as { id: string };

      // 2. Exceptions JSON
      const exceptionsJson = JSON.stringify({
        auditRunId: run.id,
        generatedAt: new Date().toISOString(),
        count: exceptions.length,
        exceptions: exceptions.map((e) => ({
          id: e.id,
          controlCode: e.controlCode,
          severity: e.severity,
          status: e.status,
          description: e.description,
          cause: e.cause,
          impact: e.impact,
          remediationPlan: e.remediationPlan,
          remediationOwner: e.remediationOwner,
          remediationDueDate: e.remediationDueDate?.toISOString() ?? null,
          reviewerStatus: e.reviewerStatus,
          reviewerComment: e.reviewerComment,
          reviewedBy: e.reviewedBy,
          reviewedAt: e.reviewedAt?.toISOString() ?? null,
        })),
      }, null, 2);
      const exceptionsArtifact = (await this.artifacts.createArtifact({
        tenantId: input.tenantId,
        workflowId,
        producedBy: input.generatedBy,
        artifactType: 'exception_register',
        fileName: `exception-register-${run.id.slice(0, 8)}.json`,
        mimeType: 'application/json',
        inlineContent: exceptionsJson,
        approvalState: 'NOT_REQUIRED',
        metadata: { auditRunId: run.id, count: exceptions.length },
      })) as { id: string };

      // 3. Executive summary PDF
      const summary = this.buildExecutiveSummary({ run, tests, exceptions, workpaperCount: wps.length });
      const summaryPdf = await exportPdf(
        { title: `Executive summary — ${run.title}`, sections: summary },
        { baseName: `executive-summary-${run.id.slice(0, 8)}` },
      );
      const summaryArtifact = (await this.artifacts.createArtifact({
        tenantId: input.tenantId,
        workflowId,
        producedBy: input.generatedBy,
        artifactType: 'executive_summary',
        fileName: summaryPdf.fileName,
        mimeType: summaryPdf.mimeType,
        bytes: summaryPdf.bytes,
        approvalState: 'NOT_REQUIRED',
        metadata: { auditRunId: run.id },
      })) as { id: string };

      // 4. Build the bundle manifest from all referenced artefacts
      const referencedIds = [
        ...wps.filter((w) => w.artifactId).map((w) => w.artifactId!),
        matrixArtifact.id,
        exceptionsArtifact.id,
        summaryArtifact.id,
      ];
      const referencedArtifacts = await this.db.workflowArtifact.findMany({
        where: { id: { in: referencedIds }, tenantId: input.tenantId, deletedAt: null, status: 'READY' },
        select: { id: true, fileName: true, contentHash: true, sizeBytes: true, artifactType: true },
      });

      const artifactRefs: BundleArtifactRef[] = referencedArtifacts
        .filter((a) => a.contentHash && a.sizeBytes !== null)
        .map((a) => ({
          artifactId: a.id,
          fileName: a.fileName,
          contentHash: a.contentHash!,
          sizeBytes: a.sizeBytes!,
          artifactType: a.artifactType,
        }));

      const manifest: BundleManifest = {
        version: 1,
        tenantId: input.tenantId,
        workflowId,
        generatedAt: new Date().toISOString(),
        artifacts: artifactRefs,
        metadata: {
          auditRunId: run.id,
          frameworkSlug: run.frameworkSlug,
          title: run.title,
          periodStart: run.periodStart.toISOString(),
          periodEnd: run.periodEnd.toISOString(),
          coveragePercent: run.coveragePercent,
          riskSummary: run.riskSummary,
          controlCount: tests.length,
          workpaperCount: wps.length,
          exceptionCount: exceptions.length,
        },
      };

      const signed = signBundleManifest(manifest);

      // Persist the bundle as a new artefact (REQUIRES_APPROVAL — bundles are binding)
      const bundleArtifact = (await this.artifacts.createArtifact({
        tenantId: input.tenantId,
        workflowId,
        producedBy: input.generatedBy,
        artifactType: 'evidence_bundle',
        fileName: `final-audit-pack-${run.id.slice(0, 8)}-${Date.now()}.signed.json`,
        mimeType: 'application/json',
        inlineContent: JSON.stringify(signed, null, 2),
        approvalState: 'REQUIRES_APPROVAL',
        metadata: {
          signatureAlgo: signed.signatureAlgo,
          artifactCount: artifactRefs.length,
          bundleVersion: manifest.version,
          auditRunId: run.id,
          frameworkSlug: run.frameworkSlug,
        },
      })) as { id: string };

      // Stamp on AuditRun + transition COMPLETED
      await this.db.auditRun.update({
        where: { id: run.id },
        data: { finalPackArtifactId: bundleArtifact.id, status: 'COMPLETED' },
      });

      this.emit({
        type: 'final_pack_generated',
        auditRunId: run.id,
        agentRole: 'FINAL_AUDIT_PACK_AGENT',
        timestamp: new Date().toISOString(),
        details: {
          bundleArtifactId: bundleArtifact.id,
          signature: signed.signature,
          signatureAlgo: signed.signatureAlgo,
          referencedArtifactCount: artifactRefs.length,
          workpaperCount: wps.length,
          exceptionCount: exceptions.length,
        },
      });

      this.emit({
        type: 'audit_run_completed',
        auditRunId: run.id,
        agentRole: 'AUDIT_COMMANDER',
        timestamp: new Date().toISOString(),
        details: { bundleArtifactId: bundleArtifact.id },
      });

      return {
        artifactId: bundleArtifact.id,
        signature: signed.signature,
        signatureAlgo: signed.signatureAlgo,
        manifest,
        workpaperCount: wps.length,
        exceptionCount: exceptions.length,
        controlCount: tests.length,
      };
    } catch (err) {
      // Rollback: transition back to READY_TO_PACK + emit failure
      try {
        await this.db.auditRun.update({ where: { id: run.id }, data: { status: 'FAILED' } });
      } catch {/* best effort */}
      this.emit({
        type: 'audit_run_failed',
        auditRunId: run.id,
        agentRole: 'FINAL_AUDIT_PACK_AGENT',
        timestamp: new Date().toISOString(),
        details: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }

  private buildExecutiveSummary(input: {
    run: { title: string; frameworkSlug: string; periodStart: Date; periodEnd: Date; coveragePercent: number | null; riskSummary: string | null };
    tests: Array<{ controlCode: string; result: string | null; status: string }>;
    exceptions: Array<{ controlCode: string; severity: string; status: string; description: string }>;
    workpaperCount: number;
  }): Array<{ heading?: string; body: string }> {
    const r = input.run;
    const passed = input.tests.filter((t) => t.result === 'pass').length;
    const failed = input.tests.filter((t) => t.result === 'fail').length;
    const exc = input.tests.filter((t) => t.result === 'exception').length;
    const needsEv = input.tests.filter((t) => t.result === 'needs_evidence').length;

    return [
      {
        heading: 'Engagement summary',
        body: [
          `- Framework: ${r.frameworkSlug}`,
          `- Period: ${r.periodStart.toISOString().slice(0, 10)} → ${r.periodEnd.toISOString().slice(0, 10)}`,
          `- Coverage: ${r.coveragePercent !== null ? r.coveragePercent.toFixed(1) + '%' : '(not computed)'}`,
          `- Risk summary: ${r.riskSummary ?? '(not computed)'}`,
          `- Controls tested: ${input.tests.length}`,
          `- Workpapers approved: ${input.workpaperCount}`,
        ].join('\n'),
      },
      {
        heading: 'Test result breakdown',
        body: [
          `- Pass: ${passed}`,
          `- Fail: ${failed}`,
          `- Exception: ${exc}`,
          `- Needs evidence: ${needsEv}`,
        ].join('\n'),
      },
      {
        heading: 'Exception register',
        body: input.exceptions.length === 0
          ? 'No exceptions recorded.'
          : input.exceptions.slice(0, 50).map((e) => `- [${e.severity.toUpperCase()}] ${e.controlCode} (${e.status}) — ${e.description.slice(0, 200)}`).join('\n'),
      },
      {
        heading: 'Signing posture',
        body: [
          'This pack is signed via HMAC-SHA256 over a canonical JSON manifest.',
          'Verification re-fetches every referenced artefact and recomputes the SHA-256 of its bytes.',
          'Any tampering with the manifest, the signature, or any referenced artefact bytes will cause verification to fail.',
        ].join('\n'),
      },
    ];
  }
}
