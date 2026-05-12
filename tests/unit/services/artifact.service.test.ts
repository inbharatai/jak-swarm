/**
 * Unit tests for ArtifactService (apps/api/src/services/artifact.service.ts).
 *
 * The service is the production foundation for the Audit & Compliance product's
 * evidence + export surface — it owns row creation, inline-vs-storage
 * materialisation, the approval gate, signed-URL issuance, and soft delete.
 *
 * Mocking strategy mirrors tests/unit/services/trial-promotion.test.ts:
 *   - small in-memory fake Prisma with vi.fn() per call site
 *   - vi.mock('@supabase/supabase-js') exposes the storage adapter as
 *     { upload, download, createSignedUrl, remove } — all vi.fn() — so the
 *     test can assert calls and inject failures without a real Supabase
 *   - vi.hoisted() seeds NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *     so the real config module is happy at load time
 *
 * BEHAVIOURAL NOTES discovered while reading the source:
 *
 *   - createArtifact does NOT dedupe ROWS by contentHash. Identical content
 *     produces two distinct rows; only the storage BLOB is deduped (upsert:true
 *     with a hash-keyed filename). The dedupe-by-row test pins this.
 *
 *   - Storage upload failure throws BEFORE the row is created — the spec
 *     requirement "row marked status='FAILED' on storage write fail" is NOT
 *     implemented. Recorded as a P1 it.todo.
 *
 *   - There is no separate getArtifactContent(); the gate logic lives in
 *     requestSignedDownloadUrl(). The "APPROVED returns content / REJECTED
 *     throws / REQUIRES_APPROVAL throws" tests target that method.
 *
 *   - softDelete is named deleteArtifact; it sets status='DELETED' AND
 *     deletedAt, and a subsequent getArtifact filters by deletedAt:null so
 *     it throws ArtifactNotFoundError (not null).
 *
 *   - listArtifactsForWorkflow does NOT implement a pagination cap. The
 *     "pagination cap" test is recorded as it.todo so we don't ship a fake
 *     assertion that would flatter the source.
 *
 * INFRA SURPRISE (the big one):
 *
 *   - vi.mock('@supabase/supabase-js') does NOT intercept the import made
 *     from apps/api/src/services/artifact.service.ts in this monorepo.
 *     Confirmed via instrumented diagnostic: createClient counter stays at 0
 *     when the source imports the package, while the same vi.mock factory
 *     IS hit when the test file imports the package directly.
 *
 *     Likely cause: the package resolves under apps/api/node_modules/.pnpm/...
 *     while Vitest registers the mock against tests/node_modules/... — the
 *     two paths never reconcile in Vitest's mock registry.
 *
 *     The same limitation hits tests/integration/audit-run-e2e.test.ts: it
 *     sets up an identical vi.mock('@supabase/supabase-js') but its tests
 *     only ever exercise the inline-content path, so the missing mock never
 *     trips an assertion.
 *
 *     Six "happy path needs the storage adapter" tests are therefore filed
 *     as it.todo with a clear [BLOCKED: supabase mock infra] tag. Suggested
 *     fixes — DO NOT roll into this PR:
 *
 *       1. Add `@supabase/supabase-js` to tests/package.json so vitest sees
 *          it under tests/node_modules and the mock target resolves
 *          consistently with the source's resolution.
 *       2. Add a vitest.config alias mapping '@supabase/supabase-js' to a
 *          shared in-repo stub module, gated behind an env flag.
 *       3. Refactor ArtifactService to accept a storage adapter via DI
 *          (constructor injection) so the service can be unit-tested
 *          without a module-level mock at all. Best long-term option —
 *          pin via a follow-up.
 *
 *     Net effect: ArtifactService's storage-upload, storage-signed-URL, and
 *     storage-remove paths currently have ZERO unit-test coverage in this
 *     repo. They are exercised only end-to-end against a real (or stubbed
 *     by the integration harness) Supabase. This is a real coverage gap
 *     worth flagging — surfaced here as the infra todos.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Set Supabase env BEFORE the config module loads. apps/api/src/config.ts
// reads env at import time. vi.hoisted() runs before any imports, so this
// fires before config.ts is loaded transitively. (Same pattern used by
// tests/integration/audit-run-e2e.test.ts.)
vi.hoisted(() => {
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost:54321';
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key-32-bytes-long-1234567890';
});

// ─── Module mocks (must be declared BEFORE the service import) ─────────────
//
// Supabase Storage stub. createClient() returns a chainable shape:
//   client.storage.listBuckets()
//   client.storage.createBucket(name, opts)
//   client.storage.from(bucket).upload(key, bytes, opts)
//   client.storage.from(bucket).createSignedUrl(key, ttl)
//   client.storage.from(bucket).remove([key])
//   client.storage.from(bucket).download(key)   // not used by source but
//                                               //   included per spec for
//                                               //   future-proofing
//
// Each mock fn is exported via the helper getStorageMocks() so tests can
// reach them after vi.resetModules() reloads the service module.

// vi.hoisted ensures the storageMocks object is constructed BEFORE the
// hoisted vi.mock() factory runs, so the factory can close over real vi.fn()
// instances. Without hoisted(), the factory would reference an undefined
// outer-scope variable (Vitest hoists vi.mock above all top-level statements).
const storageMocks = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
  listBuckets: vi.fn(),
  createBucket: vi.fn(),
}));

// vi.mock factory mirrors tests/integration/audit-run-e2e.test.ts. NOTE: in
// this monorepo this mock is not actually exercised because of a Vitest +
// pnpm resolver mismatch — see file-top docstring "INFRA SURPRISE". The mock
// factory is still useful for documentation and for the day the resolver
// issue gets fixed; tests that depend on it are filed as it.todo.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      listBuckets: storageMocks.listBuckets,
      createBucket: storageMocks.createBucket,
      from: () => ({
        upload: storageMocks.upload,
        download: storageMocks.download,
        createSignedUrl: storageMocks.createSignedUrl,
        remove: storageMocks.remove,
      }),
    },
  }),
}));

// Mock the bundle-signing dependency. The artifact service does NOT directly
// import bundle-signing today — bundling lives in BundleService — but the
// brief requires the mock so that any future composition (e.g. createArtifact
// auto-signing an evidence_bundle) is intercepted instead of executing the
// HMAC code path. Declared module-level so it applies even if the import
// chain pulls it in transitively.
vi.mock('../../../apps/api/src/services/bundle-signing.service.js', () => ({
  signBundleManifest: vi.fn(() => ({
    algorithm: 'HMAC-SHA256',
    signature: 'mocked-signature',
    keyId: 'mocked-key-id',
    signedAt: new Date().toISOString(),
  })),
  verifyBundleSignature: vi.fn(() => ({ valid: true })),
  verifyBundleWithArtifactBytes: vi.fn(() => ({ valid: true })),
  isSigningAvailable: vi.fn(() => ({ available: true })),
  canonicalJson: vi.fn((x: unknown) => JSON.stringify(x)),
  BundleSigningUnavailableError: class extends Error {},
  BUNDLE_SIGNATURE_ALGO: 'HMAC-SHA256',
}));

// Static import AFTER all vi.mock calls. The module-level cachedClient
// inside the source is cached once; that's harmless because every test
// resets the storage mock fn state in beforeEach.
import {
  ArtifactService,
  ArtifactGatedError,
  ArtifactNotFoundError,
} from '../../../apps/api/src/services/artifact.service.js';

// ─── Fake Prisma ───────────────────────────────────────────────────────────

interface FakeWorkflow {
  id: string;
  tenantId: string;
}

interface FakeArtifact {
  id: string;
  tenantId: string;
  workflowId: string;
  taskId: string | null;
  producedBy: string;
  artifactType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  inlineContent: string | null;
  storageKey: string | null;
  status: 'PENDING' | 'READY' | 'FAILED' | 'DELETED';
  approvalState: 'NOT_REQUIRED' | 'REQUIRES_APPROVAL' | 'APPROVED' | 'REJECTED';
  parentId: string | null;
  metadata: Record<string, unknown> | null;
  deletedAt: Date | null;
  lastDownloadedBy: string | null;
  lastDownloadedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
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
      return true;
    });
    if (orderBy?.createdAt === 'desc') {
      rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return rows;
  });

  const artifactCount = vi.fn(async () => artifacts.length);

  const artifactCreate = vi.fn(async ({ data }: any) => {
    const a: FakeArtifact = {
      id: id('art'),
      tenantId: data.tenantId,
      workflowId: data.workflowId,
      taskId: data.taskId ?? null,
      producedBy: data.producedBy,
      artifactType: data.artifactType,
      fileName: data.fileName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      contentHash: data.contentHash,
      inlineContent: data.inlineContent ?? null,
      storageKey: data.storageKey ?? null,
      status: data.status ?? 'READY',
      approvalState: data.approvalState ?? 'NOT_REQUIRED',
      parentId: data.parentId ?? null,
      metadata: data.metadata ?? null,
      deletedAt: null,
      lastDownloadedBy: null,
      lastDownloadedAt: null,
      approvedBy: null,
      approvedAt: null,
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
      count: artifactCount,
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
      artifactCount,
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

// ─── Default storage mock behaviours (reset per-test) ──────────────────────

function primeHappyStorage() {
  storageMocks.listBuckets.mockResolvedValue({
    data: [{ name: 'tenant-artifacts' }],
    error: null,
  });
  storageMocks.createBucket.mockResolvedValue({ data: null, error: null });
  storageMocks.upload.mockResolvedValue({ data: { path: 'ok' }, error: null });
  storageMocks.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://signed.example/url' },
    error: null,
  });
  storageMocks.remove.mockResolvedValue({ data: [{ name: 'removed' }], error: null });
  storageMocks.download.mockResolvedValue({ data: new Blob(['x']), error: null });
}

beforeEach(() => {
  for (const fn of Object.values(storageMocks)) fn.mockReset();
  primeHappyStorage();
});

afterEach(() => {
  // Don't restoreAllMocks here — that would tear down the vi.mock factories
  // and break the next test. Per-test mock state is reset in beforeEach.
});

const TENANT = 'tnt-acme';
const OTHER_TENANT = 'tnt-evilcorp';
const WORKFLOW = 'wf-soc2-q1';
const USER = 'usr-auditor';

function seedWorkflow(state: ReturnType<typeof makeFakeDb>['state'], tenantId = TENANT, workflowId = WORKFLOW) {
  state.workflows.push({ id: workflowId, tenantId });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('ArtifactService.createArtifact', () => {
  it('stores small text content INLINE (≤256KB) — no storage upload', async () => {
    const { db, state, spies } = makeFakeDb();
    seedWorkflow(state);
    const svc = new ArtifactService(db, fakeLog);

    const row = (await svc.createArtifact({
      tenantId: TENANT,
      workflowId: WORKFLOW,
      producedBy: USER,
      artifactType: 'final_output',
      fileName: 'summary.txt',
      mimeType: 'text/plain',
      inlineContent: 'tiny payload',
    })) as FakeArtifact;

    expect(row.inlineContent).toBe('tiny payload');
    expect(row.storageKey).toBeNull();
    expect(row.sizeBytes).toBe(Buffer.byteLength('tiny payload', 'utf8'));
    expect(row.status).toBe('READY');
    expect(storageMocks.upload).not.toHaveBeenCalled();
    expect(spies.artifactCreate).toHaveBeenCalledTimes(1);
  });

  // Storage-touching tests are todo'd. See file-top docstring "INFRA SURPRISE"
  // section for the root cause and suggested fixes.
  it.todo(
    'uploads BINARY/large content to storage and returns a storageKey [BLOCKED: supabase mock infra]',
  );

  it('rejects inlineContent > 256KB with a clear error', async () => {
    const { db, state } = makeFakeDb();
    seedWorkflow(state);
    const svc = new ArtifactService(db, fakeLog);

    const big = 'x'.repeat(256 * 1024 + 1);
    await expect(
      svc.createArtifact({
        tenantId: TENANT,
        workflowId: WORKFLOW,
        producedBy: USER,
        artifactType: 'final_output',
        fileName: 'big.txt',
        mimeType: 'text/plain',
        inlineContent: big,
      }),
    ).rejects.toThrow(/exceeds .* byte limit/);
  });

  it('requires exactly one of inlineContent or bytes', async () => {
    const { db, state } = makeFakeDb();
    seedWorkflow(state);
    const svc = new ArtifactService(db, fakeLog);

    await expect(
      svc.createArtifact({
        tenantId: TENANT,
        workflowId: WORKFLOW,
        producedBy: USER,
        artifactType: 'final_output',
        fileName: 'f.txt',
        mimeType: 'text/plain',
      } as any),
    ).rejects.toThrow(/exactly one of inlineContent or bytes/);

    await expect(
      svc.createArtifact({
        tenantId: TENANT,
        workflowId: WORKFLOW,
        producedBy: USER,
        artifactType: 'final_output',
        fileName: 'f.txt',
        mimeType: 'text/plain',
        inlineContent: 'a',
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow(/exactly one of inlineContent or bytes/);
  });

  it('writes the row with tenantId matching the caller (tenant scoping)', async () => {
    const { db, state } = makeFakeDb();
    seedWorkflow(state);
    const svc = new ArtifactService(db, fakeLog);

    const row = (await svc.createArtifact({
      tenantId: TENANT,
      workflowId: WORKFLOW,
      producedBy: USER,
      artifactType: 'final_output',
      fileName: 'a.txt',
      mimeType: 'text/plain',
      inlineContent: 'hello',
    })) as FakeArtifact;

    expect(row.tenantId).toBe(TENANT);
  });

  it('refuses to create when the workflow does not belong to the tenant', async () => {
    const { db, state } = makeFakeDb();
    // Workflow exists but under DIFFERENT tenant
    state.workflows.push({ id: WORKFLOW, tenantId: OTHER_TENANT });
    const svc = new ArtifactService(db, fakeLog);

    await expect(
      svc.createArtifact({
        tenantId: TENANT,
        workflowId: WORKFLOW,
        producedBy: USER,
        artifactType: 'final_output',
        fileName: 'x.txt',
        mimeType: 'text/plain',
        inlineContent: 'hi',
      }),
    ).rejects.toThrow(/not found in tenant/);
  });

  it('computes a sha256 contentHash and stores it on the row', async () => {
    const { db, state } = makeFakeDb();
    seedWorkflow(state);
    const svc = new ArtifactService(db, fakeLog);

    const content = 'deterministic';
    const row = (await svc.createArtifact({
      tenantId: TENANT,
      workflowId: WORKFLOW,
      producedBy: USER,
      artifactType: 'final_output',
      fileName: 'h.txt',
      mimeType: 'text/plain',
      inlineContent: content,
    })) as FakeArtifact;

    // sha256("deterministic") — pre-computed for stability
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update(content).digest('hex');
    expect(row.contentHash).toBe(expected);
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does NOT dedupe rows by contentHash — duplicate content yields two rows', async () => {
    // SURPRISE: only the storage BLOB is deduped (upsert:true with hash-keyed
    // filename). The DB row is always created. Pinning this so a future
    // "add row dedupe" change explicitly updates the test.
    const { db, state } = makeFakeDb();
    seedWorkflow(state);
    const svc = new ArtifactService(db, fakeLog);

    const args = {
      tenantId: TENANT,
      workflowId: WORKFLOW,
      producedBy: USER,
      artifactType: 'final_output',
      fileName: 'dup.txt',
      mimeType: 'text/plain',
      inlineContent: 'same content',
    };
    const a = (await svc.createArtifact(args)) as FakeArtifact;
    const b = (await svc.createArtifact(args)) as FakeArtifact;

    expect(a.id).not.toBe(b.id);
    expect(a.contentHash).toBe(b.contentHash);
    expect(state.artifacts).toHaveLength(2);
  });

  it.todo(
    'reuses the same hash-keyed storageKey for duplicate binary content [BLOCKED: supabase mock infra]',
  );

  it('persists approvalState=REQUIRES_APPROVAL when caller demands the gate', async () => {
    const { db, state } = makeFakeDb();
    seedWorkflow(state);
    const svc = new ArtifactService(db, fakeLog);

    const row = (await svc.createArtifact({
      tenantId: TENANT,
      workflowId: WORKFLOW,
      producedBy: USER,
      artifactType: 'redacted_export',
      fileName: 'pii.csv',
      mimeType: 'text/csv',
      inlineContent: 'name,email\nAlice,alice@x',
      approvalState: 'REQUIRES_APPROVAL',
    })) as FakeArtifact;

    expect(row.approvalState).toBe('REQUIRES_APPROVAL');
  });

  it('defaults approvalState to NOT_REQUIRED when omitted', async () => {
    const { db, state } = makeFakeDb();
    seedWorkflow(state);
    const svc = new ArtifactService(db, fakeLog);

    const row = (await svc.createArtifact({
      tenantId: TENANT,
      workflowId: WORKFLOW,
      producedBy: USER,
      artifactType: 'final_output',
      fileName: 'a.txt',
      mimeType: 'text/plain',
      inlineContent: 'hi',
    })) as FakeArtifact;

    expect(row.approvalState).toBe('NOT_REQUIRED');
  });

  // SURPRISE pinned as text: the source's storage-error path throws before
  // the row insert — it does NOT mark a row 'FAILED' as the brief asked. The
  // accompanying P1 todo records the gap. We can't drive the throw in this
  // file because we can't intercept the storage adapter (see infra note
  // above), so we record both the actual behaviour AND the gap as todos.
  it.todo(
    "SURPRISE: storage upload failure throws BEFORE row insert (no row created, no FAILED state) [BLOCKED: supabase mock infra]",
  );
  it.todo(
    "P1 — storage failure should leave a status='FAILED' audit row; source throws pre-insert today",
  );
  it.todo(
    "treats 'already exists' storage error as success (idempotent upsert) [BLOCKED: supabase mock infra]",
  );
});

describe('ArtifactService.getArtifact', () => {
  it('returns the row when tenant matches', async () => {
    const { db, state } = makeFakeDb();
    seedWorkflow(state);
    const svc = new ArtifactService(db, fakeLog);

    const created = (await svc.createArtifact({
      tenantId: TENANT,
      workflowId: WORKFLOW,
      producedBy: USER,
      artifactType: 'final_output',
      fileName: 'a.txt',
      mimeType: 'text/plain',
      inlineContent: 'hi',
    })) as FakeArtifact;

    const fetched = (await svc.getArtifact(created.id, TENANT)) as FakeArtifact;
    expect(fetched.id).toBe(created.id);
  });

  it('throws ArtifactNotFoundError on cross-tenant ID (no leak)', async () => {
    const { db, state } = makeFakeDb();
    seedWorkflow(state);
    const svc = new ArtifactService(db, fakeLog);

    const created = (await svc.createArtifact({
      tenantId: TENANT,
      workflowId: WORKFLOW,
      producedBy: USER,
      artifactType: 'final_output',
      fileName: 'a.txt',
      mimeType: 'text/plain',
      inlineContent: 'hi',
    })) as FakeArtifact;

    await expect(svc.getArtifact(created.id, OTHER_TENANT)).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    );
  });

  it('throws ArtifactNotFoundError for an unknown ID', async () => {
    const { db } = makeFakeDb();
    const svc = new ArtifactService(db, fakeLog);
    await expect(svc.getArtifact('art-does-not-exist', TENANT)).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    );
  });
});

describe('ArtifactService.requestSignedDownloadUrl (gate enforcement)', () => {
  async function makeArtifact(
    state: ReturnType<typeof makeFakeDb>['state'],
    overrides: Partial<FakeArtifact>,
  ): Promise<FakeArtifact> {
    const a: FakeArtifact = {
      id: `art-seed-${state.artifacts.length + 1}`,
      tenantId: TENANT,
      workflowId: WORKFLOW,
      taskId: null,
      producedBy: USER,
      artifactType: 'final_output',
      fileName: 'r.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      contentHash: 'a'.repeat(64),
      inlineContent: 'hello',
      storageKey: null,
      status: 'READY',
      approvalState: 'NOT_REQUIRED',
      parentId: null,
      metadata: null,
      deletedAt: null,
      lastDownloadedBy: null,
      lastDownloadedAt: null,
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date(),
      ...overrides,
    };
    state.artifacts.push(a);
    return a;
  }

  it('returns inline content when approvalState=APPROVED and inline body present', async () => {
    const { db, state } = makeFakeDb();
    const a = await makeArtifact(state, {
      inlineContent: 'cleared evidence',
      approvalState: 'APPROVED',
    });
    const svc = new ArtifactService(db, fakeLog);

    const result = await svc.requestSignedDownloadUrl({
      artifactId: a.id,
      tenantId: TENANT,
      requestedBy: USER,
    });
    expect(result).toEqual({ kind: 'inline', content: 'cleared evidence', mimeType: 'text/plain' });
  });

  it('returns NOT_REQUIRED inline content (no gate)', async () => {
    const { db, state } = makeFakeDb();
    const a = await makeArtifact(state, { approvalState: 'NOT_REQUIRED' });
    const svc = new ArtifactService(db, fakeLog);

    const result = await svc.requestSignedDownloadUrl({
      artifactId: a.id,
      tenantId: TENANT,
      requestedBy: USER,
    });
    expect((result as any).kind).toBe('inline');
  });

  it('throws ArtifactGatedError(reason=requires_approval) when approvalState=REQUIRES_APPROVAL', async () => {
    const { db, state } = makeFakeDb();
    const a = await makeArtifact(state, { approvalState: 'REQUIRES_APPROVAL' });
    const svc = new ArtifactService(db, fakeLog);

    await expect(
      svc.requestSignedDownloadUrl({
        artifactId: a.id,
        tenantId: TENANT,
        requestedBy: USER,
      }),
    ).rejects.toMatchObject({
      name: 'ArtifactGatedError',
      reason: 'requires_approval',
    });
    // Sanity: it's an instance of the exported error class, not just shaped.
    await expect(
      svc.requestSignedDownloadUrl({
        artifactId: a.id,
        tenantId: TENANT,
        requestedBy: USER,
      }),
    ).rejects.toBeInstanceOf(ArtifactGatedError);
  });

  it('throws ArtifactGatedError(reason=rejected) when approvalState=REJECTED', async () => {
    const { db, state } = makeFakeDb();
    const a = await makeArtifact(state, { approvalState: 'REJECTED' });
    const svc = new ArtifactService(db, fakeLog);

    await expect(
      svc.requestSignedDownloadUrl({
        artifactId: a.id,
        tenantId: TENANT,
        requestedBy: USER,
      }),
    ).rejects.toMatchObject({ name: 'ArtifactGatedError', reason: 'rejected' });
  });

  it.todo(
    'issues a signed URL for storage-backed APPROVED artifact [BLOCKED: supabase mock infra]',
  );

  it('refuses to sign a storageKey that does not start with the tenant prefix (defense-in-depth)', async () => {
    const { db, state } = makeFakeDb();
    // Row says it belongs to TENANT but the storageKey points at a path
    // owned by OTHER_TENANT. The defense-in-depth check must catch this.
    const a = await makeArtifact(state, {
      approvalState: 'APPROVED',
      inlineContent: null,
      storageKey: `${OTHER_TENANT}/${WORKFLOW}/abc123.pdf`,
    });
    const svc = new ArtifactService(db, fakeLog);

    await expect(
      svc.requestSignedDownloadUrl({
        artifactId: a.id,
        tenantId: TENANT,
        requestedBy: USER,
      }),
    ).rejects.toMatchObject({ name: 'ArtifactGatedError', reason: 'rejected' });
  });

  it('records lastDownloadedBy / lastDownloadedAt on a successful download', async () => {
    const { db, state, spies } = makeFakeDb();
    const a = await makeArtifact(state, { approvalState: 'APPROVED' });
    const svc = new ArtifactService(db, fakeLog);

    await svc.requestSignedDownloadUrl({
      artifactId: a.id,
      tenantId: TENANT,
      requestedBy: 'reviewer-bob',
    });

    expect(spies.artifactUpdate).toHaveBeenCalled();
    const updated = state.artifacts.find((x) => x.id === a.id)!;
    expect(updated.lastDownloadedBy).toBe('reviewer-bob');
    expect(updated.lastDownloadedAt).toBeInstanceOf(Date);
  });
});

describe('ArtifactService.setApprovalState', () => {
  it('flips REQUIRES_APPROVAL → APPROVED and stamps reviewer', async () => {
    const { db, state } = makeFakeDb();
    state.artifacts.push({
      id: 'art-pending',
      tenantId: TENANT,
      workflowId: WORKFLOW,
      taskId: null,
      producedBy: USER,
      artifactType: 'redacted_export',
      fileName: 'p.csv',
      mimeType: 'text/csv',
      sizeBytes: 1,
      contentHash: 'h',
      inlineContent: 'x',
      storageKey: null,
      status: 'READY',
      approvalState: 'REQUIRES_APPROVAL',
      parentId: null,
      metadata: null,
      deletedAt: null,
      lastDownloadedBy: null,
      lastDownloadedAt: null,
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date(),
    });
    const svc = new ArtifactService(db, fakeLog);

    await svc.setApprovalState({
      artifactId: 'art-pending',
      tenantId: TENANT,
      decision: 'APPROVED',
      reviewedBy: 'reviewer-1',
    });
    const after = state.artifacts.find((x) => x.id === 'art-pending')!;
    expect(after.approvalState).toBe('APPROVED');
    expect(after.approvedBy).toBe('reviewer-1');
    expect(after.approvedAt).toBeInstanceOf(Date);
  });
});

describe('ArtifactService.deleteArtifact (soft delete)', () => {
  it("sets status='DELETED' + deletedAt; subsequent getArtifact throws NotFound", async () => {
    const { db, state } = makeFakeDb();
    seedWorkflow(state);
    const svc = new ArtifactService(db, fakeLog);

    const created = (await svc.createArtifact({
      tenantId: TENANT,
      workflowId: WORKFLOW,
      producedBy: USER,
      artifactType: 'final_output',
      fileName: 'a.txt',
      mimeType: 'text/plain',
      inlineContent: 'hi',
    })) as FakeArtifact;

    await svc.deleteArtifact({ artifactId: created.id, tenantId: TENANT, deletedBy: USER });
    const persisted = state.artifacts.find((x) => x.id === created.id)!;
    expect(persisted.status).toBe('DELETED');
    expect(persisted.deletedAt).toBeInstanceOf(Date);

    await expect(svc.getArtifact(created.id, TENANT)).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    );
  });

  it.todo(
    'removes the storage object for storage-backed artifacts [BLOCKED: supabase mock infra]',
  );

  it.todo(
    'soft-deletes the row even when storage remove fails (non-fatal) [BLOCKED: supabase mock infra]',
  );
});

describe('ArtifactService.listArtifactsForWorkflow', () => {
  it('returns rows scoped to (workflowId, tenantId) with deletedAt:null', async () => {
    const { db, state, spies } = makeFakeDb();
    seedWorkflow(state);
    const svc = new ArtifactService(db, fakeLog);

    // Three live, one soft-deleted, one belonging to OTHER_TENANT.
    for (let i = 0; i < 3; i++) {
      await svc.createArtifact({
        tenantId: TENANT,
        workflowId: WORKFLOW,
        producedBy: USER,
        artifactType: 'final_output',
        fileName: `a-${i}.txt`,
        mimeType: 'text/plain',
        inlineContent: `payload-${i}`,
      });
    }
    // Soft-delete one
    const target = state.artifacts[0]!;
    await svc.deleteArtifact({ artifactId: target.id, tenantId: TENANT, deletedBy: USER });
    // Cross-tenant noise
    state.workflows.push({ id: WORKFLOW, tenantId: OTHER_TENANT });
    await svc.createArtifact({
      tenantId: OTHER_TENANT,
      workflowId: WORKFLOW,
      producedBy: USER,
      artifactType: 'final_output',
      fileName: 'evil.txt',
      mimeType: 'text/plain',
      inlineContent: 'evil',
    });

    const rows = (await svc.listArtifactsForWorkflow(WORKFLOW, TENANT)) as FakeArtifact[];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.tenantId).toBe(TENANT);
      expect(r.deletedAt).toBeNull();
    }
    // Verify the where clause shape — the deletedAt:null filter is the
    // load-bearing piece, so we assert on it directly.
    const firstCall = spies.artifactFindMany.mock.calls[0]![0];
    expect(firstCall.where).toMatchObject({
      workflowId: WORKFLOW,
      tenantId: TENANT,
      deletedAt: null,
    });
  });

  it.todo(
    "P2 — listArtifactsForWorkflow has no pagination cap; large workflows could OOM the API. Add `take` + cursor support.",
  );
});

describe('ArtifactService.healthCheck', () => {
  it('returns schemaPresent=true and a numeric rowCount when the table exists', async () => {
    const { db } = makeFakeDb();
    const svc = new ArtifactService(db, fakeLog);
    const result = await svc.healthCheck();
    expect(result.schemaPresent).toBe(true);
    expect(typeof result.rowCount).toBe('number');
  });

  it('returns schemaPresent=false on Prisma P2021 (table missing)', async () => {
    const { db } = makeFakeDb();
    db.workflowArtifact.count = vi.fn(async () => {
      const e: any = new Error('relation "workflow_artifacts" does not exist');
      e.code = 'P2021';
      throw e;
    });
    const svc = new ArtifactService(db, fakeLog);
    const result = await svc.healthCheck();
    expect(result.schemaPresent).toBe(false);
    expect(result.rowCount).toBeNull();
  });
});
