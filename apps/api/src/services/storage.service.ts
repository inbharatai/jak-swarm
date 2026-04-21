/**
 * storage.service — thin Supabase Storage wrapper for tenant document uploads.
 *
 * Why a service instead of calling the SDK inline: every storage touch-point
 * needs to enforce the same tenant-scoped key naming convention
 * (`tenant-documents/<tenantId>/<id>.<ext>`) and handle the same failure
 * modes (bucket missing, signed URL expiry, RLS refusal). Centralizing here
 * keeps the routes thin and makes the bucket-bootstrap idempotent.
 *
 * Storage layout:
 *   bucket: `tenant-documents` (private — no anonymous reads)
 *   object key: `<tenantId>/<documentId>.<ext>`
 *
 * Tenant isolation: the SERVICE (this file) enforces the `<tenantId>/` prefix
 * on every read/write/delete — the bucket itself is not tenant-scoped at the
 * Supabase RLS layer because we use the service-role key. The invariant is
 * in code, not in Postgres policies. Writing to a path without the correct
 * tenantId prefix throws.
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY     (write access to Storage)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { createLogger } from '@jak-swarm/shared';

const logger = createLogger('storage-service');

const BUCKET = 'tenant-documents';

// Allowed MIME types for uploads. Keep this tight — uploads for anything
// outside this list get rejected at the route layer. Adding a new type
// requires a one-line change here + ingestion support in DocumentIngestor.
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB — tune up after we see real usage patterns

let cachedClient: SupabaseClient | null = null;
let bucketEnsured = false;

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error(
      'Supabase Storage requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. ' +
        'Check apps/api env config.',
    );
  }
  cachedClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

/**
 * Ensure the `tenant-documents` bucket exists. Safe to call on every upload —
 * the bucket-ensured flag caches the first successful check so we don't make
 * this a per-request API call in steady state.
 */
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const client = getClient();
  const { data, error } = await client.storage.listBuckets();
  if (error) {
    logger.warn({ err: error.message }, '[storage] listBuckets failed — assuming bucket exists');
    bucketEnsured = true;
    return;
  }
  const exists = data?.some((b) => b.name === BUCKET);
  if (!exists) {
    const { error: createErr } = await client.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_FILE_SIZE_BYTES,
    });
    if (createErr) {
      // 409 is ok — means bucket was created concurrently by another instance.
      if (!String(createErr.message).toLowerCase().includes('already exists')) {
        throw new Error(`[storage] Failed to create bucket '${BUCKET}': ${createErr.message}`);
      }
    }
    logger.info({ bucket: BUCKET }, '[storage] bucket created');
  }
  bucketEnsured = true;
}

export interface UploadResult {
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
  contentHash: string;
}

/**
 * Upload bytes to the tenant's namespace. Caller is responsible for generating
 * the documentId + extension before calling. Returns the storage key so the
 * caller can persist it in the TenantDocument row.
 */
export async function uploadTenantFile(opts: {
  tenantId: string;
  documentId: string;
  extension: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<UploadResult> {
  if (!ALLOWED_MIME_TYPES.has(opts.mimeType)) {
    throw new Error(`[storage] MIME type not allowed: ${opts.mimeType}`);
  }
  if (opts.bytes.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `[storage] File exceeds ${MAX_FILE_SIZE_BYTES} byte limit (${opts.bytes.length} bytes)`,
    );
  }
  if (!opts.tenantId || !opts.documentId) {
    throw new Error('[storage] tenantId and documentId are required');
  }

  await ensureBucket();

  const ext = opts.extension.replace(/^\./, '').toLowerCase();
  const storageKey = `${opts.tenantId}/${opts.documentId}${ext ? `.${ext}` : ''}`;

  const { error } = await getClient()
    .storage.from(BUCKET)
    .upload(storageKey, opts.bytes, {
      contentType: opts.mimeType,
      cacheControl: 'private, max-age=3600',
      upsert: false,
    });

  if (error) {
    throw new Error(`[storage] Upload failed for key ${storageKey}: ${error.message}`);
  }

  // Compute hash for dedupe / integrity
  const { createHash } = await import('node:crypto');
  const contentHash = createHash('sha256').update(opts.bytes).digest('hex');

  return {
    storageKey,
    sizeBytes: opts.bytes.length,
    mimeType: opts.mimeType,
    contentHash,
  };
}

/**
 * Generate a short-lived signed URL so the frontend can stream a file back
 * to the user for preview. 1-hour TTL; the frontend should re-request if it
 * expires.
 *
 * Enforces tenant isolation at the service boundary: the storageKey MUST
 * start with `<tenantId>/`. Cross-tenant access throws.
 */
export async function createSignedReadUrl(opts: {
  tenantId: string;
  storageKey: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const prefix = `${opts.tenantId}/`;
  if (!opts.storageKey.startsWith(prefix)) {
    throw new Error(
      `[storage] Refusing cross-tenant read: key '${opts.storageKey}' does not start with '${prefix}'`,
    );
  }
  await ensureBucket();
  const { data, error } = await getClient()
    .storage.from(BUCKET)
    .createSignedUrl(opts.storageKey, opts.expiresInSeconds ?? 3600);

  if (error || !data?.signedUrl) {
    throw new Error(`[storage] Signed URL failed for ${opts.storageKey}: ${error?.message}`);
  }
  return data.signedUrl;
}

/**
 * Remove the storage object. The accompanying TenantDocument row is not
 * touched — the caller owns the DB-side soft-delete.
 */
export async function deleteTenantFile(opts: {
  tenantId: string;
  storageKey: string;
}): Promise<void> {
  const prefix = `${opts.tenantId}/`;
  if (!opts.storageKey.startsWith(prefix)) {
    throw new Error(
      `[storage] Refusing cross-tenant delete: key '${opts.storageKey}' does not start with '${prefix}'`,
    );
  }
  await ensureBucket();
  const { error } = await getClient().storage.from(BUCKET).remove([opts.storageKey]);
  if (error) {
    // Non-fatal: the Files tab needs delete to succeed even if the object
    // was already gone or the path was renamed externally.
    logger.warn(
      { storageKey: opts.storageKey, err: error.message },
      '[storage] Delete failed — continuing with DB soft-delete',
    );
  }
}

export { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, BUCKET };
