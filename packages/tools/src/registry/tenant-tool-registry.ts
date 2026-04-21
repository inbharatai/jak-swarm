import type { ToolMetadata, ToolExecutionContext, ToolResult, ToolRiskClass } from '@jak-swarm/shared';
import { ToolCategory, createLogger } from '@jak-swarm/shared';
import { toolRegistry, type RegisteredTool } from '../registry/tool-registry.js';

const logger = createLogger('tenant-tool-registry');

/**
 * TenantToolRegistry — a tenant-scoped view over the global ToolRegistry.
 *
 * In multi-tenant mode, each tenant may have different MCP integrations
 * connected. This wrapper:
 * 1. Always exposes built-in tools (no `provider` field) to every tenant
 * 2. Only exposes MCP/provider tools that the tenant has connected
 * 3. Provides the same API as ToolRegistry for drop-in usage by agents
 *
 * Usage:
 *   const tenantTools = new TenantToolRegistry('tenant_123', ['GMAIL', 'SLACK']);
 *   const tools = tenantTools.list(); // built-ins + gmail_* + slack_*
 */
export interface TenantToolRegistryOptions {
  browserAutomationEnabled?: boolean;
  restrictedCategories?: ToolCategory[];
  disabledToolNames?: string[];
}

export class TenantToolRegistry {
  private readonly tenantId: string;
  private readonly allowedProviders: Set<string>;
  private browserAutomationEnabled: boolean;
  private restrictedCategories: Set<ToolCategory>;
  private disabledToolNames: Set<string>;

  constructor(tenantId: string, connectedProviders: string[], options?: TenantToolRegistryOptions) {
    this.tenantId = tenantId;
    this.allowedProviders = new Set(connectedProviders.map(p => p.toLowerCase()));
    this.browserAutomationEnabled = options?.browserAutomationEnabled ?? false;
    this.restrictedCategories = new Set(options?.restrictedCategories ?? []);
    this.disabledToolNames = new Set(options?.disabledToolNames ?? []);
  }

  /** Check if a tool is available to this tenant. */
  has(name: string): boolean {
    const tool = toolRegistry.get(name);
    if (!tool) return false;
    return this.isAllowed(tool.metadata);
  }

  /** Get a tool if available to this tenant. */
  get(name: string): RegisteredTool | undefined {
    const tool = toolRegistry.get(name);
    if (!tool || !this.isAllowed(tool.metadata)) return undefined;
    return tool;
  }

  /** List all tools visible to this tenant. */
  list(filter?: { category?: ToolCategory; riskClass?: ToolRiskClass }): ToolMetadata[] {
    return toolRegistry.list(filter).filter(m => this.isAllowed(m));
  }

  /** Execute a tool with tenant-scoped context. */
  async execute<TOutput = unknown>(
    name: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolResult<TOutput>> {
    const tool = toolRegistry.get(name);
    if (!tool || !this.isAllowed(tool.metadata)) {
      return {
        success: false,
        error: `Tool '${name}' is not available for tenant '${this.tenantId}'`,
        durationMs: 0,
      };
    }

    // Enforce tool-level approval gate: if tool requires approval,
    // the execution context must carry an approvalId proving it was approved.
    if (tool.metadata.requiresApproval && !context.approvalId) {
      return {
        success: false,
        error: `Tool '${name}' requires approval before execution. No approvalId provided.`,
        durationMs: 0,
      };
    }

    return toolRegistry.execute<TOutput>(name, input, context);
  }

  /** Update the list of connected providers (e.g., when integration status changes). */
  updateProviders(connectedProviders: string[]): void {
    this.allowedProviders.clear();
    for (const p of connectedProviders) this.allowedProviders.add(p.toLowerCase());
  }

  /** Update tenant options (browser automation flag, restricted categories). */
  updateOptions(options: TenantToolRegistryOptions): void {
    if (options.browserAutomationEnabled !== undefined) {
      this.browserAutomationEnabled = options.browserAutomationEnabled;
    }
    if (options.restrictedCategories) {
      this.restrictedCategories = new Set(options.restrictedCategories);
    }
    if (options.disabledToolNames) {
      this.disabledToolNames = new Set(options.disabledToolNames);
    }
  }

  private isAllowed(metadata: ToolMetadata): boolean {
    // Block browser tools if tenant hasn't enabled browser automation
    if (metadata.category === ToolCategory.BROWSER && !this.browserAutomationEnabled) {
      logger.debug(
        { tenantId: this.tenantId, tool: metadata.name, reason: 'browser_automation_disabled' },
        'Tool blocked by tenant policy',
      );
      return false;
    }
    // Block tools in categories restricted by the tenant's industry pack
    if (this.restrictedCategories.has(metadata.category)) {
      logger.debug(
        { tenantId: this.tenantId, tool: metadata.name, category: metadata.category, reason: 'restricted_category' },
        'Tool blocked by tenant industry pack',
      );
      return false;
    }
    // Block tools explicitly disabled by the tenant admin
    if (this.disabledToolNames.has(metadata.name)) {
      logger.debug(
        { tenantId: this.tenantId, tool: metadata.name, reason: 'admin_disabled' },
        'Tool blocked by tenant admin toggle',
      );
      return false;
    }
    // Built-in tools (no provider) are always available
    if (!metadata.provider) return true;
    // Provider-specific tools require the tenant to have that provider connected
    const ok = this.allowedProviders.has(metadata.provider.toLowerCase());
    if (!ok) {
      logger.debug(
        { tenantId: this.tenantId, tool: metadata.name, provider: metadata.provider, reason: 'provider_not_connected' },
        'Tool blocked — required MCP provider not connected',
      );
    }
    return ok;
  }
}

/**
 * Factory: create or retrieve a tenant-scoped tool registry.
 * Caches instances per tenantId so multiple agents in the same workflow share one.
 */
const tenantRegistries = new Map<string, TenantToolRegistry>();

export function getTenantToolRegistry(
  tenantId: string,
  connectedProviders: string[],
  options?: TenantToolRegistryOptions,
): TenantToolRegistry {
  let registry = tenantRegistries.get(tenantId);
  if (!registry) {
    registry = new TenantToolRegistry(tenantId, connectedProviders, options);
    tenantRegistries.set(tenantId, registry);
  } else {
    registry.updateProviders(connectedProviders);
    if (options) registry.updateOptions(options);
  }
  return registry;
}

/** Clear the tenant registry cache (for testing). */
export function clearTenantToolRegistries(): void {
  tenantRegistries.clear();
}
