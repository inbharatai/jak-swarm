/**
 * artifact.service — production foundation for the Audit & Compliance
 * product's evidence + export surface.
 *
 * A WorkflowArtifact is a customer-deliverable file produced by a workflow
 * run. Distinct from:
 *   - AgentTrace (per-step internal record — diagnostic only)
 *   - TenantDocument (user-uploaded INPUT)
 *
 * This service handles:
 *   - row creation (PENDING)
 *   - inline content materialisation (small text/JSON ≤256KB)
 *   - storage upload for binary artefacts (separate bucket from documents)
 *   - approval-gated download (compliance enforcement)
 *   - signed-URL issuance with audit trail
 *   - soft-delete + retention sweep
 *
 * Tenant isolation is enforced at the service boundary (every public method
 * takes tenantId and validates the artifact row matches before touching it).
 *
 * Approval gate semantics:
 *   - artifact.approvalState === 'REQUIRES_APPROVAL' → download blocked,
 *     requestSignedDownloadUrl throws ArtifactGatedError.
 *   - artifact.approvalState === 'APPROVED' → download allowed.
 *   - artifact.approvalState === 'REJECTED' → download permanently blocked,
 *     also throws ArtifactGatedError with a different reason code.
 *   - artifact.approvalState === 'NOT_REQUIRED' → download allowed without gate.
 */

import { createHash } from 'node:crypto';
import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { AuditLogger, AuditAction } from '@jak-swarm/security';
import type { AuditPrismaClient } from '@jak-swarm/security';

const ARTIFACT_BUCKET = 'tenant-artifacts';
const MAX_INLINE_BYTES = 256 * 1024; // 256 KB — text/JSON cutoff
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024; // 100 MB — generous, can tighten

export type ArtifactType =
  | 'final_output'
  | 'export'
  | 'evidence_bundle'
  | 'attachment'
  | 'redacted_export'
  | string; // open vocabulary, validated at the route layer per-tenant

export type ArtifactStatus = 'PENDING' | 'READY' | 'FAILED' | 'DELETED';
export type ApprovalState =
  | 'NOT_REQUIRED'
  | 'REQUIRES_APPROVAL'
  | 'APPROVED'
  | 'REJECTED';

export interface CreateArtifactInput {
  tenantId: string;
  workflowId: string;
  taskId?: string;
  producedBy: string;
  artifactType: ArtifactType;
  fileName: string;
  mimeType: string;
  /** Inline content for small artefacts (≤256KB). Mutually exclusive with bytes. */
  inlineContent?: string;
  /** Binary bytes for storage upload (≤100MB). Mutually exclusive with inlineContent. */
  bytes?: Uint8Array;
  /** Compliance gate. Defaults to NOT_REQUIRED for non-sensitive artefacts. */
  approvalState?: ApprovalState;
  parentArtifactId?: string;
  metadata?: Record<string, unknown>;
}

export class ArtifactGatedError extends Error {
  readonly reason: 'requires_approval' | 'rejected' | 'deleted';
  constructor(reason: ArtifactGatedError['reason'], message: string) {
    super(message);
    this.name = 'ArtifactGatedError';
    this.reason = reason;
  }
}

export class ArtifactNotFoundError extends Error {
  constructor(artifactId: string) {
    super(`Artifact ${artifactId} not found or not visible to this tenant`);
    this.name = 'ArtifactNotFoundError';
  }
}

/**
 * Thrown when the workflow_artifacts table doesn't exist in the DB —
 * usually means migration `10_workflow_artifacts` hasn't been deployed.
 * Routes catch this and return 503 SERVICE_UNAVAILABLE with a clear
 * "run pnpm db:migrate:deploy" hint instead of a generic 500.
 */
export class ArtifactSchemaUnavailableError extends Error {
  constructor() {
    super(
      '[artifact] The workflow_artifacts table does not exist in this database. ' +
      'Apply migration 10_workflow_artifacts via `pnpm db:migrate:deploy`.',
    );
    this.name = 'ArtifactSchemaUnavailableError';
  }
}

/**
 * Detect Prisma's "table doesn't exist" error (P2021) and translate it.
 * Anything else re-throws unchanged.
 */
function rethrowIfSchemaMissing(err: unknown): never {
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'P2021' || /table .* does not exist|relation .* does not exist/i.test(msg)) {
    throw new ArtifactSchemaUnavailableError();
  }
  throw err;
}

