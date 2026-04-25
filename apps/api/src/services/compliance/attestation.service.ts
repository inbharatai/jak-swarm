/**
 * attestation.service — produces a SOC 2 (or other framework) period
 * attestation as a real PDF artifact, optionally HMAC-signed.
 *
 * Pipeline:
 *   1. Snapshot all evidence mappings for the (tenant, framework, period).
 *   2. Compute per-control summary (count + sample evidence ids).
 *   3. Render a PDF report via the existing exporter.
 *   4. Persist as a WorkflowArtifact (artifactType='control_attestation').
 *      approvalState='REQUIRES_APPROVAL' — attestations are binding;
 *      a reviewer must approve before download.
 *   5. Persist a ControlAttestation summary row pointing at the artifact.
 *   6. Optionally sign as a tamper-evident bundle if `sign=true` AND
 *      `EVIDENCE_SIGNING_SECRET` is set.
 *
 * Honesty:
 *   - Coverage % is computed from real mapping rows, not hand-waved.
 *   - Each control row in the PDF includes its evidence count + the FIRST
 *     5 evidence ids for spot-checking. NO claim of evidence we don't have.
 *   - A control with 0 evidence is shown explicitly as "0 — uncovered" so
 *     the auditor sees the gap, not a hidden absence.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { ComplianceMapperService, ComplianceSchemaUnavailableError } from './compliance-mapper.service.js';
import { ArtifactService } from '../artifact.service.js';
import { exportPdf } from '../exporters/index.js';
import { BundleService } from '../bundle.service.js';
import { isSigningAvailable, BundleSigningUnavailableError } from '../bundle-signing.service.js';

export interface AttestationRequest {
  tenantId: string;
  frameworkSlug: string;
  /** ISO date or Date — beginning of attestation period. */
  periodStart: Date | string;
  /** ISO date or Date — end of attestation period. */
  periodEnd: Date | string;
  /** Who triggered generation. Recorded on the artifact + audit row. */
  generatedBy: string;
  /** When true, also create a signed evidence bundle alongside. */
  sign?: boolean;
  /** Optional metadata (e.g. control framework variant, customer name). */
  metadata?: Record<string, unknown>;
}

export interface AttestationResult {
  attestationId: string;
  artifactId: string;
  bundleArtifactId?: string;
  bundleSignature?: string;
  framework: { slug: string; name: string; version: string };
  periodStart: string;
  periodEnd: string;
  totalEvidence: number;
  coveragePercent: number;
  controlSummary: Array<{ controlCode: string; title: string; evidenceCount: number }>;
  fileName: string;
}

export class AttestationService {
  private readonly mapper: ComplianceMapperService;
  private readonly artifacts: ArtifactService;
  private readonly bundles: BundleService;

  constructor(
    private readonly db: PrismaClient,
    log: FastifyBaseLogger,
  ) {
    this.mapper = new ComplianceMapperService(db, log);
    this.artifacts = new ArtifactService(db, log);
    this.bundles = new BundleService(db, log);
  }

