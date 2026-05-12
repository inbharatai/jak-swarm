/**
 * Unit tests for WorkflowService (apps/api/src/services/workflow.service.ts)
 *
 * What this file covers (vs. what it does NOT)
 * --------------------------------------------
 *  - createWorkflow happy path + tenant scoping (the row carries the supplied
 *    tenantId verbatim; the service never reads tenant from anywhere else).
 *  - resolveApproval: happy path, cross-tenant rejection, payload-binding
 *    mismatch (Item B / OpenClaw-inspired Phase 1), already-decided refusal,
 *    invalid-decision passthrough, transactional ApprovalScope insert,
 *    P2002 swallow on duplicate ApprovalScope row, legacy hash bootstrapping.
 *  - getWorkflow tenant guard, listWorkflows pagination + hasMore math,
 *    cancelWorkflow terminal-state guard, updateWorkflowStatus side-effects
 *    (startedAt on RUNNING, completedAt on terminal), saveTrace persistence
 *    redaction passthrough, createApprovalRequest hash capture,
 *    getWorkflowTraces / getWorkflowApprovals tenant filter.
 *
 * IMPORTANT context surfaced while reading the source:
 *
 *   1. The service performs NO input validation on `createWorkflow` —
 *      goal-too-long, blank-goal, etc. are NOT enforced here. They are
 *      enforced one level up in the route schema (Zod). Requirement (3)
 *      from the brief is therefore impossible to test on this layer; the
 *      relevant cases are kept as `it.todo` so the gap is explicit.
 *
 *   2. `updateWorkflowStatus` calls `assertTransition` from @jak-swarm/swarm
 *      with the Fastify logger. In Phase 5 this is log-only by default
 *      (does NOT throw). We don't try to drive strict-mode (env-flag) here
 *      — the service-level concern is "the row is written"; the lifecycle
 *      assertion has its own coverage in packages/swarm.
 *
 *   3. `resolveApproval` runs the status update + ApprovalScope insert in a
 *      single $transaction. Our fake routes the transaction callback through
 *      the SAME in-memory tables so we observe the post-commit state. We
 *      simulate a P2002 unique-constraint failure by detecting a duplicate
 *      (approvalId, proposedDataHash) pair and throwing { code: 'P2002' }.
 *
 *   4. `resolveApproval` initialises `proposedDataHash` for legacy rows on
 *      first decide. We exercise that path explicitly so a legacy approval
 *      can't slip through with a still-null hash.
 *
 *   5. The brief asks about "invalid decision string → ValidationError". The
 *      service does NOT validate the decision string; whatever is passed is
 *      written straight into `status` and `ApprovalScope.decision`. Schema
 *      validation lives at the route layer. We document this reality: a
 *      bogus decision is persisted (no throw), and the test asserts that —
 *      a behaviour-pinning check rather than a "should-throw".
 */

import { describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

import { WorkflowService } from '../../../apps/api/src/services/workflow.service.js';
import {
  ApprovalPayloadMismatchError,
  ForbiddenError,
  NotFoundError,
  WorkflowStateError,
} from '../../../apps/api/src/errors.js';
import { canonicalHash } from '../../../apps/api/src/utils/canonical-hash.js';

// ───────────────────────────── Fake DB helpers ─────────────────────────────

interface FakeWorkflow {
  id: string;
  tenantId: string;
  userId: string;
  goal: string;
  industry: string | null;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  finalOutput: string | null;
  error: string | null;
  updatedAt: Date;
  totalCostUsd?: number | null;
}

interface FakeAgentTrace {
  id: string;
  workflowId: string;
  tenantId: string;
  traceId: string;
  runId: string;
  agentRole: string;
  stepIndex: number;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  inputJson: unknown;
  outputJson: unknown;
  toolCallsJson: unknown;
  handoffsJson: unknown;
  tokenUsage: unknown;
  error: string | null;
  costUsd: number | null;
}

interface FakeApprovalRequest {
  id: string;
  workflowId: string;
  tenantId: string;
  taskId: string;
  agentRole: string;
  action: string;
  rationale: string;
  proposedDataJson: unknown;
  riskLevel: string;
  status: string;
  proposedDataHash: string | null;
  toolName: string | null;
  filesAffected: string[];
  externalService: string | null;
  idempotencyKey: string | null;
  expectedResult: string | null;
  reviewedBy: string | null;
  comment: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeApprovalScope {
  approvalId: string;
  proposedDataHash: string;
  decision: string;
  approverId: string;
}

function makeFakeDb() {
  const workflows: FakeWorkflow[] = [];
  const traces: FakeAgentTrace[] = [];
  const approvals: FakeApprovalRequest[] = [];
  const scopes: FakeApprovalScope[] = [];

  let cuid = 0;
  const newId = (prefix = 'id') => `${prefix}-${++cuid}`;

  const workflowApi = {
    create: vi.fn(async ({ data }: any) => {
      const w: FakeWorkflow = {
        id: newId('wf'),
        tenantId: data.tenantId,
        userId: data.userId,
        goal: data.goal,
        industry: data.industry ?? null,
        status: data.status,
        startedAt: null,
        completedAt: null,
        finalOutput: null,
        error: null,
        updatedAt: new Date(),
        totalCostUsd: null,
      };
      workflows.push(w);
      return w;
    }),
    findUnique: vi.fn(async ({ where, select }: any) => {
      const w = workflows.find((x) => x.id === where.id);
      if (!w) return null;
      if (select) {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) {
          if (select[k]) out[k] = (w as Record<string, unknown>)[k];
        }
        return out;
      }
      return w;
    }),
    findFirst: vi.fn(async ({ where, select }: any) => {
      const w = workflows.find(
        (x) =>
          (where.id === undefined || x.id === where.id) &&
          (where.tenantId === undefined || x.tenantId === where.tenantId),
      );
      if (!w) return null;
      if (select) {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) {
          if (select[k]) out[k] = (w as Record<string, unknown>)[k];
        }
        return out;
      }
      return w;
    }),
    findMany: vi.fn(async ({ where, orderBy, skip, take, include }: any) => {
      let rows = workflows.slice();
      if (where?.tenantId) rows = rows.filter((w) => w.tenantId === where.tenantId);
      if (where?.status?.in)
        rows = rows.filter((w) => (where.status.in as string[]).includes(w.status));
      if (orderBy?.startedAt === 'desc') {
        rows.sort((a, b) => {
          const at = a.startedAt?.getTime() ?? 0;
          const bt = b.startedAt?.getTime() ?? 0;
          return bt - at;
        });
      }
      const sliced = rows.slice(skip ?? 0, (skip ?? 0) + (take ?? rows.length));
      if (include?._count?.select?.traces) {
        return sliced.map((w) => ({
          ...w,
          _count: {
            traces: traces.filter((t) => t.workflowId === w.id).length,
          },
        }));
      }
      return sliced;
    }),
    count: vi.fn(async ({ where }: any) => {
      let rows = workflows.slice();
      if (where?.tenantId) rows = rows.filter((w) => w.tenantId === where.tenantId);
      if (where?.status?.in)
        rows = rows.filter((w) => (where.status.in as string[]).includes(w.status));
      return rows.length;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const w = workflows.find((x) => x.id === where.id);
      if (!w) throw new Error(`workflow ${where.id} not found`);
      Object.assign(w, data, { updatedAt: new Date() });
      return w;
    }),
  };

  const agentTraceApi = {
    create: vi.fn(async ({ data }: any) => {
      const t: FakeAgentTrace = {
        id: newId('trc'),
        workflowId: data.workflowId,
        tenantId: data.tenantId,
        traceId: data.traceId,
        runId: data.runId,
        agentRole: data.agentRole,
        stepIndex: data.stepIndex,
        startedAt: data.startedAt,
        completedAt: data.completedAt ?? null,
        durationMs: data.durationMs ?? null,
        inputJson: data.inputJson,
        outputJson: data.outputJson,
        toolCallsJson: data.toolCallsJson,
        handoffsJson: data.handoffsJson,
        tokenUsage: data.tokenUsage,
        error: data.error ?? null,
        costUsd: null,
      };
      traces.push(t);
      return t;
    }),
    findMany: vi.fn(async ({ where, orderBy }: any) => {
      let rows = traces.slice();
      if (where?.workflowId) rows = rows.filter((t) => t.workflowId === where.workflowId);
      if (where?.tenantId) rows = rows.filter((t) => t.tenantId === where.tenantId);
      if (orderBy?.startedAt === 'desc') {
        rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      }
      if (orderBy?.stepIndex === 'asc') {
        rows.sort((a, b) => a.stepIndex - b.stepIndex);
      }
      return rows;
    }),
  };

  const approvalRequestApi = {
    create: vi.fn(async ({ data }: any) => {
      const a: FakeApprovalRequest = {
        id: newId('apr'),
        workflowId: data.workflowId,
        tenantId: data.tenantId,
        taskId: data.taskId,
        agentRole: data.agentRole,
        action: data.action,
        rationale: data.rationale,
        proposedDataJson: data.proposedDataJson ?? null,
        riskLevel: data.riskLevel,
        status: data.status,
        proposedDataHash: data.proposedDataHash ?? null,
        toolName: data.toolName ?? null,
        filesAffected: data.filesAffected ?? [],
        externalService: data.externalService ?? null,
        idempotencyKey: data.idempotencyKey ?? null,
        expectedResult: data.expectedResult ?? null,
        reviewedBy: null,
        comment: null,
        reviewedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      approvals.push(a);
      return a;
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      return approvals.find((a) => a.id === where.id) ?? null;
    }),
    findMany: vi.fn(async ({ where, orderBy }: any) => {
      let rows = approvals.slice();
      if (where?.workflowId) rows = rows.filter((a) => a.workflowId === where.workflowId);
      if (where?.tenantId) rows = rows.filter((a) => a.tenantId === where.tenantId);
      if (orderBy?.createdAt === 'desc') {
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return rows;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const a = approvals.find((x) => x.id === where.id);
      if (!a) throw new Error(`approval ${where.id} not found`);
      Object.assign(a, data, { updatedAt: new Date() });
      return a;
    }),
  };

  const approvalScopeApi = {
    create: vi.fn(async ({ data }: any) => {
      // Mimic Prisma's @@unique([approvalId, proposedDataHash]) — duplicate
      // pair raises code P2002. The service swallows P2002 specifically;
      // any other thrown error propagates.
      const dup = scopes.find(
        (s) =>
          s.approvalId === data.approvalId && s.proposedDataHash === data.proposedDataHash,
      );
      if (dup) {
        const e = new Error('Unique constraint failed') as Error & { code: string };
        e.code = 'P2002';
        throw e;
      }
      const s: FakeApprovalScope = {
        approvalId: data.approvalId,
        proposedDataHash: data.proposedDataHash,
        decision: data.decision,
        approverId: data.approverId,
      };
      scopes.push(s);
      return s;
    }),
  };

  // The service uses `this.db.$transaction(async (tx) => …)`. The fake routes
  // tx through the SAME tables so the post-commit state is observable from
  // the top-level db too. No real isolation/rollback (not needed for these
  // tests — none of them simulate aborted transactions).
  const tx = {
    workflow: workflowApi,
    agentTrace: agentTraceApi,
    approvalRequest: approvalRequestApi,
    approvalScope: approvalScopeApi,
  };

  const db: any = {
    ...tx,
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };

  return {
    db,
    _state: { workflows, traces, approvals, scopes },
  };
}

function makeFakeLog(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => makeFakeLog()),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

// ───────────────────────────── Tests ─────────────────────────────

describe('WorkflowService.createWorkflow', () => {
  it('creates a row in PENDING with the supplied tenantId / userId / goal / industry', async () => {
    const { db, _state } = makeFakeDb();
    const log = makeFakeLog();
    const svc = new WorkflowService(db, log);

    const wf = await svc.createWorkflow('tnt-A', 'usr-1', 'Find churn risks', 'TECH');

    expect(wf.tenantId).toBe('tnt-A');
    expect(wf.createdBy).toBe('usr-1');
    expect(wf.goal).toBe('Find churn risks');
    expect(wf.industry).toBe('TECH');
    expect(wf.status).toBe('PENDING');
    expect(_state.workflows).toHaveLength(1);
    expect(_state.workflows[0]!.status).toBe('PENDING');
    // Logger gets the workflowId + tenantId tag (used by ops dashboards).
    expect(log.info).toHaveBeenCalledWith(
      { workflowId: wf.id, tenantId: 'tnt-A' },
      'Workflow created',
    );
  });

  it('coerces an undefined industry to null', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());

    const wf = await svc.createWorkflow('tnt-A', 'usr-1', 'Goal');

    expect(wf.industry).toBeNull();
    expect(_state.workflows[0]!.industry).toBeNull();
  });

  it('writes the supplied tenantId verbatim — caller is responsible for tenant scoping', async () => {
    // Tenant scoping is enforced at the route layer (auth → tenantId from
    // JWT). The service writes whatever it is told. This pins that contract:
    // two workflows with different tenantIds end up in different rows; one
    // tenant cannot accidentally land in another tenant's row.
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());

    const a = await svc.createWorkflow('tnt-A', 'usr-1', 'A goal');
    const b = await svc.createWorkflow('tnt-B', 'usr-2', 'B goal');

    expect(a.tenantId).toBe('tnt-A');
    expect(b.tenantId).toBe('tnt-B');
    expect(a.id).not.toBe(b.id);
    expect(_state.workflows.find((w) => w.id === a.id)!.tenantId).toBe('tnt-A');
    expect(_state.workflows.find((w) => w.id === b.id)!.tenantId).toBe('tnt-B');
  });

  it.todo(
    'rejects goal > N chars / blank goal — validation lives in the route schema (Zod), not the service. Move this assertion to the route-level test once those exist.',
  );
});

