import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fromMcpTool } from './mcp-tool-bridge.js';
import { toolRegistry } from '../registry/tool-registry.js';
import type { McpServerConfig } from './mcp-providers.js';
import type { McpToolSpec } from './mcp-tool-bridge.js';
import type { ToolExecutionContext } from '@jak-swarm/shared';
import { createLogger } from '@jak-swarm/shared';

const logger = createLogger('mcp-client');

export class McpClientManager {
  private clients = new Map<string, { client: Client; toolNames: string[] }>();

  /**
   * Connect to an MCP server, discover its tools, and register them in the JAK tool registry.
   * Tool names are prefixed with the provider name (e.g., slack_search_messages).
   */
  async connect(provider: string, config: McpServerConfig): Promise<string[]> {
    // Disconnect existing if any
    await this.disconnect(provider);

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
    });

    const client = new Client(
      { name: 'jak-swarm', version: '1.0.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
    } catch (err) {
      throw new Error(`Failed to connect to MCP server '${provider}': ${err instanceof Error ? err.message : String(err)}`);
    }

    // Discover available tools
    const { tools } = await client.listTools();
    const registeredNames: string[] = [];

    for (const mcpTool of tools) {
      // Cast the SDK tool shape to our McpToolSpec bridge type
      const mcpSpec: McpToolSpec = {
        name: mcpTool.name,
        description: mcpTool.description ?? '',
        inputSchema: mcpTool.inputSchema as McpToolSpec['inputSchema'],
        annotations: mcpTool.annotations,
      };

      const jakMeta = fromMcpTool(mcpSpec);
      // Prefix tool name with provider
      const prefix = provider.toLowerCase();
      const toolName = jakMeta.name.startsWith(prefix) ? jakMeta.name : `${prefix}_${jakMeta.name}`;
      jakMeta.name = toolName;
      jakMeta.provider = provider;

      // Create executor that delegates to MCP server
      const mcpToolName = mcpTool.name; // Original MCP tool name (unprefixed)
      const executor = async (input: unknown, _context: ToolExecutionContext) => {
        try {
          const result = await client.callTool({
            name: mcpToolName,
            arguments: (input ?? {}) as Record<string, unknown>,
          });
          // MCP returns content array -- extract text
          const content = Array.isArray(result.content)
            ? result.content.map((c: unknown) => {
                const item = c as { type?: string; text?: string };
                return item.text ?? JSON.stringify(c);
              }).join('\n')
            : String(result.content ?? '');
          return { success: true, data: content };
        } catch (err) {
          return {
            success: false,
            error: `MCP tool '${mcpToolName}' failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      };

      toolRegistry.register(jakMeta, executor);
      registeredNames.push(toolName);
    }

    this.clients.set(provider, { client, toolNames: registeredNames });
    logger.info({ provider, toolCount: registeredNames.length }, 'Connected to MCP server');
    return registeredNames;
  }

  /**
   * Disconnect from an MCP server and unregister its tools.
   */
  async disconnect(provider: string): Promise<void> {
    const entry = this.clients.get(provider);
    if (!entry) return;

    try {
      await entry.client.close();
    } catch {
      /* already closed */
    }

    this.clients.delete(provider);
    logger.info({ provider }, 'Disconnected from MCP server');
  }

  isConnected(provider: string): boolean {
    return this.clients.has(provider);
  }

  getRegisteredTools(provider: string): string[] {
    return this.clients.get(provider)?.toolNames ?? [];
  }

  getConnectedProviders(): string[] {
    return [...this.clients.keys()];
  }
}

// Singleton instance
export const mcpClientManager = new McpClientManager();
