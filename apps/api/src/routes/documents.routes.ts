/**
 * Documents routes — Track 2 of the hardening plan.
 *
 * Customer round-trip:
 *   1. User drops a PDF on the Files tab (apps/web/src/app/(dashboard)/files).
 *   2. Frontend POSTs multipart/form-data to /documents/upload.
 *   3. This handler saves bytes to Supabase Storage, creates a TenantDocument
 *      row (status=PENDING), and fire-and-forget kicks off chunking + embedding.
 *   4. When ingestion completes, the row transitions to status=INDEXED.
 *   5. The agent's `find_document` tool queries both TenantDocument metadata
 *      and VectorDocument content to answer "review this contract".
 *
 * Tenant isolation: every handler path scopes by request.user.tenantId. The
 * storage.service layer additionally enforces the `<tenantId>/` storage-key
 * prefix so a cross-tenant signed-URL forgery is structurally rejected.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError, NotFoundError, ForbiddenError } from '../errors.js';
import { ok, err } from '../types.js';
import {
  uploadTenantFile,
  createSignedReadUrl,
  deleteTenantFile,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '../services/storage.service.js';

// Maximum number of documents a tenant can hold at once — a soft cap to
// keep dev/trial accounts from accidentally hammering storage. Pro/Team
// tiers should bump this via a per-tenant setting in a follow-up.
const MAX_DOCUMENTS_PER_TENANT = 500;

// Lightweight ext-from-filename; storage service normalizes further.
function extFrom(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['PENDING', 'INDEXED', 'FAILED', 'DELETED']).optional(),
});

const documentsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /documents/upload
   * multipart/form-data — single file per request.
   * Optional form fields: `tags` (comma-separated), `metadataJson` (JSON string).
   *
   * Returns the newly created TenantDocument row with status=PENDING. The
   * frontend should poll GET /documents/:id or subscribe to SSE to observe
   * the PENDING → INDEXED transition.
   */
  fastify.post(
    '/upload',
    {
      preHandler: [fastify.authenticate],
      config: {
        // Multipart plugin reads the body; raw bodyLimit from the root Fastify
        // config (10MB) is bypassed. MAX_FILE_SIZE_BYTES (25MB) is the
        // storage-layer ceiling.
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.user;

      // Soft cap: count active (non-deleted) documents first
      const activeCount = await fastify.db.tenantDocument.count({
        where: { tenantId, deletedAt: null },
      });
      if (activeCount >= MAX_DOCUMENTS_PER_TENANT) {
        throw new AppError(
          429,
          'DOCUMENT_QUOTA_EXCEEDED',
          `Tenant has ${activeCount} active documents. Limit is ${MAX_DOCUMENTS_PER_TENANT}. Delete old documents first.`,
        );
      }

      const parts = request.parts({ limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 } });
      let fileBuffer: Buffer | null = null;
      let fileName = '';
      let mimeType = '';
      let tags: string[] = [];
      let metadata: Record<string, unknown> | null = null;

      for await (const part of parts) {
        if (part.type === 'file') {
          fileName = part.filename ?? 'upload';
          mimeType = part.mimetype ?? 'application/octet-stream';
          fileBuffer = await part.toBuffer();
        } else {
          // Multipart text fields: tags, metadataJson
          if (part.fieldname === 'tags' && typeof part.value === 'string') {
            tags = part.value.split(',').map((t) => t.trim()).filter(Boolean);
          } else if (part.fieldname === 'metadataJson' && typeof part.value === 'string') {
            try {
              metadata = JSON.parse(part.value);
            } catch {
              throw new AppError(422, 'INVALID_METADATA_JSON', 'metadataJson must be valid JSON');
            }
          }
        }
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        throw new AppError(422, 'NO_FILE', 'Request must include a file part');
      }
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        throw new AppError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          `MIME type ${mimeType} is not allowed. Supported: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
        );
      }

      // Create the row first so the storage key embeds a real documentId.
      const doc = await fastify.db.tenantDocument.create({
        data: {
          tenantId,
          uploadedBy: userId,
          fileName,
          mimeType,
          sizeBytes: fileBuffer.length,
          // Placeholder storageKey overwritten after upload succeeds; we need
          // an id from the DB to name the storage object.
          storageKey: `${tenantId}/pending-${Date.now()}`,
          status: 'PENDING',
          tags,
          // Prisma's Json type for the metadata column expects InputJsonValue,
          // not the plain Record<string, unknown> we parsed from form data.
          // JSON.parse(JSON.stringify(...)) canonicalizes to plain JSON.
          metadata: metadata ? (JSON.parse(JSON.stringify(metadata)) as object) : undefined,
        },
      });

      try {
        const uploadResult = await uploadTenantFile({
          tenantId,
          documentId: doc.id,
          extension: extFrom(fileName),
          mimeType,
          bytes: new Uint8Array(fileBuffer),
        });

        // Update row with the real storage key + content hash
        const updated = await fastify.db.tenantDocument.update({
          where: { id: doc.id },
          data: {
            storageKey: uploadResult.storageKey,
            contentHash: uploadResult.contentHash,
            sizeBytes: uploadResult.sizeBytes,
          },
        });

        await fastify.auditLog(request, 'UPLOAD_DOCUMENT', 'TenantDocument', doc.id, {
          fileName,
          sizeBytes: uploadResult.sizeBytes,
          mimeType,
        });

        // Fire-and-forget ingestion. Errors update the row status; the
        // response is not blocked on ingestion completion.
        void ingestDocumentInBackground(fastify, updated.id).catch((err: unknown) => {
          fastify.log.error(
            { docId: updated.id, err: err instanceof Error ? err.message : String(err) },
            '[documents] Background ingestion failed',
          );
        });

        return reply.status(201).send(ok(updated));
      } catch (uploadErr) {
        // Roll back the DB row if storage upload fails — leaves no orphan.
        await fastify.db.tenantDocument.delete({ where: { id: doc.id } }).catch(() => {});
        const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        throw new AppError(500, 'UPLOAD_FAILED', `Document upload failed: ${msg}`);
      }
    },
  );

  /**
   * GET /documents — list the tenant's documents.
   * Supports ?limit, ?offset, ?status filters.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.user;
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(422).send(err('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
      }
      const { limit, offset, status } = parsed.data;

      const [items, total] = await Promise.all([
        fastify.db.tenantDocument.findMany({
          where: {
            tenantId,
            deletedAt: null,
            ...(status ? { status } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        fastify.db.tenantDocument.count({
          where: { tenantId, deletedAt: null, ...(status ? { status } : {}) },
        }),
      ]);

      return reply.status(200).send(ok({ items, total, limit, offset }));
    },
  );

  /**
   * GET /documents/:id — get a single document's metadata + a fresh signed
   * read URL. Signed URLs expire in 1 hour — clients should re-request.
   */
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;

      const doc = await fastify.db.tenantDocument.findUnique({ where: { id } });
      if (!doc || doc.deletedAt) throw new NotFoundError('TenantDocument', id);
      if (doc.tenantId !== tenantId) throw new ForbiddenError('Document not in your tenant');

      const signedUrl = await createSignedReadUrl({
        tenantId,
        storageKey: doc.storageKey,
        expiresInSeconds: 3600,
      });

      return reply.status(200).send(ok({ ...doc, signedUrl, signedUrlExpiresIn: 3600 }));
    },
  );

  /**
   * DELETE /documents/:id — soft-delete + remove the storage object +
   * clean up VectorDocument chunks linked by documentId.
   */
  fastify.delete(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { tenantId } = request.user;

      const doc = await fastify.db.tenantDocument.findUnique({ where: { id } });
      if (!doc || doc.deletedAt) throw new NotFoundError('TenantDocument', id);
      if (doc.tenantId !== tenantId) throw new ForbiddenError('Document not in your tenant');

      await deleteTenantFile({ tenantId, storageKey: doc.storageKey }).catch((e: unknown) => {
        request.log.warn(
          { id, err: e instanceof Error ? e.message : String(e) },
          '[documents] Storage delete failed — continuing with DB soft-delete',
        );
      });

      // Delete chunks + mark document soft-deleted in one transaction
      await fastify.db.$transaction([
        fastify.db.vectorDocument.deleteMany({ where: { tenantId, documentId: id } }),
        fastify.db.tenantDocument.update({
          where: { id },
          data: { deletedAt: new Date(), status: 'DELETED' },
        }),
      ]);

      await fastify.auditLog(request, 'DELETE_DOCUMENT', 'TenantDocument', id, {
        fileName: doc.fileName,
      });

      return reply.status(200).send(ok({ id, deleted: true }));
    },
  );
};

// ─── Background ingestion ────────────────────────────────────────────────────
// Exported for testability; the route above invokes this fire-and-forget.

// Shape narrowed to the fields we actually read. The full TenantDocument
// model carries more columns but we only need these for the ingest pipeline;
// the helper stays stable if Prisma adds new columns later.
interface IngestableDocument {
  id: string;
  tenantId: string;
  fileName: string;
  mimeType: string;
  storageKey: string;
}

// Loose typing on `fastify` because this helper is exported for test harnesses
// that may pass a partial mock and we only consume `.db` and `.log`. The full
// FastifyInstance would drag in plugin-declared decorators the tests don't need.
export async function ingestDocumentInBackground(
  fastify: {
    db: {
      tenantDocument: {
        findUnique: (args: { where: { id: string } }) => Promise<IngestableDocument | null>;
        update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
      };
    };
    log?: { error: (obj: unknown, msg: string) => void };
  },
  documentId: string,
): Promise<void> {
  const doc = await fastify.db.tenantDocument.findUnique({ where: { id: documentId } });
  if (!doc) return;

  try {
    // Import DocumentIngestor lazily so the route file doesn't pull the
    // PDF/embedding dep chain on every hot-reload in dev.
    const { DocumentIngestor } = await import('@jak-swarm/tools');
    const { createSignedReadUrl: signUrl } = await import('../services/storage.service.js');

    // Fetch the file back from storage to re-read its bytes for ingestion.
    // We could also pass bytes directly at upload time, but re-fetching keeps
    // the ingestion worker decoupled from the upload request's lifetime.
    const signedUrl = await signUrl({ tenantId: doc.tenantId, storageKey: doc.storageKey });
    const res = await fetch(signedUrl);
    if (!res.ok) throw new Error(`Fetch storage object failed: ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    const bytes = Buffer.from(arrayBuf);

    // DocumentIngestor defaults to the singleton vector adapter, which in prod
    // is the Prisma-backed DbVectorAdapter. We rely on that default rather
    // than passing fastify.db because the ingestor's adapter wiring is
    // established at package load time.
    const ingestor = new DocumentIngestor();
    if (doc.mimeType === 'application/pdf') {
      await ingestor.ingestPDF(doc.tenantId, bytes, {
        documentId: doc.id,
        sourceKey: doc.fileName,
        title: doc.fileName,
      });
    } else if (doc.mimeType.startsWith('text/') || doc.mimeType === 'application/json') {
      await ingestor.ingestText(doc.tenantId, bytes.toString('utf-8'), {
        documentId: doc.id,
        sourceKey: doc.fileName,
        title: doc.fileName,
      });
    } else {
      // Images and office docs are stored but not yet indexed. Mark as indexed
      // so the Files tab doesn't show a perpetual PENDING; the find_document
      // tool will still surface them via filename/metadata match.
      await fastify.db.tenantDocument.update({
        where: { id: documentId },
        data: { status: 'INDEXED' },
      });
      return;
    }

    await fastify.db.tenantDocument.update({
      where: { id: documentId },
      data: { status: 'INDEXED' },
    });
  } catch (err) {
    await fastify.db.tenantDocument.update({
      where: { id: documentId },
      data: {
        status: 'FAILED',
        ingestionError: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

export default documentsRoutes;
