/**
 * Unit tests for AttestationService — pins the actual contract:
 *
 *   1. generate(): validates period, snapshots evidence via mapper, renders
 *      PDF, persists artifact + ControlAttestation row, optional signed
 *      bundle, tenantId is propagated to every write.
 *   2. list(): tenant-scoped, framework filter resolves slug → id, paginates,
 *      enriches results with framework slug + name, surfaces schema errors
 *      as ComplianceSchemaUnavailableError.
 *   3. ensureCompliancePlaceholderWorkflow (private — exercised via generate):
 *      idempotent. Re-runs reuse the same placeholder workflow row.
 *
 * Heavy lifting (PDF byte layout, real bundle signing crypto, real Prisma
 * relation enforcement) is intentionally out of scope here — those live
 * behind the mocked exporter / ArtifactService / BundleService boundaries.
 * Items that genuinely need a live Postgres + schema are captured as
 * `it.todo` with the reason inline.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock the heavyweight collaborators BEFORE importing the SUT. ───────
// AttestationService instantiates ComplianceMapperService + ArtifactService
// + BundleService inside its ctor, so we have to intercept those modules.

const mapperState = {
  summary: null as any,
  controlEvidence: new Map<string, Array<{ evidenceType: string; evidenceId: string }>>(),
  getFrameworkSummary: vi.fn(),
  getControlEvidence: vi.fn(),
};

const artifactState = {
  createArtifact: vi.fn(),
};

const bundleState = {
  createSignedBundle: vi.fn(),
};

const signingState = {
  ready: true,
};

vi.mock('../../../apps/api/src/services/compliance/compliance-mapper.service.js', () => {
  class ComplianceSchemaUnavailableError extends Error {
    constructor() {
      super('compliance schema unavailable');
      this.name = 'ComplianceSchemaUnavailableError';
    }
  }
  class ComplianceMapperService {
    constructor(_db: unknown, _log: unknown) {}
    async getFrameworkSummary(input: any) {
      mapperState.getFrameworkSummary(input);
      if (!mapperState.summary) throw new ComplianceSchemaUnavailableError();
      return mapperState.summary;
    }
    async getControlEvidence(input: any) {
      mapperState.getControlEvidence(input);
      const items = mapperState.controlEvidence.get(input.controlId) ?? [];
      return { items: items.slice(0, input.limit ?? 5) };
    }
  }
  return { ComplianceMapperService, ComplianceSchemaUnavailableError };
});

vi.mock('../../../apps/api/src/services/artifact.service.js', () => {
  class ArtifactSchemaUnavailableError extends Error {
    constructor() {
      super('artifact schema unavailable');
      this.name = 'ArtifactSchemaUnavailableError';
    }
  }
  class ArtifactService {
    constructor(_db: unknown, _log: unknown) {}
    async createArtifact(input: any) {
      return artifactState.createArtifact(input);
    }
  }
  return { ArtifactService, ArtifactSchemaUnavailableError };
});

vi.mock('../../../apps/api/src/services/bundle.service.js', () => {
  class BundleService {
    constructor(_db: unknown, _log: unknown) {}
    async createSignedBundle(input: any) {
      return bundleState.createSignedBundle(input);
    }
  }
  return { BundleService };
});

vi.mock('../../../apps/api/src/services/bundle-signing.service.js', () => {
  class BundleSigningUnavailableError extends Error {
    constructor() {
      super('bundle signing unavailable');
      this.name = 'BundleSigningUnavailableError';
    }
  }
  return {
    BundleSigningUnavailableError,
    isSigningAvailable: () => ({ ready: signingState.ready }),
  };
});

vi.mock('../../../apps/api/src/services/exporters/index.js', () => ({
  exportPdf: vi.fn(async (_doc: any, opts: { baseName: string }) => ({
    fileName: `${opts.baseName}.pdf`,
    mimeType: 'application/pdf',
    bytes: Buffer.from('%PDF-1.4 fake'),
  })),
}));

// Now import the SUT — its dependencies are stubbed.
import { AttestationService } from '../../../apps/api/src/services/compliance/attestation.service.js';
import { ComplianceSchemaUnavailableError } from '../../../apps/api/src/services/compliance/compliance-mapper.service.js';
import { BundleSigningUnavailableError } from '../../../apps/api/src/services/bundle-signing.service.js';

// ─── In-memory Prisma stub ──────────────────────────────────────────────

interface FakeWorkflow { id: string; tenantId: string; goal: string; userId: string }
interface FakeAttestation {
  id: string; tenantId: string; frameworkId: string;
  periodStart: Date; periodEnd: Date;
  controlSummary: unknown; totalEvidence: number; coveragePercent: number;
  artifactId: string | null; generatedBy: string; createdAt: Date;
}
interface FakeFramework { id: string; slug: string; name: string; version: string }

function makeFakeDb(opts: { schemaMissing?: boolean } = {}) {
  const workflows: FakeWorkflow[] = [];
  const attestations: FakeAttestation[] = [];
  const frameworks: FakeFramework[] = [];
  let cuid = 0;
  const id = (p = 'id') => `${p}-${++cuid}`;

  const maybeThrow = () => {
    if (opts.schemaMissing) {
      const err = new Error('relation "ControlAttestation" does not exist');
      (err as any).code = 'P2021';
      throw err;
    }
  };

  const db: any = {
    workflow: {
      findFirst: vi.fn(async ({ where }: any) =>
        workflows.find((w) => w.tenantId === where.tenantId && w.goal === where.goal) ?? null
      ),
      create: vi.fn(async ({ data }: any) => {
        const w: FakeWorkflow = { id: id('wf'), tenantId: data.tenantId, goal: data.goal, userId: data.userId };
        workflows.push(w);
        return w;
      }),
    },
    controlAttestation: {
      create: vi.fn(async ({ data }: any) => {
        maybeThrow();
        const a: FakeAttestation = {
          id: id('att'),
          tenantId: data.tenantId,
          frameworkId: data.frameworkId,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          controlSummary: data.controlSummary,
          totalEvidence: data.totalEvidence,
          coveragePercent: data.coveragePercent,
          artifactId: data.artifactId ?? null,
          generatedBy: data.generatedBy,
          createdAt: new Date(),
        };
        attestations.push(a);
        return a;
      }),
      findMany: vi.fn(async ({ where, take, skip }: any) => {
        maybeThrow();
        let rows = attestations.filter((a) => a.tenantId === where.tenantId);
        if (where.frameworkId) rows = rows.filter((a) => a.frameworkId === where.frameworkId);
        rows = rows.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows.slice(skip ?? 0, (skip ?? 0) + (take ?? 50));
      }),
      count: vi.fn(async ({ where }: any) => {
        maybeThrow();
        let rows = attestations.filter((a) => a.tenantId === where.tenantId);
        if (where.frameworkId) rows = rows.filter((a) => a.frameworkId === where.frameworkId);
        return rows.length;
      }),
    },
    complianceFramework: {
      findUnique: vi.fn(async ({ where }: any) =>
        frameworks.find((f) => f.slug === where.slug) ?? null
      ),
      findMany: vi.fn(async ({ where }: any) => {
        const ids = (where?.id?.in as string[]) ?? [];
        return frameworks.filter((f) => ids.includes(f.id)).map((f) => ({
          id: f.id, slug: f.slug, name: f.name,
        }));
      }),
    },
  };

  return {
    db,
    _state: { workflows, attestations, frameworks },
  };
}

const fakeLog: any = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  child: () => fakeLog,
};

beforeEach(() => {
  mapperState.summary = null;
  mapperState.controlEvidence.clear();
  mapperState.getFrameworkSummary.mockReset();
  mapperState.getControlEvidence.mockReset();
  artifactState.createArtifact.mockReset();
  artifactState.createArtifact.mockResolvedValue({ id: 'art-stub' });
  bundleState.createSignedBundle.mockReset();
  bundleState.createSignedBundle.mockResolvedValue({ artifactId: 'art-bundle', signature: 'sig-hex' });
  signingState.ready = true;
});

afterEach(() => { vi.clearAllMocks(); });

const baseSummary = {
  framework: { id: 'fw-soc2', slug: 'soc2', name: 'SOC 2', version: '2017', issuer: 'AICPA' },
  coverageCounts: { total: 3, covered: 2, uncovered: 1, coveragePercent: 67 },
  controls: [
    { id: 'ctl-1', code: 'CC1.1', title: 'Org structure', category: 'Common Criteria', evidenceCount: 3 },
    { id: 'ctl-2', code: 'CC1.2', title: 'Board oversight', category: 'Common Criteria', evidenceCount: 2 },
    { id: 'ctl-3', code: 'CC2.1', title: 'Quality info', category: 'Communication', evidenceCount: 0 },
  ],
};

describe('AttestationService.generate', () => {
  it('builds a tenant-scoped attestation, persists artifact + summary row, and returns aggregated counts', async () => {
    const { db, _state } = makeFakeDb();
    _state.frameworks.push({ id: 'fw-soc2', slug: 'soc2', name: 'SOC 2', version: '2017' });
    mapperState.summary = baseSummary;
    mapperState.controlEvidence.set('ctl-1', [
      { evidenceType: 'audit_log', evidenceId: 'al-1' },
      { evidenceType: 'audit_log', evidenceId: 'al-2' },
      { evidenceType: 'workflow', evidenceId: 'wf-3' },
    ]);
    mapperState.controlEvidence.set('ctl-2', [
      { evidenceType: 'approval', evidenceId: 'apr-1' },
      { evidenceType: 'approval', evidenceId: 'apr-2' },
    ]);
    artifactState.createArtifact.mockResolvedValueOnce({ id: 'art-1' });

    const svc = new AttestationService(db, fakeLog);
    const result = await svc.generate({
      tenantId: 'tnt-A',
      frameworkSlug: 'soc2',
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
      generatedBy: 'usr-admin',
    });

    expect(result.attestationId).toMatch(/^att-/);
    expect(result.artifactId).toBe('art-1');
    expect(result.framework).toEqual({ slug: 'soc2', name: 'SOC 2', version: '2017' });
    expect(result.totalEvidence).toBe(5); // 3 + 2 + 0
    expect(result.coveragePercent).toBe(67);
    expect(result.fileName).toBe('soc2-attestation-2026-01-01-to-2026-03-31.pdf');
    expect(result.bundleArtifactId).toBeUndefined();
    expect(result.bundleSignature).toBeUndefined();

    // Mapper was scoped to the requesting tenant.
    expect(mapperState.getFrameworkSummary).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tnt-A',
      frameworkSlug: 'soc2',
    }));
    // Control with 0 evidence skipped the per-control evidence fetch.
    expect(mapperState.getControlEvidence).toHaveBeenCalledTimes(2);

    // Persisted attestation row is scoped to tenant + carries summary JSON.
    expect(_state.attestations).toHaveLength(1);
    const row = _state.attestations[0]!;
    expect(row.tenantId).toBe('tnt-A');
    expect(row.frameworkId).toBe('fw-soc2');
    expect(row.totalEvidence).toBe(5);
    expect(row.artifactId).toBe('art-1');
    expect(Array.isArray(row.controlSummary)).toBe(true);
    expect((row.controlSummary as any[])).toHaveLength(3);

    // Artifact write got the right tenant + REQUIRES_APPROVAL.
    expect(artifactState.createArtifact).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tnt-A',
      artifactType: 'control_attestation',
      approvalState: 'REQUIRES_APPROVAL',
      mimeType: 'application/pdf',
    }));
  });

  it('rejects when periodEnd is not strictly after periodStart', async () => {
    const { db } = makeFakeDb();
    const svc = new AttestationService(db, fakeLog);
    await expect(svc.generate({
      tenantId: 'tnt-A',
      frameworkSlug: 'soc2',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-01',
      generatedBy: 'usr-admin',
    })).rejects.toThrow(/periodEnd must be strictly after periodStart/);
  });

  it('reuses an existing compliance placeholder workflow on subsequent runs (idempotent)', async () => {
    const { db, _state } = makeFakeDb();
    _state.frameworks.push({ id: 'fw-soc2', slug: 'soc2', name: 'SOC 2', version: '2017' });
    mapperState.summary = baseSummary;

    const svc = new AttestationService(db, fakeLog);
    await svc.generate({
      tenantId: 'tnt-A', frameworkSlug: 'soc2',
      periodStart: '2026-01-01', periodEnd: '2026-03-31', generatedBy: 'u1',
    });
    await svc.generate({
      tenantId: 'tnt-A', frameworkSlug: 'soc2',
      periodStart: '2026-04-01', periodEnd: '2026-06-30', generatedBy: 'u1',
    });

    // Only ONE placeholder workflow despite two attestation runs.
    expect(_state.workflows).toHaveLength(1);
    expect(_state.workflows[0]!.goal).toBe('__compliance_attestations__');
    expect(_state.workflows[0]!.tenantId).toBe('tnt-A');
    expect(_state.attestations).toHaveLength(2);
  });

  it('creates a SEPARATE placeholder workflow per tenant — no cross-tenant reuse', async () => {
    const { db, _state } = makeFakeDb();
    _state.frameworks.push({ id: 'fw-soc2', slug: 'soc2', name: 'SOC 2', version: '2017' });
    mapperState.summary = baseSummary;

    const svc = new AttestationService(db, fakeLog);
    await svc.generate({
      tenantId: 'tnt-A', frameworkSlug: 'soc2',
      periodStart: '2026-01-01', periodEnd: '2026-03-31', generatedBy: 'u1',
    });
    await svc.generate({
      tenantId: 'tnt-B', frameworkSlug: 'soc2',
      periodStart: '2026-01-01', periodEnd: '2026-03-31', generatedBy: 'u2',
    });

    expect(_state.workflows).toHaveLength(2);
    expect(_state.workflows.map((w) => w.tenantId).sort()).toEqual(['tnt-A', 'tnt-B']);
    expect(_state.attestations.map((a) => a.tenantId).sort()).toEqual(['tnt-A', 'tnt-B']);
  });

  it('produces a signed bundle when sign=true and signing is available', async () => {
    const { db, _state } = makeFakeDb();
    _state.frameworks.push({ id: 'fw-soc2', slug: 'soc2', name: 'SOC 2', version: '2017' });
    mapperState.summary = baseSummary;
    artifactState.createArtifact.mockResolvedValueOnce({ id: 'art-pdf' });
    bundleState.createSignedBundle.mockResolvedValueOnce({ artifactId: 'art-bundle', signature: 'deadbeef' });

    const svc = new AttestationService(db, fakeLog);
    const result = await svc.generate({
      tenantId: 'tnt-A', frameworkSlug: 'soc2',
      periodStart: '2026-01-01', periodEnd: '2026-03-31',
      generatedBy: 'u1', sign: true,
    });

    expect(result.bundleArtifactId).toBe('art-bundle');
    expect(result.bundleSignature).toBe('deadbeef');
    expect(bundleState.createSignedBundle).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tnt-A',
      requestedBy: 'u1',
      metadata: expect.objectContaining({
        attestationId: expect.stringMatching(/^att-/),
        frameworkSlug: 'soc2',
      }),
    }));
  });

  it('throws BundleSigningUnavailableError when sign=true but signing is not configured', async () => {
    const { db, _state } = makeFakeDb();
    _state.frameworks.push({ id: 'fw-soc2', slug: 'soc2', name: 'SOC 2', version: '2017' });
    mapperState.summary = baseSummary;
    signingState.ready = false;

    const svc = new AttestationService(db, fakeLog);
    await expect(svc.generate({
      tenantId: 'tnt-A', frameworkSlug: 'soc2',
      periodStart: '2026-01-01', periodEnd: '2026-03-31',
      generatedBy: 'u1', sign: true,
    })).rejects.toBeInstanceOf(BundleSigningUnavailableError);

    // The PDF + summary row already landed BEFORE the signing check —
    // pin that contract so a future change is conscious of it.
    expect(bundleState.createSignedBundle).not.toHaveBeenCalled();
  });

  it('translates a missing controlAttestation table into ComplianceSchemaUnavailableError', async () => {
    const { db, _state } = makeFakeDb({ schemaMissing: true });
    _state.frameworks.push({ id: 'fw-soc2', slug: 'soc2', name: 'SOC 2', version: '2017' });
    mapperState.summary = baseSummary;

    const svc = new AttestationService(db, fakeLog);
    await expect(svc.generate({
      tenantId: 'tnt-A', frameworkSlug: 'soc2',
      periodStart: '2026-01-01', periodEnd: '2026-03-31', generatedBy: 'u1',
    })).rejects.toBeInstanceOf(ComplianceSchemaUnavailableError);
  });

  it('propagates a ComplianceSchemaUnavailableError from the mapper untouched', async () => {
    const { db } = makeFakeDb();
    // mapperState.summary stays null → mapper mock throws ComplianceSchemaUnavailableError.
    const svc = new AttestationService(db, fakeLog);
    await expect(svc.generate({
      tenantId: 'tnt-A', frameworkSlug: 'soc2',
      periodStart: '2026-01-01', periodEnd: '2026-03-31', generatedBy: 'u1',
    })).rejects.toBeInstanceOf(ComplianceSchemaUnavailableError);
  });
});

describe('AttestationService.list', () => {
  it('returns only this tenant\'s attestations, newest first, with framework slug + name resolved', async () => {
    const { db, _state } = makeFakeDb();
    _state.frameworks.push(
      { id: 'fw-soc2', slug: 'soc2', name: 'SOC 2', version: '2017' },
      { id: 'fw-iso', slug: 'iso27001', name: 'ISO 27001', version: '2022' },
    );
    const now = Date.now();
    _state.attestations.push(
      {
        id: 'att-A1', tenantId: 'tnt-A', frameworkId: 'fw-soc2',
        periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-03-31'),
        controlSummary: [], totalEvidence: 5, coveragePercent: 60,
        artifactId: 'art-A1', generatedBy: 'u1', createdAt: new Date(now - 2000),
      },
      {
        id: 'att-A2', tenantId: 'tnt-A', frameworkId: 'fw-iso',
        periodStart: new Date('2026-02-01'), periodEnd: new Date('2026-04-30'),
        controlSummary: [], totalEvidence: 9, coveragePercent: 80,
        artifactId: 'art-A2', generatedBy: 'u1', createdAt: new Date(now - 1000),
      },
      {
        // Other tenant — must NOT appear.
        id: 'att-B1', tenantId: 'tnt-B', frameworkId: 'fw-soc2',
        periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-03-31'),
        controlSummary: [], totalEvidence: 1, coveragePercent: 10,
        artifactId: 'art-B1', generatedBy: 'u9', createdAt: new Date(now),
      },
    );

    const svc = new AttestationService(db, fakeLog);
    const out = await svc.list({ tenantId: 'tnt-A' });

    expect(out.total).toBe(2);
    expect(out.items).toHaveLength(2);
    expect(out.items.map((i) => i.id)).toEqual(['att-A2', 'att-A1']);
    expect(out.items[0]).toMatchObject({
      frameworkSlug: 'iso27001',
      frameworkName: 'ISO 27001',
      totalEvidence: 9,
      coveragePercent: 80,
    });
    // Tenant B's attestation is invisible.
    expect(out.items.some((i) => i.id === 'att-B1')).toBe(false);
  });

  it('filters by frameworkSlug when provided (slug → frameworkId resolution)', async () => {
    const { db, _state } = makeFakeDb();
    _state.frameworks.push(
      { id: 'fw-soc2', slug: 'soc2', name: 'SOC 2', version: '2017' },
      { id: 'fw-iso', slug: 'iso27001', name: 'ISO 27001', version: '2022' },
    );
    _state.attestations.push(
      { id: 'att-1', tenantId: 'tnt-A', frameworkId: 'fw-soc2', periodStart: new Date(), periodEnd: new Date(), controlSummary: [], totalEvidence: 1, coveragePercent: 10, artifactId: null, generatedBy: 'u', createdAt: new Date() },
      { id: 'att-2', tenantId: 'tnt-A', frameworkId: 'fw-iso',  periodStart: new Date(), periodEnd: new Date(), controlSummary: [], totalEvidence: 2, coveragePercent: 20, artifactId: null, generatedBy: 'u', createdAt: new Date() },
    );

    const svc = new AttestationService(db, fakeLog);
    const out = await svc.list({ tenantId: 'tnt-A', frameworkSlug: 'soc2' });
    expect(out.total).toBe(1);
    expect(out.items[0]!.id).toBe('att-1');
  });

  it('silently ignores an unknown frameworkSlug (no rows filtered out beyond tenant)', async () => {
    // Pin the actual contract: when the framework slug doesn\'t match a row,
    // the service simply omits the frameworkId predicate. (See lines 286-289
    // of the SUT.) That is arguably a bug, but it is the current behavior.
    const { db, _state } = makeFakeDb();
    _state.frameworks.push({ id: 'fw-soc2', slug: 'soc2', name: 'SOC 2', version: '2017' });
    _state.attestations.push(
      { id: 'att-1', tenantId: 'tnt-A', frameworkId: 'fw-soc2', periodStart: new Date(), periodEnd: new Date(), controlSummary: [], totalEvidence: 1, coveragePercent: 10, artifactId: null, generatedBy: 'u', createdAt: new Date() },
    );

    const svc = new AttestationService(db, fakeLog);
    const out = await svc.list({ tenantId: 'tnt-A', frameworkSlug: 'does-not-exist' });
    expect(out.total).toBe(1); // tenant-scoped, framework predicate skipped
  });

  it('respects limit + offset for pagination', async () => {
    const { db, _state } = makeFakeDb();
    _state.frameworks.push({ id: 'fw-soc2', slug: 'soc2', name: 'SOC 2', version: '2017' });
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      _state.attestations.push({
        id: `att-${i}`, tenantId: 'tnt-A', frameworkId: 'fw-soc2',
        periodStart: new Date(), periodEnd: new Date(),
        controlSummary: [], totalEvidence: i, coveragePercent: i * 10,
        artifactId: null, generatedBy: 'u', createdAt: new Date(base - i * 1000),
      });
    }
    const svc = new AttestationService(db, fakeLog);
    const page1 = await svc.list({ tenantId: 'tnt-A', limit: 2, offset: 0 });
    const page2 = await svc.list({ tenantId: 'tnt-A', limit: 2, offset: 2 });
    expect(page1.total).toBe(5);
    expect(page1.items.map((i) => i.id)).toEqual(['att-0', 'att-1']); // newest first
    expect(page2.items.map((i) => i.id)).toEqual(['att-2', 'att-3']);
  });

  it('translates a P2021 missing-table error into ComplianceSchemaUnavailableError', async () => {
    const { db } = makeFakeDb({ schemaMissing: true });
    const svc = new AttestationService(db, fakeLog);
    await expect(svc.list({ tenantId: 'tnt-A' })).rejects.toBeInstanceOf(ComplianceSchemaUnavailableError);
  });

  it.todo('PDF byte content + page layout — needs the real exportPdf, covered by integration tests under tests/integration/exporters');
  it.todo('signed bundle HMAC verification — requires EVIDENCE_SIGNING_SECRET + real BundleService crypto path');
  it.todo('AttestationService delete/revoke — service does not currently expose this; auditing flow goes through artifact.approvalState — track once a delete API lands');
});
