/**
 * Unit tests for apps/api/src/routes/documents.routes.ts
 *
 * Coverage strategy:
 *   - Upload + list + get + delete routes are exercised through Fastify-inject
 *     against an inline test app (auth/db/auditLog decorators stubbed).
 *   - The storage service is mocked at module-boundary so no Supabase touch.
 *   - Multipart bodies are constructed by hand from raw bytes (no FormData
 *     dependency required) so the @fastify/multipart parser sees a real
 *     RFC-7578 stream and runs its real code path.
 *   - DOCX / XLSX / image parser dispatch lives inside the fire-and-forget
 *     `ingestDocumentInBackground` helper (exported for testability), so we
 *     test that function directly with mocked dynamic imports rather than
 *     racing the upload route's `void` ingest call.
 *
 * Notes on what is NOT covered (with `it.todo` placeholders):
 *   - Real PDF parse (pdf-parse) and real Tesseract OCR — those need WASM
 *     workers and large fixtures; out of scope for a unit test.
 *   - Real PII detector / injection detector — covered by their own
 *     dedicated suites (unit/security/pii-detector.test.ts).
 *
 * Security notes:
 *   - The route enforces tenant scope plus uploader-or-REVIEWER+ delete
 *     authorization. Non-owner END_USER deletion is pinned as 403 below.
 *   - The route's mount path is `/upload` (POST) not `/`. The brief said
 *     `POST /documents`; the source registers `POST /upload`. Tests pin
 *     the source's actual paths.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Fastify + @fastify/multipart live in apps/api's node_modules (the tests
// workspace doesn't depend on them directly). Import via the apps/api
// package's resolution context so Node finds them without a tests-side
// dependency. The .js extension is what those packages publish to ESM.
import Fastify, { type FastifyInstance, type FastifyRequest } from '../../../apps/api/node_modules/fastify/fastify.js';
import multipart from '../../../apps/api/node_modules/@fastify/multipart/index.js';

const documentIngestorHarness = vi.hoisted(() => ({
  ingestText: vi.fn(async () => undefined),
  ingestPDF: vi.fn(async () => undefined),
}));

vi.mock('@jak-swarm/tools', () => ({
  DocumentIngestor: class {
    ingestText = documentIngestorHarness.ingestText;
    ingestPDF = documentIngestorHarness.ingestPDF;
  },
}));

function mockSecurityScan(options?: {
  containsPII?: boolean;
  found?: string[];
  injectionDetected?: boolean;
  injectionConfidence?: number;
}): void {
  const containsPII = options?.containsPII ?? false;
  const found = options?.found ?? [];
  const injectionDetected = options?.injectionDetected ?? false;
  const injectionConfidence = options?.injectionConfidence ?? 0;

  vi.doMock('@jak-swarm/security', () => ({
    getShieldGateway: () => ({
      scanInput: vi.fn(async (text: string) => ({
        source: 'local',
        pii: {
          containsPII,
          found,
          matches: [],
          redacted: text,
        },
        injection: {
          detected: injectionDetected,
          confidence: injectionConfidence,
          patterns: injectionDetected ? ['test-pattern'] : [],
          risk: injectionDetected ? 'HIGH' : 'LOW',
        },
        offensiveCyber: {
          detected: false,
          category: null,
          reason: null,
          confidence: 0,
          defensiveMarkers: 0,
        },
        blocked: injectionDetected,
        blockReasons: [],
      })),
    }),
  }));
}

// ─── Module-level mock of the storage service ───────────────────────────────
// Mirrors the strategy in tests/unit/api/documents-upload.test.ts: stub the
// service module so no Supabase Storage call is made.
//
// IMPORTANT: vi.mock factories are hoisted ABOVE all imports/consts, so the
// factory body cannot reference any module-level `const`. All values used
// inside the factory must be inlined.

vi.mock('../../../apps/api/src/services/storage.service.js', () => ({
  uploadTenantFile: vi.fn(async (opts: {
    tenantId: string;
    documentId: string;
    extension: string;
    mimeType: string;
    bytes: Uint8Array;
  }) => ({
    storageKey: `${opts.tenantId}/${opts.documentId}.${opts.extension}`,
    sizeBytes: opts.bytes.length,
    mimeType: opts.mimeType,
    contentHash: 'a'.repeat(64),
  })),
  createSignedReadUrl: vi.fn(async (opts: { tenantId: string; storageKey: string }) => {
    if (!opts.storageKey.startsWith(`${opts.tenantId}/`)) {
      throw new Error(`cross-tenant read refused: ${opts.storageKey}`);
    }
    return `https://stub.local/${opts.storageKey}?sig=test`;
  }),
  deleteTenantFile: vi.fn(async (_opts: { tenantId: string; storageKey: string }) => {
    /* no-op */
  }),
  ALLOWED_MIME_TYPES: new Set<string>([
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'image/webp',
  ]),
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
  BUCKET: 'tenant-documents',
}));

