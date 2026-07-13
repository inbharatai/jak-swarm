/**
 * PR E (Phase 10) — Brain MCP server unit tests.
 *
 * Proves the `brain_*` tool surface is a genuine, tenant-safe MCP server:
 *   - the 4 tool input schemas contain NO `tenantId`/`userId` (a caller cannot
 *     supply tenant identity via arguments);
 *   - a conformant MCP `Client` (returned by the factory, connected over the
 *     in-memory transport) can `listTools` (4 brain_* tools) + `callTool`;
 *   - a `callTool` WITHOUT the `_meta.jakContext` envelope is REFUSED (isError);
 *   - the service receives the tenantId/userId from the CONTEXT envelope, never
 *     from the tool arguments — a caller that passes `tenantId` in arguments
 *     cannot reach another tenant's graph (the arg is stripped by the schema +
 *     ignored by the dispatcher);
 *   - the JAK-registry executor injects the authenticated ToolExecutionContext
 *     as the jakContext envelope and delegates with the context's tenantId;
 *   - governed writes (merge/decide) carry userId from the context.
 *
 * NOTE: this test imports ONLY from `@jak-swarm/tools` (never the MCP SDK
 * directly) — the SDK is a transitive dep of `@jak-swarm/tools` and is not
 * hoisted to the repo root, so a direct import would not resolve. The factory
 * returns the connected `Client` + `Server`, which we drive via a minimal local
 * surface interface.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createBrainMcpServer,
  registerBrainMcpToolsInRegistry,
  BRAIN_MCP_TOOL_DEFS,
  JAK_CONTEXT_META_KEY,
  type BrainMcpService,
  type BrainMcpRegistration,
} from '../../../packages/tools/src/index.js';
import type { ToolExecutionContext, ToolResult } from '@jak-swarm/shared';

/** Minimal MCP client surface the test drives (the real Client satisfies this). */
interface McpClientSurface {
  listTools(): Promise<{ tools: Array<{ name: string; inputSchema: { type: string; properties?: Record<string, unknown> } }> }>;
  callTool(params: { name: string; arguments?: Record<string, unknown>; _meta?: Record<string, unknown> }): Promise<{ isError?: boolean; content: Array<{ text?: string }> }>;
  close(): Promise<void>;
}

/** A mock Brain service that records every call + returns a canned payload. */
function mockBrain(): BrainMcpService & { calls: Array<{ method: string; args: unknown }> } {
  const calls: Array<{ method: string; args: unknown }> = [];
  const record = (method: string) => (args: unknown) => {
    calls.push({ method, args });
    return Promise.resolve({ ok: true, method, echoedArgs: args });
  };
  return {
    getGraph: record('getGraph') as BrainMcpService['getGraph'],
    getEntityDetail: record('getEntityDetail') as BrainMcpService['getEntityDetail'],
    mergeEntities: record('mergeEntities') as BrainMcpService['mergeEntities'],
    decideClaim: record('decideClaim') as BrainMcpService['decideClaim'],
    calls,
  };
}

/** A local fake JAK registry so tests don't pollute the global singleton.
 *  Mirrors `ToolRegistry.register(metadata, executor, options?)` +
 *  `deregister(name)`. */
function fakeRegistry() {
  const tools = new Map<string, { executor: (input: unknown, ctx: ToolExecutionContext) => Promise<ToolResult> }>();
  return {
    register: vi.fn((meta: { name: string }, executor: (input: unknown, ctx: ToolExecutionContext) => Promise<ToolResult>) => {
      tools.set(meta.name, { executor });
    }),
    deregister: vi.fn((name: string) => { tools.delete(name); }),
    get: (name: string) => tools.get(name),
    size: () => tools.size,
  };
}

/** Build a registration + a typed client surface for the raw-MCP-path tests. */
async function boot(brain: BrainMcpService, reg: ReturnType<typeof fakeRegistry>): Promise<{ registration: BrainMcpRegistration; client: McpClientSurface }> {
  const registration = await registerBrainMcpToolsInRegistry(brain, reg as unknown as Parameters<typeof registerBrainMcpToolsInRegistry>[1]);
  return { registration, client: registration.client as unknown as McpClientSurface };
}

