/**
 * brain-mcp-tools.ts — PR E (Phase 10): the Brain MCP `brain.*` tool surface.
 *
 * The Company Brain V2 service (apps/api) holds the tenant's entity graph,
 * claims, edges, evidence, and governed writes (merge / claim decisions). PR E
 * exposes a SMALL, high-value subset of those operations as an MCP tool surface
 * (`brain_*`) so an autonomous agent can READ the product graph and perform
 * GOVERNED WRITES through the same tool registry it uses for every other tool —
 * reachable from the live runtime, not a placeholder.
 *
 * TENANT SAFETY (the standing security constraint: never trust tenant/user/agent
 * role fields supplied by an untrusted request):
 *
 *   - NO tool input schema contains `tenantId` or `userId`. The tenant + actor
 *     are supplied by the AUTHENTICATED runtime context (`ToolExecutionContext`
 *     for the JAK-registry path; the `_meta.jakContext` envelope for the raw MCP
 *     protocol path), NEVER by the tool arguments. A caller cannot read or write
 *     another tenant's graph by passing a different tenantId — the field is not
 *     accepted.
 *   - `getContextPackage` (the `<company_brain>` evidence injection) is
 *     INTENTIONALLY NOT exposed here. It takes an `agentRole` selector that
 *     gates RESTRICTED artifact visibility; accepting agentRole from a tool
 *     argument would let an agent self-authorise to see restricted evidence. It
 *     is already injected into BaseAgent at boot (PR #145) from a trusted path,
 *     so the MCP surface does not need to re-expose it.
 *
 * This file is PURE: tool spec definitions only, no I/O, no service import. The
 * server that wires these specs to the real CompanyBrainV2Service lives in
 * `brain-mcp-server.ts` (apps/api side, where the service is constructed).
 */
import { ToolRiskClass, ToolCategory } from '@jak-swarm/shared';
import type { McpToolAnnotations } from './mcp-tool-bridge.js';

/** The metadata key under which the JAK runtime injects the authenticated
 *  tenant context into an MCP `callTool` request's `_meta`. The Brain MCP
 *  server's tool handlers read the tenant + actor from here — the raw MCP
 *  protocol has no native tenant context, so this envelope is the only path
 *  that does NOT require the caller to supply tenantId in arguments. */
export const JAK_CONTEXT_META_KEY = 'jakContext';

/** The authenticated tenant + actor context the runtime injects per call. */
export interface BrainTenantContext {
  tenantId: string;
  userId: string;
  workflowId?: string;
}

/** The four brain.* tool names. */
export type BrainToolName =
  | 'brain_get_graph'
  | 'brain_get_entity'
  | 'brain_merge_entities'
  | 'brain_decide_claim';

/** A loose output schema (the service returns rich JSON; we don't over-constrain
 *  the shape — the service's own types are the contract). */
const LOOSE_OBJECT_OUTPUT = {
  type: 'object' as const,
  additionalProperties: true,
};

export interface BrainMcpToolDef {
  name: BrainToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
  riskClass: ToolRiskClass;
  requiresApproval: boolean;
  category: ToolCategory;
}

export const BRAIN_MCP_TOOL_DEFS: readonly BrainMcpToolDef[] = [
  {
    name: 'brain_get_graph',
    description:
      "Read the tenant's company graph: entities, edges, active/proposed/disputed claims, and the open-review count. " +
      'Tenant-scoped — the tenant is determined by the authenticated runtime context, NOT by the tool arguments. ' +
      'This is the product-graph interface for the Company Brain.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional substring filter on entity title or summary.' },
        entityType: { type: 'string', description: 'Optional entity-type filter (e.g. "company", "person", "product").' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Max entities to return (default 150, capped at 500).' },
      },
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT_OUTPUT,
    annotations: { readOnlyHint: true, idempotentHint: true },
    riskClass: ToolRiskClass.READ_ONLY,
    requiresApproval: false,
    category: ToolCategory.KNOWLEDGE,
  },
  {
    name: 'brain_get_entity',
    description:
      'Read a single company entity with its aliases, claims, edges, and evidence artifacts. ' +
      'Tenant-scoped via the authenticated runtime context.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'The entity id to read.' },
      },
      required: ['entityId'],
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT_OUTPUT,
    annotations: { readOnlyHint: true, idempotentHint: true },
    riskClass: ToolRiskClass.READ_ONLY,
    requiresApproval: false,
    category: ToolCategory.KNOWLEDGE,
  },
  {
    name: 'brain_merge_entities',
    description:
      'Merge two company entities (governed write). Migrates claims, edges, aliases, and evidence from the source onto the ' +
      'target in a single atomic transaction, then soft-deletes the source. Tenant + actor are determined by the authenticated ' +
      'runtime context. REQUIRES APPROVAL — this is a destructive, non-idempotent graph rewrite.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceEntityId: { type: 'string', description: 'The entity to merge away (will be soft-deleted).' },
        targetEntityId: { type: 'string', description: 'The entity to merge into (survives).' },
        reason: { type: 'string', description: 'Human-readable merge rationale (recorded in the merge-audit row).' },
        similarity: { type: 'number', minimum: 0, maximum: 1, description: 'Optional match similarity score (recorded for audit).' },
      },
      required: ['sourceEntityId', 'targetEntityId', 'reason'],
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT_OUTPUT,
    annotations: { destructiveHint: true, idempotentHint: false },
    riskClass: ToolRiskClass.DESTRUCTIVE,
    requiresApproval: true,
    category: ToolCategory.KNOWLEDGE,
  },
  {
    name: 'brain_decide_claim',
    description:
      'Approve or reject a proposed/disputed company claim (governed write). Approving supersedes the prior active claim for the ' +
      'same subject+predicate. Tenant + actor are determined by the authenticated runtime context. REQUIRES APPROVAL.',
    inputSchema: {
      type: 'object',
      properties: {
        claimId: { type: 'string', description: 'The claim id to review.' },
        decision: { type: 'string', enum: ['APPROVED', 'REJECTED'], description: 'The review decision.' },
        comment: { type: 'string', description: 'Optional review comment (recorded for audit).' },
      },
      required: ['claimId', 'decision'],
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT_OUTPUT,
    annotations: { idempotentHint: false },
    riskClass: ToolRiskClass.WRITE,
    requiresApproval: true,
    category: ToolCategory.KNOWLEDGE,
  },
];

/** Tool names for registration/telemetry. */
export const BRAIN_MCP_TOOL_NAMES: readonly BrainToolName[] = BRAIN_MCP_TOOL_DEFS.map((d) => d.name);