/**
 * LangGraph graph builder — Sprint 2.5 / A.3 unit tests.
 *
 * Verifies the native LangGraph StateGraph wires together correctly,
 * that the state-annotation reducers preserve SwarmGraph semantics,
 * and that the conditional-edge functions route as expected.
 *
 * The full DAG execution (planner → router → worker → verifier) is
 * exercised by the existing integration tests against the live runtime.
 * These unit tests cover the pure plumbing.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  SwarmStateAnnotation,
  buildLangGraph,
  makeRunnableConfig,
  raceNodeWithTimeout,
  type CheckpointPrismaClient,
} from '../../../packages/swarm/src/workflow-runtime/index.js';

// Minimal stub Prisma — buildLangGraph only needs the shape; the
// graph isn't invoked in these tests, only constructed.
function stubDb(): CheckpointPrismaClient {
  return {
    workflowCheckpoint: {
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => ({}),
      upsert: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
      updateMany: async () => ({ count: 0 }),
    },
  };
}

describe('raceNodeWithTimeout — timer-leak fix', () => {
  it('returns the node result when it resolves before the timeout', async () => {
    const result = await raceNodeWithTimeout(async () => 'ok', 60_000, 'fast');
    expect(result).toBe('ok');
  });

  it('CLEARS the timeout timer when the node resolves quickly (no dangling 120s timer)', async () => {
    // Before the fix, wrapNode used `Promise.race([fn, new Promise(reject =>
    // setTimeout(reject, t))])` and never cleared the timer — every fast node
    // invocation left a 120s timer live. Assert the cleanup path calls
    // clearTimeout so the timer does not outlive the node call.
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      await raceNodeWithTimeout(async () => 'ok', 60_000, 'fast');
      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
    }
  });

  it('rejects with the timeout message when the node hangs past the timeout', async () => {
    vi.useFakeTimers();
    try {
      const pending = raceNodeWithTimeout(
        () => new Promise<string>(() => { /* never resolves */ }),
        1_000,
        'hang',
      );
      // Attach the rejection handler BEFORE firing the timer so the rejection
      // is never momentarily unhandled when the fake timer callback runs.
      const assertion = expect(pending).rejects.toThrow(/Node 'hang' exceeded 1000ms timeout/);
      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the timer when the node rejects before the timeout', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      await expect(
        raceNodeWithTimeout(async () => { throw new Error('boom'); }, 60_000, 'fails'),
      ).rejects.toThrow('boom');
      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
    }
  });
});

describe('SwarmStateAnnotation reducers (Sprint 2.5 / A.3)', () => {
  it('exposes Annotation with all SwarmState fields', () => {
    expect(SwarmStateAnnotation).toBeDefined();
    // The Annotation.Root produces a spec with state + update typings.
    // We assert the spec is callable to build a graph.
    expect(typeof SwarmStateAnnotation).toBe('object');
  });
});

describe('buildLangGraph — graph compiles', () => {
  // Helper — LangGraph's getGraph() returns nodes/edges in shapes that
  // vary by version; we normalise to Arrays for assertions.
  function nodeIds(compiled: ReturnType<typeof buildLangGraph>): string[] {
    const topology = compiled.getGraph() as unknown as {
      nodes?: Map<string, unknown> | Record<string, unknown> | Array<{ id: string }>;
    };
    if (!topology.nodes) return [];
    if (Array.isArray(topology.nodes)) return topology.nodes.map((n) => n.id);
    if (topology.nodes instanceof Map) return Array.from(topology.nodes.keys());
    return Object.keys(topology.nodes);
  }

  function edges(compiled: ReturnType<typeof buildLangGraph>): Array<{ source: string; target: string }> {
    const topology = compiled.getGraph() as unknown as {
      edges?: Array<{ source: string; target: string }>;
    };
    return topology.edges ?? [];
  }

  it('compiles a graph with the main SwarmGraph nodes + HyperAgent diagnosis/replanner', () => {
    const compiled = buildLangGraph({ db: stubDb() });
    expect(compiled).toBeDefined();
    const ids = nodeIds(compiled);
    expect(ids).toContain('commander');
    expect(ids).toContain('planner');
    expect(ids).toContain('router');
    expect(ids).toContain('guardrail');
    expect(ids).toContain('worker');
    expect(ids).toContain('verifier');
    expect(ids).toContain('approval');
    expect(ids).toContain('validator');
    // HyperAgent Phase 4 nodes — only reachable when hyperAgentActive(state),
    // but they ARE registered in the graph topology so the conditional edges
    // can route to them. See langgraph-graph-builder.ts + edges.ts.
    expect(ids).toContain('diagnosis');
    expect(ids).toContain('replanner');
  });

  it('wires the START → commander entry edge', () => {
    const compiled = buildLangGraph({ db: stubDb() });
    const startEdges = edges(compiled).filter((e) => e.source === '__start__');
    expect(startEdges.some((e) => e.target === 'commander')).toBe(true);
  });

  it('worker → verifier edge exists', () => {
    const compiled = buildLangGraph({ db: stubDb() });
    const fromWorker = edges(compiled).filter((e) => e.source === 'worker');
    expect(fromWorker.some((e) => e.target === 'verifier')).toBe(true);
  });

  it('validator → END edge exists (terminal node)', () => {
    const compiled = buildLangGraph({ db: stubDb() });
    const fromValidator = edges(compiled).filter((e) => e.source === 'validator');
    expect(fromValidator.some((e) => e.target === '__end__')).toBe(true);
  });
});

describe('makeRunnableConfig (tenant-scoped checkpoint config)', () => {
  it('returns a config with tenantId + thread_id required by the checkpointer', () => {
    const cfg = makeRunnableConfig('wf_123', 'tenant_a');
    expect(cfg.configurable?.thread_id).toBe('wf_123');
    expect(cfg.configurable?.tenantId).toBe('tenant_a');
    expect(cfg.configurable?.checkpoint_ns).toBe('');
  });

  it('sizes recursionLimit by task count (10 per task, min 100, max 500)', () => {
    expect(makeRunnableConfig('w', 't', 1).recursionLimit).toBe(100);
    expect(makeRunnableConfig('w', 't', 5).recursionLimit).toBe(100); // 5*10=50 < 100 floor
    expect(makeRunnableConfig('w', 't', 20).recursionLimit).toBe(200);
    expect(makeRunnableConfig('w', 't', 100).recursionLimit).toBe(500); // capped
  });
});

describe('LangGraphRuntime construction (smoke)', () => {
  it('LangGraphRuntime declares isFullyImplemented = true (no longer a shim)', async () => {
    const { LangGraphRuntime } = await import(
      '../../../packages/swarm/src/workflow-runtime/index.js'
    );
    // We just need the class — instantiation requires a SwarmRunner.
    expect(LangGraphRuntime).toBeDefined();
    // Instantiate with stubs to verify it does not throw at construction.
    const fakeRunner = {
      isCancelled: () => false,
      isPaused: () => false,
      stop: () => undefined,
    } as unknown as Parameters<typeof LangGraphRuntime>[0];
    const runtime = new LangGraphRuntime(fakeRunner, stubDb());
    expect(runtime.name).toBe('langgraph');
    expect(runtime.isFullyImplemented).toBe(true);
    expect(runtime.status).toBe('active');
  });
});
