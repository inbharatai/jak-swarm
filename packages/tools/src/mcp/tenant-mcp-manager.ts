import { mcpClientManager } from './mcp-client.js';
import type { McpServerConfig } from './mcp-providers.js';

/**
 * TenantMcpManager — tenant-scoped wrapper around the global McpClientManager.
 *
 * Purpose:
 * - Namespace MCP connections per tenant so provider_X for tenant_A
 *   doesn't collide with provider_X for tenant_B
 * - Track which MCP tools belong to which tenant
 * - Provide tenant-isolated connect/disconnect operations
 *
 * Namespacing:
 *   Internal key = `${tenantId}::${provider}` (e.g., "tenant_abc::SLACK")
 *   Tool names remain prefixed with provider only (e.g., "slack_search_messages")
 *   but are tracked per-tenant via the tenant tool registry.
 */
export class TenantMcpManager {
  private readonly tenantId: string;
  /** Set of providers connected for this tenant. */
  private readonly connectedProviders = new Set<string>();

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  private namespaceKey(provider: string): string {
    return `${this.tenantId}|${provider}`;
  }

  /** Connect an MCP server for this tenant. */
  async connect(provider: string, config: McpServerConfig): Promise<string[]> {
    const ns = this.namespaceKey(provider);
    const tools = await mcpClientManager.connect(ns, config);
    this.connectedProviders.add(provider);
    return tools;
  }

  /** Disconnect an MCP server for this tenant. */
  async disconnect(provider: string): Promise<void> {
    const ns = this.namespaceKey(provider);
    await mcpClientManager.disconnect(ns);
    this.connectedProviders.delete(provider);
  }

  /** Check if a provider is connected for this tenant. */
  isConnected(provider: string): boolean {
    return mcpClientManager.isConnected(this.namespaceKey(provider));
  }

  /** Get tool names registered via MCP for this tenant+provider. */
  getRegisteredTools(provider: string): string[] {
    return mcpClientManager.getRegisteredTools(this.namespaceKey(provider));
  }

  /** Get all providers currently connected for this tenant. */
  getConnectedProviders(): string[] {
    return [...this.connectedProviders];
  }

  /** Disconnect all MCP servers for this tenant (e.g., on tenant suspension). */
  async disconnectAll(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.connectedProviders].map((provider) => this.disconnect(provider)),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        // Log but don't throw — best effort cleanup
        console.error(`[TenantMcpManager] Failed to disconnect provider for ${this.tenantId}:`, result.reason);
      }
    }
  }
}

/**
 * Factory: get or create a TenantMcpManager for a given tenant.
 */
const tenantManagers = new Map<string, TenantMcpManager>();

export function getTenantMcpManager(tenantId: string): TenantMcpManager {
  let manager = tenantManagers.get(tenantId);
  if (!manager) {
    manager = new TenantMcpManager(tenantId);
    tenantManagers.set(tenantId, manager);
  }
  return manager;
}

/** Clear the cache (for testing). */
export function clearTenantMcpManagers(): void {
  tenantManagers.clear();
}
