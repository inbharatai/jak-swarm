/**
 * brain-mcp-server.ts — PR E (Phase 10): the Brain MCP SERVER.
 *
 * The first in-process MCP server in the repo. Exposes the `brain_*` tool
 * surface (defined in brain-mcp-tools.ts) over a real `@modelcontextprotocol/sdk`
 * `Server` + `InMemoryTransport` pair, and registers the same tools in the JAK
 * `toolRegistry` with context-aware executors so they are REACHABLE FROM THE
 * LIVE AGENT RUNTIME as first-class tools (not a placeholder, not a stub).
 *
 * Two equivalent paths, ONE tenant-safety model:
 *
 *   1. RAW MCP protocol path: a conformant MCP `Client` connects to the
 *      `Server` via the in-memory transport, calls `tools/list` + `tools/call`.
 *      The tenant + actor are carried in `params._meta.jakContext` (the MCP
 *      protocol has no native tenant context). The handler REFUSES a call whose
 *      `jakContext` is absent or lacks a tenantId — a caller can NEVER supply
 *      tenantId in the tool arguments (the input schemas don't accept it), and
 *      can NEVER act without the authenticated envelope.
 *
 *   2. JAK registry path (the live-runtime path): `registerBrainMcpToolsInRegistry`
 *      connects a `Client` to the server and registers each tool in the JAK
 *      `toolRegistry` with an executor that injects the authenticated
 *      `ToolExecutionContext` as the `jakContext` envelope on every call. So an
 *      agent running under a tenant gets the tenant's own graph — it cannot pass
 *      a different tenantId because the registry executor sources it from the
 *      context, and the MCP input schema rejects a tenantId argument.
 *
 * HONEST SCOPE:
 *   - This is an IN-PROCESS server (InMemoryTransport). A standalone stdio/SSE
 *     JAK Shield-style deployment is roadmap. The `transport` option on the
 *     ShieldMcpClient is the seam for that future.
 *   - `getContextPackage` (the `<company_brain>` injection) is deliberately NOT
 *     exposed — see brain-mcp-tools.ts for the agentRole-escalation rationale.
 *   - The server is a CANARY: it activates only when `BRAIN_MCP_SERVER=1` (boot
 *     wiring on the apps/api side). Default-off so existing behaviour is
 *     unchanged. The tool SPECS are always importable; the live wiring is gated.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolExecutionContext, ToolMetadata, ToolResult } from '@jak-swarm/shared';
import {
  BRAIN_MCP_TOOL_DEFS,
  JAK_CONTEXT_META_KEY,
  type BrainMcpToolDef,
  type BrainTenantContext,
  type BrainToolName,
} from './brain-mcp-tools.js';
import { toolRegistry } from '../registry/tool-registry.js';

/**
 * Structural interface for the Company Brain V2 service methods the Brain MCP
 * server wraps. `apps/api`'s `CompanyBrainV2Service` satisfies this structurally
 * (same method names + compatible signatures) — passed in at boot, so this
 * package never imports from `apps/api` (no circular dependency). The returns
 * are `unknown` here; the service's own types are the contract and the JSON is
 * forwarded verbatim to the caller.
 */
export interface BrainMcpService {
  getGraph(input: {
    tenantId: string;
    query?: string;
    entityType?: string;
    limit?: number;
  }): Promise<unknown>;
  getEntityDetail(input: { tenantId: string; entityId: string }): Promise<unknown>;
  mergeEntities(input: {
    tenantId: string;
    userId: string;
    sourceEntityId: string;
    targetEntityId: string;
    reason: string;
    similarity?: number;
  }): Promise<unknown>;
  decideClaim(input: {
    tenantId: string;
    userId: string;
    claimId: string;
    decision: 'APPROVED' | 'REJECTED';
    comment?: string;
  }): Promise<unknown>;
}

/** A brain tool dispatch entry: extracts the tenant-scoped call to make. */
type BrainDispatcher = (args: Record<string, unknown>, ctx: BrainTenantContext) => Promise<unknown>;

