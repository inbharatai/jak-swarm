/**
 * Bundle signing tests — proves the tamper-evidence guarantees.
 *
 * Critical assertions (these are the SECURITY contract):
 *   1. A signed manifest verifies as valid.
 *   2. Tampering with the manifest invalidates the signature.
 *   3. Tampering with the signature invalidates verification.
 *   4. Different tenants get different keys (cross-tenant signature
 *      forgery is impossible without the server secret).
 *   5. Missing EVIDENCE_SIGNING_SECRET throws BundleSigningUnavailableError.
 *   6. Artifact-bytes verification catches bytes that have been swapped
 *      out from under the manifest.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  signBundleManifest,
  verifyBundleSignature,
  verifyBundleWithArtifactBytes,
  isSigningAvailable,
  canonicalJson,
  BundleSigningUnavailableError,
  type BundleManifest,
} from '../../apps/api/src/services/bundle-signing.service.js';
import { createHash } from 'node:crypto';

const TEST_SECRET = 'test-evidence-signing-secret-32-bytes-long-1234567890';

beforeEach(() => {
  process.env['EVIDENCE_SIGNING_SECRET'] = TEST_SECRET;
});

afterEach(() => {
  delete process.env['EVIDENCE_SIGNING_SECRET'];
});

function makeManifest(overrides: Partial<BundleManifest> = {}): BundleManifest {
  return {
    version: 1,
    tenantId: 'tenant-a',
    workflowId: 'wf-1',
    generatedAt: '2026-04-25T00:00:00.000Z',
    artifacts: [
      { artifactId: 'a1', fileName: 'file1.pdf', contentHash: 'abc123', sizeBytes: 100, artifactType: 'export' },
      { artifactId: 'a2', fileName: 'file2.json', contentHash: 'def456', sizeBytes: 50, artifactType: 'export' },
    ],
    ...overrides,
  };
}

describe('canonicalJson', () => {
  it('produces stable output regardless of key order', () => {
    const a = canonicalJson({ b: 1, a: 2, nested: { z: 3, y: 4 } });
    const b = canonicalJson({ nested: { y: 4, z: 3 }, a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('drops undefined values', () => {
    const out = canonicalJson({ a: 1, b: undefined, c: null });
    expect(out).toBe('{"a":1,"c":null}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('signBundleManifest + verifyBundleSignature', () => {
  it('verifies a freshly signed manifest', () => {
    const m = makeManifest();
    const signed = signBundleManifest(m);
    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.signatureAlgo).toBe('HMAC-SHA256');
    expect(verifyBundleSignature(signed)).toEqual({ valid: true });
  });

  it('detects tampering with the manifest body', () => {
    const m = makeManifest();
    const signed = signBundleManifest(m);
    // Mutate the manifest after signing — same signature, different content
    const tampered = {
      ...signed,
      manifest: { ...signed.manifest, generatedAt: '2030-01-01T00:00:00.000Z' },
    };
    expect(verifyBundleSignature(tampered)).toEqual({
      valid: false,
      reason: 'manifest_signature_mismatch',
    });
  });

  it('detects tampering with the artifacts list', () => {
    const m = makeManifest();
    const signed = signBundleManifest(m);
    const tampered = {
      ...signed,
      manifest: {
        ...signed.manifest,
        artifacts: [
          ...signed.manifest.artifacts,
          { artifactId: 'a3', fileName: 'extra.txt', contentHash: 'fake', sizeBytes: 1, artifactType: 'export' },
        ],
      },
    };
    expect(verifyBundleSignature(tampered)).toEqual({
      valid: false,
      reason: 'manifest_signature_mismatch',
    });
  });

  it('detects tampering with the signature itself', () => {
    const signed = signBundleManifest(makeManifest());
    const tampered = { ...signed, signature: '0'.repeat(64) };
    expect(verifyBundleSignature(tampered)).toEqual({
      valid: false,
      reason: 'manifest_signature_mismatch',
    });
  });

  it('different tenantIds produce different signatures (cross-tenant forgery prevented)', () => {
    const m1 = makeManifest({ tenantId: 'tenant-a' });
    const m2 = makeManifest({ tenantId: 'tenant-b' });
    const sig1 = signBundleManifest(m1).signature;
    const sig2 = signBundleManifest(m2).signature;
    expect(sig1).not.toBe(sig2);
    // A bundle signed for tenant-a must NOT verify if relabeled as tenant-b
    const signedForA = signBundleManifest(m1);
    const fakedForB = { ...signedForA, manifest: { ...signedForA.manifest, tenantId: 'tenant-b' } };
    expect(verifyBundleSignature(fakedForB)).toEqual({
      valid: false,
      reason: 'manifest_signature_mismatch',
    });
  });

  it('rejects malformed bundle (missing manifest)', () => {
    const bad = { signature: 'x', signatureAlgo: 'HMAC-SHA256' } as never;
    const result = verifyBundleSignature(bad);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('malformed_bundle');
  });

  it('rejects unknown signature algo', () => {
    const signed = signBundleManifest(makeManifest());
    const bad = { ...signed, signatureAlgo: 'AES-256-CBC' };
    const result = verifyBundleSignature(bad);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('malformed_bundle');
  });
});

describe('Missing EVIDENCE_SIGNING_SECRET', () => {
  beforeEach(() => {
    delete process.env['EVIDENCE_SIGNING_SECRET'];
  });

  it('signing throws BundleSigningUnavailableError', () => {
    expect(() => signBundleManifest(makeManifest())).toThrow(BundleSigningUnavailableError);
  });

  it('verification returns signing_unavailable', () => {
    // Sign with secret set so we have a valid bundle
    process.env['EVIDENCE_SIGNING_SECRET'] = TEST_SECRET;
    const signed = signBundleManifest(makeManifest());
    delete process.env['EVIDENCE_SIGNING_SECRET'];

    const result = verifyBundleSignature(signed);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('signing_unavailable');
  });

  it('isSigningAvailable returns ready=false', () => {
    expect(isSigningAvailable().ready).toBe(false);
  });

  it('isSigningAvailable returns ready=true with sufficient secret', () => {
    process.env['EVIDENCE_SIGNING_SECRET'] = TEST_SECRET;
    expect(isSigningAvailable().ready).toBe(true);
  });

  it('isSigningAvailable returns ready=false with too-short secret', () => {
    process.env['EVIDENCE_SIGNING_SECRET'] = 'too-short';
    expect(isSigningAvailable().ready).toBe(false);
  });
});

describe('verifyBundleWithArtifactBytes', () => {
  it('passes when artifact bytes hash matches the manifest', async () => {
    const bytes = Buffer.from('hello world', 'utf8');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const m = makeManifest({
      artifacts: [{
        artifactId: 'a1',
        fileName: 'f.txt',
        contentHash: hash,
        sizeBytes: bytes.length,
        artifactType: 'export',
      }],
    });
    const signed = signBundleManifest(m);
    const result = await verifyBundleWithArtifactBytes(signed, async () => bytes);
    expect(result).toEqual({ valid: true });
  });

  it('detects swapped bytes (manifest hash no longer matches)', async () => {
    const originalBytes = Buffer.from('hello world', 'utf8');
    const originalHash = createHash('sha256').update(originalBytes).digest('hex');
    const m = makeManifest({
      artifacts: [{
        artifactId: 'a1',
        fileName: 'f.txt',
        contentHash: originalHash,
        sizeBytes: originalBytes.length,
        artifactType: 'export',
      }],
    });
    const signed = signBundleManifest(m);
    // Now an attacker swaps the bytes
    const tamperedBytes = Buffer.from('goodbye world', 'utf8');
    const result = await verifyBundleWithArtifactBytes(signed, async () => tamperedBytes);
    expect(result.valid).toBe(false);
    if (!result.valid && 'reason' in result) {
      expect(result.reason).toBe('artifact_hash_mismatch');
    }
  });

  it('detects deleted artifact (loadArtifactBytes returns null)', async () => {
    const m = makeManifest();
    const signed = signBundleManifest(m);
    const result = await verifyBundleWithArtifactBytes(signed, async () => null);
    expect(result.valid).toBe(false);
    if (!result.valid && 'reason' in result) {
      expect(result.reason).toBe('artifact_hash_mismatch');
    }
  });
});