  /**
   * Generate a period attestation. Returns the new artifact + summary.
   *
   * Throws ComplianceSchemaUnavailableError, ArtifactSchemaUnavailableError,
   * or BundleSigningUnavailableError (only when `sign=true`).
   */
  async generate(req: AttestationRequest): Promise<AttestationResult> {
    const periodStart = new Date(req.periodStart);
    const periodEnd = new Date(req.periodEnd);
    if (periodEnd <= periodStart) {
      throw new Error('periodEnd must be strictly after periodStart');
    }

    // Pull the framework + per-control evidence count for the period.
    const summary = await this.mapper.getFrameworkSummary({
      tenantId: req.tenantId,
      frameworkSlug: req.frameworkSlug,
      periodStart,
      periodEnd,
    });

    // For each control, pull the first 5 evidence ids for the PDF table.
    // Doing this serially for ≤50 controls is fine; switch to a single
    // groupBy + per-control window if we ever ship 500-control frameworks.
    const samplesByControl = new Map<string, string[]>();
    for (const c of summary.controls) {
      if (c.evidenceCount === 0) {
        samplesByControl.set(c.id, []);
        continue;
      }
      const ev = await this.mapper.getControlEvidence({
        tenantId: req.tenantId,
        controlId: c.id,
        periodStart,
        periodEnd,
        limit: 5,
      });
      samplesByControl.set(c.id, ev.items.map((m) => `${m.evidenceType}:${m.evidenceId}`));
    }

    const totalEvidence = summary.controls.reduce((s, c) => s + c.evidenceCount, 0);

    // ── Build the PDF document ─────────────────────────────────────────
    const sections: Array<{ heading?: string; body: string }> = [];
    sections.push({
      heading: 'Attestation summary',
      body: [
        `Framework: ${summary.framework.name} (${summary.framework.version})`,
        `Issuer: ${summary.framework.issuer}`,
        `Tenant: ${req.tenantId}`,
        `Period: ${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}`,
        `Generated by: ${req.generatedBy}`,
        `Generated at: ${new Date().toISOString()}`,
        '',
        `Total controls: ${summary.coverageCounts.total}`,
        `Controls with evidence in period: ${summary.coverageCounts.covered}`,
        `Controls without evidence: ${summary.coverageCounts.uncovered}`,
        `Coverage: ${summary.coverageCounts.coveragePercent}%`,
        `Total evidence rows: ${totalEvidence.toLocaleString()}`,
      ].join('\n'),
    });

    // Group controls by category for readability.
    const byCategory = new Map<string, typeof summary.controls>();
    for (const c of summary.controls) {
      const list = byCategory.get(c.category) ?? [];
      list.push(c);
      byCategory.set(c.category, list);
    }

    for (const [category, controls] of byCategory) {
      sections.push({
        heading: category,
        body: controls.map((c) => {
          const samples = samplesByControl.get(c.id) ?? [];
          const head = `${c.code} — ${c.title}`;
          const cov = c.evidenceCount > 0 ? `${c.evidenceCount} evidence row(s)` : '0 — UNCOVERED';
          const sampleLine = samples.length > 0 ? `  samples: ${samples.slice(0, 5).join(', ')}` : '';
          return [`- ${head}`, `  ${cov}`, sampleLine].filter(Boolean).join('\n');
        }).join('\n\n'),
      });
    }

    sections.push({
      heading: 'How to read this attestation',
      body: [
        'This is a machine-generated period attestation produced by JAK Swarm. Each control listing shows the count of evidence rows mapped during the attestation period. Sample evidence ids are provided for spot-checking by an auditor.',
        '',
        'Mappings are produced by the auto-mapping engine (see docs/compliance-frameworks.md) which applies declarative rules to the audit log, workflow records, approval decisions, and artifact rows. Controls labeled "UNCOVERED" had no audit-log activity that the engine could match — they require either manual evidence curation or an organisational policy attestation.',
        '',
        'A signed companion bundle (if requested) is verifiable via POST /artifacts/:id/verify. Verification recomputes the HMAC signature AND re-hashes every referenced artifact byte. See docs/tamper-evident-bundles.md.',
      ].join('\n\n'),
    });

    const baseName = `${req.frameworkSlug}-attestation-${periodStart.toISOString().slice(0, 10)}-to-${periodEnd.toISOString().slice(0, 10)}`;
    const pdf = await exportPdf(
      { title: `${summary.framework.name} — Period Attestation`, sections },
      { baseName },
    );

    // ── Persist as a WorkflowArtifact ──────────────────────────────────
    // Attestations aren't tied to a single workflow — use a synthetic
    // "compliance" pseudo-workflow id. We need an actual workflow row
    // to satisfy the FK; create a placeholder workflow row tagged
    // appropriately on first run for this tenant.
    const placeholder = await this.ensureCompliancePlaceholderWorkflow(req.tenantId, req.generatedBy);

    const artifact = await this.artifacts.createArtifact({
      tenantId: req.tenantId,
      workflowId: placeholder.id,
      producedBy: req.generatedBy,
      artifactType: 'control_attestation',
      fileName: pdf.fileName,
      mimeType: pdf.mimeType,
      bytes: pdf.bytes,
      approvalState: 'REQUIRES_APPROVAL',
      metadata: {
        frameworkSlug: req.frameworkSlug,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        coveragePercent: summary.coverageCounts.coveragePercent,
        totalEvidence,
        ...(req.metadata ?? {}),
      },
    }) as { id: string };

    // ── Persist the ControlAttestation summary row ─────────────────────
    const controlSummaryJson = summary.controls.map((c) => ({
      controlId: c.id,
      controlCode: c.code,
      title: c.title,
      evidenceCount: c.evidenceCount,
    }));
    const attestation = await this.db.controlAttestation.create({
      data: {
        tenantId: req.tenantId,
        frameworkId: summary.framework.id,
        periodStart,
        periodEnd,
        controlSummary: controlSummaryJson,
        totalEvidence,
        coveragePercent: summary.coverageCounts.coveragePercent,
        artifactId: artifact.id,
        generatedBy: req.generatedBy,
      },
    }).catch((err) => {
      const code = (err as { code?: string }).code;
      if (code === 'P2021' || /does not exist/i.test(err instanceof Error ? err.message : String(err))) {
        throw new ComplianceSchemaUnavailableError();
      }
      throw err;
    });

    // ── Optionally produce a signed bundle ─────────────────────────────
    let bundleArtifactId: string | undefined;
    let bundleSignature: string | undefined;
    if (req.sign) {
      const sigStatus = isSigningAvailable();
      if (!sigStatus.ready) {
        throw new BundleSigningUnavailableError();
      }
      const bundle = await this.bundles.createSignedBundle({
        workflowId: placeholder.id,
        tenantId: req.tenantId,
        requestedBy: req.generatedBy,
        metadata: {
          attestationId: attestation.id,
          frameworkSlug: req.frameworkSlug,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
        },
      });
      bundleArtifactId = bundle.artifactId;
      bundleSignature = bundle.signature;
    }

    return {
      attestationId: attestation.id,
      artifactId: artifact.id,
      ...(bundleArtifactId ? { bundleArtifactId } : {}),
      ...(bundleSignature ? { bundleSignature } : {}),
      framework: { slug: summary.framework.slug, name: summary.framework.name, version: summary.framework.version },
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      totalEvidence,
      coveragePercent: summary.coverageCounts.coveragePercent,
      controlSummary: summary.controls.map((c) => ({ controlCode: c.code, title: c.title, evidenceCount: c.evidenceCount })),
      fileName: pdf.fileName,
    };
  }

