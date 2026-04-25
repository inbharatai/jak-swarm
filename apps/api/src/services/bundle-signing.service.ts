/**
 * bundle-signing.service — tamper-evident evidence bundles via HMAC-SHA256.
 *
 * Key derivation (intentionally tenant-scoped without per-tenant DB columns):
 *   server_secret  = process.env.EVIDENCE_SIGNING_SECRET (≥32 bytes recommended)
 *   tenant_key     = HMAC-SHA256(server_secret, tenantId)
 *   manifest_sig   = HMAC-SHA256(tenant_key, canonicalJSON(manifest))
 *
 * Why HMAC + canonical-JSON instead of full PKI:
 *   - We control both signer + verifier (same server). No third-party
 *     verification surface yet, so PKI is overkill for v0.
 *   - Detects tampering with the manifest itself OR any artifact bytes
 *     it references (because `artifactHashes` are sha256s of the bytes).
 *   - Verifiable by re-fetching artifacts and recomputing — see
 *     `verifyBundleManifest`.
 *
 * Failure modes are explicit:
 *   - `EVIDENCE_SIGNING_SECRET` not set → throws BundleSigningUnavailableError
 *   - manifest tampered → returns { valid: false, reason: 'manifest_signature_mismatch' }
 *   - artifact bytes tampered → returns { valid: false, reason: 'artifact_hash_mismatch', artifactId }
 *
 * Important: the AUTH_SECRET that signs JWTs is intentionally NOT reused
 * here. EVIDENCE_SIGNING_SECRET is a separate operator-managed env var so
 * rotating one doesn't invalidate the other.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const BUNDLE_MANIFEST_VERSION = 1;
export const BUNDLE_SIGNATURE_ALGO = 'HMAC-SHA256';

export interface BundleArtifactRef {
  artifactId: string;
  fileName: string;
  contentHash: string; // sha256 hex of the artifact bytes
  sizeBytes: number;
  artifactType: string;
}

export interface BundleManifest {
  version: number;
  tenantId: string;
  workflowId: string;
  generatedAt: string; // ISO timestamp
  artifacts: BundleArtifactRef[];
  /**
   * Optional metadata stamped by the producer (e.g. workflow goal, total
   * cost, control framework references). Included in the signed payload
   * so any modification invalidates the signature.
   */
  metadata?: Record<string, unknown>;
}

export interface SignedBundle {
  manifest: BundleManifest;
  signatureAlgo: string;
  signature: string; // hex
}

export type VerifyResult =
  | { valid: true }
  | { valid: false; reason: 'manifest_signature_mismatch' }
  | { valid: false; reason: 'artifact_hash_mismatch'; artifactId: string }
  | { valid: false; reason: 'signing_unavailable'; message: string }
  | { valid: false; reason: 'malformed_bundle'; message: string };

export class BundleSigningUnavailableError extends Error {
  constructor() {
    super(
      '[bundle-signing] EVIDENCE_SIGNING_SECRET is not set. ' +
      'Set it to a 32+ byte random value (e.g. `openssl rand -base64 48`) and restart the service.',
    );
    this.name = 'BundleSigningUnavailableError';
  }
}

function getServerSecret(): Buffer {
  const raw = process.env['EVIDENCE_SIGNING_SECRET']?.trim();
  if (!raw || raw.length < 16) {
    throw new BundleSigningUnavailableError();
  }
  return Buffer.from(raw, 'utf8');
}

function deriveTenantKey(tenantId: string): Buffer {
  const serverSecret = getServerSecret();
  return createHmac('sha256', serverSecret).update(tenantId).digest();
}

/**
 * Canonical JSON: deterministic key ordering so two equivalent objects
 * always produce the same signed bytes. Critical for signature stability.
 *
 * Recursively sorts object keys, preserves array order, drops undefineds.
 */
export function canonicalJson(value: unknown): string {
  const stable = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(stable);
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      const x = obj[k];
      if (x !== undefined) out[k] = stable(x);
    }
    return out;
  };
  return JSON.stringify(stable(value));
}