// Import AFTER the mock so the routes plugin sees the stub.
// eslint-disable-next-line import/first
import documentsRoutes, {
  ingestDocumentInBackground,
} from '../../../apps/api/src/routes/documents.routes.ts';

// ─── In-memory DB stub ──────────────────────────────────────────────────────
// Shaped like the slice of Prisma the route actually touches: tenantDocument
// (count/findMany/findUnique/create/update/delete) + vectorDocument.deleteMany
// + $transaction. Nothing else is needed.

interface FakeDoc {
  id: string;
  tenantId: string;
  uploadedBy: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  status: string;
  tags: string[];
  metadata: Record<string, unknown> | null | undefined;
  contentHash: string | null;
  ingestionError: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakeDb() {
  const docs: FakeDoc[] = [];
  let idSeq = 0;

  function nextId(): string {
    idSeq += 1;
    return `doc_${String(idSeq).padStart(4, '0')}`;
  }

  // Predicate evaluator that mimics the subset of Prisma `where` we actually use.
  function matches(doc: FakeDoc, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k === 'deletedAt') {
        if (v === null && doc.deletedAt !== null) return false;
        if (v instanceof Date && (doc.deletedAt === null || +doc.deletedAt !== +v)) return false;
        continue;
      }
      // Direct scalar equality
      if (k in doc && (doc as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
  }

  const tenantDocument = {
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return docs.filter((d) => matches(d, where)).length;
    }),
    findMany: vi.fn(
      async ({
        where,
        take,
        skip,
        orderBy,
      }: {
        where: Record<string, unknown>;
        take?: number;
        skip?: number;
        orderBy?: { createdAt: 'asc' | 'desc' };
      }) => {
        let rows = docs.filter((d) => matches(d, where));
        if (orderBy?.createdAt === 'desc') {
          rows = rows.slice().sort((a, b) => +b.createdAt - +a.createdAt);
        } else if (orderBy?.createdAt === 'asc') {
          rows = rows.slice().sort((a, b) => +a.createdAt - +b.createdAt);
        }
        if (typeof skip === 'number') rows = rows.slice(skip);
        if (typeof take === 'number') rows = rows.slice(0, take);
        return rows;
      },
    ),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return docs.find((d) => d.id === where.id) ?? null;
    }),
    create: vi.fn(
      async ({ data }: { data: Partial<FakeDoc> & { tenantId: string; fileName: string } }) => {
        const now = new Date();
        const doc: FakeDoc = {
          id: nextId(),
          tenantId: data.tenantId,
          uploadedBy: data.uploadedBy ?? 'unknown',
          fileName: data.fileName,
          mimeType: data.mimeType ?? 'application/octet-stream',
          sizeBytes: data.sizeBytes ?? 0,
          storageKey: data.storageKey ?? '',
          status: data.status ?? 'PENDING',
          tags: data.tags ?? [],
          metadata: data.metadata ?? null,
          contentHash: null,
          ingestionError: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        docs.push(doc);
        return doc;
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeDoc>;
      }) => {
        const doc = docs.find((d) => d.id === where.id);
        if (!doc) throw new Error(`No row with id ${where.id}`);
        Object.assign(doc, data, { updatedAt: new Date() });
        return doc;
      },
    ),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const idx = docs.findIndex((d) => d.id === where.id);
      if (idx < 0) throw new Error(`No row with id ${where.id}`);
      const [removed] = docs.splice(idx, 1);
      return removed;
    }),
  };

  const vectorDocument = {
    deleteMany: vi.fn(
      async (_args: { where: { tenantId: string; documentId: string } }) => ({ count: 0 }),
    ),
  };

  return {
    docs,
    tenantDocument,
    vectorDocument,
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    $reset(): void {
      docs.length = 0;
      idSeq = 0;
    },
  };
}

// ─── Auth identity injected on each inject() call via a fastify.authenticate
// stub. Tests mutate `currentUser` to simulate different callers. ───────────

let currentUser: {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
} = {
  userId: 'user_alice',
  tenantId: 'tenant-A',
  role: 'TENANT_ADMIN',
  email: 'alice@a.com',
};

const auditLogCalls: Array<{
  action: string;
  resource: string;
  resourceId: string;
  details: unknown;
}> = [];

async function buildTestApp(db: ReturnType<typeof makeFakeDb>): Promise<FastifyInstance> {
  // `logger: false` keeps test output quiet; bodyLimit covers max payload
  // headroom (multipart's per-file limit is set inside the route handler).
  const app = Fastify({ logger: false, bodyLimit: 30 * 1024 * 1024 });

  await app.register(multipart);

  // Decorate with the symbols the route handler uses.
  app.decorate('db', db);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    (request as unknown as { user: typeof currentUser }).user = currentUser;
  });
  app.decorate(
    'auditLog',
    async (
      _request: FastifyRequest,
      action: string,
      resource: string,
      resourceId: string,
      details: unknown,
    ) => {
      auditLogCalls.push({ action, resource, resourceId, details });
    },
  );

  // Map AppError → JSON envelope (the real app does this in a global error
  // handler; we reproduce just enough to assert status + code).
  app.setErrorHandler((error, _req, reply) => {
    const e = error as unknown as {
      statusCode?: number;
      code?: string;
      message?: string;
      details?: unknown;
    };
    const status = e.statusCode ?? 500;
    return reply.status(status).send({
      success: false,
      error: {
        code: e.code ?? 'INTERNAL',
        message: e.message ?? 'Internal Server Error',
        details: e.details,
      },
    });
  });

  await app.register(documentsRoutes, { prefix: '/documents' });
  await app.ready();
  return app;
}