describe('WorkflowService.getWorkflow', () => {
  it('returns the workflow when tenant matches', async () => {
    const { db } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const created = await svc.createWorkflow('tnt-A', 'usr-1', 'goal');

    const fetched = await svc.getWorkflow('tnt-A', created.id);
    expect(fetched.id).toBe(created.id);
  });

  it('throws NotFoundError when the row does not exist', async () => {
    const { db } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    await expect(svc.getWorkflow('tnt-A', 'wf-missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError on cross-tenant access', async () => {
    const { db } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const created = await svc.createWorkflow('tnt-A', 'usr-1', 'goal');
    await expect(svc.getWorkflow('tnt-B', created.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('WorkflowService.listWorkflows', () => {
  it('paginates by tenant and computes hasMore correctly', async () => {
    const { db } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());

    // 3 workflows for tnt-A, 1 for tnt-B
    await svc.createWorkflow('tnt-A', 'u', 'g1');
    await svc.createWorkflow('tnt-A', 'u', 'g2');
    await svc.createWorkflow('tnt-A', 'u', 'g3');
    await svc.createWorkflow('tnt-B', 'u', 'g4');

    const page1 = await svc.listWorkflows('tnt-A', { page: 1, limit: 2 });
    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    // No tnt-B leakage.
    for (const w of page1.items) expect(w.tenantId).toBe('tnt-A');

    const page2 = await svc.listWorkflows('tnt-A', { page: 2, limit: 2 });
    expect(page2.total).toBe(3);
    expect(page2.items).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });

  it('filters by single status', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());

    const a = await svc.createWorkflow('tnt-A', 'u', 'g1');
    await svc.createWorkflow('tnt-A', 'u', 'g2');
    // Mutate one status directly to COMPLETED via the db fake.
    _state.workflows.find((w) => w.id === a.id)!.status = 'COMPLETED';

    const result = await svc.listWorkflows('tnt-A', {
      page: 1,
      limit: 10,
      status: 'COMPLETED',
    });
    expect(result.total).toBe(1);
    expect(result.items[0]!.status).toBe('COMPLETED');
  });

  it('exposes traceCount via _count include', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());

    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');
    // Seed two traces against this workflow.
    _state.traces.push({
      id: 't1',
      workflowId: wf.id,
      tenantId: 'tnt-A',
      traceId: 'tr1',
      runId: 'r1',
      agentRole: 'planner',
      stepIndex: 0,
      startedAt: new Date(),
      completedAt: null,
      durationMs: null,
      inputJson: null,
      outputJson: null,
      toolCallsJson: null,
      handoffsJson: null,
      tokenUsage: null,
      error: null,
      costUsd: null,
    });
    _state.traces.push({
      id: 't2',
      workflowId: wf.id,
      tenantId: 'tnt-A',
      traceId: 'tr2',
      runId: 'r1',
      agentRole: 'router',
      stepIndex: 1,
      startedAt: new Date(),
      completedAt: null,
      durationMs: null,
      inputJson: null,
      outputJson: null,
      toolCallsJson: null,
      handoffsJson: null,
      tokenUsage: null,
      error: null,
      costUsd: null,
    });

    const result = await svc.listWorkflows('tnt-A', { page: 1, limit: 10 });
    expect(result.items[0]!.traceCount).toBe(2);
  });
});

describe('WorkflowService.cancelWorkflow', () => {
  it('cancels a running workflow', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');
    // Move out of PENDING so the cancel actually flips status.
    _state.workflows.find((w) => w.id === wf.id)!.status = 'RUNNING';

    const cancelled = await svc.cancelWorkflow('tnt-A', wf.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.completedAt).toBeInstanceOf(Date);
  });

  it('refuses to cancel a workflow already in a terminal state', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');
    _state.workflows.find((w) => w.id === wf.id)!.status = 'COMPLETED';

    await expect(svc.cancelWorkflow('tnt-A', wf.id)).rejects.toBeInstanceOf(WorkflowStateError);
  });

  it('refuses cross-tenant cancel via getWorkflow guard', async () => {
    const { db } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');
    await expect(svc.cancelWorkflow('tnt-B', wf.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('WorkflowService.updateWorkflowStatus', () => {
  it('stamps startedAt when transitioning to RUNNING', async () => {
    const { db } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');

    const updated = await svc.updateWorkflowStatus(wf.id, 'RUNNING');
    expect(updated.status).toBe('RUNNING');
    expect(updated.startedAt).toBeInstanceOf(Date);
    expect(updated.completedAt).toBeNull();
  });

  it('stamps completedAt + error string on FAILED', async () => {
    const { db } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');

    const updated = await svc.updateWorkflowStatus(wf.id, 'FAILED', 'agent crashed');
    expect(updated.status).toBe('FAILED');
    expect(updated.completedAt).toBeInstanceOf(Date);
    expect(updated.error).toBe('agent crashed');
  });
});

describe('WorkflowService.saveTrace', () => {
  it('persists a trace row with redaction passthrough on JSON columns', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');

    await svc.saveTrace({
      workflowId: wf.id,
      tenantId: 'tnt-A',
      traceId: 'tr-1',
      runId: 'run-1',
      agentRole: 'planner',
      stepIndex: 0,
      startedAt: new Date(),
      // The persistence redactor scrubs these — we just want to confirm the
      // service forwards them (and the stub doesn't blow up on plain values).
      inputJson: { hello: 'world' },
      outputJson: { ok: true },
      toolCallsJson: { calls: [] },
      handoffsJson: { handoff: null },
      tokenUsage: { inputTokens: 10, outputTokens: 20 },
    });

    expect(_state.traces).toHaveLength(1);
    const t = _state.traces[0]!;
    expect(t.workflowId).toBe(wf.id);
    expect(t.tenantId).toBe('tnt-A');
    expect(t.agentRole).toBe('planner');
    expect(t.stepIndex).toBe(0);
    // Redactor returns an object of the same shape for plain key/values.
    expect(t.inputJson).toEqual({ hello: 'world' });
    expect(t.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });
});

describe('WorkflowService.createApprovalRequest', () => {
  it('captures a canonical hash of proposedDataJson on create', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');

    const proposed = { z: 1, a: 2 };
    const expectedHash = canonicalHash(proposed);

    await svc.createApprovalRequest({
      workflowId: wf.id,
      tenantId: 'tnt-A',
      taskId: 'task-1',
      agentRole: 'router',
      action: 'send_email',
      rationale: 'because',
      proposedDataJson: proposed,
      riskLevel: 'MEDIUM',
    });

    expect(_state.approvals).toHaveLength(1);
    expect(_state.approvals[0]!.proposedDataHash).toBe(expectedHash);
  });

  it('stores null hash when no proposedDataJson provided', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');

    await svc.createApprovalRequest({
      workflowId: wf.id,
      tenantId: 'tnt-A',
      taskId: 'task-1',
      agentRole: 'router',
      action: 'noop',
      rationale: 'because',
      riskLevel: 'LOW',
    });
    expect(_state.approvals[0]!.proposedDataHash).toBeNull();
  });
});

describe('WorkflowService.resolveApproval', () => {
  it('happy path: PENDING → APPROVED, writes ApprovalScope, propagates reviewer + comment', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');

    const proposed = { foo: 'bar' };
    const created = await svc.createApprovalRequest({
      workflowId: wf.id,
      tenantId: 'tnt-A',
      taskId: 'task-1',
      agentRole: 'router',
      action: 'send_email',
      rationale: 'r',
      proposedDataJson: proposed,
      riskLevel: 'MEDIUM',
    });
    const expectedHash = canonicalHash(proposed);

    const result = await svc.resolveApproval(
      'tnt-A',
      created.id,
      'APPROVED' as any,
      'usr-reviewer',
      'looks good',
    );

    expect(result.status).toBe('APPROVED');
    expect(_state.approvals[0]!.status).toBe('APPROVED');
    expect(_state.approvals[0]!.reviewedBy).toBe('usr-reviewer');
    expect(_state.approvals[0]!.comment).toBe('looks good');
    expect(_state.approvals[0]!.reviewedAt).toBeInstanceOf(Date);
    // Audit row.
    expect(_state.scopes).toHaveLength(1);
    expect(_state.scopes[0]).toEqual({
      approvalId: created.id,
      proposedDataHash: expectedHash,
      decision: 'APPROVED',
      approverId: 'usr-reviewer',
    });
  });

  it('throws NotFoundError on a missing approvalId', async () => {
    const { db } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    await expect(
      svc.resolveApproval('tnt-A', 'apr-missing', 'APPROVED' as any, 'u'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses cross-tenant decide (ForbiddenError)', async () => {
    const { db } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');
    const created = await svc.createApprovalRequest({
      workflowId: wf.id,
      tenantId: 'tnt-A',
      taskId: 't',
      agentRole: 'r',
      action: 'a',
      rationale: 'r',
      proposedDataJson: {},
      riskLevel: 'LOW',
    });

    await expect(
      svc.resolveApproval('tnt-B', created.id, 'APPROVED' as any, 'u'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ApprovalPayloadMismatchError when proposedDataJson was mutated post-create (replay protection)', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');
    const created = await svc.createApprovalRequest({
      workflowId: wf.id,
      tenantId: 'tnt-A',
      taskId: 't',
      agentRole: 'r',
      action: 'send_email',
      rationale: 'r',
      proposedDataJson: { to: 'a@b.com', amount: 10 },
      riskLevel: 'HIGH',
    });

    // Simulate an attacker / buggy code path mutating proposedData after
    // the approval was created but before it is decided.
    _state.approvals[0]!.proposedDataJson = { to: 'evil@b.com', amount: 9999 };

    await expect(
      svc.resolveApproval('tnt-A', created.id, 'APPROVED' as any, 'usr-r'),
    ).rejects.toBeInstanceOf(ApprovalPayloadMismatchError);

    // Status is unchanged; ApprovalScope NOT written.
    expect(_state.approvals[0]!.status).toBe('PENDING');
    expect(_state.scopes).toHaveLength(0);
  });

  it('refuses to decide an already-decided approval (WorkflowStateError, idempotency boundary)', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');
    const created = await svc.createApprovalRequest({
      workflowId: wf.id,
      tenantId: 'tnt-A',
      taskId: 't',
      agentRole: 'r',
      action: 'a',
      rationale: 'r',
      proposedDataJson: { x: 1 },
      riskLevel: 'LOW',
    });

    await svc.resolveApproval('tnt-A', created.id, 'APPROVED' as any, 'usr-r');
    expect(_state.approvals[0]!.status).toBe('APPROVED');

    // Second decide should be refused — the source explicitly throws on
    // any non-PENDING status. (NB: the brief asked "idempotent OR refuses"
    // — the source refuses; this test pins the actual behaviour.)
    await expect(
      svc.resolveApproval('tnt-A', created.id, 'REJECTED' as any, 'usr-r'),
    ).rejects.toBeInstanceOf(WorkflowStateError);
  });

  it('initialises proposedDataHash for a legacy row on first decide (no prior hash → bootstrap)', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');

    // Seed an approval that pre-dates Item B (no stored hash) directly into
    // the fake table to simulate a legacy migrated row.
    const legacy: FakeApprovalRequest = {
      id: 'apr-legacy',
      workflowId: wf.id,
      tenantId: 'tnt-A',
      taskId: 't',
      agentRole: 'r',
      action: 'a',
      rationale: 'r',
      proposedDataJson: { foo: 'bar' },
      riskLevel: 'LOW',
      status: 'PENDING',
      proposedDataHash: null, // ← legacy: no hash yet
      toolName: null,
      filesAffected: [],
      externalService: null,
      idempotencyKey: null,
      expectedResult: null,
      reviewedBy: null,
      comment: null,
      reviewedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    _state.approvals.push(legacy);

    await svc.resolveApproval('tnt-A', 'apr-legacy', 'APPROVED' as any, 'usr-r');

    const expectedHash = canonicalHash({ foo: 'bar' });
    expect(_state.approvals[0]!.status).toBe('APPROVED');
    expect(_state.approvals[0]!.proposedDataHash).toBe(expectedHash);
    // ApprovalScope row also written.
    expect(_state.scopes).toHaveLength(1);
    expect(_state.scopes[0]!.proposedDataHash).toBe(expectedHash);
  });

  it('persists invalid/unknown decision strings as-is (validation lives in route layer)', async () => {
    // The service has no allow-list for decision strings — anything stringy
    // is written into ApprovalRequest.status. ValidationError comes from the
    // route schema (Zod), not from this service. Pin actual behaviour.
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');
    const created = await svc.createApprovalRequest({
      workflowId: wf.id,
      tenantId: 'tnt-A',
      taskId: 't',
      agentRole: 'r',
      action: 'a',
      rationale: 'r',
      proposedDataJson: { x: 1 },
      riskLevel: 'LOW',
    });

    const result = await svc.resolveApproval(
      'tnt-A',
      created.id,
      'BANANA' as any, // ← bogus decision
      'usr-r',
    );
    expect(result.status).toBe('BANANA');
    expect(_state.approvals[0]!.status).toBe('BANANA');
    expect(_state.scopes[0]!.decision).toBe('BANANA');
  });

  it.todo(
    'rejects invalid decision strings with ValidationError — actually enforced at the route schema, NOT the service. Move once a route-level test is added.',
  );

  it('swallows P2002 on duplicate ApprovalScope insert (idempotent retry of the same hash)', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');
    const created = await svc.createApprovalRequest({
      workflowId: wf.id,
      tenantId: 'tnt-A',
      taskId: 't',
      agentRole: 'r',
      action: 'a',
      rationale: 'r',
      proposedDataJson: { x: 1 },
      riskLevel: 'LOW',
    });

    // Pre-seed an ApprovalScope row with the same (approvalId, hash) the
    // service will compute. The second insert from the service will trip
    // the unique constraint and throw P2002 — which the service swallows.
    const expectedHash = canonicalHash({ x: 1 });
    _state.scopes.push({
      approvalId: created.id,
      proposedDataHash: expectedHash,
      decision: 'APPROVED',
      approverId: 'someone-else',
    });

    // Should NOT throw despite the duplicate.
    const out = await svc.resolveApproval(
      'tnt-A',
      created.id,
      'APPROVED' as any,
      'usr-r',
    );
    expect(out.status).toBe('APPROVED');
    // ApprovalScope still has the original (no second row inserted).
    expect(_state.scopes).toHaveLength(1);
    expect(_state.scopes[0]!.approverId).toBe('someone-else');
  });

  it('propagates non-P2002 errors from ApprovalScope.create', async () => {
    const { db } = makeFakeDb();
    // Override approvalScope.create to throw a non-P2002 error.
    db.approvalScope.create = vi.fn(async () => {
      const e = new Error('connection terminated') as Error & { code: string };
      e.code = 'P1001'; // Prisma "can't reach DB" — must NOT be swallowed.
      throw e;
    });

    const svc = new WorkflowService(db, makeFakeLog());
    const wf = await svc.createWorkflow('tnt-A', 'u', 'g');
    const created = await svc.createApprovalRequest({
      workflowId: wf.id,
      tenantId: 'tnt-A',
      taskId: 't',
      agentRole: 'r',
      action: 'a',
      rationale: 'r',
      proposedDataJson: { x: 1 },
      riskLevel: 'LOW',
    });

    await expect(
      svc.resolveApproval('tnt-A', created.id, 'APPROVED' as any, 'usr-r'),
    ).rejects.toThrow(/connection terminated/);
  });
});

describe('WorkflowService.getWorkflowTraces / getWorkflowApprovals', () => {
  it('getWorkflowTraces filters by both workflowId AND tenantId', async () => {
    const { db, _state } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wfA = await svc.createWorkflow('tnt-A', 'u', 'g');
    const wfB = await svc.createWorkflow('tnt-B', 'u', 'g');

    _state.traces.push(
      {
        id: 't1',
        workflowId: wfA.id,
        tenantId: 'tnt-A',
        traceId: 'tr1',
        runId: 'r1',
        agentRole: 'a',
        stepIndex: 0,
        startedAt: new Date('2026-01-01T00:00:00Z'),
        completedAt: null,
        durationMs: null,
        inputJson: null,
        outputJson: null,
        toolCallsJson: null,
        handoffsJson: null,
        tokenUsage: null,
        error: null,
        costUsd: null,
      },
      {
        id: 't2',
        workflowId: wfB.id,
        tenantId: 'tnt-B',
        traceId: 'tr2',
        runId: 'r2',
        agentRole: 'a',
        stepIndex: 0,
        startedAt: new Date('2026-01-02T00:00:00Z'),
        completedAt: null,
        durationMs: null,
        inputJson: null,
        outputJson: null,
        toolCallsJson: null,
        handoffsJson: null,
        tokenUsage: null,
        error: null,
        costUsd: null,
      },
    );

    const aTraces = await svc.getWorkflowTraces('tnt-A', wfA.id);
    expect(aTraces).toHaveLength(1);
    expect(aTraces[0]!.tenantId).toBe('tnt-A');

    // Wrong tenant → empty list (no leak), even if workflowId matches.
    const bogus = await svc.getWorkflowTraces('tnt-B', wfA.id);
    expect(bogus).toHaveLength(0);
  });

  it('getWorkflowApprovals filters by both workflowId AND tenantId', async () => {
    const { db } = makeFakeDb();
    const svc = new WorkflowService(db, makeFakeLog());
    const wfA = await svc.createWorkflow('tnt-A', 'u', 'g');

    await svc.createApprovalRequest({
      workflowId: wfA.id,
      tenantId: 'tnt-A',
      taskId: 't',
      agentRole: 'r',
      action: 'a',
      rationale: 'r',
      proposedDataJson: {},
      riskLevel: 'LOW',
    });

    const fromA = await svc.getWorkflowApprovals('tnt-A', wfA.id);
    expect(fromA).toHaveLength(1);
    const fromB = await svc.getWorkflowApprovals('tnt-B', wfA.id);
    expect(fromB).toHaveLength(0);
  });
});
