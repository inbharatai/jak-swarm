import type { ToolMetadata } from '@jak-swarm/shared';
import { ToolRiskClass } from '@jak-swarm/shared';

/**
 * MCP (Model Context Protocol) tool specification format.
 * Converts between JAK Swarm's ToolMetadata and MCP's tool spec format.
 *
 * MCP Tool Spec reference: https://modelcontextprotocol.io/docs/concepts/tools
 */
export interface McpToolAnnotations {
  /** If true, tool does not modify external state */
  readOnlyHint?: boolean;
  /** If true, calling the tool may be destructive */
  destructiveHint?: boolean;
  /** If true, calling the tool multiple times with same args has same effect */
  idempotentHint?: boolean;
  /** If true, tool interacts with the external world (e.g., web) */
  openWorldHint?: boolean;
}

export interface McpInputSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    items?: { type: string };
  }>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: McpInputSchema;
  annotations?: McpToolAnnotations;
}

/**
 * Convert a JAK Swarm ToolMetadata to MCP tool spec format.
 */
export function toMcpTool(metadata: ToolMetadata): McpToolSpec {
  return {
    name: metadata.name,
    description: metadata.description,
    inputSchema: normalizeToMcpSchema(metadata.inputSchema),
    annotations: {
      readOnlyHint: metadata.riskClass === ToolRiskClass.READ_ONLY,
      destructiveHint:
        metadata.riskClass === ToolRiskClass.DESTRUCTIVE ||
        metadata.riskClass === ToolRiskClass.EXTERNAL_SIDE_EFFECT,
      idempotentHint: metadata.riskClass === ToolRiskClass.READ_ONLY,
      openWorldHint:
        metadata.riskClass === ToolRiskClass.EXTERNAL_SIDE_EFFECT,
    },
  };
}

/**
 * Convert an MCP tool spec to JAK Swarm ToolMetadata.
 * Note: Some fields (category, version) cannot be inferred from MCP spec
 * and will use defaults.
 */
export function fromMcpTool(
  mcpSpec: McpToolSpec,
  overrides?: Partial<ToolMetadata>,
): ToolMetadata {
  const annotations = mcpSpec.annotations ?? {};

  let riskClass: ToolRiskClass;
  if (annotations.destructiveHint) {
    riskClass = annotations.openWorldHint
      ? ToolRiskClass.EXTERNAL_SIDE_EFFECT
      : ToolRiskClass.DESTRUCTIVE;
  } else if (annotations.readOnlyHint) {
    riskClass = ToolRiskClass.READ_ONLY;
  } else {
    riskClass = ToolRiskClass.WRITE;
  }

  return {
    name: mcpSpec.name,
    description: mcpSpec.description,
    category: overrides?.category ?? ('KNOWLEDGE' as ToolMetadata['category']),
    riskClass,
    requiresApproval:
      overrides?.requiresApproval ??
      (riskClass === ToolRiskClass.DESTRUCTIVE || riskClass === ToolRiskClass.EXTERNAL_SIDE_EFFECT),
    inputSchema: mcpSpec.inputSchema as unknown as Record<string, unknown>,
    outputSchema: overrides?.outputSchema ?? { type: 'object' },
    provider: overrides?.provider ?? 'mcp',
    version: overrides?.version ?? '1.0.0',
    ...overrides,
  };
}

/**
 * Convert an array of ToolMetadata to MCP tool list format.
 */
export function toMcpToolList(tools: ToolMetadata[]): McpToolSpec[] {
  return tools.map(toMcpTool);
}

/**
 * Convert an array of MCP tool specs to ToolMetadata.
 */
export function fromMcpToolList(
  specs: McpToolSpec[],
  overrides?: Partial<ToolMetadata>,
): ToolMetadata[] {
  return specs.map((spec) => fromMcpTool(spec, overrides));
}

function normalizeToMcpSchema(schema: Record<string, unknown>): McpInputSchema {
  if (schema['type'] === 'object' && schema['properties']) {
    return schema as unknown as McpInputSchema;
  }

  // Wrap in object schema if bare
  return {
    type: 'object',
    properties: (schema['properties'] as McpInputSchema['properties']) ?? {},
    ...(schema['required'] !== undefined && { required: schema['required'] as string[] }),
  };
}