let cachedClient: SupabaseClient | null = null;
let bucketEnsured = false;

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error(
      'Artifact service requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. ' +
        'Check apps/api env config.',
    );
  }
  cachedClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

async function ensureBucket(log: FastifyBaseLogger): Promise<void> {
  if (bucketEnsured) return;
  const client = getClient();
  const { data, error } = await client.storage.listBuckets();
  if (error) {
    log.warn({ err: error.message }, '[artifact] listBuckets failed — assuming bucket exists');
    bucketEnsured = true;
    return;
  }
  const exists = data?.some((b) => b.name === ARTIFACT_BUCKET);
  if (!exists) {
    const { error: createErr } = await client.storage.createBucket(ARTIFACT_BUCKET, {
      public: false,
      fileSizeLimit: MAX_ARTIFACT_BYTES,
    });
    if (createErr && !String(createErr.message).toLowerCase().includes('already exists')) {
      throw new Error(`[artifact] Failed to create bucket '${ARTIFACT_BUCKET}': ${createErr.message}`);
    }
    log.info({ bucket: ARTIFACT_BUCKET }, '[artifact] bucket created');
  }
  bucketEnsured = true;
}

export class ArtifactService {
  private readonly audit: AuditLogger;

  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {
    this.audit = new AuditLogger(db as unknown as AuditPrismaClient);
  }