  /**
   * List previous attestations for a tenant + framework. Used by the
   * Compliance UI tab.
   */
  async list(input: { tenantId: string; frameworkSlug?: string; limit?: number; offset?: number }): Promise<{
    items: Array<{
      id: string;
      frameworkSlug: string;
      frameworkName: string;
      periodStart: Date;
      periodEnd: Date;
      totalEvidence: number;
      coveragePercent: number;
      artifactId: string | null;
      generatedBy: string;
      createdAt: Date;
    }>;
    total: number;
  }> {
    const where: Record<string, unknown> = { tenantId: input.tenantId };
    if (input.frameworkSlug) {
      const fw = await this.db.complianceFramework.findUnique({ where: { slug: input.frameworkSlug } });
      if (fw) where['frameworkId'] = fw.id;
    }
    const [rowsRaw, total] = await Promise.all([
      this.db.controlAttestation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: input.limit ?? 50,
        skip: input.offset ?? 0,
      }),
      this.db.controlAttestation.count({ where }),
    ]).catch((err) => {
      const code = (err as { code?: string }).code;
      if (code === 'P2021' || /does not exist/i.test(err instanceof Error ? err.message : String(err))) {
        throw new ComplianceSchemaUnavailableError();
      }
      throw err;
    });

    // Resolve framework names in one batch lookup
    const frameworkIds = Array.from(new Set(rowsRaw.map((r) => r.frameworkId)));
    const fws = await this.db.complianceFramework.findMany({
      where: { id: { in: frameworkIds } },
      select: { id: true, slug: true, name: true },
    });
    const fwById = new Map(fws.map((f) => [f.id, f]));

    return {
      items: rowsRaw.map((r) => ({
        id: r.id,
        frameworkSlug: fwById.get(r.frameworkId)?.slug ?? '',
        frameworkName: fwById.get(r.frameworkId)?.name ?? '',
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        totalEvidence: r.totalEvidence,
        coveragePercent: r.coveragePercent,
        artifactId: r.artifactId,
        generatedBy: r.generatedBy,
        createdAt: r.createdAt,
      })),
      total,
    };
  }

  // ─── Internal ───────────────────────────────────────────────────────

  /**
   * Attestations + signed bundles need a Workflow row to attach to (FK
   * constraint on WorkflowArtifact.workflowId). For attestations, we
   * use a single per-tenant placeholder workflow tagged "Compliance
   * pseudo-workflow" so they group cleanly in the Workflows UI.
   *
   * Idempotent: looks up the placeholder by goal+industry; creates if missing.
   */
  private async ensureCompliancePlaceholderWorkflow(tenantId: string, userId: string): Promise<{ id: string }> {
    const existing = await this.db.workflow.findFirst({
      where: { tenantId, goal: '__compliance_attestations__' },
      select: { id: true },
    });
    if (existing) return existing;

    return this.db.workflow.create({
      data: {
        tenantId,
        userId,
        goal: '__compliance_attestations__',
        industry: 'COMPLIANCE',
        status: 'COMPLETED',
        finalOutput: 'Synthetic workflow row for grouping compliance attestation artifacts.',
        startedAt: new Date(),
        completedAt: new Date(),
      },
      select: { id: true },
    });
  }
}

// Re-exports for the route layer
export { ComplianceSchemaUnavailableError } from './compliance-mapper.service.js';
export { ArtifactSchemaUnavailableError } from '../artifact.service.js';
export { BundleSigningUnavailableError } from '../bundle-signing.service.js';