/**
 * Sign a bundle manifest. Returns `{ manifest, signatureAlgo, signature }`
 * suitable for JSON serialization.
 *
 * Throws BundleSigningUnavailableError if EVIDENCE_SIGNING_SECRET is unset.
 */
export function signBundleManifest(manifest: BundleManifest): SignedBundle {
  const tenantKey = deriveTenantKey(manifest.tenantId);
  const payload = canonicalJson(manifest);
  const signature = createHmac('sha256', tenantKey).update(payload).digest('hex');
  return {
    manifest,
    signatureAlgo: BUNDLE_SIGNATURE_ALGO,
    signature,
  };
}

/**
 * Verify a bundle's signature alone (does NOT re-fetch artifact bytes).
 * Returns true if the signature is valid for this manifest.
 *
 * Use `verifyBundleWithArtifactBytes` to additionally check that none of
 * the referenced artifact bytes have been altered.
 */
export function verifyBundleSignature(bundle: SignedBundle): VerifyResult {
  if (!bundle || typeof bundle !== 'object') {
    return { valid: false, reason: 'malformed_bundle', message: 'bundle must be an object' };
  }
  if (bundle.signatureAlgo !== BUNDLE_SIGNATURE_ALGO) {
    return { valid: false, reason: 'malformed_bundle', message: `unknown signature algo: ${bundle.signatureAlgo}` };
  }
  if (!bundle.manifest || typeof bundle.manifest !== 'object') {
    return { valid: false, reason: 'malformed_bundle', message: 'manifest missing' };
  }
  let recomputed: string;
  try {
    const tenantKey = deriveTenantKey(bundle.manifest.tenantId);
    recomputed = createHmac('sha256', tenantKey).update(canonicalJson(bundle.manifest)).digest('hex');
  } catch (err) {
    if (err instanceof BundleSigningUnavailableError) {
      return { valid: false, reason: 'signing_unavailable', message: err.message };
    }
    return { valid: false, reason: 'malformed_bundle', message: err instanceof Error ? err.message : String(err) };
  }
  // Constant-time comparison
  const a = Buffer.from(bundle.signature, 'hex');
  const b = Buffer.from(recomputed, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'manifest_signature_mismatch' };
  }
  return { valid: true };
}

/**
 * Stronger verification — checks the manifest signature AND that each
 * referenced artifact's current sha256 still matches the manifest's
 * recorded hash. Catches tampering of the artifact bytes themselves.
 *
 * `loadArtifactBytes` is supplied by the caller so this module stays
 * pure (no DB / storage coupling).
 */
export async function verifyBundleWithArtifactBytes(
  bundle: SignedBundle,
  loadArtifactBytes: (artifactId: string) => Promise<Uint8Array | null>,
): Promise<VerifyResult> {
  const sigCheck = verifyBundleSignature(bundle);
  if (!sigCheck.valid) return sigCheck;

  const { createHash } = await import('node:crypto');
  for (const ref of bundle.manifest.artifacts) {
    const bytes = await loadArtifactBytes(ref.artifactId);
    if (!bytes) {
      // Missing artifact = tamper (could mean deleted after signing).
      return { valid: false, reason: 'artifact_hash_mismatch', artifactId: ref.artifactId };
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== ref.contentHash) {
      return { valid: false, reason: 'artifact_hash_mismatch', artifactId: ref.artifactId };
    }
  }

  return { valid: true };
}

/**
 * Diagnostic — is the signing subsystem ready?
 * Returns true if EVIDENCE_SIGNING_SECRET is set with sufficient length.
 */
export function isSigningAvailable(): { ready: boolean; reason?: string } {
  const raw = process.env['EVIDENCE_SIGNING_SECRET']?.trim();
  if (!raw) return { ready: false, reason: 'EVIDENCE_SIGNING_SECRET not set' };
  if (raw.length < 16) return { ready: false, reason: 'EVIDENCE_SIGNING_SECRET shorter than 16 chars (use ≥32)' };
  return { ready: true };
}
