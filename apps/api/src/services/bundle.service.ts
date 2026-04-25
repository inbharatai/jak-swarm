/**
 * bundle.service — produces a signed evidence bundle from a workflow's
 * artifacts. The bundle is itself a WorkflowArtifact with:
 *   - artifactType='evidence_bundle'
 *   - inlineContent = JSON of { manifest, signatureAlgo, signature }
 *   - approvalState='REQUIRES_APPROVAL' (always — bundles are binding)
 *
 * Verification is a separate operation that re-computes the signature
 * AND re-hashes each referenced artifact's bytes.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { ArtifactService, ArtifactSchemaUnavailableError } from './artifact.service.js';
import {
  signBundleManifest,
  verifyBundleWithArtifactBytes,
  isSigningAvailable,
  BundleSigningUnavailableError,
  type BundleManifest,
  type SignedBundle,
  type VerifyResult,
  type BundleArtifactRef,
} from './bundle-signing.service.js';

export class BundleService {
  private readonly artifacts: ArtifactService;

  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {
    this.artifacts = new ArtifactService(db, log);
  }

  /**
   * Create a signed evidence bundle for a workflow. Collects all READY
   * artifacts that are NOT themselves bundles, builds a manifest, signs
   * with the tenant-derived key, and persists the result as a new
   * WorkflowArtifact.
   *
   * Returns the new bundle artifact's id + the signature so the caller
   * can render it without an extra DB read.
   *
   * Throws:
   *   - BundleSigningUnavailableError if EVIDENCE_SIGNING_SECRET not set
   *   - ArtifactSchemaUnavailableError if migration not deployed
   */
  async createSignedBundle(input: {
    workflowId: string;
    tenantId: string;
    requestedBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ artifactId: string; manifest: BundleManifest; signature: string; signatureAlgo: string }> {
    const sigStatus = isSigningAvailable();
    if (!sigStatus.ready) {
      throw new BundleSigningUnavailableError();
    }

    // Validate the workflow belongs to the tenant
    const workflow = await (this.db.workflow.findFirst as unknown as (a: unknown) => Promise<{ id: string; goal: string } | null>)({
      where: { id: input.workflowId, tenantId: input.tenantId },
      select: { id: true, goal: true },
    });
    if (!workflow) throw new Error(`Workflow ${input.workflowId} not found in tenant ${input.tenantId}`);

    // Collect every READY artifact for this workflow EXCEPT prior bundles
    // (don't sign over yourself / chain bundles).
    let rows: Array<{
      id: string;
      fileName: string;
      contentHash: string | null;
      sizeBytes: number | null;
      artifactType: string;
    }>;
    try {
      rows = await (this.db.workflowArtifact.findMany as unknown as (a: unknown) => Promise<Array<{
        id: string; fileName: string; contentHash: string | null; sizeBytes: number | null; artifactType: string;
      }>>)({
        where: {
          workflowId: input.workflowId,
          tenantId: input.tenantId,
          deletedAt: null,
          status: 'READY',
          NOT: { artifactType: 'evidence_bundle' },
        },
        select: { id: true, fileName: true, contentHash: true, sizeBytes: true, artifactType: true },
        orderBy: { createdAt: 'asc' },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'P2021' || /does not exist/i.test(err instanceof Error ? err.message : String(err))) {
        throw new ArtifactSchemaUnavailableError();
      }
      throw err;
    }

    const artifactRefs: BundleArtifactRef[] = rows
      .filter((r) => r.contentHash && r.sizeBytes !== null)
      .map((r) => ({
        artifactId: r.id,
        fileName: r.fileName,
        contentHash: r.contentHash!,
        sizeBytes: r.sizeBytes!,
        artifactType: r.artifactType,
      }));

    const manifest: BundleManifest = {
      version: 1,
      tenantId: input.tenantId,
      workflowId: input.workflowId,
      generatedAt: new Date().toISOString(),
      artifacts: artifactRefs,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };

    const signed = signBundleManifest(manifest);

    // Persist the bundle as a new artifact. Approval state is forced to
    // REQUIRES_APPROVAL because a signed bundle is a binding artefact.
    const created = await this.artifacts.createArtifact({
      tenantId: input.tenantId,
      workflowId: input.workflowId,
      producedBy: input.requestedBy,
      artifactType: 'evidence_bundle',
      fileName: `evidence-bundle-${input.workflowId.slice(0, 8)}-${Date.now()}.signed.json`,
      mimeType: 'application/json',
      inlineContent: JSON.stringify(signed, null, 2),
      approvalState: 'REQUIRES_APPROVAL',
      metadata: {
        signatureAlgo: signed.signatureAlgo,
        artifactCount: artifactRefs.length,
        bundleVersion: manifest.version,
      },
    }) as { id: string };

    return {
      artifactId: created.id,
      manifest,
      signature: signed.signature,
      signatureAlgo: signed.signatureAlgo,
    };
  }

  /**
   * Verify a signed bundle. Re-fetches the bundle JSON, then re-hashes
   * every referenced artifact's bytes and compares against the manifest.
   *
   * Returns VerifyResult — `{ valid: true }` or `{ valid: false, reason }`.
   * Never throws on tamper detection; ONLY throws on infra failures.
   */
  async verifyBundle(input: {
    bundleArtifactId: string;
    tenantId: string;
  }): Promise<VerifyResult> {
    const bundleRow = (await this.artifacts.getArtifact(input.bundleArtifactId, input.tenantId)) as {
      inlineContent: string | null;
      artifactType: string;
    };
    if (bundleRow.artifactType !== 'evidence_bundle') {
      return { valid: false, reason: 'malformed_bundle', message: 'artifact is not an evidence_bundle' };
    }
    if (!bundleRow.inlineContent) {
      return { valid: false, reason: 'malformed_bundle', message: 'bundle has no inline content' };
    }
    let signed: SignedBundle;
    try {
      signed = JSON.parse(bundleRow.inlineContent) as SignedBundle;
    } catch (err) {
      return { valid: false, reason: 'malformed_bundle', message: `bundle JSON parse failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    // Verify both signature AND artifact bytes
    return verifyBundleWithArtifactBytes(signed, async (artifactId) => {
      try {
        const dl = await this.artifacts.requestSignedDownloadUrl({
          artifactId,
          tenantId: input.tenantId,
          requestedBy: 'bundle-verifier',
          expiresInSeconds: 60,
        });
        if (dl.kind === 'inline') {
          return Buffer.from(dl.content, 'utf8');
        }
        // For storage-backed artifacts, fetch the bytes directly via
        // the signed URL. (Could optimise by reading from storage with
        // service-role client; for now keep it consistent with download path.)
        const res = await fetch(dl.url);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
      } catch (err) {
        // ArtifactGatedError — the bundle's referenced artifact was
        // rejected/deleted after signing. That's a tamper signal.
        this.log.warn(
          { artifactId, err: err instanceof Error ? err.message : String(err) },
          '[bundle] artifact unavailable during verification',
        );
        return null;
      }
    });
  }
}

// Re-export so route layer can do isinstanceof checks
export { BundleSigningUnavailableError } from './bundle-signing.service.js';