describe('PR E — Brain MCP tool specs: tenant identity is NOT an argument', () => {
  it('no brain_* tool input schema accepts tenantId or userId', () => {
    for (const def of BRAIN_MCP_TOOL_DEFS) {
      const props = (def.inputSchema['properties'] ?? {}) as Record<string, unknown>;
      expect(props['tenantId']).toBeUndefined();
      expect(props['userId']).toBeUndefined();
      expect(def.inputSchema['additionalProperties']).toBe(false);
    }
  });

  it('exposes exactly 4 tools: get_graph, get_entity, merge_entities, decide_claim', () => {
    expect(BRAIN_MCP_TOOL_DEFS.map((d) => d.name).sort()).toEqual(
      ['brain_decide_claim', 'brain_get_entity', 'brain_get_graph', 'brain_merge_entities'],
    );
  });

  it('getContextPackage is deliberately NOT exposed (agentRole-escalation guard)', () => {
    expect(BRAIN_MCP_TOOL_DEFS.find((d) => d.name.includes('context'))).toBeUndefined();
  });
});

describe('PR E — Brain MCP server: raw MCP protocol path', () => {
  let brain: ReturnType<typeof mockBrain>;
  let reg: ReturnType<typeof fakeRegistry>;
  let client: McpClientSurface;
  let registration: BrainMcpRegistration;

  beforeEach(async () => {
    brain = mockBrain();
    reg = fakeRegistry();
    ({ registration, client } = await boot(brain, reg));
  });
  afterEach(async () => {
    await registration.disconnect();
  });

  it('a conformant MCP client can listTools → 4 brain_* tools with input schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['brain_decide_claim', 'brain_get_entity', 'brain_get_graph', 'brain_merge_entities'],
    );
    const graph = tools.find((t) => t.name === 'brain_get_graph')!;
    expect(graph.inputSchema.type).toBe('object');
    expect((graph.inputSchema.properties ?? {})['tenantId']).toBeUndefined();
  });

  it('callTool WITHOUT _meta.jakContext is REFUSED (isError) — no tenant context, no action', async () => {
    const result = await client.callTool({ name: 'brain_get_graph', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/authenticated tenant context/i);
  });

  it('callTool WITH jakContext delegates to the service with the CONTEXT tenantId (not args)', async () => {
    const result = await client.callTool({
      name: 'brain_get_graph',
      arguments: { query: 'acme', limit: 10 },
      _meta: { [JAK_CONTEXT_META_KEY]: { tenantId: 'tenant-A', userId: 'user-A' } },
    });
    expect(result.isError).not.toBe(true);
    expect(brain.calls).toHaveLength(1);
    expect(brain.calls[0]!.method).toBe('getGraph');
    expect(brain.calls[0]!.args).toMatchObject({ tenantId: 'tenant-A', query: 'acme', limit: 10 });
  });

  it('a tenantId passed in ARGUMENTS is ignored — the service uses the context tenantId (cross-tenant escape blocked)', async () => {
    const result = await client.callTool({
      name: 'brain_get_entity',
      arguments: { entityId: 'e1', tenantId: 'victim-tenant' },
      _meta: { [JAK_CONTEXT_META_KEY]: { tenantId: 'tenant-A', userId: 'user-A' } },
    });
    expect(result.isError).not.toBe(true);
    expect(brain.calls[0]!.args).toMatchObject({ tenantId: 'tenant-A', entityId: 'e1' });
    // The victim tenantId never reached the service.
    expect(JSON.stringify(brain.calls[0]!.args)).not.toContain('victim-tenant');
  });

  it('a jakContext missing userId is REFUSED', async () => {
    const result = await client.callTool({
      name: 'brain_get_graph',
      arguments: {},
      _meta: { [JAK_CONTEXT_META_KEY]: { tenantId: 'tenant-A' } },
    });
    expect(result.isError).toBe(true);
  });

  it('merge_entities (governed write) carries userId from the context + reason from args', async () => {
    const result = await client.callTool({
      name: 'brain_merge_entities',
      arguments: { sourceEntityId: 's1', targetEntityId: 't1', reason: 'duplicate' },
      _meta: { [JAK_CONTEXT_META_KEY]: { tenantId: 'tenant-A', userId: 'user-A' } },
    });
    expect(result.isError).not.toBe(true);
    expect(brain.calls[0]!.args).toMatchObject({
      tenantId: 'tenant-A', userId: 'user-A', sourceEntityId: 's1', targetEntityId: 't1', reason: 'duplicate',
    });
  });

  it('decide_claim maps the decision enum + carries userId from the context', async () => {
    const result = await client.callTool({
      name: 'brain_decide_claim',
      arguments: { claimId: 'c1', decision: 'REJECTED', comment: 'no evidence' },
      _meta: { [JAK_CONTEXT_META_KEY]: { tenantId: 'tenant-A', userId: 'user-A' } },
    });
    expect(result.isError).not.toBe(true);
    expect(brain.calls[0]!.args).toMatchObject({
      tenantId: 'tenant-A', userId: 'user-A', claimId: 'c1', decision: 'REJECTED', comment: 'no evidence',
    });
  });

  it('an unknown tool name returns isError', async () => {
    const result = await client.callTool({ name: 'brain_bogus', arguments: {} });
    expect(result.isError).toBe(true);
  });

  it('a service throw is surfaced as isError (not swallowed)', async () => {
    const failingBrain: BrainMcpService = {
      ...mockBrain(),
      getEntityDetail: async () => { throw new Error('entity not found in this tenant'); },
    };
    const failingReg = fakeRegistry();
    const { registration: failingReg_, client: failingClient } = await boot(failingBrain, failingReg);
    try {
      const result = await failingClient.callTool({
        name: 'brain_get_entity',
        arguments: { entityId: 'missing' },
        _meta: { [JAK_CONTEXT_META_KEY]: { tenantId: 'tenant-A', userId: 'user-A' } },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toMatch(/entity not found in this tenant/);
    } finally {
      await failingReg_.disconnect();
    }
  });
});

describe('PR E — Brain MCP server: JAK registry path (live runtime)', () => {
  let brain: ReturnType<typeof mockBrain>;
  let reg: ReturnType<typeof fakeRegistry>;
  let registration: BrainMcpRegistration;

  beforeEach(async () => {
    brain = mockBrain();
    reg = fakeRegistry();
    registration = (await boot(brain, reg)).registration;
  });
  afterEach(async () => {
    await registration.disconnect();
  });

  it('registers all 4 brain_* tools', () => {
    expect(reg.size()).toBe(4);
    expect(reg.register).toHaveBeenCalledTimes(4);
  });

  it('the registry executor injects the ToolExecutionContext as jakContext → service gets the context tenantId', async () => {
    const ctx: ToolExecutionContext = {
      tenantId: 'tenant-B', userId: 'user-B', workflowId: 'wf-1', runId: 'run-1',
    };
    const res = await reg.get('brain_get_graph')!.executor({ query: 'globex' }, ctx);
    expect(res.success).toBe(true);
    expect(brain.calls[0]!.args).toMatchObject({ tenantId: 'tenant-B', query: 'globex' });
  });

  it('the registry executor ignores any tenantId in the input — context wins (cross-tenant escape blocked)', async () => {
    const ctx: ToolExecutionContext = { tenantId: 'tenant-B', userId: 'user-B', workflowId: 'wf', runId: 'r' };
    const res = await reg.get('brain_get_entity')!.executor({ entityId: 'e9', tenantId: 'victim' } as never, ctx);
    expect(res.success).toBe(true);
    expect(brain.calls[0]!.args).toMatchObject({ tenantId: 'tenant-B', entityId: 'e9' });
    expect(JSON.stringify(brain.calls[0]!.args)).not.toContain('victim');
  });

  it('a governed write (merge) via the registry carries userId from the context', async () => {
    const ctx: ToolExecutionContext = { tenantId: 'tenant-B', userId: 'user-B', workflowId: 'wf', runId: 'r' };
    const res = await reg.get('brain_merge_entities')!.executor(
      { sourceEntityId: 's', targetEntityId: 't', reason: 'dup' }, ctx,
    );
    expect(res.success).toBe(true);
    expect(brain.calls[0]!.args).toMatchObject({ tenantId: 'tenant-B', userId: 'user-B', reason: 'dup' });
  });

  it('disconnect deregisters the brain_* tools', async () => {
    expect(reg.size()).toBe(4);
    await registration.disconnect();
    expect(reg.deregister).toHaveBeenCalledTimes(4);
    expect(reg.size()).toBe(0);
  });
});