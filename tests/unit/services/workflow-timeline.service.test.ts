/**
 * Unit tests for buildWorkflowTimeline (apps/api/src/services/workflow-timeline.service.ts)
 *
 * What this file covers (vs. what it does NOT)
 * --------------------------------------------
 *  - Public surface: the module exports a SINGLE async function
 *    `buildWorkflowTimeline(db, workflowId, tenantId)` returning either a
 *    `WorkflowTimeline` object or `null` (when the workflow does not exist
 *    or the tenant does not own it). No other public methods.
 *
 *  - Tenant scoping is enforced by `db.workflow.findFirst({ where: { id, tenantId } })`
 *    — the same id under a different tenant returns null. We test both
 *    directions explicitly so an accidental drop of the `tenantId` clause
 *    in the where would surface immediately.
 *
 *  - Aggregations: per-trace cost (via @jak-swarm/shared `calculateCost`),
 *    per-agent / per-provider / per-model cost rollups, totals, node count,
 *    duration sum, token sums.
 *
 *  - Ordering: returned `nodes` array MUST be sorted by stepIndex ASC even
 *    when the DB returned a different order (the source sorts the array
 *    AFTER computing the critical path — see the in-place .sort() on the
 *    second-to-last line of the function). We verify this explicitly because
 *    the source mutates the same array used by criticalPath, which is a
 *    surprising-but-intentional ordering invariant worth pinning.
 *
 *  - Critical path: the top-5 by durationMs DESC. We pin both the count cap
 *    AND the ordering because that's the contract the UI's DAG inspector
 *    relies on.
 *
 *  - Cost source-of-truth: when the workflow row carries a non-null
 *    `totalCostUsd`, the returned `totalCostUsd` MUST be that stored value
 *    (NOT the per-trace re-sum). The source uses
 *    `workflow.totalCostUsd ?? totalCostUsd` so we test both branches.
 *
 *  - toolCalls count handles non-array shapes safely (the source has a
 *    `Array.isArray(...)? : []` guard — non-array → 0).
 *
 *  - tokenUsage missing → defaults: model='unknown', provider='unknown',
 *    inputTokens=0, outputTokens=0. costUsd via calculateCost('unknown', 0, 0)
 *    is 0 (the unknown-model warn path is not exercised because tokens=0).
 *
 *  - startedAt/completedAt are stringified via toISOString when present,
 *    null otherwise.
 *
 * IMPORTANT context surfaced while reading the source:
 *
 *   1. The function takes a `PrismaClient` directly (NOT a service instance)
 *      and has NO logger dependency — so there is nothing to mock on the
 *      logging side. The brief asked us to "mock fastify.log"; for THIS
 *      service that's a no-op (kept the request from confusing later
 *      readers — the symmetric workflow.service test file does mock it).
 *
 *   2. `criticalPath` is computed from a `nodes.sort((a,b) => b - a)` which
 *      mutates `nodes` in place. The function then re-sorts `nodes` ASC
 *      before returning. So:
 *        - the FIRST-pass sort happens first, then top-5 sliced for criticalPath
 *        - the SECOND-pass sort restores stepIndex ASC for the returned array
 *      This means criticalPath is the TOP-5 BY DURATION, not the LONGEST CHAIN.
 *      The variable name is slightly misleading; we test the actual behaviour.
 *
 *   3. `calculateCost` from @jak-swarm/shared is imported at the top of the
 *      service. We don't mock it — we feed it real model names (e.g.
 *      'gpt-5.4-mini') with known per-1M prices and verify the math directly.
 *      Mocking calculateCost would hide the integration with the pricing
 *      table, which is exactly the bug class the source's docstring says it
 *      is paranoid about (gpt-4.1 silently $0).
 *
 *   4. There's a single subtle precision risk: floating-point token-cost
 *      math accumulates rounding error. Tests use `toBeCloseTo(...)` with
 *      sensible precision rather than strict equality.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildWorkflowTimeline,
  type WorkflowTimeline,
} from '../../../apps/api/src/services/workflow-timeline.service.js';

// ───────────────────────────── Fake DB ─────────────────────────────

interface FakeWorkflow {
  id: string;
  tenantId: string;
  status: string;
  goal: string;
  totalCostUsd: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface FakeAgentTrace {
  id: string;
  workflowId: string;
  tenantId: string;
  agentRole: string;
  stepIndex: number;
  durationMs: number | null;
  tokenUsage: unknown;
  toolCallsJson: unknown;
}

function makeFakeDb(seed?: { workflows?: FakeWorkflow[]; traces?: FakeAgentTrace[] }) {
  const workflows: FakeWorkflow[] = seed?.workflows ? [...seed.workflows] : [];
  const traces: FakeAgentTrace[] = seed?.traces ? [...seed.traces] : [];

  const db: any = {
    workflow: {
      findFirst: vi.fn(async ({ where, select }: any) => {
        const w = workflows.find(
          (x) =>
            (where.id === undefined || x.id === where.id) &&
            (where.tenantId === undefined || x.tenantId === where.tenantId),
        );
        if (!w) return null;
        if (!select) return w;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) {
          if (select[k]) out[k] = (w as Record<string, unknown>)[k];
        }
        return out;
      }),
    },
    agentTrace: {
      findMany: vi.fn(async ({ where, orderBy }: any) => {
        let rows = traces.slice();
        if (where?.workflowId) rows = rows.filter((t) => t.workflowId === where.workflowId);
        if (where?.tenantId) rows = rows.filter((t) => t.tenantId === where.tenantId);
        if (orderBy?.stepIndex === 'asc') {
          rows.sort((a, b) => a.stepIndex - b.stepIndex);
        }
        if (orderBy?.stepIndex === 'desc') {
          rows.sort((a, b) => b.stepIndex - a.stepIndex);
        }
        return rows;
      }),
    },
  };

  return { db, _state: { workflows, traces } };
}

// ───────────────────────────── Tests ─────────────────────────────

describe('buildWorkflowTimeline', () => {
  it('returns null when the workflow does not exist', async () => {
    const { db } = makeFakeDb();
    const result = await buildWorkflowTimeline(db, 'wf-missing', 'tnt-A');
    expect(result).toBeNull();
  });

  it('returns null when the workflow exists but belongs to a different tenant (tenant scoping)', async () => {
    const { db } = makeFakeDb({
      workflows: [
        {
          id: 'wf-1',
          tenantId: 'tnt-A',
          status: 'COMPLETED',
          goal: 'g',
          totalCostUsd: null,
          startedAt: null,
          completedAt: null,
        },
      ],
    });

    // Same id, wrong tenant — must NOT leak.
    const result = await buildWorkflowTimeline(db, 'wf-1', 'tnt-B');
    expect(result).toBeNull();
  });

  it('returns a timeline with empty aggregates when the workflow has no traces', async () => {
    const startedAt = new Date('2026-04-01T10:00:00.000Z');
    const completedAt = new Date('2026-04-01T10:05:00.000Z');
    const { db } = makeFakeDb({
      workflows: [
        {
          id: 'wf-1',
          tenantId: 'tnt-A',
          status: 'COMPLETED',
          goal: 'Empty wf',
          totalCostUsd: null,
          startedAt,
          completedAt,
        },
      ],
    });

    const tl = (await buildWorkflowTimeline(db, 'wf-1', 'tnt-A'))!;
    expect(tl).not.toBeNull();
    expect(tl.workflowId).toBe('wf-1');
    expect(tl.tenantId).toBe('tnt-A');
    expect(tl.status).toBe('COMPLETED');
    expect(tl.goal).toBe('Empty wf');
    expect(tl.nodes).toEqual([]);
    expect(tl.nodeCount).toBe(0);
    expect(tl.totalCostUsd).toBe(0);
    expect(tl.totalDurationMs).toBe(0);
    expect(tl.totalInputTokens).toBe(0);
    expect(tl.totalOutputTokens).toBe(0);
    expect(tl.criticalPath).toEqual([]);
    expect(tl.costByAgent).toEqual({});
    expect(tl.costByProvider).toEqual({});
    expect(tl.costByModel).toEqual({});
    expect(tl.startedAt).toBe(startedAt.toISOString());
    expect(tl.completedAt).toBe(completedAt.toISOString());
  });

  it('aggregates per-trace cost / tokens / duration and groups by agent/provider/model', async () => {
    // Use real pricing entries so the math is verifiable:
    //   gpt-5.4-mini  → input $0.50 / 1M, output $2.00 / 1M
    //   gpt-5.4       → input $5.00 / 1M, output $15.00 / 1M
    const { db } = makeFakeDb({
      workflows: [
        {
          id: 'wf-1',
          tenantId: 'tnt-A',
          status: 'COMPLETED',
          goal: 'g',
          totalCostUsd: null, // ← NOT preset, so re-sum is used
          startedAt: new Date('2026-04-01T10:00:00.000Z'),
          completedAt: new Date('2026-04-01T10:10:00.000Z'),
        },
      ],
      traces: [
        {
          id: 't1',
          workflowId: 'wf-1',
          tenantId: 'tnt-A',
          agentRole: 'planner',
          stepIndex: 0,
          durationMs: 1200,
          tokenUsage: {
            inputTokens: 1_000_000,
            outputTokens: 500_000,
            model: 'gpt-5.4-mini',
            provider: 'openai',
          },
          toolCallsJson: [{ name: 'search' }, { name: 'read' }],
        },
        {
          id: 't2',
          workflowId: 'wf-1',
          tenantId: 'tnt-A',
          agentRole: 'router',
          stepIndex: 1,
          durationMs: 800,
          tokenUsage: {
            inputTokens: 500_000,
            outputTokens: 200_000,
            model: 'gpt-5.4',
            provider: 'openai',
          },
          toolCallsJson: [],
        },
      ],
    });

    const tl = (await buildWorkflowTimeline(db, 'wf-1', 'tnt-A'))!;

    // Per-trace cost spot-check.
    //   t1: 1M * 0.50/1M + 0.5M * 2.00/1M = 0.50 + 1.00 = 1.50 USD
    //   t2: 0.5M * 0.80/1M + 0.2M * 4.00/1M = 0.40 + 0.80 = 1.20 USD
    expect(tl.nodeCount).toBe(2);
    expect(tl.nodes[0]!.costUsd).toBeCloseTo(1.5, 6);
    expect(tl.nodes[1]!.costUsd).toBeCloseTo(5.5, 6);
    expect(tl.totalCostUsd).toBeCloseTo(7.0, 6);
    expect(tl.totalDurationMs).toBe(2000);
    expect(tl.totalInputTokens).toBe(1_500_000);
    expect(tl.totalOutputTokens).toBe(700_000);

    // toolCalls count is the array length when toolCallsJson is an array.
    expect(tl.nodes[0]!.toolCalls).toBe(2);
    expect(tl.nodes[1]!.toolCalls).toBe(0);

    // Group rollups.
    expect(tl.costByAgent).toEqual({
      planner: expect.closeTo(1.5, 6) as unknown as number,
      router: expect.closeTo(5.5, 6) as unknown as number,
    });
    expect(Object.keys(tl.costByProvider).sort()).toEqual(['openai']);
    expect(tl.costByProvider['openai']).toBeCloseTo(7.0, 6);
    expect(Object.keys(tl.costByModel).sort()).toEqual([
      'gpt-5.4',
      'gpt-5.4-mini',
    ]);
  });

  it('returned nodes are ordered by stepIndex ASC even when the DB returned them out of order', async () => {
    // Seed traces deliberately reversed AND ask the fake DB to NOT honour
    // the orderBy (we re-implement orderBy honouring it but flip after).
    const { db, _state } = makeFakeDb({
      workflows: [
        {
          id: 'wf-1',
          tenantId: 'tnt-A',
          status: 'COMPLETED',
          goal: 'g',
          totalCostUsd: null,
          startedAt: null,
          completedAt: null,
        },
      ],
    });

    // Push in scrambled order with various step indices.
    _state.traces.push(
      mkTrace('wf-1', 'agentC', 2, 100, 'gpt-5.4-mini'),
      mkTrace('wf-1', 'agentA', 0, 100, 'gpt-5.4-mini'),
      mkTrace('wf-1', 'agentB', 1, 100, 'gpt-5.4-mini'),
    );

    // Patch findMany to ignore orderBy entirely (simulates a future
    // refactor that drops the order-by clause — the service should STILL
    // return nodes sorted by stepIndex because of its own .sort() call).
    db.agentTrace.findMany = vi.fn(async ({ where }: any) => {
      let rows = _state.traces.slice();
      if (where?.workflowId) rows = rows.filter((t) => t.workflowId === where.workflowId);
      if (where?.tenantId) rows = rows.filter((t) => t.tenantId === where.tenantId);
      // Deliberately scrambled.
      return rows.reverse();
    });

    const tl = (await buildWorkflowTimeline(db, 'wf-1', 'tnt-A'))!;
    expect(tl.nodes.map((n) => n.stepIndex)).toEqual([0, 1, 2]);
    expect(tl.nodes.map((n) => n.agentRole)).toEqual(['agentA', 'agentB', 'agentC']);
  });

  it('criticalPath is the TOP-5 nodes by durationMs DESC (cap + ordering)', async () => {
    const { db, _state } = makeFakeDb({
      workflows: [
        {
          id: 'wf-1',
          tenantId: 'tnt-A',
          status: 'COMPLETED',
          goal: 'g',
          totalCostUsd: null,
          startedAt: null,
          completedAt: null,
        },
      ],
    });

    // 7 traces with descending durations 700,600,500,400,300,200,100 ms.
    // Critical path should pick the top 5: roles a700,a600,a500,a400,a300.
    _state.traces.push(
      mkTrace('wf-1', 'a100', 6, 100, 'gpt-5.4-mini'),
      mkTrace('wf-1', 'a200', 5, 200, 'gpt-5.4-mini'),
      mkTrace('wf-1', 'a300', 4, 300, 'gpt-5.4-mini'),
      mkTrace('wf-1', 'a400', 3, 400, 'gpt-5.4-mini'),
      mkTrace('wf-1', 'a500', 2, 500, 'gpt-5.4-mini'),
      mkTrace('wf-1', 'a600', 1, 600, 'gpt-5.4-mini'),
      mkTrace('wf-1', 'a700', 0, 700, 'gpt-5.4-mini'),
    );

    const tl = (await buildWorkflowTimeline(db, 'wf-1', 'tnt-A'))!;
    expect(tl.criticalPath).toEqual(['a700', 'a600', 'a500', 'a400', 'a300']);
    // Returned nodes still sorted ASC by stepIndex (the second sort wins).
    expect(tl.nodes.map((n) => n.stepIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('uses the stored workflow.totalCostUsd when present (does NOT overwrite with the per-trace re-sum)', async () => {
    const { db } = makeFakeDb({
      workflows: [
        {
          id: 'wf-1',
          tenantId: 'tnt-A',
          status: 'COMPLETED',
          goal: 'g',
          totalCostUsd: 99.99, // ← preset
          startedAt: null,
          completedAt: null,
        },
      ],
      traces: [mkTrace('wf-1', 'a', 0, 100, 'gpt-5.4-mini', 1000, 1000)],
    });

    const tl = (await buildWorkflowTimeline(db, 'wf-1', 'tnt-A'))!;
    // Stored value wins over the freshly-computed per-trace sum (which
    // would be tiny — a fraction of a cent on these tokens).
    expect(tl.totalCostUsd).toBe(99.99);
    // Per-node costUsd is still computed from calculateCost and is small.
    expect(tl.nodes[0]!.costUsd).toBeGreaterThan(0);
    expect(tl.nodes[0]!.costUsd).toBeLessThan(1);
  });

  it('handles missing tokenUsage and missing durationMs by defaulting to 0 / "unknown"', async () => {
    const { db } = makeFakeDb({
      workflows: [
        {
          id: 'wf-1',
          tenantId: 'tnt-A',
          status: 'COMPLETED',
          goal: 'g',
          totalCostUsd: null,
          startedAt: null,
          completedAt: null,
        },
      ],
      traces: [
        {
          id: 't1',
          workflowId: 'wf-1',
          tenantId: 'tnt-A',
          agentRole: 'orphan',
          stepIndex: 0,
          durationMs: null, // ← missing
          tokenUsage: null, //  ← missing entirely
          toolCallsJson: null,
        },
      ],
    });

    const tl = (await buildWorkflowTimeline(db, 'wf-1', 'tnt-A'))!;
    expect(tl.nodes).toHaveLength(1);
    expect(tl.nodes[0]!.model).toBe('unknown');
    expect(tl.nodes[0]!.provider).toBe('unknown');
    expect(tl.nodes[0]!.inputTokens).toBe(0);
    expect(tl.nodes[0]!.outputTokens).toBe(0);
    expect(tl.nodes[0]!.durationMs).toBe(0);
    expect(tl.nodes[0]!.toolCalls).toBe(0);
    // calculateCost('unknown', 0, 0) is 0 (unknown-model warn skipped because tokens=0).
    expect(tl.nodes[0]!.costUsd).toBe(0);
    expect(tl.totalCostUsd).toBe(0);
    expect(tl.costByAgent).toEqual({ orphan: 0 });
    expect(tl.costByProvider).toEqual({ unknown: 0 });
    expect(tl.costByModel).toEqual({ unknown: 0 });
  });

  it('treats a non-array toolCallsJson as 0 toolCalls (defensive parsing)', async () => {
    const { db } = makeFakeDb({
      workflows: [
        {
          id: 'wf-1',
          tenantId: 'tnt-A',
          status: 'COMPLETED',
          goal: 'g',
          totalCostUsd: null,
          startedAt: null,
          completedAt: null,
        },
      ],
      traces: [
        {
          id: 't1',
          workflowId: 'wf-1',
          tenantId: 'tnt-A',
          agentRole: 'a',
          stepIndex: 0,
          durationMs: 0,
          tokenUsage: null,
          // Non-array shape — older trace versions wrote an object here.
          toolCallsJson: { wrapped: [{ name: 'a' }, { name: 'b' }] },
        },
      ],
    });

    const tl = (await buildWorkflowTimeline(db, 'wf-1', 'tnt-A'))!;
    expect(tl.nodes[0]!.toolCalls).toBe(0);
  });

  it('startedAt / completedAt are null in the response when the workflow row has them as null', async () => {
    const { db } = makeFakeDb({
      workflows: [
        {
          id: 'wf-1',
          tenantId: 'tnt-A',
          status: 'PENDING',
          goal: 'g',
          totalCostUsd: null,
          startedAt: null,
          completedAt: null,
        },
      ],
    });

    const tl = (await buildWorkflowTimeline(db, 'wf-1', 'tnt-A'))!;
    expect(tl.startedAt).toBeNull();
    expect(tl.completedAt).toBeNull();
  });

  it('returned object satisfies the WorkflowTimeline shape (smoke: all top-level keys present)', async () => {
    const { db } = makeFakeDb({
      workflows: [
        {
          id: 'wf-1',
          tenantId: 'tnt-A',
          status: 'COMPLETED',
          goal: 'g',
          totalCostUsd: null,
          startedAt: null,
          completedAt: null,
        },
      ],
      traces: [mkTrace('wf-1', 'a', 0, 1, 'gpt-5.4-mini')],
    });

    const tl = (await buildWorkflowTimeline(db, 'wf-1', 'tnt-A'))!;
    const expectedKeys: Array<keyof WorkflowTimeline> = [
      'workflowId',
      'tenantId',
      'status',
      'goal',
      'totalCostUsd',
      'totalDurationMs',
      'totalInputTokens',
      'totalOutputTokens',
      'nodeCount',
      'nodes',
      'criticalPath',
      'costByAgent',
      'costByProvider',
      'costByModel',
      'startedAt',
      'completedAt',
    ];
    for (const k of expectedKeys) {
      expect(tl).toHaveProperty(k);
    }
  });

  it('passes only (id, tenantId) into the workflow.findFirst — never `id` alone', async () => {
    const { db } = makeFakeDb({
      workflows: [
        {
          id: 'wf-1',
          tenantId: 'tnt-A',
          status: 'COMPLETED',
          goal: 'g',
          totalCostUsd: null,
          startedAt: null,
          completedAt: null,
        },
      ],
    });

    await buildWorkflowTimeline(db, 'wf-1', 'tnt-A');
    const call = (db.workflow.findFirst as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({ id: 'wf-1', tenantId: 'tnt-A' });
  });

  it('passes only (workflowId, tenantId) into the agentTrace.findMany — never workflowId alone', async () => {
    const { db } = makeFakeDb({
      workflows: [
        {
          id: 'wf-1',
          tenantId: 'tnt-A',
          status: 'COMPLETED',
          goal: 'g',
          totalCostUsd: null,
          startedAt: null,
          completedAt: null,
        },
      ],
    });

    await buildWorkflowTimeline(db, 'wf-1', 'tnt-A');
    const call = (db.agentTrace.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({ workflowId: 'wf-1', tenantId: 'tnt-A' });
    expect(call.orderBy).toEqual({ stepIndex: 'asc' });
  });
});

// ───────────────────────────── helpers ─────────────────────────────

function mkTrace(
  workflowId: string,
  agentRole: string,
  stepIndex: number,
  durationMs: number,
  model: string,
  inputTokens: number = 0,
  outputTokens: number = 0,
): FakeAgentTrace {
  return {
    id: `t-${workflowId}-${stepIndex}`,
    workflowId,
    tenantId: 'tnt-A',
    agentRole,
    stepIndex,
    durationMs,
    tokenUsage: {
      inputTokens,
      outputTokens,
      model,
      provider: 'openai',
    },
    toolCallsJson: [],
  };
}
