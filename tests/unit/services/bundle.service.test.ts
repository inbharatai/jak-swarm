/**
 * Unit tests for BundleService + bundle-signing.service.
 *
 * Both modules are tested together because BundleService composes the
 * signing primitives — the bundle row's `signature` field is exactly what
 * `signBundleManifest` produces, and verifyBundle round-trips through the
 * same canonical-JSON HMAC-SHA256 path.
 *
 * Coverage:
 *   1. signBundleManifest produces a deterministic HMAC-SHA256 signature
 *   2. Verify happy path — round-trip returns valid:true
 *   3. Verify with tampered manifest field returns manifest_signature_mismatch
 *   4. Verify with a different EVIDENCE_SIGNING_SECRET returns mismatch
 *   5. verifyBundleSignature uses crypto.timingSafeEqual (constant-time)
 *   6. createSignedBundle persists a bundle artifact with signature populated
 *   7. Bundle manifest contains the expected artifact references
 *   8. Approval-gate behavior — bundle artifact is forced to REQUIRES_APPROVAL
 *      (the source does NOT block bundling on un-approved inputs; the gate
 *      is on the BUNDLE itself, not its predecessors)
 *   9. EVIDENCE_SIGNING_SECRET unset → throws BundleSigningUnavailableError
 *  10. Tenant isolation — workflow + artifact queries are tenant-scoped
 *  11. Idempotency — calling createSignedBundle twice creates TWO bundles
 *      (no built-in dedup; documented behavioral surprise)
 *
 * Mocking strategy mirrors tests/unit/services/trial-promotion.test.ts —
 * a small in-memory fake Prisma with vi.fn() for each call site, no real
 * database, no real Supabase Storage (artifacts are stored inline-only in
 * these tests so the storage adapter is never reached).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import { BundleService } from '../../../apps/api/src/services/bundle.service.js';
import {
  signBundleManifest,
  verifyBundleSignature,
  verifyBundleWithArtifactBytes,
  isSigningAvailable,
  canonicalJson,
  BundleSigningUnavailableError,
  BUNDLE_SIGNATURE_ALGO,
  type BundleManifest,
  type SignedBundle,
} from '../../../apps/api/src/services/bundle-signing.service.js';

const TEST_SIGNING_KEY = 'test-signing-key-do-not-use-in-prod-32b';
const ALT_SIGNING_KEY = 'alternate-signing-key-also-not-real-32b!';

interface FakeWorkflow {
  id: string;
  tenantId: string;
  goal: string;
}

interface FakeArtifact {
  id: string;
  tenantId: string;
  workflowId: string;
  artifactType: string;
  fileName: string;
  mimeType: string;
  status: 'PENDING' | 'READY' | 'FAILED' | 'DELETED';
  approvalState: 'NOT_REQUIRED' | 'REQUIRES_APPROVAL' | 'APPROVED' | 'REJECTED';
  contentHash: string | null;
  sizeBytes: number | null;
  inlineContent: string | null;
  storageKey: string | null;
  metadata: Record<string, unknown> | null;
  deletedAt: Date | null;
  producedBy: string;
  createdAt: Date;
}

function sha256Hex(input: string): string {
  return nodeCrypto.createHash('sha256').update(input).digest('hex');
}

function makeFakeDb() {
  const workflows: FakeWorkflow[] = [];
  const artifacts: FakeArtifact[] = [];
  const auditLogs: Array<Record<string, unknown>> = [];

  let cuid = 0;
  const id = (prefix = 'id') => `${prefix}-${++cuid}`;

  const workflowFindFirst = vi.fn(async ({ where }: any) => {
    return (
      workflows.find(
        (w) =>
          w.id === where.id &&
          (where.tenantId === undefined || w.tenantId === where.tenantId),
      ) ?? null
    );
  });

  const artifactFindFirst = vi.fn(async ({ where }: any) => {
    return (
      artifacts.find((a) => {
        if (where.id && a.id !== where.id) return false;
        if (where.tenantId && a.tenantId !== where.tenantId) return false;
        if (where.deletedAt === null && a.deletedAt !== null) return false;
        return true;
      }) ?? null
    );
  });

  const artifactFindMany = vi.fn(async ({ where, orderBy }: any) => {
    let rows = artifacts.filter((a) => {
      if (where.workflowId && a.workflowId !== where.workflowId) return false;
      if (where.tenantId && a.tenantId !== where.tenantId) return false;
      if (where.deletedAt === null && a.deletedAt !== null) return false;
      if (where.status && a.status !== where.status) return false;
      if (where.NOT?.artifactType && a.artifactType === where.NOT.artifactType) return false;
      return true;
    });
    if (orderBy?.createdAt === 'asc') {
      rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }
    return rows;
  });

  const artifactCreate = vi.fn(async ({ data }: any) => {
    const a: FakeArtifact = {
      id: id('art'),
      tenantId: data.tenantId,
      workflowId: data.workflowId,
      artifactType: data.artifactType,
      fileName: data.fileName,
      mimeType: data.mimeType,
      status: data.status ?? 'READY',
      approvalState: data.approvalState ?? 'NOT_REQUIRED',
      contentHash: data.contentHash ?? null,
      sizeBytes: data.sizeBytes ?? null,
      inlineContent: data.inlineContent ?? null,
      storageKey: data.storageKey ?? null,
      metadata: data.metadata ?? null,
      deletedAt: null,
      producedBy: data.producedBy,
      createdAt: new Date(),
    };
    artifacts.push(a);
    return a;
  });

  const artifactUpdate = vi.fn(async ({ where, data }: any) => {
    const a = artifacts.find((x) => x.id === where.id);
    if (!a) throw new Error('artifact not found in fake update');
    Object.assign(a, data);
    return a;
  });

  const auditCreate = vi.fn(async ({ data }: any) => {
    auditLogs.push(data);
    return { id: id('audit'), ...data };
  });

  const db: any = {
    workflow: { findFirst: workflowFindFirst },
    workflowArtifact: {
      findFirst: artifactFindFirst,
      findMany: artifactFindMany,
      create: artifactCreate,
      update: artifactUpdate,
    },
    auditLog: { create: auditCreate },
  };

  return {
    db,
    spies: {
      workflowFindFirst,
      artifactFindFirst,
      artifactFindMany,
      artifactCreate,
      artifactUpdate,
      auditCreate,
    },
    state: { workflows, artifacts, auditLogs },
  };
}

const fakeLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(() => fakeLog),
} as any;

function seedWorkflowAndArtifacts(state: ReturnType<typeof makeFakeDb>['state']) {
  const tenantId = 'tnt-acme';
  const workflowId = 'wf-soc2-q1';
  state.workflows.push({ id: workflowId, tenantId, goal: 'SOC2 Q1 controls review' });

  const evidence: Array<Pick<FakeArtifact,
    'fileName' | 'artifactType' | 'inlineContent' | 'approvalState' | 'status'
  >> = [
    {
      fileName: 'control-matrix.csv',
      artifactType: 'control_matrix',
      inlineContent: 'control_id,description,status\nCC1.1,Code of conduct,IMPLEMENTED',
      approvalState: 'APPROVED',
      status: 'READY',
    },
    {
      fileName: 'exceptions.json',
      artifactType: 'exceptions_log',
      inlineContent: JSON.stringify({ exceptions: [] }),
      approvalState: 'APPROVED',
      status: 'READY',
    },
    {
      fileName: 'executive-summary.md',
      artifactType: 'executive_summary',
      inlineContent: '# Executive Summary\nNo material exceptions identified.',
      approvalState: 'APPROVED',
      status: 'READY',
    },
    {
      fileName: 'workpaper-cc1.pdf',
      artifactType: 'workpaper',
      inlineContent: 'binary-pdf-stand-in',
      approvalState: 'APPROVED',
      status: 'READY',
    },
    // A non-READY one — should NOT show up in the bundle
    {
      fileName: 'in-progress.txt',
      artifactType: 'workpaper',
      inlineContent: 'still cooking',
      approvalState: 'NOT_REQUIRED',
      status: 'PENDING',
    },
  ];

  let counter = 0;
  for (const e of evidence) {
    counter += 1;
    const content = e.inlineContent;
    state.artifacts.push({
      id: `art-seed-${counter}`,
      tenantId,
      workflowId,
      artifactType: e.artifactType,
      fileName: e.fileName,
      mimeType: 'text/plain',
      status: e.status,
      approvalState: e.approvalState,
      contentHash: sha256Hex(content),
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      inlineContent: content,
      storageKey: null,
      metadata: null,
      deletedAt: null,
      producedBy: 'usr-auditor',
      createdAt: new Date(Date.now() + counter * 1000),
    });
  }

  return { tenantId, workflowId };
}

// ---- Tests ---------------------------------------------------------------

describe('bundle-signing.service', () => {
  beforeEach(() => {
    process.env['EVIDENCE_SIGNING_SECRET'] = TEST_SIGNING_KEY;
  });

  afterEach(() => {
    delete process.env['EVIDENCE_SIGNING_SECRET'];
    vi.restoreAllMocks();
  });

  describe('isSigningAvailable', () => {
    it('reports ready=true when EVIDENCE_SIGNING_SECRET is set with sufficient length', () => {
      const status = isSigningAvailable();
      expect(status.ready).toBe(true);
    });

    it('reports ready=false when EVIDENCE_SIGNING_SECRET is missing', () => {
      delete process.env['EVIDENCE_SIGNING_SECRET'];
      const status = isSigningAvailable();
      expect(status.ready).toBe(false);
      expect(status.reason).toMatch(/not set/i);
    });

    it('reports ready=false when EVIDENCE_SIGNING_SECRET is too short', () => {
      process.env['EVIDENCE_SIGNING_SECRET'] = 'too-short';
      const status = isSigningAvailable();
      expect(status.ready).toBe(false);
      expect(status.reason).toMatch(/16/);
    });
  });

  describe('canonicalJson', () => {
    it('produces stable output regardless of object key order', () => {
      const a = canonicalJson({ b: 2, a: 1, c: { y: 2, x: 1 } });
      const b = canonicalJson({ a: 1, c: { x: 1, y: 2 }, b: 2 });
      expect(a).toBe(b);
      expect(a).toBe('{"a":1,"b":2,"c":{"x":1,"y":2}}');
    });

    it('drops undefined values', () => {
      const out = canonicalJson({ a: 1, b: undefined, c: 3 });
      expect(out).toBe('{"a":1,"c":3}');
    });

    it('preserves array order', () => {
      const out = canonicalJson({ list: [3, 1, 2] });
      expect(out).toBe('{"list":[3,1,2]}');
    });
  });

  describe('signBundleManifest', () => {
    const baseManifest: BundleManifest = {
      version: 1,
      tenantId: 'tnt-acme',
      workflowId: 'wf-1',
      generatedAt: '2026-05-06T00:00:00.000Z',
      artifacts: [
        {
          artifactId: 'art-1',
          fileName: 'evidence.txt',
          contentHash: 'a'.repeat(64),
          sizeBytes: 100,
          artifactType: 'workpaper',
        },
      ],
    };

    it('produces a deterministic HMAC-SHA256 signature for the same manifest+key', () => {
      const a = signBundleManifest(baseManifest);
      const b = signBundleManifest(baseManifest);
      expect(a.signature).toBe(b.signature);
      expect(a.signatureAlgo).toBe('HMAC-SHA256');
      expect(a.signatureAlgo).toBe(BUNDLE_SIGNATURE_ALGO);
      // 32-byte HMAC-SHA256 → 64 hex chars
      expect(a.signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces a DIFFERENT signature when the signing key changes', () => {
      const sigA = signBundleManifest(baseManifest).signature;
      process.env['EVIDENCE_SIGNING_SECRET'] = ALT_SIGNING_KEY;
      const sigB = signBundleManifest(baseManifest).signature;
      expect(sigA).not.toBe(sigB);
    });

    it('produces a DIFFERENT signature when the tenant changes (per-tenant key derivation)', () => {
      const sigA = signBundleManifest(baseManifest).signature;
      const sigB = signBundleManifest({ ...baseManifest, tenantId: 'tnt-other' }).signature;
      expect(sigA).not.toBe(sigB);
    });

    it('throws BundleSigningUnavailableError when secret is unset', () => {
      delete process.env['EVIDENCE_SIGNING_SECRET'];
      expect(() => signBundleManifest(baseManifest)).toThrowError(BundleSigningUnavailableError);
    });
  });

  describe('verifyBundleSignature (round-trip)', () => {
    const manifest: BundleManifest = {
      version: 1,
      tenantId: 'tnt-acme',
      workflowId: 'wf-rt',
      generatedAt: '2026-05-06T00:00:00.000Z',
      artifacts: [],
    };

    it('returns valid:true on a freshly-signed bundle (happy path)', () => {
      const signed = signBundleManifest(manifest);
      const result = verifyBundleSignature(signed);
      expect(result.valid).toBe(true);
    });

    it('returns manifest_signature_mismatch when a manifest field is tampered', () => {
      const signed = signBundleManifest(manifest);
      const tampered: SignedBundle = {
        ...signed,
        manifest: { ...signed.manifest, workflowId: 'wf-evil' },
      };
      const result = verifyBundleSignature(tampered);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('manifest_signature_mismatch');
      }
    });

    it('returns manifest_signature_mismatch when the signature itself is tampered (1 byte flipped)', () => {
      const signed = signBundleManifest(manifest);
      // Flip the first hex char to something different
      const head = signed.signature[0]!;
      const flipped = (head === 'a' ? 'b' : 'a') + signed.signature.slice(1);
      const tampered: SignedBundle = { ...signed, signature: flipped };
      const result = verifyBundleSignature(tampered);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('manifest_signature_mismatch');
      }
    });

    it('returns manifest_signature_mismatch when verifying with a DIFFERENT key', () => {
      const signed = signBundleManifest(manifest);
      // Same bytes, different key → verification should fail
      process.env['EVIDENCE_SIGNING_SECRET'] = ALT_SIGNING_KEY;
      const result = verifyBundleSignature(signed);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('manifest_signature_mismatch');
      }
    });

    it('returns malformed_bundle for unknown signatureAlgo', () => {
      const signed = signBundleManifest(manifest);
      const bad: SignedBundle = { ...signed, signatureAlgo: 'MD5-LOL' };
      const result = verifyBundleSignature(bad);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('malformed_bundle');
      }
    });

    it('returns signing_unavailable when the secret is missing during verify', () => {
      const signed = signBundleManifest(manifest);
      delete process.env['EVIDENCE_SIGNING_SECRET'];
      const result = verifyBundleSignature(signed);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('signing_unavailable');
      }
    });

    it('uses crypto.timingSafeEqual for constant-time signature comparison', async () => {
      // We can't spy on node:crypto exports — they're non-configurable
      // built-ins, so vi.spyOn(nodeCrypto, 'timingSafeEqual') throws
      // "Cannot redefine property". Instead we verify the contract two
      // ways:
      //
      //   (a) STRUCTURAL: read the source and assert that signature
      //       comparison routes through timingSafeEqual, not `===` or
      //       Buffer.equals(). This guards against a refactor that
      //       silently drops constant-time comparison.
      //
      //   (b) BEHAVIORAL: verify that signature length mismatches are
      //       rejected before timingSafeEqual is even called (the source
      //       short-circuits on `a.length !== b.length`). A signature of
      //       the wrong length must fail with manifest_signature_mismatch
      //       rather than throwing — this is the documented contract
      //       around timingSafeEqual's length-equality requirement.
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const sourcePath = path.resolve(
        __dirname,
        '../../../apps/api/src/services/bundle-signing.service.ts',
      );
      const src = await fs.readFile(sourcePath, 'utf8');

      // (a) Structural: timingSafeEqual MUST be imported and called
      expect(src).toMatch(/timingSafeEqual/);
      // It must NOT use plain === on the signature buffer comparison
      // (the only place this matters is the verifyBundleSignature body).
      const verifyBody = src.match(/export function verifyBundleSignature[\s\S]*?\n\}/)?.[0] ?? '';
      expect(verifyBody).toMatch(/timingSafeEqual/);
      // No naive string equality on the signature variable
      expect(verifyBody).not.toMatch(/bundle\.signature\s*===\s*recomputed/);

      // (b) Behavioral: a too-short signature is rejected (length-guard
      // protects timingSafeEqual from throwing on mismatched lengths).
      const signed = signBundleManifest(manifest);
      const truncated: SignedBundle = { ...signed, signature: signed.signature.slice(0, 32) };
      const result = verifyBundleSignature(truncated);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('manifest_signature_mismatch');
      }
    });
  });

  describe('verifyBundleWithArtifactBytes', () => {
    it('returns valid:true when manifest signature AND every artifact hash match', async () => {
      const content = 'the quick brown fox';
      const hash = sha256Hex(content);
      const manifest: BundleManifest = {
        version: 1,
        tenantId: 'tnt-acme',
        workflowId: 'wf-1',
        generatedAt: '2026-05-06T00:00:00.000Z',
        artifacts: [
          {
            artifactId: 'art-x',
            fileName: 'fox.txt',
            contentHash: hash,
            sizeBytes: Buffer.byteLength(content, 'utf8'),
            artifactType: 'evidence',
          },
        ],
      };
      const signed = signBundleManifest(manifest);
      const loader = vi.fn(async () => Buffer.from(content, 'utf8'));
      const res = await verifyBundleWithArtifactBytes(signed, loader);
      expect(res.valid).toBe(true);
      expect(loader).toHaveBeenCalledWith('art-x');
    });

    it('returns artifact_hash_mismatch when an artifact byte is flipped', async () => {
      const content = 'the quick brown fox';
      const hash = sha256Hex(content);
      const manifest: BundleManifest = {
        version: 1,
        tenantId: 'tnt-acme',
        workflowId: 'wf-1',
        generatedAt: '2026-05-06T00:00:00.000Z',
        artifacts: [
          {
            artifactId: 'art-x',
            fileName: 'fox.txt',
            contentHash: hash,
            sizeBytes: Buffer.byteLength(content, 'utf8'),
            artifactType: 'evidence',
          },
        ],
      };
      const signed = signBundleManifest(manifest);
      // Tamper the bytes after signing — same length so size doesn't drift.
      const tamperedBytes = Buffer.from('the quick brown FOX', 'utf8');
      const loader = vi.fn(async () => tamperedBytes);
      const res = await verifyBundleWithArtifactBytes(signed, loader);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe('artifact_hash_mismatch');
        if (res.reason === 'artifact_hash_mismatch') {
          expect(res.artifactId).toBe('art-x');
        }
      }
    });

    it('returns artifact_hash_mismatch when an artifact has been deleted (loader returns null)', async () => {
      const manifest: BundleManifest = {
        version: 1,
        tenantId: 'tnt-acme',
        workflowId: 'wf-1',
        generatedAt: '2026-05-06T00:00:00.000Z',
        artifacts: [
          {
            artifactId: 'art-gone',
            fileName: 'gone.txt',
            contentHash: sha256Hex('whatever'),
            sizeBytes: 8,
            artifactType: 'evidence',
          },
        ],
      };
      const signed = signBundleManifest(manifest);
      const loader = vi.fn(async () => null);
      const res = await verifyBundleWithArtifactBytes(signed, loader);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe('artifact_hash_mismatch');
      }
    });
  });
});

describe('BundleService.createSignedBundle', () => {
  beforeEach(() => {
    process.env['EVIDENCE_SIGNING_SECRET'] = TEST_SIGNING_KEY;
  });

  afterEach(() => {
    delete process.env['EVIDENCE_SIGNING_SECRET'];
    vi.restoreAllMocks();
  });

  it('persists a bundle artifact with a populated signature and REQUIRES_APPROVAL state', async () => {
    const { db, state, spies } = makeFakeDb();
    const { tenantId, workflowId } = seedWorkflowAndArtifacts(state);

    const svc = new BundleService(db, fakeLog);
    const result = await svc.createSignedBundle({
      tenantId,
      workflowId,
      requestedBy: 'usr-auditor',
    });

    expect(result.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(result.signatureAlgo).toBe('HMAC-SHA256');
    expect(result.artifactId).toMatch(/^art-/);
    expect(result.manifest.version).toBe(1);
    expect(result.manifest.tenantId).toBe(tenantId);
    expect(result.manifest.workflowId).toBe(workflowId);

    // The bundle row was actually created via workflowArtifact.create
    expect(spies.artifactCreate).toHaveBeenCalledTimes(1);
    const createArg = spies.artifactCreate.mock.calls[0]![0];
    expect(createArg.data.artifactType).toBe('evidence_bundle');
    expect(createArg.data.approvalState).toBe('REQUIRES_APPROVAL');
    expect(createArg.data.mimeType).toBe('application/json');
    expect(createArg.data.fileName).toMatch(/^evidence-bundle-.+\.signed\.json$/);

    // The persisted inlineContent IS the signed bundle JSON
    const persisted = state.artifacts.find((a) => a.id === result.artifactId);
    expect(persisted).toBeDefined();
    expect(persisted!.artifactType).toBe('evidence_bundle');
    const parsed = JSON.parse(persisted!.inlineContent!) as SignedBundle;
    expect(parsed.signature).toBe(result.signature);
    expect(parsed.manifest.workflowId).toBe(workflowId);
  });

  it('manifest contains every READY non-bundle artifact (control matrix, exceptions, summary, workpaper)', async () => {
    const { db, state } = makeFakeDb();
    const { tenantId, workflowId } = seedWorkflowAndArtifacts(state);

    const svc = new BundleService(db, fakeLog);
    const result = await svc.createSignedBundle({
      tenantId,
      workflowId,
      requestedBy: 'usr-auditor',
    });

    // Seed has 4 READY + 1 PENDING non-bundle artifacts. Only the 4 READY
    // should appear in the manifest.
    expect(result.manifest.artifacts).toHaveLength(4);
    const fileNames = result.manifest.artifacts.map((a) => a.fileName).sort();
    expect(fileNames).toEqual([
      'control-matrix.csv',
      'exceptions.json',
      'executive-summary.md',
      'workpaper-cc1.pdf',
    ].sort());

    // Each ref carries the expected fields
    for (const ref of result.manifest.artifacts) {
      expect(ref.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof ref.sizeBytes).toBe('number');
      expect(ref.artifactType).toBeTruthy();
      expect(ref.artifactId).toBeTruthy();
    }
  });

  it('PENDING artifacts are excluded; only status=READY are bundled', async () => {
    const { db, state } = makeFakeDb();
    const { tenantId, workflowId } = seedWorkflowAndArtifacts(state);

    const svc = new BundleService(db, fakeLog);
    const result = await svc.createSignedBundle({ tenantId, workflowId, requestedBy: 'u' });
    const bundledNames = result.manifest.artifacts.map((a) => a.fileName);
    expect(bundledNames).not.toContain('in-progress.txt');
  });

  it('queries are tenant-scoped on workflow.findFirst AND workflowArtifact.findMany', async () => {
    const { db, state, spies } = makeFakeDb();
    const { tenantId, workflowId } = seedWorkflowAndArtifacts(state);

    const svc = new BundleService(db, fakeLog);
    await svc.createSignedBundle({ tenantId, workflowId, requestedBy: 'u' });

    // workflow.findFirst was called with the tenant filter
    expect(spies.workflowFindFirst).toHaveBeenCalled();
    const wfArg = spies.workflowFindFirst.mock.calls[0]![0];
    expect(wfArg.where.tenantId).toBe(tenantId);
    expect(wfArg.where.id).toBe(workflowId);

    // workflowArtifact.findMany was called with the tenant filter and
    // excludes prior bundles (NOT artifactType evidence_bundle)
    expect(spies.artifactFindMany).toHaveBeenCalled();
    const findArg = spies.artifactFindMany.mock.calls[0]![0];
    expect(findArg.where.tenantId).toBe(tenantId);
    expect(findArg.where.workflowId).toBe(workflowId);
    expect(findArg.where.status).toBe('READY');
    expect(findArg.where.deletedAt).toBeNull();
    expect(findArg.where.NOT?.artifactType).toBe('evidence_bundle');

    // The bundle row created back is also tenant-scoped
    const createArg = spies.artifactCreate.mock.calls[0]![0];
    expect(createArg.data.tenantId).toBe(tenantId);
  });

  it('refuses to create a bundle for a workflow that does not belong to the tenant', async () => {
    const { db, state } = makeFakeDb();
    const { workflowId } = seedWorkflowAndArtifacts(state);

    const svc = new BundleService(db, fakeLog);
    await expect(
      svc.createSignedBundle({
        tenantId: 'tnt-evil',
        workflowId,
        requestedBy: 'u',
      }),
    ).rejects.toThrow(/not found in tenant/);
  });

  it('throws BundleSigningUnavailableError when EVIDENCE_SIGNING_SECRET is unset', async () => {
    delete process.env['EVIDENCE_SIGNING_SECRET'];
    const { db, state } = makeFakeDb();
    const { tenantId, workflowId } = seedWorkflowAndArtifacts(state);

    const svc = new BundleService(db, fakeLog);
    await expect(
      svc.createSignedBundle({ tenantId, workflowId, requestedBy: 'u' }),
    ).rejects.toBeInstanceOf(BundleSigningUnavailableError);

    // No bundle row was created
    const bundles = state.artifacts.filter((a) => a.artifactType === 'evidence_bundle');
    expect(bundles).toHaveLength(0);
  });

  it('throws BundleSigningUnavailableError when EVIDENCE_SIGNING_SECRET is too short (<16 chars)', async () => {
    process.env['EVIDENCE_SIGNING_SECRET'] = 'shorty';
    const { db, state } = makeFakeDb();
    const { tenantId, workflowId } = seedWorkflowAndArtifacts(state);

    const svc = new BundleService(db, fakeLog);
    await expect(
      svc.createSignedBundle({ tenantId, workflowId, requestedBy: 'u' }),
    ).rejects.toBeInstanceOf(BundleSigningUnavailableError);
  });

  it('forces approvalState=REQUIRES_APPROVAL on the bundle artifact (binding-artifact contract)', async () => {
    const { db, state, spies } = makeFakeDb();
    const { tenantId, workflowId } = seedWorkflowAndArtifacts(state);

    const svc = new BundleService(db, fakeLog);
    await svc.createSignedBundle({ tenantId, workflowId, requestedBy: 'u' });

    const createArg = spies.artifactCreate.mock.calls[0]![0];
    expect(createArg.data.approvalState).toBe('REQUIRES_APPROVAL');

    // Sanity: the bundle is downstream of un-gated inputs, but the bundle
    // ITSELF requires approval before download. Verify by reading back.
    const bundle = state.artifacts.find((a) => a.artifactType === 'evidence_bundle');
    expect(bundle?.approvalState).toBe('REQUIRES_APPROVAL');
  });

  it('still bundles inputs that are themselves REQUIRES_APPROVAL (the gate is on the BUNDLE, not its inputs)', async () => {
    // BEHAVIORAL SURPRISE: the source code does NOT block bundling on
    // un-approved inputs. The approval gate enforced by BundleService is
    // strictly on the OUTPUT bundle. If the user wanted "refuse to bundle
    // un-approved evidence," that's a feature gap — documented here so a
    // future change to add the check will trip this test on purpose.
    const { db, state } = makeFakeDb();
    const tenantId = 'tnt-acme';
    const workflowId = 'wf-pending-approval';
    state.workflows.push({ id: workflowId, tenantId, goal: 'pending approvals test' });

    const content = 'unapproved evidence';
    state.artifacts.push({
      id: 'art-pending',
      tenantId,
      workflowId,
      artifactType: 'workpaper',
      fileName: 'pending.txt',
      mimeType: 'text/plain',
      status: 'READY',
      approvalState: 'REQUIRES_APPROVAL',
      contentHash: sha256Hex(content),
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      inlineContent: content,
      storageKey: null,
      metadata: null,
      deletedAt: null,
      producedBy: 'usr-auditor',
      createdAt: new Date(),
    });

    const svc = new BundleService(db, fakeLog);
    const result = await svc.createSignedBundle({ tenantId, workflowId, requestedBy: 'u' });
    // The unapproved artifact IS included — current behavior.
    expect(result.manifest.artifacts.map((a) => a.artifactId)).toContain('art-pending');
  });

  it('idempotency: calling createSignedBundle twice produces TWO bundle rows (no built-in dedup)', async () => {
    // BEHAVIORAL SURPRISE: there is no idempotency check. Each call writes
    // a fresh bundle artifact. This may be intentional (auditors want a
    // versioned trail), but it's worth pinning so a refactor that adds
    // dedup must explicitly update this test.
    const { db, state } = makeFakeDb();
    const { tenantId, workflowId } = seedWorkflowAndArtifacts(state);

    const svc = new BundleService(db, fakeLog);
    const first = await svc.createSignedBundle({ tenantId, workflowId, requestedBy: 'u' });
    const second = await svc.createSignedBundle({ tenantId, workflowId, requestedBy: 'u' });

    expect(first.artifactId).not.toBe(second.artifactId);
    const bundles = state.artifacts.filter((a) => a.artifactType === 'evidence_bundle');
    expect(bundles).toHaveLength(2);

    // Each bundle has its own signature; signatures may even differ
    // because the manifest's generatedAt is per-call (Date.now()).
    expect(first.signature).toBeDefined();
    expect(second.signature).toBeDefined();
  });

  it('skips artifacts that lack contentHash or sizeBytes (defensive filter)', async () => {
    const { db, state } = makeFakeDb();
    const tenantId = 'tnt-acme';
    const workflowId = 'wf-malformed';
    state.workflows.push({ id: workflowId, tenantId, goal: 'malformed-row test' });

    // Row missing contentHash — should be filtered out of the manifest
    state.artifacts.push({
      id: 'art-malformed',
      tenantId,
      workflowId,
      artifactType: 'workpaper',
      fileName: 'no-hash.txt',
      mimeType: 'text/plain',
      status: 'READY',
      approvalState: 'APPROVED',
      contentHash: null,
      sizeBytes: 10,
      inlineContent: 'whatever',
      storageKey: null,
      metadata: null,
      deletedAt: null,
      producedBy: 'u',
      createdAt: new Date(),
    });

    const svc = new BundleService(db, fakeLog);
    const result = await svc.createSignedBundle({ tenantId, workflowId, requestedBy: 'u' });
    expect(result.manifest.artifacts.map((a) => a.artifactId)).not.toContain('art-malformed');
    expect(result.manifest.artifacts).toHaveLength(0);
  });

  it('passes through optional metadata into the manifest', async () => {
    const { db, state } = makeFakeDb();
    const { tenantId, workflowId } = seedWorkflowAndArtifacts(state);

    const svc = new BundleService(db, fakeLog);
    const result = await svc.createSignedBundle({
      tenantId,
      workflowId,
      requestedBy: 'u',
      metadata: { framework: 'SOC2', period: 'Q1-2026' },
    });
    expect(result.manifest.metadata).toEqual({ framework: 'SOC2', period: 'Q1-2026' });
  });

  // Pinned-as-todo: tests that genuinely require a real Postgres ----------

  it.todo(
    'translates Prisma P2021 (workflow_artifacts table missing) into ArtifactSchemaUnavailableError ' +
      '— reason: needs a real Prisma client throwing P2021, not a hand-rolled fake. Covered by integration tests.',
  );

  it.todo(
    'records an audit_log row for bundle creation ' +
      '— reason: AuditLogger is non-blocking (catches its own DB errors and falls back to console). ' +
      'A unit test that asserts on the audit row is racey because the fire-and-forget Promise may not resolve ' +
      'before the test ends. Cover this in the integration suite where we can await the audit write.',
  );
});