const DISPATCHERS: Record<BrainToolName, BrainDispatcher> = {
  brain_get_graph: (args, ctx) => {
    const svc = BRAIN_SERVICE_REF.service;
    if (!svc) throw new Error('Brain MCP server is not initialised (no service bound).');
    // `query`, `entityType`, `limit` are all optional and undefined-safe.
    return svc.getGraph({
      tenantId: ctx.tenantId,
      ...(args['query'] !== undefined && { query: String(args['query']) }),
      ...(args['entityType'] !== undefined && { entityType: String(args['entityType']) }),
      ...(args['limit'] !== undefined && { limit: Number(args['limit']) }),
    });
  },
  brain_get_entity: (args, ctx) => {
    const svc = BRAIN_SERVICE_REF.service;
    if (!svc) throw new Error('Brain MCP server is not initialised (no service bound).');
    return svc.getEntityDetail({ tenantId: ctx.tenantId, entityId: String(args['entityId']) });
  },
  brain_merge_entities: (args, ctx) => {
    const svc = BRAIN_SERVICE_REF.service;
    if (!svc) throw new Error('Brain MCP server is not initialised (no service bound).');
    return svc.mergeEntities({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      sourceEntityId: String(args['sourceEntityId']),
      targetEntityId: String(args['targetEntityId']),
      reason: String(args['reason']),
      ...(args['similarity'] !== undefined && { similarity: Number(args['similarity']) }),
    });
  },
  brain_decide_claim: (args, ctx) => {
    const svc = BRAIN_SERVICE_REF.service;
    if (!svc) throw new Error('Brain MCP server is not initialised (no service bound).');
    return svc.decideClaim({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      claimId: String(args['claimId']),
      decision: args['decision'] === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      ...(args['comment'] !== undefined && { comment: String(args['comment']) }),
    });
  },
};

/**
 * The dispatchers reference the service via this holder because the low-level
 * `Server` request handlers are registered once (at server-creation time) but
 * the service is injected per `createBrainMcpServer` call. Set in
 * `createBrainMcpServer` before the handlers can fire.
 */
const BRAIN_SERVICE_REF: { service: BrainMcpService | null } = { service: null };

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text }], isError };
}

function okResult(payload: unknown): CallToolResult {
  return textResult(JSON.stringify(payload));
}

/** Read + validate the authenticated tenant context from a call request's
 *  `_meta.jakContext`. Returns null when absent/invalid — the handler refuses. */
function readTenantContext(meta: unknown): BrainTenantContext | null {
  if (meta === null || typeof meta !== 'object') return null;
  const ctx = (meta as Record<string, unknown>)[JAK_CONTEXT_META_KEY];
  if (ctx === null || typeof ctx !== 'object') return null;
  const c = ctx as Record<string, unknown>;
  const tenantId = c['tenantId'];
  const userId = c['userId'];
  if (typeof tenantId !== 'string' || tenantId.length === 0 || typeof userId !== 'string' || userId.length === 0) {
    return null;
  }
  const out: BrainTenantContext = { tenantId, userId };
  if (typeof c['workflowId'] === 'string') out.workflowId = c['workflowId'];
  return out;
}

const MISSING_CONTEXT_ERROR =
  'Brain MCP tool requires an authenticated tenant context (jakContext with tenantId + userId). ' +
  'The tenant cannot be supplied by the tool arguments — it is injected by the authenticated JAK runtime.';

/**
 * Build a real MCP `Server` exposing the `brain_*` tools. The `brain` service
 * is captured for the dispatchers. Returns the `server` plus the
 * `clientTransport` (the server's pair end is connected internally when you
 * call `server.connect`). A conformant MCP `Client` can connect to
 * `clientTransport`, list tools, and call them — passing the tenant context via
 * `callTool({ _meta: { jakContext: { tenantId, userId } } })`.
 *
 * The server is NOT connected to a transport here (the caller connects it to the
 * server end of the linked pair). This keeps the factory pure-ish + testable.
 */
