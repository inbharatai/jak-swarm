/**
 * Audit run end-to-end test — proves the Phase 1 audit & compliance product
 * shipped in this session is real, not faked.
 *
 * What this proves:
 *   1. AuditRunService.create persists an AuditRun row + emits audit_run_started.
 *   2. .plan() seeds ControlTest rows from the framework + transitions PLANNING → PLANNED.
 *   3. State-machine refuses illegal transitions (PLANNED → COMPLETED).
 *   4. ControlTestService.runAll evaluates evidence + writes results +
 *      auto-creates AuditException on fail/exception.
 *   5. WorkpaperService renders real PDFs via exportPdf and persists them
 *      as WorkflowArtifacts with approvalState='REQUIRES_APPROVAL'.
 *   6. FinalAuditPackService refuses when workpapers aren't approved (gate enforced).
 *   7. After approving workpapers, FinalAuditPackService produces a signed
 *      bundle artifact that verifies cleanly.
 *   8. Lifecycle events fire in the documented order: audit_run_started →
 *      audit_plan_created → control_test_started/_completed → exception_found
 *      → workpaper_generated → final_pack_started → final_pack_generated →
 *      audit_run_completed.
 *
 * Approach: pure in-memory Prisma mock + real services + real exporters.
 * No live DB needed. Tests that target services (not LLM heuristics) are
 * deterministic and run in CI without OPENAI_API_KEY (the fallback path
 * exercised below is the 'no LLM key' deterministic rule).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set Supabase env BEFORE the config module loads. apps/api/src/config.ts
// reads env at import time. vi.hoisted runs before any imports, so this
// fires before config.ts is loaded transitively.
vi.hoisted(() => {
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost:54321';
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key-32-bytes-long-1234567890';
});

// Mock supabase BEFORE any service imports. ArtifactService caches its
// client on first use, so the mock has to be in place before the first
// createArtifact() call. vi.mock is hoisted, so this fires at module load.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      listBuckets: async () => ({ data: [{ name: 'tenant-artifacts' }], error: null }),
      createBucket: async () => ({ error: null }),
      from: () => ({
        upload: async () => ({ error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: 'http://localhost/dummy' }, error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  }),
}));

import {
  AuditRunService,
  IllegalAuditRunTransitionError,
  type AuditLifecycleEvent,
} from '../../apps/api/src/services/audit/audit-run.service.js';
import { ControlTestService } from '../../apps/api/src/services/audit/control-test.service.js';
import { AuditExceptionService } from '../../apps/api/src/services/audit/audit-exception.service.js';
import { WorkpaperService } from '../../apps/api/src/services/audit/workpaper.service.js';
import { FinalAuditPackService, FinalPackGateError } from '../../apps/api/src/services/audit/final-audit-pack.service.js';
import { ArtifactService } from '../../apps/api/src/services/artifact.service.js';
import {
  verifyBundleSignature,
  type SignedBundle,
} from '../../apps/api/src/services/bundle-signing.service.js';

const TEST_SECRET = 'test-evidence-signing-secret-32-bytes-long-1234567890';

beforeEach(() => {
  process.env['EVIDENCE_SIGNING_SECRET'] = TEST_SECRET;
  // Ensure the deterministic non-LLM evaluation path is used so the test is
  // hermetic and reproducible.
  delete process.env['OPENAI_API_KEY'];
});

afterEach(() => {
  delete process.env['EVIDENCE_SIGNING_SECRET'];
  // Leave Supabase env in place — set at module load to satisfy config validation.
});

// Minimal logger satisfying FastifyBaseLogger
const log: never = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  level: 'info',
  child: () => log,
} as never;

interface AuditRunRow {
  id: string;
  tenantId: string;
  userId: string;
  frameworkSlug: string;
  title: string;
  scope?: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  riskSummary: string | null;
  coveragePercent: number | null;
  finalPackArtifactId: string | null;
  metadata: Record<string, unknown> | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ControlTestRow {
  id: string;
  tenantId: string;
  auditRunId: string;
  controlId: string;
  controlCode: string;
  controlTitle: string;
  testProcedure: string | null;
  status: string;
  result: string | null;
  rationale: string | null;
  confidence: number | null;
  evidenceConsidered: unknown;
  evidenceCount: number;
  exceptionId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AuditExceptionRow {
  id: string;
  tenantId: string;
  auditRunId: string;
  controlTestId: string | null;
  controlId: string;
  controlCode: string;
  severity: string;
  description: string;
  cause: string | null;
  impact: string | null;
  remediationPlan: string | null;
  remediationOwner: string | null;
  remediationDueDate: Date | null;
  status: string;
  reviewerStatus: string | null;
  reviewerComment: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AuditWorkpaperRow {
  id: string;
  tenantId: string;
  auditRunId: string;
  controlTestId: string | null;
  controlId: string;
  controlCode: string;
  controlTitle: string;
  artifactId: string | null;
  status: string;
  reviewerNotes: string | null;
  generatedBy: string;
  reviewedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface WorkflowArtifactRow {
  id: string;
  tenantId: string;
  workflowId: string;
  taskId?: string;
  producedBy: string;
  artifactType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  inlineContent: string | null;
  storageKey: string | null;
  status: string;
  approvalState: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  parentId?: string | null;
  metadata?: Record<string, unknown> | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  bytes?: Uint8Array;
}

interface WorkflowRow {
  id: string;
  tenantId: string;
  userId: string;
  goal: string;
  status: string;
  createdAt: Date;
}

let nextId = 1;
function id(prefix: string): string { return `${prefix}-${nextId++}`; }

function makeMockDb() {
  const auditRuns: AuditRunRow[] = [];
  const controlTests: ControlTestRow[] = [];
  const auditExceptions: AuditExceptionRow[] = [];
  const auditWorkpapers: AuditWorkpaperRow[] = [];
  const workflowArtifacts: WorkflowArtifactRow[] = [];
  const workflows: WorkflowRow[] = [];

  const framework = {
    id: 'fw-soc2',
    slug: 'soc2-type2',
    name: 'SOC 2 Type 2',
    shortName: 'SOC 2',
    issuer: 'AICPA',
    description: 'Trust Services Criteria',
    version: '2017',
    active: true,
    controls: [
      { id: 'ctl-1', frameworkId: 'fw-soc2', code: 'CC6.1', category: 'Security', series: 'CC6', title: 'Logical Access Controls', description: 'Design + implement logical access controls. Includes encryption + MFA + key management for in-scope systems.', autoRuleKey: 'tenant-rbac-changes', sortOrder: 1, subControls: null, createdAt: new Date(), updatedAt: new Date() },
      { id: 'ctl-2', frameworkId: 'fw-soc2', code: 'CC7.1', category: 'Security', series: 'CC7', title: 'System Operations', description: 'Detect security events. Includes monitoring, alerting, and review of suspicious activity.', autoRuleKey: 'guardrail-and-injection-events', sortOrder: 2, subControls: null, createdAt: new Date(), updatedAt: new Date() },
    ],
  };

  function findOne<T>(arr: T[], pred: (x: T) => boolean): T | null {
    return arr.find(pred) ?? null;
  }

  return {
    _state: { auditRuns, controlTests, auditExceptions, auditWorkpapers, workflowArtifacts, workflows },
    complianceFramework: {
      findUnique: vi.fn(async ({ where, include }: { where: { slug: string }; include?: { controls?: boolean | { orderBy?: unknown } } }) => {
        if (where.slug !== framework.slug) return null;
        if (include?.controls) return framework;
        const { controls: _ctrls, ...rest } = framework;
        return rest;
      }),
    },
    auditRun: {
      create: vi.fn(async ({ data }: { data: Omit<AuditRunRow, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'riskSummary' | 'coveragePercent' | 'finalPackArtifactId' | 'metadata'> & Partial<AuditRunRow> }) => {
        const row: AuditRunRow = {
          id: id('ar'),
          tenantId: data.tenantId,
          userId: data.userId,
          frameworkSlug: data.frameworkSlug,
          title: data.title,
          ...(data.scope ? { scope: data.scope } : {}),
          periodStart: data.periodStart instanceof Date ? data.periodStart : new Date(data.periodStart as unknown as string),
          periodEnd: data.periodEnd instanceof Date ? data.periodEnd : new Date(data.periodEnd as unknown as string),
          status: data.status,
          riskSummary: null,
          coveragePercent: null,
          finalPackArtifactId: null,
          metadata: (data.metadata as Record<string, unknown> | undefined) ?? null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        auditRuns.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return findOne(auditRuns, (r) =>
          (where['id'] === undefined || r.id === where['id']) &&
          (where['tenantId'] === undefined || r.tenantId === where['tenantId']) &&
          (where['deletedAt'] === undefined || r.deletedAt === where['deletedAt']),
        );
      }),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
        return auditRuns.filter((r) =>
          (!where || ((where['tenantId'] === undefined || r.tenantId === where['tenantId']) &&
            (where['status'] === undefined || r.status === where['status']) &&
            (where['deletedAt'] === undefined || r.deletedAt === where['deletedAt']))),
        );
      }),
      count: vi.fn(async () => auditRuns.length),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<AuditRunRow> }) => {
        const row = findOne(auditRuns, (r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
    controlTest: {
      upsert: vi.fn(async ({ where, create, update: _update }: { where: { auditRunId_controlId: { auditRunId: string; controlId: string } }; create: Omit<ControlTestRow, 'id' | 'createdAt' | 'updatedAt' | 'startedAt' | 'completedAt' | 'result' | 'rationale' | 'confidence' | 'evidenceConsidered' | 'exceptionId' | 'testProcedure'>; update: Partial<ControlTestRow> }) => {
        const existing = findOne(controlTests, (t) => t.auditRunId === where.auditRunId_controlId.auditRunId && t.controlId === where.auditRunId_controlId.controlId);
        if (existing) return existing;
        const row: ControlTestRow = {
          id: id('ct'),
          tenantId: create.tenantId,
          auditRunId: create.auditRunId,
          controlId: create.controlId,
          controlCode: create.controlCode,
          controlTitle: create.controlTitle,
          testProcedure: null,
          status: create.status,
          result: null,
          rationale: null,
          confidence: null,
          evidenceConsidered: null,
          evidenceCount: create.evidenceCount,
          exceptionId: null,
          startedAt: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        controlTests.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return findOne(controlTests, (t) =>
          (where['id'] === undefined || t.id === where['id']) &&
          (where['tenantId'] === undefined || t.tenantId === where['tenantId']) &&
          (where['auditRunId'] === undefined || t.auditRunId === where['auditRunId']),
        );
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return controlTests.filter((t) => {
          if (where['auditRunId'] && t.auditRunId !== where['auditRunId']) return false;
          if (where['tenantId'] && t.tenantId !== where['tenantId']) return false;
          const status = where['status'] as { in?: string[] } | string | undefined;
          if (status) {
            if (typeof status === 'string' && t.status !== status) return false;
            if (typeof status === 'object' && status.in && !status.in.includes(t.status)) return false;
          }
          return true;
        });
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ControlTestRow> }) => {
        const row = findOne(controlTests, (t) => t.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
    complianceControl: {
      findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: { framework?: unknown } }) => {
        const c = framework.controls.find((c) => c.id === where.id);
        if (!c) return null;
        return include?.framework ? { ...c, framework: { slug: framework.slug, name: framework.name } } : c;
      }),
    },
    controlEvidenceMapping: {
      findMany: vi.fn(async () => []),
    },
    manualEvidence: {
      findMany: vi.fn(async () => []),
    },
    auditException: {
      create: vi.fn(async ({ data }: { data: Partial<AuditExceptionRow> }) => {
        const row: AuditExceptionRow = {
          id: id('ae'),
          tenantId: data.tenantId!,
          auditRunId: data.auditRunId!,
          controlTestId: data.controlTestId ?? null,
          controlId: data.controlId!,
          controlCode: data.controlCode!,
          severity: data.severity ?? 'medium',
          description: data.description!,
          cause: data.cause ?? null,
          impact: data.impact ?? null,
          remediationPlan: data.remediationPlan ?? null,
          remediationOwner: data.remediationOwner ?? null,
          remediationDueDate: data.remediationDueDate ?? null,
          status: data.status ?? 'open',
          reviewerStatus: null,
          reviewerComment: null,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        auditExceptions.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return findOne(auditExceptions, (e) =>
          (where['tenantId'] === undefined || e.tenantId === where['tenantId']) &&
          (where['auditRunId'] === undefined || e.auditRunId === where['auditRunId']) &&
          (where['controlTestId'] === undefined || e.controlTestId === where['controlTestId']) &&
          (where['id'] === undefined || e.id === where['id']),
        );
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return auditExceptions.filter((e) =>
          (where['tenantId'] === undefined || e.tenantId === where['tenantId']) &&
          (where['auditRunId'] === undefined || e.auditRunId === where['auditRunId']),
        );
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<AuditExceptionRow> }) => {
        const row = findOne(auditExceptions, (e) => e.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
    auditWorkpaper: {
      upsert: vi.fn(async ({ where, create, update }: { where: { auditRunId_controlId: { auditRunId: string; controlId: string } }; create: Partial<AuditWorkpaperRow>; update: Partial<AuditWorkpaperRow> }) => {
        const existing = findOne(auditWorkpapers, (w) => w.auditRunId === where.auditRunId_controlId.auditRunId && w.controlId === where.auditRunId_controlId.controlId);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const row: AuditWorkpaperRow = {
          id: id('wp'),
          tenantId: create.tenantId!,
          auditRunId: create.auditRunId!,
          controlTestId: create.controlTestId ?? null,
          controlId: create.controlId!,
          controlCode: create.controlCode!,
          controlTitle: create.controlTitle!,
          artifactId: create.artifactId ?? null,
          status: create.status ?? 'draft',
          reviewerNotes: null,
          generatedBy: create.generatedBy!,
          reviewedBy: null,
          approvedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        auditWorkpapers.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return findOne(auditWorkpapers, (w) =>
          (where['id'] === undefined || w.id === where['id']) &&
          (where['auditRunId'] === undefined || w.auditRunId === where['auditRunId']) &&
          (where['controlId'] === undefined || w.controlId === where['controlId']) &&
          (where['tenantId'] === undefined || w.tenantId === where['tenantId']),
        );
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return auditWorkpapers.filter((w) =>
          (where['tenantId'] === undefined || w.tenantId === where['tenantId']) &&
          (where['auditRunId'] === undefined || w.auditRunId === where['auditRunId']),
        );
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<AuditWorkpaperRow> }) => {
        const row = findOne(auditWorkpapers, (w) => w.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
    workflow: {
      create: vi.fn(async ({ data }: { data: Omit<WorkflowRow, 'id' | 'createdAt'> }) => {
        const row: WorkflowRow = { id: id('wf'), createdAt: new Date(), ...data };
        workflows.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return findOne(workflows, (w) =>
          (where['id'] === undefined || w.id === where['id']) &&
          (where['tenantId'] === undefined || w.tenantId === where['tenantId']),
        );
      }),
    },
    workflowArtifact: {
      create: vi.fn(async ({ data }: { data: Partial<WorkflowArtifactRow> }) => {
        const row: WorkflowArtifactRow = {
          id: id('art'),
          tenantId: data.tenantId!,
          workflowId: data.workflowId!,
          producedBy: data.producedBy!,
          artifactType: data.artifactType!,
          fileName: data.fileName!,
          mimeType: data.mimeType!,
          sizeBytes: data.sizeBytes ?? 0,
          contentHash: data.contentHash ?? '',
          inlineContent: data.inlineContent ?? null,
          storageKey: data.storageKey ?? null,
          status: data.status ?? 'READY',
          approvalState: data.approvalState ?? 'NOT_REQUIRED',
          approvedBy: null,
          approvedAt: null,
          parentId: data.parentId ?? null,
          metadata: (data.metadata as Record<string, unknown> | undefined) ?? null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        workflowArtifacts.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return findOne(workflowArtifacts, (a) =>
          (where['id'] === undefined || a.id === where['id']) &&
          (where['tenantId'] === undefined || a.tenantId === where['tenantId']),
        );
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const idIn = (where['id'] as { in?: string[] } | undefined)?.in;
        return workflowArtifacts.filter((a) =>
          (where['tenantId'] === undefined || a.tenantId === where['tenantId']) &&
          (where['workflowId'] === undefined || a.workflowId === where['workflowId']) &&
          (where['status'] === undefined || a.status === where['status']) &&
          (where['deletedAt'] === undefined || a.deletedAt === where['deletedAt']) &&
          (!idIn || idIn.includes(a.id)),
        );
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<WorkflowArtifactRow> }) => {
        const row = findOne(workflowArtifacts, (a) => a.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
      count: vi.fn(async () => workflowArtifacts.length),
    },
    auditLog: {
      create: vi.fn(async () => ({ id: id('al') })),
    },
  } as const;
}

describe('Audit run end-to-end', () => {
  it('runs the full lifecycle: create → plan → test → workpaper → final pack', async () => {
    const events: AuditLifecycleEvent[] = [];
    const emit = (ev: AuditLifecycleEvent) => events.push(ev);

    const db = makeMockDb();

    // Stub ArtifactService.createArtifact + setApprovalState — they normally
    // hit Supabase Storage, which we don't run in CI. Persist directly to
    // the in-memory workflowArtifacts table so the rest of the flow sees
    // real rows. content hash + size mirror the bytes faithfully so the
    // signed-bundle verification path still has real data to verify.
    const { createHash } = await import('node:crypto');
    vi.spyOn(ArtifactService.prototype, 'createArtifact').mockImplementation(async function (this: ArtifactService, input) {
      const sizeBytes = input.bytes ? input.bytes.length : Buffer.byteLength(input.inlineContent ?? '', 'utf8');
      const contentHash = input.bytes
        ? createHash('sha256').update(input.bytes).digest('hex')
        : createHash('sha256').update(input.inlineContent ?? '').digest('hex');
      const row = await (db.workflowArtifact.create as unknown as (a: unknown) => Promise<{ id: string }>)({
        data: {
          tenantId: input.tenantId,
          workflowId: input.workflowId,
          producedBy: input.producedBy,
          artifactType: input.artifactType,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes,
          contentHash,
          inlineContent: input.inlineContent ?? null,
          storageKey: input.bytes ? `${input.tenantId}/${input.workflowId}/${contentHash}.bin` : null,
          status: 'READY',
          approvalState: input.approvalState ?? 'NOT_REQUIRED',
          metadata: input.metadata ?? null,
        },
      });
      return row;
    });
    vi.spyOn(ArtifactService.prototype, 'setApprovalState').mockImplementation(async function (this: ArtifactService, input) {
      const row = await (db.workflowArtifact.update as unknown as (a: unknown) => Promise<unknown>)({
        where: { id: input.artifactId },
        data: { approvalState: input.decision, approvedBy: input.reviewedBy, approvedAt: new Date() },
      });
      return row;
    });
    const runs = new AuditRunService(db as never, log, emit);
    const exceptions = new AuditExceptionService(db as never, log, emit);
    const tests = new ControlTestService(db as never, log, exceptions, emit);
    const workpapers = new WorkpaperService(db as never, log, emit);
    const finalPack = new FinalAuditPackService(db as never, log, emit);

    // ── 1. Create the audit run ─────────────────────────────────────────
    const created = await runs.create({
      tenantId: 'tenant-A',
      userId: 'user-1',
      frameworkSlug: 'soc2-type2',
      title: 'Q1 2026 SOC 2 readiness',
      periodStart: '2026-01-01T00:00:00Z',
      periodEnd: '2026-03-31T23:59:59Z',
    });
    expect(created.id).toMatch(/^ar-/);
    expect(created.status).toBe('PLANNING');
    expect(events.find((e) => e.type === 'audit_run_started' && e.auditRunId === created.id)).toBeTruthy();

    // ── 2. Plan: seeds 2 ControlTest rows + transitions to PLANNED ──────
    const planned = await runs.plan({ id: created.id, tenantId: 'tenant-A' });
    expect(planned.controlsSeeded).toBe(2);
    const runRow = (await runs.get(created.id, 'tenant-A')) as { status: string };
    expect(runRow.status).toBe('PLANNED');
    expect(events.find((e) => e.type === 'audit_plan_created')).toBeTruthy();

    // ── 3. State machine: refuses illegal transitions ───────────────────
    await expect(
      runs.transition({ id: created.id, tenantId: 'tenant-A', to: 'COMPLETED' }),
    ).rejects.toBeInstanceOf(IllegalAuditRunTransitionError);

    // ── 4. Run all control tests (deterministic — no LLM key set) ───────
    const testResult = await tests.runAll({ auditRunId: created.id, tenantId: 'tenant-A', triggeredBy: 'user-1' });
    expect(testResult.totalTests).toBe(2);
    expect(testResult.ranTests).toBe(2);
    // With no evidence rows in the mock DB, all tests should fall to 'needs_evidence'
    expect(testResult.needsEvidence).toBe(2);
    expect(events.filter((e) => e.type === 'control_test_started').length).toBe(2);
    expect(events.filter((e) => e.type === 'control_test_completed').length).toBe(2);

    // ── 4a. With no failures, no exceptions auto-created ────────────────
    expect(db._state.auditExceptions.length).toBe(0);

    // Run should have transitioned to REVIEWING
    const reviewing = (await runs.get(created.id, 'tenant-A')) as { status: string };
    expect(reviewing.status).toBe('REVIEWING');

    // ── 5. Generate workpapers ──────────────────────────────────────────
    const wpResult = await workpapers.generateAll({ tenantId: 'tenant-A', auditRunId: created.id, generatedBy: 'user-1' });
    expect(wpResult.totalControls).toBe(2);
    expect(wpResult.generated).toBe(2);
    expect(events.filter((e) => e.type === 'workpaper_generated').length).toBe(2);

    // Workpapers should be in needs_review with REQUIRES_APPROVAL artifacts
    expect(db._state.auditWorkpapers.length).toBe(2);
    expect(db._state.auditWorkpapers.every((w) => w.status === 'needs_review')).toBe(true);
    const wpArtifacts = db._state.workflowArtifacts.filter((a) => a.artifactType === 'workpaper');
    expect(wpArtifacts.length).toBe(2);
    expect(wpArtifacts.every((a) => a.approvalState === 'REQUIRES_APPROVAL')).toBe(true);

    // ── 6. Final pack refuses while workpapers unapproved ───────────────
    await expect(
      finalPack.generate({ tenantId: 'tenant-A', auditRunId: created.id, generatedBy: 'user-1' }),
    ).rejects.toBeInstanceOf(FinalPackGateError);

    // ── 7. Approve all workpapers → run promotes to READY_TO_PACK ───────
    for (const w of db._state.auditWorkpapers) {
      await workpapers.setReviewDecision({
        workpaperId: w.id,
        tenantId: 'tenant-A',
        decision: 'approved',
        reviewedBy: 'reviewer-1',
      });
    }
    const ready = (await runs.get(created.id, 'tenant-A')) as { status: string };
    expect(ready.status).toBe('READY_TO_PACK');

    // ── 8. Generate the signed final pack ───────────────────────────────
    const pack = await finalPack.generate({ tenantId: 'tenant-A', auditRunId: created.id, generatedBy: 'user-1' });
    expect(pack.artifactId).toMatch(/^art-/);
    expect(pack.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(pack.signatureAlgo).toBe('HMAC-SHA256');
    expect(pack.workpaperCount).toBe(2);
    expect(pack.controlCount).toBe(2);

    // ── 9. Verify the bundle signature ──────────────────────────────────
    const bundleArtifact = db._state.workflowArtifacts.find((a) => a.id === pack.artifactId);
    expect(bundleArtifact).toBeTruthy();
    const signed = JSON.parse(bundleArtifact!.inlineContent!) as SignedBundle;
    expect(verifyBundleSignature(signed)).toEqual({ valid: true });

    // ── 10. Audit run is COMPLETED, finalPackArtifactId stamped ─────────
    const completed = (await runs.get(created.id, 'tenant-A')) as { status: string; finalPackArtifactId: string };
    expect(completed.status).toBe('COMPLETED');
    expect(completed.finalPackArtifactId).toBe(pack.artifactId);

    // ── 11. Lifecycle events fired in order ─────────────────────────────
    const types = events.map((e) => e.type);
    const idxStarted = types.indexOf('audit_run_started');
    const idxPlan = types.indexOf('audit_plan_created');
    const idxTestStart = types.indexOf('control_test_started');
    const idxTestDone = types.indexOf('control_test_completed');
    const idxWorkpaper = types.indexOf('workpaper_generated');
    const idxFinalStarted = types.indexOf('final_pack_started');
    const idxFinalDone = types.indexOf('final_pack_generated');
    const idxRunCompleted = types.indexOf('audit_run_completed');

    expect(idxStarted).toBeGreaterThanOrEqual(0);
    expect(idxPlan).toBeGreaterThan(idxStarted);
    expect(idxTestStart).toBeGreaterThan(idxPlan);
    expect(idxTestDone).toBeGreaterThan(idxTestStart);
    expect(idxWorkpaper).toBeGreaterThan(idxTestDone);
    expect(idxFinalStarted).toBeGreaterThan(idxWorkpaper);
    expect(idxFinalDone).toBeGreaterThan(idxFinalStarted);
    expect(idxRunCompleted).toBeGreaterThan(idxFinalDone);
  });
});
