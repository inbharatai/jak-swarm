/**
 * Unit tests for ManualEvidenceService — pins the actual contract:
 *
 *   - create(): validates required fields, validates control exists, validates
 *               attached artifact belongs to the tenant, persists ManualEvidence
 *               + companion ControlEvidenceMapping in 'manual' source.
 *               If the mapping upsert fails, the evidence row is kept and the
 *               returned mappingId is the sentinel '__deferred__'.
 *   - list(): tenant-scoped + control-scoped, soft-deleted rows excluded.
 *   - delete(): soft-deletes (deletedAt stamp), removes the companion mapping,
 *               throws ManualEvidenceNotFoundError when the row is in another
 *               tenant or already soft-deleted.
 *   - schema-missing errors translate to ComplianceSchemaUnavailableError.
 *
 * The service does NOT implement approve/reject — the route layer enforces
 * REVIEWER+ permissions and stamps approvalState on the attached artifact.
 * Pin that with `it.todo` so future readers don't think it's missing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../apps/api/src/services/compliance/compliance-mapper.service.js', () => {
  class ComplianceSchemaUnavailableError extends Error {
    constructor() {
      super('compliance schema unavailable');
      this.name = 'ComplianceSchemaUnavailableError';
    }
  }
  return { ComplianceSchemaUnavailableError };
});

import {
  ManualEvidenceService,
  ManualEvidenceNotFoundError,
} from '../../../apps/api/src/services/compliance/manual-evidence.service.js';
import { ComplianceSchemaUnavailableError } from '../../../apps/api/src/services/compliance/compliance-mapper.service.js';

// ─── In-memory Prisma stub ──────────────────────────────────────────────

interface FakeControl { id: string }
interface FakeArtifact { id: string; tenantId: string }
interface FakeManualEvidence {
  id: string; tenantId: string; controlId: string;
  title: string; description: string;
  attachedArtifactId: string | null;
  createdBy: string; evidenceAt: Date; createdAt: Date;
  deletedAt: Date | null;
}
interface FakeMapping {
  id: string; tenantId: string; controlId: string;
  evidenceType: string; evidenceId: string;
  evidenceAt: Date; mappedBy: string | null; mappingSource: string; notes: string | null;
}

interface MakeOpts {
  schemaMissingOnEvidence?: boolean;
  failMappingUpsert?: boolean;
}

function makeFakeDb(opts: MakeOpts = {}) {
  const controls: FakeControl[] = [];
  const artifacts: FakeArtifact[] = [];
  const evidences: FakeManualEvidence[] = [];
  const mappings: FakeMapping[] = [];
  let cuid = 0;
  const id = (p = 'id') => `${p}-${++cuid}`;

  const schemaMissing = () => {
    const err = new Error('relation "ManualEvidence" does not exist');
    (err as any).code = 'P2021';
    return err;
  };

  const db: any = {
    complianceControl: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (opts.schemaMissingOnEvidence) throw schemaMissing();
        return controls.find((c) => c.id === where.id) ?? null;
      }),
    },
    workflowArtifact: {
      findFirst: vi.fn(async ({ where }: any) =>
        artifacts.find((a) => a.id === where.id && a.tenantId === where.tenantId) ?? null
      ),
    },
    manualEvidence: {
      create: vi.fn(async ({ data }: any) => {
        if (opts.schemaMissingOnEvidence) throw schemaMissing();
        const me: FakeManualEvidence = {
          id: id('me'),
          tenantId: data.tenantId,
          controlId: data.controlId,
          title: data.title,
          description: data.description,
          attachedArtifactId: data.attachedArtifactId ?? null,
          createdBy: data.createdBy,
          evidenceAt: data.evidenceAt,
          createdAt: new Date(),
          deletedAt: null,
        };
        evidences.push(me);
        return me;
      }),
      findFirst: vi.fn(async ({ where }: any) =>
        evidences.find((e) =>
          e.id === where.id &&
          e.tenantId === where.tenantId &&
          (where.deletedAt === null ? e.deletedAt === null : true)
        ) ?? null
      ),
      findMany: vi.fn(async ({ where, take, skip, orderBy }: any) => {
        let rows = evidences.filter((e) =>
          e.tenantId === where.tenantId &&
          e.controlId === where.controlId &&
          (where.deletedAt === null ? e.deletedAt === null : true)
        );
        if (orderBy?.evidenceAt === 'desc') {
          rows = rows.slice().sort((a, b) => b.evidenceAt.getTime() - a.evidenceAt.getTime());
        }
        return rows.slice(skip ?? 0, (skip ?? 0) + (take ?? 50));
      }),
      count: vi.fn(async ({ where }: any) =>
        evidences.filter((e) =>
          e.tenantId === where.tenantId &&
          e.controlId === where.controlId &&
          (where.deletedAt === null ? e.deletedAt === null : true)
        ).length
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const e = evidences.find((x) => x.id === where.id);
        if (!e) throw new Error('not found');
        Object.assign(e, data);
        return e;
      }),
    },
    controlEvidenceMapping: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        if (opts.failMappingUpsert) throw new Error('mapping upsert exploded');
        const composite = where.tenantId_controlId_evidenceType_evidenceId;
        const found = mappings.find((m) =>
          m.tenantId === composite.tenantId &&
          m.controlId === composite.controlId &&
          m.evidenceType === composite.evidenceType &&
          m.evidenceId === composite.evidenceId
        );
        if (found) {
          Object.assign(found, update);
          return found;
        }
        const m: FakeMapping = {
          id: id('map'),
          tenantId: create.tenantId,
          controlId: create.controlId,
          evidenceType: create.evidenceType,
          evidenceId: create.evidenceId,
          evidenceAt: create.evidenceAt,
          mappedBy: create.mappedBy ?? null,
          mappingSource: create.mappingSource,
          notes: create.notes ?? null,
        };
        mappings.push(m);
        return m;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = mappings.length;
        for (let i = mappings.length - 1; i >= 0; i--) {
          const m = mappings[i]!;
          if (
            m.tenantId === where.tenantId &&
            m.controlId === where.controlId &&
            m.evidenceType === where.evidenceType &&
            m.evidenceId === where.evidenceId
          ) {
            mappings.splice(i, 1);
          }
        }
        return { count: before - mappings.length };
      }),
    },
  };

  return { db, _state: { controls, artifacts, evidences, mappings } };
}

const fakeLog: any = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  child: () => fakeLog,
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.clearAllMocks(); });

describe('ManualEvidenceService.create', () => {
  it('persists tenant-scoped manual evidence + companion mapping with mappingSource="manual"', async () => {
    const { db, _state } = makeFakeDb();
    _state.controls.push({ id: 'ctl-1' });

    const svc = new ManualEvidenceService(db, fakeLog);
    const result = await svc.create({
      tenantId: 'tnt-A',
      controlId: 'ctl-1',
      title: 'Quarterly access review attestation',
      description: 'Reviewed all 23 active users; 1 disabled.',
      createdBy: 'usr-reviewer',
    });

    expect(result.id).toMatch(/^me-/);
    expect(result.mappingId).toMatch(/^map-/);

    expect(_state.evidences).toHaveLength(1);
    const ev = _state.evidences[0]!;
    expect(ev.tenantId).toBe('tnt-A');
    expect(ev.controlId).toBe('ctl-1');
    expect(ev.title).toBe('Quarterly access review attestation');
    expect(ev.deletedAt).toBeNull();

    expect(_state.mappings).toHaveLength(1);
    const map = _state.mappings[0]!;
    expect(map).toMatchObject({
      tenantId: 'tnt-A',
      controlId: 'ctl-1',
      evidenceType: 'manual_evidence',
      evidenceId: ev.id,
      mappingSource: 'manual',
      mappedBy: 'usr-reviewer',
      notes: 'Quarterly access review attestation',
    });
  });

  it('honors a custom evidenceAt date when provided', async () => {
    const { db, _state } = makeFakeDb();
    _state.controls.push({ id: 'ctl-1' });
    const at = new Date('2026-01-15T10:00:00Z');

    const svc = new ManualEvidenceService(db, fakeLog);
    await svc.create({
      tenantId: 'tnt-A', controlId: 'ctl-1',
      title: 't', description: 'd',
      createdBy: 'u',
      evidenceAt: at,
    });

    expect(_state.evidences[0]!.evidenceAt.toISOString()).toBe(at.toISOString());
    expect(_state.mappings[0]!.evidenceAt.toISOString()).toBe(at.toISOString());
  });

  it('rejects when required fields are missing', async () => {
    const { db } = makeFakeDb();
    const svc = new ManualEvidenceService(db, fakeLog);
    await expect(svc.create({
      tenantId: '', controlId: 'ctl-1', title: 't', description: 'd', createdBy: 'u',
    } as any)).rejects.toThrow(/tenantId, controlId, title, description are all required/);
    await expect(svc.create({
      tenantId: 'tnt', controlId: '', title: 't', description: 'd', createdBy: 'u',
    } as any)).rejects.toThrow(/required/);
    await expect(svc.create({
      tenantId: 'tnt', controlId: 'c', title: '', description: 'd', createdBy: 'u',
    } as any)).rejects.toThrow(/required/);
    await expect(svc.create({
      tenantId: 'tnt', controlId: 'c', title: 't', description: '', createdBy: 'u',
    } as any)).rejects.toThrow(/required/);
  });

  it('throws ManualEvidenceNotFoundError when the control does not exist', async () => {
    const { db } = makeFakeDb();
    const svc = new ManualEvidenceService(db, fakeLog);
    await expect(svc.create({
      tenantId: 'tnt-A', controlId: 'ctl-missing',
      title: 't', description: 'd', createdBy: 'u',
    })).rejects.toBeInstanceOf(ManualEvidenceNotFoundError);
  });

  it('refuses to attach an artifact owned by a different tenant', async () => {
    const { db, _state } = makeFakeDb();
    _state.controls.push({ id: 'ctl-1' });
    _state.artifacts.push({ id: 'art-foreign', tenantId: 'tnt-B' });

    const svc = new ManualEvidenceService(db, fakeLog);
    await expect(svc.create({
      tenantId: 'tnt-A', controlId: 'ctl-1',
      title: 't', description: 'd', createdBy: 'u',
      attachedArtifactId: 'art-foreign',
    })).rejects.toThrow(/Artifact art-foreign not found in tenant tnt-A/);

    expect(_state.evidences).toHaveLength(0);
    expect(_state.mappings).toHaveLength(0);
  });

  it('accepts an attached artifact owned by the same tenant', async () => {
    const { db, _state } = makeFakeDb();
    _state.controls.push({ id: 'ctl-1' });
    _state.artifacts.push({ id: 'art-mine', tenantId: 'tnt-A' });

    const svc = new ManualEvidenceService(db, fakeLog);
    const r = await svc.create({
      tenantId: 'tnt-A', controlId: 'ctl-1',
      title: 't', description: 'd', createdBy: 'u',
      attachedArtifactId: 'art-mine',
    });
    expect(r.id).toMatch(/^me-/);
    expect(_state.evidences[0]!.attachedArtifactId).toBe('art-mine');
  });

  it('returns mappingId="__deferred__" if the companion mapping upsert fails (evidence row still created)', async () => {
    const { db, _state } = makeFakeDb({ failMappingUpsert: true });
    _state.controls.push({ id: 'ctl-1' });

    const svc = new ManualEvidenceService(db, fakeLog);
    const r = await svc.create({
      tenantId: 'tnt-A', controlId: 'ctl-1',
      title: 't', description: 'd', createdBy: 'u',
    });

    expect(r.mappingId).toBe('__deferred__');
    expect(_state.evidences).toHaveLength(1); // evidence persisted
    expect(_state.mappings).toHaveLength(0);   // mapping rolled back
    expect(fakeLog.warn).toHaveBeenCalled();
  });

  it('translates a P2021 missing-table error into ComplianceSchemaUnavailableError', async () => {
    const { db, _state } = makeFakeDb({ schemaMissingOnEvidence: true });
    _state.controls.push({ id: 'ctl-1' });

    const svc = new ManualEvidenceService(db, fakeLog);
    await expect(svc.create({
      tenantId: 'tnt-A', controlId: 'ctl-1',
      title: 't', description: 'd', createdBy: 'u',
    })).rejects.toBeInstanceOf(ComplianceSchemaUnavailableError);
  });
});

describe('ManualEvidenceService.list', () => {
  it('returns only this tenant\'s active (non-deleted) evidence for the given control', async () => {
    const { db, _state } = makeFakeDb();
    _state.evidences.push(
      { id: 'me-1', tenantId: 'tnt-A', controlId: 'ctl-1', title: 'one', description: 'd', attachedArtifactId: null, createdBy: 'u', evidenceAt: new Date(2026, 0, 1), createdAt: new Date(), deletedAt: null },
      { id: 'me-2', tenantId: 'tnt-A', controlId: 'ctl-1', title: 'two', description: 'd', attachedArtifactId: null, createdBy: 'u', evidenceAt: new Date(2026, 1, 1), createdAt: new Date(), deletedAt: null },
      // Soft-deleted — excluded.
      { id: 'me-3', tenantId: 'tnt-A', controlId: 'ctl-1', title: 'gone', description: 'd', attachedArtifactId: null, createdBy: 'u', evidenceAt: new Date(2026, 2, 1), createdAt: new Date(), deletedAt: new Date() },
      // Different control — excluded.
      { id: 'me-4', tenantId: 'tnt-A', controlId: 'ctl-OTHER', title: 'wrong-control', description: 'd', attachedArtifactId: null, createdBy: 'u', evidenceAt: new Date(2026, 3, 1), createdAt: new Date(), deletedAt: null },
      // CROSS-TENANT — must NEVER appear.
      { id: 'me-5', tenantId: 'tnt-B', controlId: 'ctl-1', title: 'other-tenant', description: 'd', attachedArtifactId: null, createdBy: 'u', evidenceAt: new Date(2026, 4, 1), createdAt: new Date(), deletedAt: null },
    );

    const svc = new ManualEvidenceService(db, fakeLog);
    const out = await svc.list({ tenantId: 'tnt-A', controlId: 'ctl-1' });
    expect(out.total).toBe(2);
    expect(out.items.map((i) => i.id)).toEqual(['me-2', 'me-1']); // newest first
    expect(out.items.some((i) => i.id === 'me-5')).toBe(false);
    expect(out.items.some((i) => i.id === 'me-3')).toBe(false);
    expect(out.items.some((i) => i.id === 'me-4')).toBe(false);
  });

  it('paginates via limit + offset', async () => {
    const { db, _state } = makeFakeDb();
    for (let i = 0; i < 5; i++) {
      _state.evidences.push({
        id: `me-${i}`, tenantId: 'tnt-A', controlId: 'ctl-1',
        title: `t${i}`, description: 'd', attachedArtifactId: null,
        createdBy: 'u', evidenceAt: new Date(2026, 0, 5 - i),
        createdAt: new Date(), deletedAt: null,
      });
    }
    const svc = new ManualEvidenceService(db, fakeLog);
    const p1 = await svc.list({ tenantId: 'tnt-A', controlId: 'ctl-1', limit: 2, offset: 0 });
    const p2 = await svc.list({ tenantId: 'tnt-A', controlId: 'ctl-1', limit: 2, offset: 2 });
    expect(p1.total).toBe(5);
    expect(p1.items).toHaveLength(2);
    expect(p2.items).toHaveLength(2);
    expect(p1.items[0]!.id).not.toBe(p2.items[0]!.id);
  });
});

describe('ManualEvidenceService.delete', () => {
  it('soft-deletes the evidence and removes its companion mapping', async () => {
    const { db, _state } = makeFakeDb();
    _state.evidences.push({
      id: 'me-1', tenantId: 'tnt-A', controlId: 'ctl-1',
      title: 't', description: 'd', attachedArtifactId: null,
      createdBy: 'u', evidenceAt: new Date(),
      createdAt: new Date(), deletedAt: null,
    });
    _state.mappings.push({
      id: 'map-1', tenantId: 'tnt-A', controlId: 'ctl-1',
      evidenceType: 'manual_evidence', evidenceId: 'me-1',
      evidenceAt: new Date(), mappedBy: 'u', mappingSource: 'manual', notes: 't',
    });

    const svc = new ManualEvidenceService(db, fakeLog);
    await svc.delete({ id: 'me-1', tenantId: 'tnt-A', deletedBy: 'usr-admin' });

    expect(_state.evidences[0]!.deletedAt).toBeInstanceOf(Date);
    expect(_state.mappings).toHaveLength(0);
    expect(fakeLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tnt-A', manualEvidenceId: 'me-1', deletedBy: 'usr-admin' }),
      expect.stringContaining('soft-deleted'),
    );
  });

  it('refuses to delete cross-tenant evidence (throws ManualEvidenceNotFoundError)', async () => {
    const { db, _state } = makeFakeDb();
    _state.evidences.push({
      id: 'me-1', tenantId: 'tnt-B', controlId: 'ctl-1',
      title: 't', description: 'd', attachedArtifactId: null,
      createdBy: 'u', evidenceAt: new Date(), createdAt: new Date(), deletedAt: null,
    });

    const svc = new ManualEvidenceService(db, fakeLog);
    await expect(svc.delete({
      id: 'me-1', tenantId: 'tnt-A', deletedBy: 'attacker',
    })).rejects.toBeInstanceOf(ManualEvidenceNotFoundError);

    // The other tenant's row is untouched.
    expect(_state.evidences[0]!.deletedAt).toBeNull();
  });

  it('refuses to re-delete an already soft-deleted row', async () => {
    const { db, _state } = makeFakeDb();
    _state.evidences.push({
      id: 'me-1', tenantId: 'tnt-A', controlId: 'ctl-1',
      title: 't', description: 'd', attachedArtifactId: null,
      createdBy: 'u', evidenceAt: new Date(), createdAt: new Date(),
      deletedAt: new Date(),
    });

    const svc = new ManualEvidenceService(db, fakeLog);
    await expect(svc.delete({
      id: 'me-1', tenantId: 'tnt-A', deletedBy: 'u',
    })).rejects.toBeInstanceOf(ManualEvidenceNotFoundError);
  });

  it('survives a mapping cleanup failure (logs warn + still soft-deletes the row)', async () => {
    const { db, _state } = makeFakeDb();
    _state.evidences.push({
      id: 'me-1', tenantId: 'tnt-A', controlId: 'ctl-1',
      title: 't', description: 'd', attachedArtifactId: null,
      createdBy: 'u', evidenceAt: new Date(), createdAt: new Date(), deletedAt: null,
    });
    db.controlEvidenceMapping.deleteMany.mockRejectedValueOnce(new Error('boom'));

    const svc = new ManualEvidenceService(db, fakeLog);
    await svc.delete({ id: 'me-1', tenantId: 'tnt-A', deletedBy: 'u' });

    expect(_state.evidences[0]!.deletedAt).toBeInstanceOf(Date);
    expect(fakeLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ manualEvidenceId: 'me-1' }),
      expect.stringContaining('mapping cleanup failed'),
    );
  });
});

// ─── approve / reject — service-level vs route-level boundary ───────────
describe('ManualEvidenceService approve/reject — boundary', () => {
  it.todo('approve(): the SERVICE does not currently expose an approve method — REVIEWER+ enforcement + status transition lives in the route handler. Pinning here so the contract is searchable.');
  it.todo('reject(): same — route layer handles permission + sets approvalState on the linked artifact.');
  it.todo('end-to-end approval flow needs a real Postgres + the reviewer route + audit log writes — covered under tests/integration/compliance-evidence-flow.test.ts.');
});
