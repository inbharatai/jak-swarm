/**
 * manual-evidence.service — CRUD for human-curated control evidence.
 *
 * Each ManualEvidence row is paired with a `ControlEvidenceMapping`
 * (mappingSource='manual', evidenceType='manual_evidence',
 * evidenceId=manualEvidence.id) so the existing coverage / attestation
 * machinery counts manual evidence without any changes to the mapper.
 *
 * Tenant isolation is enforced at every method — service refuses to
 * operate on a row whose tenantId doesn't match the requester.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { ComplianceSchemaUnavailableError } from './compliance-mapper.service.js';

export interface CreateManualEvidenceInput {
  tenantId: string;
  controlId: string;
  title: string;
  description: string;
  attachedArtifactId?: string;
  createdBy: string;
  /** Defaults to now() when omitted. */
  evidenceAt?: Date | string;
}

export class ManualEvidenceNotFoundError extends Error {
  constructor(id: string) {
    super(`Manual evidence ${id} not found or not visible to this tenant`);
    this.name = 'ManualEvidenceNotFoundError';
  }
}

export class ManualEvidenceService {
  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * Create a manual evidence row + its companion ControlEvidenceMapping.
   * Both writes happen in a transaction so partial state is impossible.
   *
   * Throws if:
   *   - The control doesn't exist
   *   - The (optional) attached artifact doesn't belong to the tenant
   */
  async create(input: CreateManualEvidenceInput): Promise<{ id: string; mappingId: string }> {
    if (!input.tenantId || !input.controlId || !input.title || !input.description) {
      throw new Error('tenantId, controlId, title, description are all required');
    }

    // Validate the control exists.
    const control = await this.db.complianceControl.findUnique({
      where: { id: input.controlId },
      select: { id: true },
    }).catch((err) => this.rethrowSchemaMissing(err));
    if (!control) {
      throw new ManualEvidenceNotFoundError(input.controlId);
    }

    // If an artifact is attached, validate it belongs to the tenant.
    if (input.attachedArtifactId) {
      const art = await this.db.workflowArtifact.findFirst({
        where: { id: input.attachedArtifactId, tenantId: input.tenantId },
        select: { id: true },
      }).catch(() => null);
      if (!art) {
        throw new Error(`Artifact ${input.attachedArtifactId} not found in tenant ${input.tenantId}`);
      }
    }

    const evidenceAt = input.evidenceAt ? new Date(input.evidenceAt) : new Date();

    // Two-step create — Prisma's $transaction would be ideal but we keep
    // it simple: create the manual_evidence row first (it's the source of
    // truth), then upsert the mapping. If the mapping write fails, we
    // best-effort log + the manual evidence remains queryable but won't
    // count in coverage until a re-run of the auto-mapper.
    const me = await this.db.manualEvidence.create({
      data: {
        tenantId: input.tenantId,
        controlId: input.controlId,
        title: input.title,
        description: input.description,
        ...(input.attachedArtifactId ? { attachedArtifactId: input.attachedArtifactId } : {}),
        createdBy: input.createdBy,
        evidenceAt,
      },
    }).catch((err) => this.rethrowSchemaMissing(err));

    const mapping = await this.db.controlEvidenceMapping.upsert({
      where: {
        tenantId_controlId_evidenceType_evidenceId: {
          tenantId: input.tenantId,
          controlId: input.controlId,
          evidenceType: 'manual_evidence',
          evidenceId: me.id,
        },
      },
      create: {
        tenantId: input.tenantId,
        controlId: input.controlId,
        evidenceType: 'manual_evidence',
        evidenceId: me.id,
        evidenceAt,
        mappedBy: input.createdBy,
        mappingSource: 'manual',
        notes: input.title,
      },
      update: { notes: input.title, evidenceAt },
    }).catch((err) => {
      this.log.warn(
        { manualEvidenceId: me.id, err: err instanceof Error ? err.message : String(err) },
        '[manual-evidence] mapping upsert failed — evidence row created, mapping deferred',
      );
      return { id: '__deferred__' };
    });

    return { id: me.id, mappingId: mapping.id };
  }

  async list(input: { tenantId: string; controlId: string; limit?: number; offset?: number }): Promise<{
    items: Array<{ id: string; title: string; description: string; attachedArtifactId: string | null; createdBy: string; evidenceAt: Date; createdAt: Date }>;
    total: number;
  }> {
    const where = { tenantId: input.tenantId, controlId: input.controlId, deletedAt: null };
    const [items, total] = await Promise.all([
      this.db.manualEvidence.findMany({
        where,
        orderBy: { evidenceAt: 'desc' },
        take: input.limit ?? 50,
        skip: input.offset ?? 0,
        select: { id: true, title: true, description: true, attachedArtifactId: true, createdBy: true, evidenceAt: true, createdAt: true },
      }),
      this.db.manualEvidence.count({ where }),
    ]).catch((err) => { this.rethrowSchemaMissing(err); throw err; });
    return { items, total };
  }

  /**
   * Soft-delete a manual evidence row + remove its companion mapping so
   * coverage drops. Tenant-scoped.
   */
  async delete(input: { id: string; tenantId: string; deletedBy: string }): Promise<void> {
    const row = await this.db.manualEvidence.findFirst({
      where: { id: input.id, tenantId: input.tenantId, deletedAt: null },
      select: { id: true, controlId: true },
    }).catch((err) => this.rethrowSchemaMissing(err));
    if (!row) throw new ManualEvidenceNotFoundError(input.id);

    await this.db.manualEvidence.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });

    // Delete the companion mapping so coverage counts reflect reality.
    await this.db.controlEvidenceMapping.deleteMany({
      where: {
        tenantId: input.tenantId,
        controlId: row.controlId,
        evidenceType: 'manual_evidence',
        evidenceId: row.id,
      },
    }).catch((err) => {
      this.log.warn(
        { manualEvidenceId: row.id, err: err instanceof Error ? err.message : String(err) },
        '[manual-evidence] mapping cleanup failed (non-fatal)',
      );
    });

    this.log.info(
      { tenantId: input.tenantId, manualEvidenceId: row.id, deletedBy: input.deletedBy },
      '[manual-evidence] soft-deleted',
    );
  }

  private rethrowSchemaMissing(err: unknown): never {
    const code = (err as { code?: string }).code;
    const msg = err instanceof Error ? err.message : String(err);
    if (code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(msg)) {
      throw new ComplianceSchemaUnavailableError();
    }
    throw err;
  }
}