  /**
   * Create a new artifact. Materialises bytes either inline or in storage
   * based on input shape. Returns the persisted Prisma row.
   *
   * Validates:
   *   - workflow belongs to the tenant
   *   - file size ≤ 100MB (storage) or ≤ 256KB (inline)
   *   - exactly one of inlineContent / bytes provided
   */
  async createArtifact(input: CreateArtifactInput): Promise<unknown> {
    const provided = [input.inlineContent !== undefined, input.bytes !== undefined].filter(Boolean).length;
    if (provided !== 1) {
      throw new Error('createArtifact requires exactly one of inlineContent or bytes');
    }

    // Validate workflow belongs to tenant — prevents cross-tenant artifact creation
    const workflow = await (this.db.workflow.findFirst as unknown as (args: unknown) => Promise<{ id: string } | null>)({
      where: { id: input.workflowId, tenantId: input.tenantId },
      select: { id: true },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (!workflow) {
      throw new Error(`Workflow ${input.workflowId} not found in tenant ${input.tenantId}`);
    }

    let inlineContent: string | null = null;
    let storageKey: string | null = null;
    let sizeBytes: number;
    let contentHash: string;

    if (input.inlineContent !== undefined) {
      if (Buffer.byteLength(input.inlineContent, 'utf8') > MAX_INLINE_BYTES) {
        throw new Error(
          `Inline content exceeds ${MAX_INLINE_BYTES} byte limit; use bytes for binary upload`,
        );
      }
      inlineContent = input.inlineContent;
      sizeBytes = Buffer.byteLength(input.inlineContent, 'utf8');
      contentHash = createHash('sha256').update(input.inlineContent).digest('hex');
    } else {
      const bytes = input.bytes!;
      if (bytes.length > MAX_ARTIFACT_BYTES) {
        throw new Error(`Artifact exceeds ${MAX_ARTIFACT_BYTES} byte limit (${bytes.length} bytes)`);
      }
      sizeBytes = bytes.length;
      contentHash = createHash('sha256').update(bytes).digest('hex');
      // Storage layout: <tenantId>/<workflowId>/<contentHash>.<ext>
      // Using contentHash means identical artefacts dedupe at the storage layer.
      const ext = (input.fileName.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      storageKey = `${input.tenantId}/${input.workflowId}/${contentHash}.${ext}`;
      await ensureBucket(this.log);
      const { error } = await getClient()
        .storage.from(ARTIFACT_BUCKET)
        .upload(storageKey, bytes, {
          contentType: input.mimeType,
          cacheControl: 'private, max-age=3600',
          upsert: true, // hash-keyed, so upsert is safe
        });
      if (error && !String(error.message).toLowerCase().includes('already exists')) {
        throw new Error(`[artifact] Storage upload failed: ${error.message}`);
      }
    }

    const row = await (this.db.workflowArtifact.create as unknown as (args: unknown) => Promise<unknown>)({
      data: {
        tenantId: input.tenantId,
        workflowId: input.workflowId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        producedBy: input.producedBy,
        artifactType: input.artifactType,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes,
        contentHash,
        inlineContent,
        storageKey,
        status: 'READY' as ArtifactStatus,
        approvalState: (input.approvalState ?? 'NOT_REQUIRED') as ApprovalState,
        ...(input.parentArtifactId ? { parentId: input.parentArtifactId } : {}),
        ...(input.metadata ? { metadata: input.metadata as object } : {}),
      },
    }).catch((err) => rethrowIfSchemaMissing(err));

    // Audit row — always log artefact creation for the compliance trail.
    void this.audit
      .log({
        action: AuditAction.WORKFLOW_COMPLETED, // Reusing existing enum; a dedicated ARTIFACT_CREATED would be cleaner
        tenantId: input.tenantId,
        userId: input.producedBy,
        resource: 'workflow_artifact',
        resourceId: (row as { id: string }).id,
        details: {
          workflowId: input.workflowId,
          artifactType: input.artifactType,
          fileName: input.fileName,
          sizeBytes,
          contentHash,
          approvalState: input.approvalState ?? 'NOT_REQUIRED',
        },
      })
      .catch(() => {
        /* never block artefact creation on audit log failure */
      });

    return row;
  }

  /**
   * Look up an artifact, scoped to tenant. Throws ArtifactNotFoundError if
   * the row doesn't exist or doesn't belong to the tenant.
   */
  async getArtifact(artifactId: string, tenantId: string): Promise<unknown> {
    const row = await (this.db.workflowArtifact.findFirst as unknown as (args: unknown) => Promise<unknown>)({
      where: { id: artifactId, tenantId, deletedAt: null },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (!row) throw new ArtifactNotFoundError(artifactId);
    return row;
  }

  /**
   * List artefacts for a workflow. Tenant-scoped — returns [] if the workflow
   * doesn't belong to the tenant or has no artefacts.
   */
  async listArtifactsForWorkflow(workflowId: string, tenantId: string): Promise<unknown[]> {
    return (this.db.workflowArtifact.findMany as unknown as (args: unknown) => Promise<unknown[]>)({
      where: { workflowId, tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    }).catch((err) => rethrowIfSchemaMissing(err));
  }

  /**
   * Diagnostic: probes whether the workflow_artifacts table exists in the
   * database. Used by /admin/diagnostics/artifacts to surface migration
   * status without trying to do a real CRUD op. Returns null if the
   * schema is unavailable so the caller can render "migration not applied"
   * cleanly.
   */
  async healthCheck(): Promise<{ schemaPresent: boolean; rowCount: number | null; bucketReachable: boolean | null }> {
    let schemaPresent = false;
    let rowCount: number | null = null;
    try {
      rowCount = await (this.db.workflowArtifact.count as unknown as (args: unknown) => Promise<number>)({});
      schemaPresent = true;
    } catch (err) {
      const code = (err as { code?: string }).code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 'P2021' || /does not exist/i.test(msg)) {
        schemaPresent = false;
      } else {
        // Some other error — still probably means schema is broken; report null
        schemaPresent = false;
      }
    }

    let bucketReachable: boolean | null = null;
    try {
      await ensureBucket(this.log);
      bucketReachable = true;
    } catch {
      bucketReachable = false;
    }

    return { schemaPresent, rowCount, bucketReachable };
  }

  /**
   * Generate a download URL — signed for storage objects, inline-base64
   * for inline content. Enforces the approval gate FIRST: throws
   * ArtifactGatedError if the artifact requires approval and isn't approved.
   *
   * Records the download in lastDownloadedBy / lastDownloadedAt + an audit row.
   */
  async requestSignedDownloadUrl(input: {
    artifactId: string;
    tenantId: string;
    requestedBy: string;
    expiresInSeconds?: number;
  }): Promise<{ kind: 'storage'; url: string; expiresAt: string } | { kind: 'inline'; content: string; mimeType: string }> {
    const row = (await this.getArtifact(input.artifactId, input.tenantId)) as {
      id: string;
      status: ArtifactStatus;
      approvalState: ApprovalState;
      storageKey: string | null;
      inlineContent: string | null;
      mimeType: string;
      tenantId: string;
    };

    // Gate enforcement
    if (row.status === 'DELETED') {
      throw new ArtifactGatedError('deleted', 'Artifact has been deleted');
    }
    if (row.approvalState === 'REQUIRES_APPROVAL') {
      throw new ArtifactGatedError('requires_approval', 'Artifact requires reviewer approval before download');
    }
    if (row.approvalState === 'REJECTED') {
      throw new ArtifactGatedError('rejected', 'Artifact download was rejected by a reviewer');
    }

    // Materialise the URL or inline content
    let result: { kind: 'storage'; url: string; expiresAt: string } | { kind: 'inline'; content: string; mimeType: string };
    if (row.inlineContent !== null) {
      result = { kind: 'inline', content: row.inlineContent, mimeType: row.mimeType };
    } else if (row.storageKey) {
      const tenantPrefix = `${input.tenantId}/`;
      if (!row.storageKey.startsWith(tenantPrefix)) {
        // Defense-in-depth: row.tenantId already matched, but the storage
        // key is the actual security boundary at the bucket layer.
        throw new ArtifactGatedError('rejected', 'Artifact storage key does not match tenant');
      }
      await ensureBucket(this.log);
      const expiresInSeconds = input.expiresInSeconds ?? 600;
      const { data, error } = await getClient()
        .storage.from(ARTIFACT_BUCKET)
        .createSignedUrl(row.storageKey, expiresInSeconds);
      if (error || !data?.signedUrl) {
        throw new Error(`[artifact] Signed URL failed: ${error?.message ?? 'unknown'}`);
      }
      result = {
        kind: 'storage',
        url: data.signedUrl,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      };
    } else {
      throw new Error(`Artifact ${input.artifactId} is in READY state but has neither inlineContent nor storageKey`);
    }

    // Update download trail
    await (this.db.workflowArtifact.update as unknown as (args: unknown) => Promise<unknown>)({
      where: { id: row.id },
      data: { lastDownloadedBy: input.requestedBy, lastDownloadedAt: new Date() },
    });
    void this.audit
      .log({
        action: AuditAction.MEMORY_READ, // best-fit existing enum; a dedicated ARTIFACT_DOWNLOADED would be cleaner
        tenantId: input.tenantId,
        userId: input.requestedBy,
        resource: 'workflow_artifact',
        resourceId: row.id,
        details: { artifactId: row.id, kind: result.kind },
      })
      .catch(() => {
        /* never block download on audit log failure */
      });

    return result;
  }

  /**
   * Approve or reject an artifact's download. Reviewer-only operation —
   * the route layer enforces RBAC; this service trusts that.
   */
  async setApprovalState(input: {
    artifactId: string;
    tenantId: string;
    decision: 'APPROVED' | 'REJECTED';
    reviewedBy: string;
  }): Promise<unknown> {
    const row = (await this.getArtifact(input.artifactId, input.tenantId)) as { id: string };
    const updated = await (this.db.workflowArtifact.update as unknown as (args: unknown) => Promise<unknown>)({
      where: { id: row.id },
      data: {
        approvalState: input.decision as ApprovalState,
        approvedBy: input.reviewedBy,
        approvedAt: new Date(),
      },
    });
    void this.audit
      .log({
        action: input.decision === 'APPROVED' ? AuditAction.APPROVAL_GRANTED : AuditAction.APPROVAL_REJECTED,
        tenantId: input.tenantId,
        userId: input.reviewedBy,
        resource: 'workflow_artifact',
        resourceId: row.id,
        details: { decision: input.decision },
      })
      .catch(() => {
        /* never block on audit */
      });
    return updated;
  }

  /**
   * Soft-delete an artifact. The blob is removed from storage but the row
   * stays for the audit trail (status='DELETED').
   */
  async deleteArtifact(input: { artifactId: string; tenantId: string; deletedBy: string }): Promise<void> {
    const row = (await this.getArtifact(input.artifactId, input.tenantId)) as {
      id: string;
      storageKey: string | null;
    };
    if (row.storageKey) {
      try {
        await ensureBucket(this.log);
        await getClient().storage.from(ARTIFACT_BUCKET).remove([row.storageKey]);
      } catch (err) {
        this.log.warn(
          { artifactId: row.id, err: err instanceof Error ? err.message : String(err) },
          '[artifact] storage remove failed (non-fatal — row will still be soft-deleted)',
        );
      }
    }
    await (this.db.workflowArtifact.update as unknown as (args: unknown) => Promise<unknown>)({
      where: { id: row.id },
      data: { status: 'DELETED' as ArtifactStatus, deletedAt: new Date() },
    });
    void this.audit
      .log({
        action: AuditAction.MEMORY_DELETED,
        tenantId: input.tenantId,
        userId: input.deletedBy,
        resource: 'workflow_artifact',
        resourceId: row.id,
        details: {},
      })
      .catch(() => {
        /* never block on audit */
      });
  }
}
