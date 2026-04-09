import type {
  ToolMetadata,
  ToolExecutionContext,
  ToolResult,
  ToolCategory,
  ToolRiskClass,
} from '@jak-swarm/shared';

export type ToolExecutor<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ToolExecutionContext,
) => Promise<TOutput>;

export interface RegisteredTool {
  metadata: ToolMetadata;
  executor: ToolExecutor;
}

export class ToolRegistry {
  private static instance: ToolRegistry | null = null;
  private readonly tools = new Map<string, RegisteredTool>();

  private constructor() {}

  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * Register a tool with its metadata and executor function.
   */
  register<TInput = unknown, TOutput = unknown>(
    metadata: ToolMetadata,
    executor: ToolExecutor<TInput, TOutput>,
  ): void {
    if (this.tools.has(metadata.name)) {
      // Allow re-registration (useful for overrides in tests)
      // console.warn(`[ToolRegistry] Tool '${metadata.name}' is being re-registered`);
    }
    this.tools.set(metadata.name, {
      metadata,
      executor: executor as ToolExecutor,
    });
  }

  /**
   * Get a registered tool by name.
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all tools, with optional filtering.
   */
  list(filter?: { category?: ToolCategory; riskClass?: ToolRiskClass }): ToolMetadata[] {
    const all = [...this.tools.values()].map((t) => t.metadata);

    if (!filter) return all;

    return all.filter((m) => {
      if (filter.category && m.category !== filter.category) return false;
      if (filter.riskClass && m.riskClass !== filter.riskClass) return false;
      return true;
    });
  }

  /**
   * Execute a tool by name with validated input.
   */
  async execute<TOutput = unknown>(
    name: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolResult<TOutput>> {
    const startedAt = Date.now();

    const registered = this.tools.get(name);
    if (!registered) {
      return {
        success: false,
        error: `Tool '${name}' not found in registry`,
        durationMs: Date.now() - startedAt,
      };
    }

    // Validate input schema if provided
    if (registered.metadata.inputSchema && Object.keys(registered.metadata.inputSchema).length > 0) {
      const validationError = this.validateInput(input, registered.metadata.inputSchema);
      if (validationError) {
        return {
          success: false,
          error: `Input validation failed for tool '${name}': ${validationError}`,
          durationMs: Date.now() - startedAt,
        };
      }
    }

    try {
      const output = await registered.executor(input, context);
      const durationMs = Date.now() - startedAt;

      // Validate output against declared schema (advisory — logs warning, does not fail)
      if (registered.metadata.outputSchema && Object.keys(registered.metadata.outputSchema).length > 0) {
        const outputValidationError = this.validateOutput(output, registered.metadata.outputSchema);
        if (outputValidationError) {
          // Log but don't fail — output schema violations are advisory
          const result: ToolResult<TOutput> = {
            success: true,
            data: output as TOutput,
            durationMs,
          };
          // Attach warning to result for downstream consumers
          (result as ToolResult<TOutput> & { outputSchemaWarning?: string }).outputSchemaWarning =
            `Output schema mismatch for tool '${name}': ${outputValidationError}`;
          return result;
        }
      }

      return {
        success: true,
        data: output as TOutput,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorMessage = err instanceof Error ? err.message : String(err);

      return {
        success: false,
        error: errorMessage,
        durationMs,
      };
    }
  }

  /**
   * Deregister a tool (useful for testing).
   */
  deregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Clear all registrations (useful for testing).
   */
  clear(): void {
    this.tools.clear();
  }

  private validateInput(
    input: unknown,
    schema: Record<string, unknown>,
  ): string | null {
    return this.validateAgainstSchema(input, schema, 'input');
  }

  private validateOutput(
    output: unknown,
    schema: Record<string, unknown>,
  ): string | null {
    return this.validateAgainstSchema(output, schema, 'output');
  }

  private validateAgainstSchema(
    data: unknown,
    schema: Record<string, unknown>,
    label: string,
  ): string | null {
    const properties = schema['properties'] as Record<string, { type: string }> | undefined;
    const required = schema['required'] as string[] | undefined;

    if (!properties) return null;

    if (typeof data !== 'object' || data === null) {
      return `${label} must be an object`;
    }

    const dataObj = data as Record<string, unknown>;

    // Check required fields
    if (required) {
      for (const field of required) {
        if (!(field in dataObj) || dataObj[field] === undefined || dataObj[field] === null) {
          return `Required ${label} field '${field}' is missing`;
        }
      }
    }

    // Check types for provided fields
    for (const [field, spec] of Object.entries(properties)) {
      if (field in dataObj) {
        const value = dataObj[field];
        const expectedType = spec.type;

        if (!this.checkType(value, expectedType)) {
          return `${label} field '${field}' should be of type '${expectedType}'`;
        }
      }
    }

    return null;
  }

  private checkType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return true;
    }
  }
}

// Export singleton accessor
export const toolRegistry = ToolRegistry.getInstance();