// ─── Multipart body builder (no FormData dependency) ────────────────────────
// Builds a raw RFC-7578 multipart/form-data payload so @fastify/multipart's
// real parser runs end-to-end during inject().

interface MultipartFilePart {
  kind: 'file';
  fieldName: string;
  filename: string;
  contentType: string;
  data: Buffer;
}
interface MultipartTextPart {
  kind: 'text';
  fieldName: string;
  value: string;
}
type MultipartPart = MultipartFilePart | MultipartTextPart;

function buildMultipart(parts: MultipartPart[]): { body: Buffer; headers: Record<string, string> } {
  const boundary = `----vitestBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
  const CRLF = '\r\n';
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}${CRLF}`, 'utf8'));
    if (p.kind === 'file') {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.fieldName}"; filename="${p.filename}"${CRLF}` +
            `Content-Type: ${p.contentType}${CRLF}${CRLF}`,
          'utf8',
        ),
      );
      chunks.push(p.data);
      chunks.push(Buffer.from(CRLF, 'utf8'));
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.fieldName}"${CRLF}${CRLF}${p.value}${CRLF}`,
          'utf8',
        ),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf8'));
  const body = Buffer.concat(chunks);
  return {
    body,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
  };
}

// ─── Test fixtures ──────────────────────────────────────────────────────────

