/**
 * Unit tests for AuditRunService — pins the audit-run lifecycle.
 *
 * Covered behaviors:
 *   1. create() happy path: row written with status=PLANNING, tenant-scoped,
 *      framework slug validated.
 *   2. create() emits audit_run_started lifecycle event with correct shape.
 *   3. create() rejects missing framework, periodEnd <= periodStart.
 *   4. State machine transitions: every legal step PLANNING → … → COMPLETED.
 *   5. State machine refuses skip-ahead (PLANNING → COMPLETED) with a
 *      structured IllegalAuditRunTransitionError.
 *   6. Tenant scoping: get/list/transition all scope by tenantId.
 *   7. cancel-via-transition: any non-terminal → CANCELLED emits cancel event.
 *   8. transition from terminal state (COMPLETED/CANCELLED/FAILED) is
 *      idempotent for same-state, refused otherwise (terminal sink).
 *   9. get() on cross-tenant id THROWS (does NOT leak another tenant's row).
 *  10. plan() seeds ControlTest rows, transitions PLANNING → PLANNED, emits
 *      audit_plan_created.
 *  11. Concurrency gap: two concurrent transitions both succeed because the
 *      service does read-then-update with no optimistic locking. Documented.
 *
 * NOT a real DB; in-memory Prisma stub mirrors trial-promotion.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuditRunService,
  IllegalAuditRunTransitionError,
  type AuditLifecycleEmitter,
  type AuditLifecycleEvent,
  type AuditRunStatus,
} from '../../../apps/api/src/services/audit/audit-run.service.js';

// ─── In-memory Prisma stub ─────────────────────────────────────────────

interface FakeAuditRun {
  id: string;
  tenantId: string;
  userId: string;
  frameworkSlug: string;
  title: string;
  scope: string | null;
  periodStart: Date;
  periodEnd: Date;
  status: AuditRunStatus;
  metadata: Record<string, unknown> | null;
  deletedAt: Date | null;
  createdAt: Date;
}

interface FakeFramework {
  id: string;
  slug: string;
  name: string;
  controls: Array<{ id: string; code: string; title: string; category: string; sortOrder: number }>;
}

interface FakeControlTest {
  auditRunId: string;
  controlId: string;
  tenantId: string;
  controlCode: string;
  controlTitle: string;
  status: string;
  evidenceCount: number;
}

function makeFakeDb() {
  const auditRuns: FakeAuditRun[] = [];
  const frameworks: FakeFramework[] = [];
  const controlTests: FakeControlTest[] = [];

  let cuid = 0;
  const id = (prefix = 'id') => `${prefix}-${++cuid}`;

  const db: any = {
    auditRun: {
      create: vi.fn(async ({ data }: any) => {
        const row: FakeAuditRun = {
          id: id('arun'),
          tenantId: data.tenantId,
          userId: data.userId,
          frameworkSlug: data.frameworkSlug,
          title: data.title,
          scope: data.scope ?? null,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          status: data.status,
          metadata: data.metadata ?? null,
          deletedAt: null,
          createdAt: new Date(),
        };
        auditRuns.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where, select }: any) => {
        const row = auditRuns.find((r) => {
          if (where.id && r.id !== where.id) return false;
          if (where.tenantId && r.tenantId !== where.tenantId) return false;
          if (where.deletedAt === null && r.deletedAt !== null) return false;
          return true;
        });
        if (!row) return null;
        if (select) {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(select)) {
            if ((select as Record<string, boolean>)[k]) out[k] = (row as unknown as Record<string, unknown>)[k];
          }
          return out;
        }
        return row;
      }),
      findMany: vi.fn(async ({ where, take, skip }: any) => {
        let rows = auditRuns.filter((r) => {
          if (where.tenantId && r.tenantId !== where.tenantId) return false;
          if (where.status && r.status !== where.status) return false;
          if (where.deletedAt === null && r.deletedAt !== null) return false;
          return true;
        });
        rows = rows.slice(skip ?? 0, (skip ?? 0) + (take ?? 50));
        return rows;
      }),
      count: vi.fn(async ({ where }: any) => {
        return auditRuns.filter((r) => {
          if (where.tenantId && r.tenantId !== where.tenantId) return false;
          if (where.status && r.status !== where.status) return false;
          if (where.deletedAt === null && r.deletedAt !== null) return false;
          return true;
        }).length;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = auditRuns.find((r) => r.id === where.id);
        if (!row) throw new Error(`auditRun ${where.id} not found`);
        Object.assign(row, data);
        return row;
      }),
    },
    complianceFramework: {
      findUnique: vi.fn(async ({ where, include, select }: any) => {
        const fw = frameworks.find((f) => f.slug === where.slug);
        if (!fw) return null;
        if (select) {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(select)) {
            if ((select as Record<string, boolean>)[k]) out[k] = (fw as unknown as Record<string, unknown>)[k];
          }
          return out;
        }
        if (include?.controls) {
          return { ...fw, controls: [...fw.controls] };
        }
        return fw;
      }),
    },
    controlTest: {
      upsert: vi.fn(async ({ where, create }: any) => {
        const key = where.auditRunId_controlId;
        const existing = controlTests.find((c) => c.auditRunId === key.auditRunId && c.controlId === key.controlId);
        if (existing) return existing;
        const row: FakeControlTest = {
          auditRunId: create.auditRunId,
          controlId: create.controlId,
          tenantId: create.tenantId,
          controlCode: create.controlCode,
          controlTitle: create.controlTitle,
          status: create.status,
          evidenceCount: create.evidenceCount,
        };
        controlTests.push(row);
        return row;
      }),
    },
    // Required by AuditLogger (constructed in service ctor)
    auditLog: {
      create: vi.fn(async ({ data }: any) => ({ id: id('alog'), ...data })),
    },
  };

  return { db, _state: { auditRuns, frameworks, controlTests } };
}

const baseLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(() => baseLog),
} as any;

function makeEmitter(): { emit: AuditLifecycleEmitter; events: AuditLifecycleEvent[] } {
  const events: AuditLifecycleEvent[] = [];
  const emit: AuditLifecycleEmitter = vi.fn((ev) => {
    events.push(ev);
  }) as any;
  return { emit, events };
}

function seedFramework(state: ReturnType<typeof makeFakeDb>['_state'], slug = 'soc2', controlCount = 3) {
  state.frameworks.push({
    id: `fw-${slug}`,
    slug,
    name: slug.toUpperCase(),
    controls: Array.from({ length: controlCount }, (_, i) => ({
      id: `ctrl-${slug}-${i + 1}`,
      code: `${slug.toUpperCase()}-${i + 1}`,
      title: `Control ${i + 1}`,
      category: 'A',
      sortOrder: i,
    })),
  });
}

const VALID_INPUT = {
  tenantId: 'tnt-1',
  userId: 'usr-1',
  frameworkSlug: 'soc2',
  title: '2026 SOC 2 Type I',
  scope: 'production environment',
  periodStart: new Date('2026-01-01'),
  periodEnd: new Date('2026-12-31'),
};

// ─── Tests ─────────────────────────────────────────────────────────────

describe('AuditRunService.create', () => {
  let fake: ReturnType<typeof makeFakeDb>;
  let emitter: ReturnType<typeof makeEmitter>;
  let svc: AuditRunService;

  beforeEach(() => {
    fake = makeFakeDb();
    seedFramework(fake._state);
    emitter = makeEmitter();
    svc = new AuditRunService(fake.db, baseLog, emitter.emit);
  });

  it('creates a row with status=PLANNING, scoped to tenant', async () => {
    const result = await svc.create(VALID_INPUT);

    expect(result.status).toBe('PLANNING');
    expect(result.id).toMatch(/^arun-/);

    expect(fake._state.auditRuns).toHaveLength(1);
    const row = fake._state.auditRuns[0]!;
    expect(row.tenantId).toBe('tnt-1');
    expect(row.userId).toBe('usr-1');
    expect(row.frameworkSlug).toBe('soc2');
    expect(row.title).toBe('2026 SOC 2 Type I');
    expect(row.scope).toBe('production environment');
    expect(row.status).toBe('PLANNING');
    expect(row.periodStart).toEqual(new Date('2026-01-01'));
    expect(row.periodEnd).toEqual(new Date('2026-12-31'));
  });

  it('passes tenantId in the create payload (tenant scoping)', async () => {
    await svc.create(VALID_INPUT);
    expect(fake.db.auditRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tnt-1' }),
      }),
    );
  });

  it('emits audit_run_started with the right shape', async () => {
    const result = await svc.create(VALID_INPUT);

    expect(emitter.emit).toHaveBeenCalledTimes(1);
    const ev = emitter.events[0]!;
    expect(ev.type).toBe('audit_run_started');
    expect(ev.auditRunId).toBe(result.id);
    expect(ev.agentRole).toBe('AUDIT_COMMANDER');
    expect(typeof ev.timestamp).toBe('string');
    expect(new Date(ev.timestamp).toString()).not.toBe('Invalid Date');
    expect(ev.details).toMatchObject({
      frameworkSlug: 'soc2',
      frameworkName: 'SOC2',
      title: '2026 SOC 2 Type I',
    });
  });

  it('rejects when framework slug does not exist', async () => {
    await expect(
      svc.create({ ...VALID_INPUT, frameworkSlug: 'made-up-framework' }),
    ).rejects.toThrow(/Framework not found: made-up-framework/);

    // No row created and no event emitted on validation failure.
    expect(fake._state.auditRuns).toHaveLength(0);
    expect(emitter.events).toHaveLength(0);
  });

  it('rejects when periodEnd <= periodStart', async () => {
    await expect(
      svc.create({
        ...VALID_INPUT,
        periodStart: new Date('2026-12-31'),
        periodEnd: new Date('2026-01-01'),
      }),
    ).rejects.toThrow(/periodEnd must be strictly after periodStart/);
    expect(fake._state.auditRuns).toHaveLength(0);
  });

  it('rejects when periodStart === periodEnd', async () => {
    const same = new Date('2026-06-01');
    await expect(
      svc.create({ ...VALID_INPUT, periodStart: same, periodEnd: same }),
    ).rejects.toThrow(/periodEnd must be strictly after periodStart/);
  });
});

describe('AuditRunService.transition (state machine)', () => {
  let fake: ReturnType<typeof makeFakeDb>;
  let emitter: ReturnType<typeof makeEmitter>;
  let svc: AuditRunService;

  beforeEach(() => {
    fake = makeFakeDb();
    seedFramework(fake._state);
    emitter = makeEmitter();
    svc = new AuditRunService(fake.db, baseLog, emitter.emit);
  });

  async function newRun(): Promise<string> {
    const r = await svc.create(VALID_INPUT);
    emitter.events.length = 0; // discard the audit_run_started
    return r.id;
  }

  it('walks the full happy path PLANNING → … → COMPLETED', async () => {
    const id = await newRun();
    const path: AuditRunStatus[] = [
      'PLANNED',
      'MAPPING',
      'TESTING',
      'REVIEWING',
      'READY_TO_PACK',
      'FINAL_PACK',
      'COMPLETED',
    ];
    for (const to of path) {
      await svc.transition({ id, tenantId: 'tnt-1', to });
    }
    expect(fake._state.auditRuns[0]!.status).toBe('COMPLETED');
    // Only the COMPLETED transition emits a lifecycle event.
    const completed = emitter.events.find((e) => e.type === 'audit_run_completed');
    expect(completed).toBeDefined();
    expect(completed?.auditRunId).toBe(id);
    expect(completed?.agentRole).toBe('AUDIT_COMMANDER');
  });

  it('refuses PLANNING → COMPLETED with IllegalAuditRunTransitionError', async () => {
    const id = await newRun();
    await expect(
      svc.transition({ id, tenantId: 'tnt-1', to: 'COMPLETED' }),
    ).rejects.toThrow(IllegalAuditRunTransitionError);
    // No update happened; no terminal event emitted.
    expect(fake._state.auditRuns[0]!.status).toBe('PLANNING');
    expect(emitter.events).toHaveLength(0);
  });

  it('refuses PLANNING → REVIEWING (skip MAPPING/TESTING)', async () => {
    const id = await newRun();
    await expect(
      svc.transition({ id, tenantId: 'tnt-1', to: 'REVIEWING' }),
    ).rejects.toThrow(IllegalAuditRunTransitionError);
  });

  it('IllegalAuditRunTransitionError carries from/to/auditRunId for structured handling', async () => {
    const id = await newRun();
    try {
      await svc.transition({ id, tenantId: 'tnt-1', to: 'COMPLETED' });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalAuditRunTransitionError);
      const e = err as IllegalAuditRunTransitionError;
      expect(e.from).toBe('PLANNING');
      expect(e.to).toBe('COMPLETED');
      expect(e.auditRunId).toBe(id);
      expect(e.name).toBe('IllegalAuditRunTransitionError');
      // Message lists allowed next states for operator clarity.
      expect(e.message).toMatch(/PLANNED/);
    }
  });

  it('allows REVIEWING → TESTING (re-test loop)', async () => {
    const id = await newRun();
    for (const to of ['PLANNED', 'MAPPING', 'TESTING', 'REVIEWING'] as AuditRunStatus[]) {
      await svc.transition({ id, tenantId: 'tnt-1', to });
    }
    await expect(
      svc.transition({ id, tenantId: 'tnt-1', to: 'TESTING' }),
    ).resolves.toBeUndefined();
    expect(fake._state.auditRuns[0]!.status).toBe('TESTING');
  });

  it('allows READY_TO_PACK → REVIEWING (reviewer rejection loop)', async () => {
    const id = await newRun();
    for (const to of ['PLANNED', 'MAPPING', 'TESTING', 'REVIEWING', 'READY_TO_PACK'] as AuditRunStatus[]) {
      await svc.transition({ id, tenantId: 'tnt-1', to });
    }
    await expect(
      svc.transition({ id, tenantId: 'tnt-1', to: 'REVIEWING' }),
    ).resolves.toBeUndefined();
  });

  it('is idempotent for same-state transition', async () => {
    const id = await newRun();
    // PLANNING → PLANNING — assertAuditTransition early-returns.
    await expect(
      svc.transition({ id, tenantId: 'tnt-1', to: 'PLANNING' }),
    ).resolves.toBeUndefined();
    expect(fake._state.auditRuns[0]!.status).toBe('PLANNING');
  });

  it('refuses transitions out of COMPLETED (terminal sink)', async () => {
    const id = await newRun();
    for (const to of ['PLANNED', 'MAPPING', 'TESTING', 'REVIEWING', 'READY_TO_PACK', 'FINAL_PACK', 'COMPLETED'] as AuditRunStatus[]) {
      await svc.transition({ id, tenantId: 'tnt-1', to });
    }
    await expect(
      svc.transition({ id, tenantId: 'tnt-1', to: 'PLANNING' }),
    ).rejects.toThrow(IllegalAuditRunTransitionError);
    await expect(
      svc.transition({ id, tenantId: 'tnt-1', to: 'CANCELLED' }),
    ).rejects.toThrow(IllegalAuditRunTransitionError);
  });

  it('refuses transitions out of CANCELLED', async () => {
    const id = await newRun();
    await svc.transition({ id, tenantId: 'tnt-1', to: 'CANCELLED' });
    await expect(
      svc.transition({ id, tenantId: 'tnt-1', to: 'PLANNED' }),
    ).rejects.toThrow(IllegalAuditRunTransitionError);
  });

  it('refuses transitions out of FAILED', async () => {
    const id = await newRun();
    await svc.transition({ id, tenantId: 'tnt-1', to: 'FAILED' });
    await expect(
      svc.transition({ id, tenantId: 'tnt-1', to: 'PLANNED' }),
    ).rejects.toThrow(IllegalAuditRunTransitionError);
  });

  it('throws when the run does not exist', async () => {
    await expect(
      svc.transition({ id: 'nope', tenantId: 'tnt-1', to: 'PLANNED' }),
    ).rejects.toThrow(/not found/);
  });

  it('scopes the transition lookup by tenantId (cannot transition another tenant\'s run)', async () => {
    const id = await newRun();
    await expect(
      svc.transition({ id, tenantId: 'tnt-EVIL', to: 'PLANNED' }),
    ).rejects.toThrow(/not found/);
    // Untouched.
    expect(fake._state.auditRuns[0]!.status).toBe('PLANNING');
  });
});

describe('AuditRunService.transition lifecycle events', () => {
  let fake: ReturnType<typeof makeFakeDb>;
  let emitter: ReturnType<typeof makeEmitter>;
  let svc: AuditRunService;

  beforeEach(() => {
    fake = makeFakeDb();
    seedFramework(fake._state);
    emitter = makeEmitter();
    svc = new AuditRunService(fake.db, baseLog, emitter.emit);
  });

  async function newRun(): Promise<string> {
    const r = await svc.create(VALID_INPUT);
    emitter.events.length = 0;
    return r.id;
  }

  it('emits audit_run_cancelled when transitioning to CANCELLED with reason', async () => {
    const id = await newRun();
    await svc.transition({ id, tenantId: 'tnt-1', to: 'CANCELLED', reason: 'customer pulled out' });
    expect(emitter.events).toHaveLength(1);
    const ev = emitter.events[0]!;
    expect(ev.type).toBe('audit_run_cancelled');
    expect(ev.auditRunId).toBe(id);
    expect(ev.agentRole).toBe('AUDIT_COMMANDER');
    expect(ev.details).toMatchObject({ reason: 'customer pulled out' });
  });

  it('emits audit_run_cancelled from each non-terminal status', async () => {
    // From each non-terminal status, cancel and verify emission. Need a fresh
    // run per scenario because CANCELLED is a sink.
    const nonTerminalReachable: AuditRunStatus[] = [
      'PLANNING',
      'PLANNED',
      'MAPPING',
      'TESTING',
      'REVIEWING',
      'READY_TO_PACK',
    ];
    for (const status of nonTerminalReachable) {
      const id = await newRun();
      // Walk to the target status.
      const stepMap: Record<AuditRunStatus, AuditRunStatus[]> = {
        PLANNING: [],
        PLANNED: ['PLANNED'],
        MAPPING: ['PLANNED', 'MAPPING'],
        TESTING: ['PLANNED', 'MAPPING', 'TESTING'],
        REVIEWING: ['PLANNED', 'MAPPING', 'TESTING', 'REVIEWING'],
        READY_TO_PACK: ['PLANNED', 'MAPPING', 'TESTING', 'REVIEWING', 'READY_TO_PACK'],
        FINAL_PACK: [],
        COMPLETED: [],
        FAILED: [],
        CANCELLED: [],
      };
      for (const step of stepMap[status]) {
        await svc.transition({ id, tenantId: 'tnt-1', to: step });
      }
      emitter.events.length = 0;
      await svc.transition({ id, tenantId: 'tnt-1', to: 'CANCELLED' });
      expect(emitter.events.find((e) => e.type === 'audit_run_cancelled')).toBeDefined();
    }
  });

  it('emits audit_run_failed with reason on FAILED transition', async () => {
    const id = await newRun();
    await svc.transition({ id, tenantId: 'tnt-1', to: 'FAILED', reason: 'pipeline crashed' });
    const ev = emitter.events.find((e) => e.type === 'audit_run_failed');
    expect(ev).toBeDefined();
    expect(ev?.details).toMatchObject({ reason: 'pipeline crashed' });
  });

  it('does NOT emit a lifecycle event for non-terminal transitions (PLANNED/MAPPING/...)', async () => {
    const id = await newRun();
    await svc.transition({ id, tenantId: 'tnt-1', to: 'PLANNED' });
    await svc.transition({ id, tenantId: 'tnt-1', to: 'MAPPING' });
    await svc.transition({ id, tenantId: 'tnt-1', to: 'TESTING' });
    // None of these are COMPLETED/FAILED/CANCELLED, so emit() is not called.
    expect(emitter.events).toHaveLength(0);
  });
});

describe('AuditRunService.get (tenant-scoped read)', () => {
  let fake: ReturnType<typeof makeFakeDb>;
  let svc: AuditRunService;

  beforeEach(() => {
    fake = makeFakeDb();
    seedFramework(fake._state);
    svc = new AuditRunService(fake.db, baseLog, makeEmitter().emit);
  });

  it('returns the run when tenantId matches', async () => {
    const created = await svc.create(VALID_INPUT);
    const row = (await svc.get(created.id, 'tnt-1')) as { id: string; tenantId: string };
    expect(row.id).toBe(created.id);
    expect(row.tenantId).toBe('tnt-1');
  });

  it('THROWS (does not return null) on cross-tenant access — no data leak', async () => {
    const created = await svc.create(VALID_INPUT);
    await expect(svc.get(created.id, 'tnt-OTHER')).rejects.toThrow(/not found in tenant tnt-OTHER/);
  });

  it('throws on unknown id', async () => {
    await expect(svc.get('does-not-exist', 'tnt-1')).rejects.toThrow(/not found/);
  });

  it('passes tenantId in the WHERE clause', async () => {
    const created = await svc.create(VALID_INPUT);
    await svc.get(created.id, 'tnt-1');
    // The most recent findFirst call (from get) — confirm tenantId was scoped.
    const calls = (fake.db.auditRun.findFirst as any).mock.calls;
    const last = calls[calls.length - 1][0];
    expect(last.where).toMatchObject({ id: created.id, tenantId: 'tnt-1', deletedAt: null });
  });

  it('does not return soft-deleted rows', async () => {
    const created = await svc.create(VALID_INPUT);
    fake._state.auditRuns[0]!.deletedAt = new Date();
    await expect(svc.get(created.id, 'tnt-1')).rejects.toThrow(/not found/);
  });
});

describe('AuditRunService.list (tenant-scoped)', () => {
  let fake: ReturnType<typeof makeFakeDb>;
  let svc: AuditRunService;

  beforeEach(() => {
    fake = makeFakeDb();
    seedFramework(fake._state);
    seedFramework(fake._state, 'iso27001');
    svc = new AuditRunService(fake.db, baseLog, makeEmitter().emit);
  });

  it('only returns runs for the requested tenant', async () => {
    await svc.create({ ...VALID_INPUT, tenantId: 'tnt-1' });
    await svc.create({ ...VALID_INPUT, tenantId: 'tnt-1', frameworkSlug: 'iso27001' });
    await svc.create({ ...VALID_INPUT, tenantId: 'tnt-2' });

    const result = await svc.list({ tenantId: 'tnt-1' });
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    for (const item of result.items as Array<{ tenantId: string }>) {
      expect(item.tenantId).toBe('tnt-1');
    }
  });

  it('passes tenantId + deletedAt:null in findMany WHERE', async () => {
    await svc.list({ tenantId: 'tnt-X' });
    expect(fake.db.auditRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tnt-X', deletedAt: null }),
      }),
    );
  });

  it('filters by status when provided', async () => {
    await svc.list({ tenantId: 'tnt-X', status: 'TESTING' });
    expect(fake.db.auditRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'TESTING' }),
      }),
    );
  });
});

describe('AuditRunService.plan', () => {
  let fake: ReturnType<typeof makeFakeDb>;
  let emitter: ReturnType<typeof makeEmitter>;
  let svc: AuditRunService;

  beforeEach(() => {
    fake = makeFakeDb();
    seedFramework(fake._state, 'soc2', 4);
    emitter = makeEmitter();
    svc = new AuditRunService(fake.db, baseLog, emitter.emit);
  });

  it('seeds one ControlTest per framework control and transitions PLANNING → PLANNED', async () => {
    const created = await svc.create(VALID_INPUT);
    emitter.events.length = 0;

    const result = await svc.plan({ id: created.id, tenantId: 'tnt-1' });

    expect(result.controlsSeeded).toBe(4);
    expect(fake._state.controlTests).toHaveLength(4);
    expect(fake._state.controlTests.every((c) => c.tenantId === 'tnt-1')).toBe(true);
    expect(fake._state.controlTests.every((c) => c.auditRunId === created.id)).toBe(true);
    expect(fake._state.controlTests.every((c) => c.status === 'not_started')).toBe(true);

    // PLANNING → PLANNED happened as a side-effect.
    expect(fake._state.auditRuns[0]!.status).toBe('PLANNED');

    // Emits audit_plan_created with the right counts.
    const ev = emitter.events.find((e) => e.type === 'audit_plan_created');
    expect(ev).toBeDefined();
    expect(ev?.details).toMatchObject({
      controlCount: 4,
      controlsSeeded: 4,
      frameworkSlug: 'soc2',
    });
  });

  it('is idempotent — re-running plan() does not duplicate ControlTest rows', async () => {
    const created = await svc.create(VALID_INPUT);
    await svc.plan({ id: created.id, tenantId: 'tnt-1' });
    expect(fake._state.controlTests).toHaveLength(4);

    // Second call — upsert should hit the existing rows, no duplicates.
    await svc.plan({ id: created.id, tenantId: 'tnt-1' });
    expect(fake._state.controlTests).toHaveLength(4);
  });

  it('does NOT re-transition once already past PLANNING', async () => {
    const created = await svc.create(VALID_INPUT);
    await svc.plan({ id: created.id, tenantId: 'tnt-1' }); // → PLANNED
    await svc.transition({ id: created.id, tenantId: 'tnt-1', to: 'MAPPING' });
    // Re-running plan when status is MAPPING — should NOT illegally try MAPPING→PLANNED.
    await expect(svc.plan({ id: created.id, tenantId: 'tnt-1' })).resolves.toMatchObject({
      controlsSeeded: 4,
    });
    expect(fake._state.auditRuns[0]!.status).toBe('MAPPING');
  });

  it('rejects cross-tenant plan() — get() throws first', async () => {
    const created = await svc.create(VALID_INPUT);
    await expect(svc.plan({ id: created.id, tenantId: 'tnt-EVIL' })).rejects.toThrow(/not found/);
    expect(fake._state.controlTests).toHaveLength(0);
  });
});

describe('AuditRunService concurrency (documented gap)', () => {
  let fake: ReturnType<typeof makeFakeDb>;
  let emitter: ReturnType<typeof makeEmitter>;
  let svc: AuditRunService;

  beforeEach(() => {
    fake = makeFakeDb();
    seedFramework(fake._state);
    emitter = makeEmitter();
    svc = new AuditRunService(fake.db, baseLog, emitter.emit);
  });

  it('does NOT detect concurrent transitions — both succeed (read-then-write race)', async () => {
    // Documented gap: transition() does findFirst() then update() with no
    // version column / optimistic lock / SELECT...FOR UPDATE. If two callers
    // both read PLANNING and one writes PLANNED while the other writes
    // CANCELLED, the second write wins with no error. The state machine is
    // enforced per-call but not across calls.
    const created = await svc.create(VALID_INPUT);

    const [r1, r2] = await Promise.allSettled([
      svc.transition({ id: created.id, tenantId: 'tnt-1', to: 'PLANNED' }),
      svc.transition({ id: created.id, tenantId: 'tnt-1', to: 'CANCELLED' }),
    ]);

    // Both calls succeed individually — no race detection.
    expect(r1.status).toBe('fulfilled');
    expect(r2.status).toBe('fulfilled');

    // Final state is whichever update() landed last; both are reachable from
    // PLANNING, so both are individually legal. The combined effect — that
    // PLANNED was clobbered by CANCELLED (or vice versa) — is invisible to
    // the service.
    const finalStatus = fake._state.auditRuns[0]!.status;
    expect(['PLANNED', 'CANCELLED']).toContain(finalStatus);

    // Verifying the gap is real: BOTH lifecycle observers fired (no one was
    // told their write was overwritten). Note: only CANCELLED emits — PLANNED
    // is non-terminal — so we can only directly observe the cancel event.
    // What this confirms: the service issued two unconditional updates.
    expect(fake.db.auditRun.update).toHaveBeenCalledTimes(2);
  });
});