export function createBrainMcpServer(brain: BrainMcpService): Server {
  BRAIN_SERVICE_REF.service = brain;

  const server = new Server(
    { name: 'jak-brain', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // tools/list — return the brain_* tool specs as MCP Tool objects.
  server.setRequestHandler(ListToolsRequestSchema, () => {
    const tools: Tool[] = BRAIN_MCP_TOOL_DEFS.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema as Tool['inputSchema'],
      ...(def.annotations && Object.keys(def.annotations).length > 0
        ? { annotations: def.annotations as Tool['annotations'] }
        : {}),
    }));
    return { tools };
  });

  // tools/call — tenant-scope via _meta.jakContext, dispatch, forward JSON.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const def = BRAIN_MCP_TOOL_DEFS.find((d) => d.name === name) as BrainMcpToolDef | undefined;
    if (!def) {
      return textResult(`Unknown brain tool: ${name}`, true);
    }
    // Prefer the request params _meta (the caller's envelope); fall back to the
    // handler extra _meta (some transports surface it there).
    const ctx = readTenantContext(request.params._meta);
    if (!ctx) {
      return textResult(MISSING_CONTEXT_ERROR, true);
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await DISPATCHERS[def.name](args, ctx);
      return okResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(`Brain tool '${name}' failed: ${msg}`, true);
    }
  });

  return server;
}

export interface BrainMcpRegistration {
  server: Server;
  client: Client;
  toolNames: BrainToolName[];
  /** Disconnect the client + close the server, and deregister the tools. */
  disconnect(): Promise<void>;
}

/**
 * Connect the Brain MCP `Server` to a `Client` over an in-memory transport pair
 * and register each `brain_*` tool in the JAK `toolRegistry` with a
 * context-aware executor. The executor injects the authenticated
 * `ToolExecutionContext` as the `jakContext` envelope on every `callTool`, so an
 * agent running under a tenant gets the tenant's own graph — tenantId is sourced
 * from the context, never from the tool arguments.
 *
 * Returns the registration handle (call `disconnect()` to tear down, e.g. in
 * tests). The `provider` is set to `'brain'` on each tool's metadata.
 */
export async function registerBrainMcpToolsInRegistry(
  brain: BrainMcpService,
  registry: { register: typeof toolRegistry['register']; deregister: (name: string) => void } = toolRegistry,
): Promise<BrainMcpRegistration> {
  const server = createBrainMcpServer(brain);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'jak-brain-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

  const toolNames = BRAIN_MCP_TOOL_DEFS.map((d) => d.name);
  for (const def of BRAIN_MCP_TOOL_DEFS) {
    const meta: ToolMetadata = {
      name: def.name,
      description: def.description,
      category: def.category,
      riskClass: def.riskClass,
      requiresApproval: def.requiresApproval,
      inputSchema: def.inputSchema,
      outputSchema: def.outputSchema,
      provider: 'brain',
      version: '1.0.0',
    };
    const toolName = def.name;
    const executor = async (input: unknown, context: ToolExecutionContext): Promise<ToolResult> => {
      const started = Date.now();
      const jakContext: BrainTenantContext = {
        tenantId: context.tenantId,
        userId: context.userId,
        ...(context.workflowId !== undefined && { workflowId: context.workflowId }),
      };
      try {
        const result = await client.callTool({
          name: toolName,
          arguments: (input ?? {}) as Record<string, unknown>,
          _meta: { [JAK_CONTEXT_META_KEY]: jakContext } as Record<string, unknown>,
        });
        const isError = (result as { isError?: boolean }).isError === true;
        const text = Array.isArray(result.content)
          ? result.content.map((c) => (c as { text?: string }).text ?? '').join('\n')
          : '';
        return {
          success: !isError,
          outcome: isError ? 'failed' : 'real_success',
          data: text,
          ...(isError && { error: text }),
          durationMs: Date.now() - started,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, outcome: 'failed', error: msg, durationMs: Date.now() - started };
      }
    };
    registry.register(meta, executor, { allowOverride: true });
  }

  return {
    server,
    client,
    toolNames,
    async disconnect() {
      for (const name of toolNames) {
        try {
          registry.deregister(name);
        } catch {
          /* already gone */
        }
      }
      try {
        await client.close();
      } catch {
        /* already closed */
      }
      try {
        await server.close();
      } catch {
        /* already closed */
      }
      if (BRAIN_SERVICE_REF.service === brain) BRAIN_SERVICE_REF.service = null;
    },
  };
}