const PDF_MAGIC = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\nfake pdf body for tests', 'binary');

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('documents.routes — POST /documents/upload', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeFakeDb>;

  beforeEach(async () => {
    db = makeFakeDb();
    auditLogCalls.length = 0;
    currentUser = {
      userId: 'user_alice',
      tenantId: 'tenant-A',
      role: 'TENANT_ADMIN',
      email: 'alice@a.com',
    };
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
  });

  it('happy path: PDF upload creates row with status=PENDING + signed storage key', async () => {
    const { body, headers } = buildMultipart([
      {
        kind: 'file',
        fieldName: 'file',
        filename: 'contract.pdf',
        contentType: 'application/pdf',
        data: PDF_MAGIC,
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers,
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const parsed = JSON.parse(res.payload) as {
      success: boolean;
      data: FakeDoc;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.data.status).toBe('PENDING');
    expect(parsed.data.fileName).toBe('contract.pdf');
    expect(parsed.data.mimeType).toBe('application/pdf');
    // storageKey is rewritten by the storage stub to <tenantId>/<docId>.<ext>
    expect(parsed.data.storageKey).toMatch(/^tenant-A\/doc_\d+\.pdf$/);
    expect(parsed.data.contentHash).toMatch(/^[a-f0-9]{64}$/);

    // DB now holds the row + audit log fired
    expect(db.docs).toHaveLength(1);
    expect(auditLogCalls.find((c) => c.action === 'UPLOAD_DOCUMENT')).toBeDefined();
  });

  it('non-multipart (JSON) body → 400/415-class error (multipart parser refuses)', async () => {
    // The route immediately hits `request.parts()` which throws when the
    // content-type isn't multipart. Fastify converts that into a 4xx — we
    // assert "definitely not 2xx" rather than pinning a single code, since
    // @fastify/multipart's exact code (FST_INVALID_MULTIPART_CONTENT_TYPE,
    // 406) is an internal contract that may shift across minor versions.
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ hello: 'world' }),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    // No row should have been created
    expect(db.docs).toHaveLength(0);
  });

  it('file too large → upload fails with 4xx/5xx (multipart limit triggers)', async () => {
    // Push past MAX_FILE_SIZE_BYTES (25MB) to hit @fastify/multipart's
    // `fileSize` limit set inside the route. We use 26MB of zeros — well
    // over the cap. The exact status depends on how multipart surfaces
    // the limit (RequestFileTooLargeError → 413), but at minimum it must
    // not return 201 + must not persist a row beyond rollback.
    const tooBig = Buffer.alloc(26 * 1024 * 1024, 0);
    const { body, headers } = buildMultipart([
      {
        kind: 'file',
        fieldName: 'file',
        filename: 'huge.pdf',
        contentType: 'application/pdf',
        data: tooBig,
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers,
      payload: body,
    });

    expect(res.statusCode).not.toBe(201);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    // Either rolled-back (delete called by upload-failure path) OR never
    // persisted at all. Both are acceptable; what's NOT acceptable is a
    // surviving row.
    const survivors = db.docs.filter((d) => d.fileName === 'huge.pdf');
    expect(survivors).toHaveLength(0);
  });

  it('unsupported MIME type (e.g. application/x-msdownload .exe) → 415', async () => {
    // SURPRISE CHECK from the brief: confirms the route does NOT happily
    // ingest an executable. The MIME allowlist gates this honestly.
    const { body, headers } = buildMultipart([
      {
        kind: 'file',
        fieldName: 'file',
        filename: 'evil.exe',
        contentType: 'application/x-msdownload',
        data: Buffer.from('MZ\x90\x00fakeExe'),
      },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(415);
    const parsed = JSON.parse(res.payload) as { error: { code: string } };
    expect(parsed.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('invalid metadataJson → 422 with INVALID_METADATA_JSON', async () => {
    const { body, headers } = buildMultipart([
      { kind: 'text', fieldName: 'metadataJson', value: '{not valid json' },
      {
        kind: 'file',
        fieldName: 'file',
        filename: 'a.pdf',
        contentType: 'application/pdf',
        data: PDF_MAGIC,
      },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    const parsed = JSON.parse(res.payload) as { error: { code: string } };
    expect(parsed.error.code).toBe('INVALID_METADATA_JSON');
  });

  it('missing file part → 422 NO_FILE', async () => {
    const { body, headers } = buildMultipart([
      { kind: 'text', fieldName: 'tags', value: 'just-text' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    const parsed = JSON.parse(res.payload) as { error: { code: string } };
    expect(parsed.error.code).toBe('NO_FILE');
  });

  it('parses comma-separated `tags` field into a string[] on the row', async () => {
    const { body, headers } = buildMultipart([
      { kind: 'text', fieldName: 'tags', value: 'legal, Q2 ,nda, ' },
      {
        kind: 'file',
        fieldName: 'file',
        filename: 'nda.pdf',
        contentType: 'application/pdf',
        data: PDF_MAGIC,
      },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(db.docs[0]?.tags).toEqual(['legal', 'Q2', 'nda']);
  });

  it('valid metadataJson is parsed and stored as canonical JSON', async () => {
    const { body, headers } = buildMultipart([
      { kind: 'text', fieldName: 'metadataJson', value: '{"author":"Alice","year":2026}' },
      {
        kind: 'file',
        fieldName: 'file',
        filename: 'a.pdf',
        contentType: 'application/pdf',
        data: PDF_MAGIC,
      },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(db.docs[0]?.metadata).toEqual({ author: 'Alice', year: 2026 });
  });

  it('tenant scoping: created row inherits caller `tenantId`', async () => {
    currentUser = {
      userId: 'user_bob',
      tenantId: 'tenant-B',
      role: 'OPERATOR',
      email: 'bob@b.com',
    };
    const { body, headers } = buildMultipart([
      {
        kind: 'file',
        fieldName: 'file',
        filename: 'b.pdf',
        contentType: 'application/pdf',
        data: PDF_MAGIC,
      },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(db.docs[0]?.tenantId).toBe('tenant-B');
    expect(db.docs[0]?.uploadedBy).toBe('user_bob');
    expect(db.docs[0]?.storageKey.startsWith('tenant-B/')).toBe(true);
  });

  it('hits 429 DOCUMENT_QUOTA_EXCEEDED when active count is at the soft cap', async () => {
    // Pre-seed 500 active docs for the tenant — the route's first-check.
    for (let i = 0; i < 500; i++) {
      await db.tenantDocument.create({
        data: {
          tenantId: 'tenant-A',
          uploadedBy: 'seed',
          fileName: `seed-${i}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1,
          storageKey: `tenant-A/seed-${i}`,
          status: 'INDEXED',
          tags: [],
        },
      });
    }
    const { body, headers } = buildMultipart([
      {
        kind: 'file',
        fieldName: 'file',
        filename: 'overflow.pdf',
        contentType: 'application/pdf',
        data: PDF_MAGIC,
      },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(429);
    const parsed = JSON.parse(res.payload) as { error: { code: string } };
    expect(parsed.error.code).toBe('DOCUMENT_QUOTA_EXCEEDED');
  });

  // PII detection in the route lives behind the dynamic `@jak-swarm/security`
  // import inside ingestDocumentInBackground (NOT in the upload route itself).
  // The covering test for that branch lives below in the
  // `ingestDocumentInBackground` block.
  it.todo('PII detection on upload (covered by ingest test, not route test)');
});

describe('documents.routes — GET /documents (list)', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeFakeDb>;

  beforeEach(async () => {
    db = makeFakeDb();
    currentUser = {
      userId: 'user_alice',
      tenantId: 'tenant-A',
      role: 'TENANT_ADMIN',
      email: 'alice@a.com',
    };
    // Seed: 3 docs in tenant-A, 1 in tenant-B, 1 soft-deleted in tenant-A
    await db.tenantDocument.create({
      data: {
        tenantId: 'tenant-A',
        uploadedBy: 'u1',
        fileName: 'a1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        storageKey: 'tenant-A/a1',
        status: 'INDEXED',
        tags: [],
      },
    });
    await db.tenantDocument.create({
      data: {
        tenantId: 'tenant-A',
        uploadedBy: 'u1',
        fileName: 'a2.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 200,
        storageKey: 'tenant-A/a2',
        status: 'PENDING',
        tags: [],
      },
    });
    await db.tenantDocument.create({
      data: {
        tenantId: 'tenant-A',
        uploadedBy: 'u1',
        fileName: 'a3.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 300,
        storageKey: 'tenant-A/a3',
        status: 'INDEXED',
        tags: [],
      },
    });
    await db.tenantDocument.create({
      data: {
        tenantId: 'tenant-B',
        uploadedBy: 'u9',
        fileName: 'b1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 400,
        storageKey: 'tenant-B/b1',
        status: 'INDEXED',
        tags: [],
      },
    });
    const trash = await db.tenantDocument.create({
      data: {
        tenantId: 'tenant-A',
        uploadedBy: 'u1',
        fileName: 'deleted.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 500,
        storageKey: 'tenant-A/deleted',
        status: 'INDEXED',
        tags: [],
      },
    });
    await db.tenantDocument.update({
      where: { id: trash.id },
      data: { deletedAt: new Date(), status: 'DELETED' },
    });
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns only the caller tenants active docs (tenant scope + deletedAt filter)', async () => {
    const res = await app.inject({ method: 'GET', url: '/documents/' });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.payload) as {
      success: boolean;
      data: { items: FakeDoc[]; total: number; limit: number; offset: number };
    };
    expect(parsed.success).toBe(true);
    expect(parsed.data.total).toBe(3); // 3 active in tenant-A
    expect(parsed.data.items).toHaveLength(3);
    for (const item of parsed.data.items) {
      expect(item.tenantId).toBe('tenant-A');
      expect(item.deletedAt).toBeNull();
    }
  });

  it('respects ?limit and ?offset (pagination-bounded)', async () => {
    const res = await app.inject({ method: 'GET', url: '/documents/?limit=2&offset=1' });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.payload) as {
      data: { items: FakeDoc[]; total: number; limit: number; offset: number };
    };
    expect(parsed.data.limit).toBe(2);
    expect(parsed.data.offset).toBe(1);
    expect(parsed.data.items).toHaveLength(2);
  });

  it('rejects ?limit > 100 with 422 VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'GET', url: '/documents/?limit=500' });
    expect(res.statusCode).toBe(422);
    const parsed = JSON.parse(res.payload) as { error: { code: string } };
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
  });

  it('?status=PENDING filters to that status only', async () => {
    const res = await app.inject({ method: 'GET', url: '/documents/?status=PENDING' });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.payload) as { data: { items: FakeDoc[] } };
    expect(parsed.data.items.every((d) => d.status === 'PENDING')).toBe(true);
    expect(parsed.data.items).toHaveLength(1);
  });
});

describe('documents.routes — GET /documents/:id', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeFakeDb>;
  let docA: FakeDoc;
  let docDeleted: FakeDoc;

  beforeEach(async () => {
    db = makeFakeDb();
    currentUser = {
      userId: 'user_alice',
      tenantId: 'tenant-A',
      role: 'TENANT_ADMIN',
      email: 'alice@a.com',
    };
    docA = await db.tenantDocument.create({
      data: {
        tenantId: 'tenant-A',
        uploadedBy: 'u1',
        fileName: 'a1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        storageKey: 'tenant-A/a1.pdf',
        status: 'INDEXED',
        tags: [],
      },
    });
    await db.tenantDocument.create({
      data: {
        tenantId: 'tenant-B',
        uploadedBy: 'u9',
        fileName: 'b1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 400,
        storageKey: 'tenant-B/b1.pdf',
        status: 'INDEXED',
        tags: [],
      },
    });
    docDeleted = await db.tenantDocument.create({
      data: {
        tenantId: 'tenant-A',
        uploadedBy: 'u1',
        fileName: 'gone.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        storageKey: 'tenant-A/gone.pdf',
        status: 'DELETED',
        tags: [],
      },
    });
    await db.tenantDocument.update({
      where: { id: docDeleted.id },
      data: { deletedAt: new Date() },
    });
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
  });

  it('happy path: returns the doc + signedUrl + signedUrlExpiresIn=3600', async () => {
    const res = await app.inject({ method: 'GET', url: `/documents/${docA.id}` });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.payload) as {
      data: FakeDoc & { signedUrl: string; signedUrlExpiresIn: number };
    };
    expect(parsed.data.id).toBe(docA.id);
    expect(parsed.data.signedUrl).toContain(docA.storageKey);
    expect(parsed.data.signedUrlExpiresIn).toBe(3600);
  });

  it('cross-tenant access → 404 (treats foreign rows as not-found... actually 403)', async () => {
    // Source explicitly throws ForbiddenError on tenant mismatch (403),
    // not NotFound. Pinning the source's actual behaviour here.
    // List the foreign id by scanning db.docs.
    const foreignDoc = db.docs.find((d) => d.tenantId === 'tenant-B');
    expect(foreignDoc).toBeDefined();
    const res = await app.inject({ method: 'GET', url: `/documents/${foreignDoc!.id}` });
    expect(res.statusCode).toBe(403);
    const parsed = JSON.parse(res.payload) as { error: { code: string } };
    expect(parsed.error.code).toBe('FORBIDDEN');
  });

  it('soft-deleted doc → 404 (deletedAt gating)', async () => {
    const res = await app.inject({ method: 'GET', url: `/documents/${docDeleted.id}` });
    expect(res.statusCode).toBe(404);
    const parsed = JSON.parse(res.payload) as { error: { code: string } };
    expect(parsed.error.code).toBe('NOT_FOUND');
  });

  it('totally unknown id → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/documents/doc_does_not_exist' });
    expect(res.statusCode).toBe(404);
  });

  // The brief mentions GET /documents/:id/content but the source does NOT
  // implement that route — only :id (which embeds the signedUrl). Pin the
  // source's actual surface; flag the brief mismatch.
  it.todo(
    'GET /documents/:id/content — NOT IMPLEMENTED in source. Brief asks for it; source has no /content sub-route. Flag as a brief/source mismatch.',
  );
});

describe('documents.routes — DELETE /documents/:id', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeFakeDb>;
  let docA: FakeDoc;

  beforeEach(async () => {
    db = makeFakeDb();
    currentUser = {
      userId: 'user_alice',
      tenantId: 'tenant-A',
      role: 'TENANT_ADMIN',
      email: 'alice@a.com',
    };
    docA = await db.tenantDocument.create({
      data: {
        tenantId: 'tenant-A',
        uploadedBy: 'user_alice',
        fileName: 'a1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        storageKey: 'tenant-A/a1.pdf',
        status: 'INDEXED',
        tags: [],
      },
    });
    auditLogCalls.length = 0;
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
  });

  it('soft-deletes (sets deletedAt + status=DELETED; row remains for audit)', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/documents/${docA.id}` });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.payload) as { data: { id: string; deleted: boolean } };
    expect(parsed.data.deleted).toBe(true);

    // Row is still in the table, just soft-deleted
    const row = db.docs.find((d) => d.id === docA.id);
    expect(row).toBeDefined();
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.status).toBe('DELETED');

    // VectorDocument cleanup ran
    expect(db.vectorDocument.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-A', documentId: docA.id },
    });

    // Audit log fired
    expect(auditLogCalls.find((c) => c.action === 'DELETE_DOCUMENT')).toBeDefined();
  });

  it('cross-tenant delete → 403 FORBIDDEN', async () => {
    const foreign = await db.tenantDocument.create({
      data: {
        tenantId: 'tenant-B',
        uploadedBy: 'u9',
        fileName: 'b1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 400,
        storageKey: 'tenant-B/b1.pdf',
        status: 'INDEXED',
        tags: [],
      },
    });
    const res = await app.inject({ method: 'DELETE', url: `/documents/${foreign.id}` });
    expect(res.statusCode).toBe(403);
    // Foreign row untouched
    expect(db.docs.find((d) => d.id === foreign.id)?.deletedAt).toBeNull();
  });

  it('already-deleted doc → 404', async () => {
    await db.tenantDocument.update({
      where: { id: docA.id },
      data: { deletedAt: new Date() },
    });
    const res = await app.inject({ method: 'DELETE', url: `/documents/${docA.id}` });
    expect(res.statusCode).toBe(404);
  });

  it('non-owner same-tenant: REVIEWER can soft-delete', async () => {
    // REVIEWER+ can delete tenant documents even when they are not the uploader.
    currentUser = {
      userId: 'user_charlie', // different from uploadedBy=user_alice
      tenantId: 'tenant-A',
      role: 'REVIEWER',
      email: 'charlie@a.com',
    };
    const res = await app.inject({ method: 'DELETE', url: `/documents/${docA.id}` });
    expect(res.statusCode).toBe(200);
    expect(db.docs.find((d) => d.id === docA.id)?.deletedAt).toBeInstanceOf(Date);
  });

  it('non-owner same-tenant: END_USER cannot soft-delete another user document', async () => {
    currentUser = {
      userId: 'user_charlie', // different from uploadedBy=user_alice
      tenantId: 'tenant-A',
      role: 'END_USER',
      email: 'charlie@a.com',
    };
    const res = await app.inject({ method: 'DELETE', url: `/documents/${docA.id}` });
    expect(res.statusCode).toBe(403);
    expect(db.docs.find((d) => d.id === docA.id)?.deletedAt).toBeNull();
  });
});

// ─── Background ingestion: parser dispatch ──────────────────────────────────
// These tests target the exported `ingestDocumentInBackground` directly so we
// can mock `parseByMimeType` + the @jak-swarm/* dynamic imports without racing
// the upload route's `void` dispatch.

describe('ingestDocumentInBackground — parser dispatch by MIME type', () => {
  // Helper: build a minimal fastify-shaped object with a mutable doc map.
  function makeIngestStub(doc: {
    id: string;
    tenantId: string;
    fileName: string;
    mimeType: string;
    storageKey: string;
  }): {
    db: {
      tenantDocument: {
        findUnique: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
    };
    log: { error: ReturnType<typeof vi.fn> };
    state: { lastUpdate: { where: { id: string }; data: Record<string, unknown> } | null };
  } {
    const state: { lastUpdate: { where: { id: string }; data: Record<string, unknown> } | null } = {
      lastUpdate: null,
    };
    return {
      db: {
        tenantDocument: {
          findUnique: vi.fn(async (_args: { where: { id: string } }) => doc),
          update: vi.fn(
            async (args: { where: { id: string }; data: Record<string, unknown> }) => {
              state.lastUpdate = args;
              return { ...doc, ...args.data };
            },
          ),
        },
      },
      log: { error: vi.fn() },
      state,
    };
  }

  beforeEach(() => {
    vi.resetModules();
    documentIngestorHarness.ingestText = vi.fn(async () => undefined);
    documentIngestorHarness.ingestPDF = vi.fn(async () => undefined);
    vi.doMock('../../../apps/api/src/services/storage.service.js', () => ({
      createSignedReadUrl: vi.fn(async (opts: { tenantId: string; storageKey: string }) => {
        if (!opts.storageKey.startsWith(`${opts.tenantId}/`)) {
          throw new Error(`cross-tenant read refused: ${opts.storageKey}`);
        }
        return `https://stub.local/${opts.storageKey}?sig=test`;
      }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@jak-swarm/security');
    vi.doUnmock('../../../apps/api/src/services/document-parsing/parsers.js');
  });

  it('DOCX upload routes through parseByMimeType + ingestText with mammoth diagnostics', async () => {
    const ingestText = documentIngestorHarness.ingestText;
    const parseByMimeType = vi.fn(async (_mime: string, _bytes: Buffer) => ({
      text: 'Hello from a Word document.',
      parseConfidence: 0.95,
      diagnostics: { parser: 'docx-mammoth' as const, notes: ['mammoth ok'] },
    }));
    vi.doMock('../../../apps/api/src/services/document-parsing/parsers.js', () => ({
      parseByMimeType,
    }));
    mockSecurityScan();
    // Intercept the in-helper signed-URL fetch.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer, // DOCX magic
      })),
    );

    const stub = makeIngestStub({
      id: 'doc_d1',
      tenantId: 'tenant-A',
      fileName: 'spec.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      storageKey: 'tenant-A/doc_d1.docx',
    });

    await ingestDocumentInBackground(stub, 'doc_d1');

    expect(parseByMimeType).toHaveBeenCalledWith(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      expect.any(Buffer),
    );
    expect(ingestText).toHaveBeenCalledWith(
      'tenant-A',
      'Hello from a Word document.',
      expect.objectContaining({
        documentId: 'doc_d1',
        metadata: expect.objectContaining({
          parser: 'docx-mammoth',
          parseConfidence: 0.95,
        }),
      }),
    );
    expect(stub.state.lastUpdate?.data.status).toBe('INDEXED');
  });

  it('XLSX upload routes through parseByMimeType + ingestText with exceljs diagnostics', async () => {
    const ingestText = documentIngestorHarness.ingestText;
    const parseByMimeType = vi.fn(async (_m: string, _b: Buffer) => ({
      text: '## Sheet: Q1\nA1\tB1\nA2\tB2',
      parseConfidence: 0.85,
      diagnostics: { parser: 'xlsx-exceljs' as const, notes: ['1 sheet, 2 rows'] },
    }));
    vi.doMock('../../../apps/api/src/services/document-parsing/parsers.js', () => ({
      parseByMimeType,
    }));
    mockSecurityScan();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer,
      })),
    );

    const stub = makeIngestStub({
      id: 'doc_x1',
      tenantId: 'tenant-A',
      fileName: 'numbers.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      storageKey: 'tenant-A/doc_x1.xlsx',
    });

    await ingestDocumentInBackground(stub, 'doc_x1');

    expect(parseByMimeType).toHaveBeenCalled();
    const ingestArgs = ingestText.mock.calls[0];
    expect(ingestArgs?.[1]).toContain('Sheet: Q1');
    expect(
      (ingestArgs?.[2] as { metadata: { parser: string; parseConfidence: number } }).metadata,
    ).toEqual(
      expect.objectContaining({ parser: 'xlsx-exceljs', parseConfidence: 0.85 }),
    );
    expect(stub.state.lastUpdate?.data.status).toBe('INDEXED');
  });

  it('JPEG/PNG upload routes through tesseract; parseConfidence ≤ 0.7', async () => {
    const ingestText = documentIngestorHarness.ingestText;
    const parseByMimeType = vi.fn(async (_m: string, _b: Buffer) => ({
      text: 'OCR scrape from a noisy receipt image',
      parseConfidence: 0.55,
      diagnostics: {
        parser: 'image-tesseract' as const,
        notes: ['avg word confidence 0.55'],
      },
    }));
    vi.doMock('../../../apps/api/src/services/document-parsing/parsers.js', () => ({
      parseByMimeType,
    }));
    mockSecurityScan();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer, // JPEG magic
      })),
    );

    const stub = makeIngestStub({
      id: 'doc_i1',
      tenantId: 'tenant-A',
      fileName: 'receipt.jpg',
      mimeType: 'image/jpeg',
      storageKey: 'tenant-A/doc_i1.jpg',
    });

    await ingestDocumentInBackground(stub, 'doc_i1');

    expect(parseByMimeType).toHaveBeenCalledWith('image/jpeg', expect.any(Buffer));
    const meta = (
      ingestText.mock.calls[0]?.[2] as { metadata: { parser: string; parseConfidence: number } }
    ).metadata;
    expect(meta.parser).toBe('image-tesseract');
    expect(meta.parseConfidence).toBeLessThanOrEqual(0.7);
    expect(stub.state.lastUpdate?.data.status).toBe('INDEXED');
  });

  it('PII text → ingestionError contains a "PII:" warning string but status is still INDEXED', async () => {
    // The route's policy is "log + warn, don't block" — confirm both halves.
    vi.doMock('../../../apps/api/src/services/document-parsing/parsers.js', () => ({
      parseByMimeType: vi.fn(async () => ({
        text: 'Contact alice@example.com or call 555-12-3456 for details',
        parseConfidence: 0.95,
        diagnostics: { parser: 'docx-mammoth' as const, notes: [] },
      })),
    }));
    mockSecurityScan({ containsPII: true, found: ['EMAIL', 'SSN'] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([0x50, 0x4b]).buffer,
      })),
    );

    const stub = makeIngestStub({
      id: 'doc_p1',
      tenantId: 'tenant-A',
      fileName: 'pii.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      storageKey: 'tenant-A/doc_p1.docx',
    });
    await ingestDocumentInBackground(stub, 'doc_p1');

    expect(stub.state.lastUpdate?.data.status).toBe('INDEXED');
    expect(String(stub.state.lastUpdate?.data.ingestionError)).toMatch(/PII/);
    expect(String(stub.state.lastUpdate?.data.ingestionError)).toMatch(/EMAIL/);
  });

  it('parser throws → status=STORED_NOT_PARSED with diagnostic', async () => {
    vi.doMock('../../../apps/api/src/services/document-parsing/parsers.js', () => ({
      parseByMimeType: vi.fn(async () => {
        throw new Error('OOM during OCR');
      }),
    }));
    mockSecurityScan();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([0xff, 0xd8]).buffer,
      })),
    );

    const stub = makeIngestStub({
      id: 'doc_e1',
      tenantId: 'tenant-A',
      fileName: 'corrupt.png',
      mimeType: 'image/png',
      storageKey: 'tenant-A/doc_e1.png',
    });
    await ingestDocumentInBackground(stub, 'doc_e1');

    expect(stub.state.lastUpdate?.data.status).toBe('STORED_NOT_PARSED');
    expect(String(stub.state.lastUpdate?.data.ingestionError)).toMatch(/OOM/);
  });

  it('parseByMimeType returns null (unknown mime family) → STORED_NOT_PARSED honestly', async () => {
    vi.doMock('../../../apps/api/src/services/document-parsing/parsers.js', () => ({
      parseByMimeType: vi.fn(async () => null),
    }));
    mockSecurityScan();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([0]).buffer,
      })),
    );

    const stub = makeIngestStub({
      id: 'doc_z1',
      tenantId: 'tenant-A',
      fileName: 'song.mp3',
      mimeType: 'audio/mpeg',
      storageKey: 'tenant-A/doc_z1.mp3',
    });
    await ingestDocumentInBackground(stub, 'doc_z1');

    expect(stub.state.lastUpdate?.data.status).toBe('STORED_NOT_PARSED');
    expect(String(stub.state.lastUpdate?.data.ingestionError)).toMatch(
      /Content parsing not implemented/,
    );
  });

  // PDF + Tesseract real-runtime tests deliberately deferred. PDF needs
  // pdf-parse + a real PDF fixture; Tesseract WASM workers are heavy and
  // sandbox-flaky. Covered by integration suites instead.
  it.todo('PDF upload (real pdf-parse + DocumentIngestor.ingestPDF) — needs real Postgres + WASM');
  it.todo('Tesseract OCR end-to-end — needs WASM workers + a real image fixture');
});
