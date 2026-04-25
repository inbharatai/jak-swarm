import { z } from 'zod';
import type {
  ToolMetadata,
  ToolExecutionContext,
  ToolResult,
  ToolOutcome,
  ToolCategory,
  ToolRiskClass,
  ToolMaturity,
} from '@jak-swarm/shared';

/**
 * Honest outcome inference for a tool that returned (didn't throw).
 *
 *   1. If the tool itself stamped an `outcome` on its return value, trust it.
 *   2. Otherwise look at the tool's maturity:
 *      - 'real' / 'config_dependent' → real_success
 *      - mock / draft / heuristic / llm_passthrough → mapped accordingly
 *   3. Specific shapes override: outputs with `{ posted: false, draftCreated: true }`
 *      are draft_created regardless of maturity (the social adapters use this shape).
 */
function inferOutcome(maturity: ToolMaturity | undefined, output: unknown): ToolOutcome {
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>;
    if (typeof o['outcome'] === 'string') return o['outcome'] as ToolOutcome;
    if (o['draftCreated'] === true && o['posted'] !== true) return 'draft_created';
    if (o['_mock'] === true || o['_notice'] !== undefined) return 'mock_provider';
  }
  switch (maturity) {
    case 'experimental':
    case 'unclassified':
    case 'llm_passthrough':
    case 'heuristic':
      return 'real_success'; // these are local logic, not external mocks
    case 'test_only':
      return 'mock_provider';
    case 'real':
    case 'config_dependent':
    default:
      return 'real_success';
  }
}

export type ToolExecutor<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ToolExecutionContext,
) => Promise<TOutput>;

export interface RegisteredTool {
  metadata: ToolMetadata;
  executor: ToolExecutor;
  /** Compiled Zod schema for input. Cached at registration. */
  inputZod?: z.ZodTypeAny;
  /** Compiled Zod schema for output. Cached at registration. */
  outputZod?: z.ZodTypeAny;
}

/**
 * Convert a JSON-schema-lite descriptor to a Zod schema.
 *
 * Supports the shape used throughout packages/tools/src/builtin/index.ts:
 *   { type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null',
 *     properties?, required?, items?, enum?, format?, minLength?, maxLength?,
 *     minimum?, maximum?, minItems?, maxItems?, additionalProperties? }
 *
 * Already-Zod schemas (anything with a `_def` property) are returned as-is, so
 * future tools can register a Zod schema directly without wrapping.
 *
 * Unrecognised shapes degrade to `z.any()` rather than throwing — this keeps
 * 119 historical tool registrations working without per-tool migration.
 */
function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
  if (schema && typeof schema === 'object' && '_def' in (schema as Record<string, unknown>)) {
    return schema as unknown as z.ZodTypeAny;
  }
  if (!schema || typeof schema !== 'object') return z.any();

  const s = schema as Record<string, unknown>;
  const type = s['type'] as string | undefined;

  // Enum at any level
  const enumVals = s['enum'];
  if (Array.isArray(enumVals) && enumVals.length > 0 && enumVals.every((v) => typeof v === 'string')) {
    return z.enum(enumVals as [string, ...string[]]);
  }

  switch (type) {
    case 'string': {
      let str: z.ZodString = z.string();
      const format = s['format'];
      if (format === 'email') str = str.email();
      if (format === 'url' || format === 'uri') str = str.url();
      if (format === 'uuid') str = str.uuid();
      if (typeof s['minLength'] === 'number') str = str.min(s['minLength'] as number);
      if (typeof s['maxLength'] === 'number') str = str.max(s['maxLength'] as number);
      return str;
    }
    case 'number':
    case 'integer': {
      let num: z.ZodNumber = z.number();
      if (type === 'integer') num = num.int();
      if (typeof s['minimum'] === 'number') num = num.min(s['minimum'] as number);
      if (typeof s['maximum'] === 'number') num = num.max(s['maximum'] as number);
      return num;
    }
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array': {
      const items = s['items'];
      const itemSchema = items ? jsonSchemaToZod(items) : z.any();
      let arr: z.ZodArray<z.ZodTypeAny> = z.array(itemSchema);
      if (typeof s['minItems'] === 'number') arr = arr.min(s['minItems'] as number);
      if (typeof s['maxItems'] === 'number') arr = arr.max(s['maxItems'] as number);
      return arr;
    }
    case 'object':
    default: {
      const properties = s['properties'] as Record<string, unknown> | undefined;
      const required = (s['required'] as string[] | undefined) ?? [];
      if (!properties) {
        // Bare `{ type: 'object' }` — accept any record.
        return z.record(z.any());
      }
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [k, v] of Object.entries(properties)) {
        const fieldSchema = jsonSchemaToZod(v);
        shape[k] = required.includes(k) ? fieldSchema : fieldSchema.optional();
      }
      let obj: z.ZodObject<z.ZodRawShape> = z.object(shape);
      if (s['additionalProperties'] === false) {
        obj = obj.strict();
      } else {
        obj = obj.passthrough();
      }
      return obj;
    }
  }
}

function formatZodError(err: z.ZodError): string {
  return err.errors
    .map((e) => `${e.path.join('.') || '<root>'}: ${e.message}`)
    .join('; ');
}

function compileSchema(schema: Record<string, unknown> | undefined): z.ZodTypeAny | undefined {
  if (!schema || Object.keys(schema).length === 0) return undefined;
  try {
    return jsonSchemaToZod(schema);
  } catch {
    // Defensive: a malformed schema must not crash registration.
    return undefined;
  }
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
   *
   * Throws on duplicate name unless `options.allowOverride` is true. Silent shadowing was
   * the historical behavior and hid a real semantic collision (`verify_email` registered
   * twice). Tests that need to swap an executor must pass `allowOverride: true` explicitly.
   *
   * Input/output schemas are compiled to Zod once at registration. Compilation failures
   * are silent (no schema is cached) — execution then runs without validation rather than
   * blocking the tool.
   */
  register<TInput = unknown, TOutput = unknown>(
    metadata: ToolMetadata,
    executor: ToolExecutor<TInput, TOutput>,
    options?: { allowOverride?: boolean },
  ): void {
    if (this.tools.has(metadata.name)) {
      if (!options?.allowOverride) {
        throw new Error(
          `[ToolRegistry] Duplicate tool registration: '${metadata.name}'. ` +
          `Pass { allowOverride: true } to replace an existing tool intentionally.`,
        );
      }
      console.warn(`[ToolRegistry] Tool '${metadata.name}' is being re-registered (override)`);
    }
    this.tools.set(metadata.name, {
      metadata,
      executor: executor as ToolExecutor,
      inputZod: compileSchema(metadata.inputSchema as Record<string, unknown> | undefined),
      outputZod: compileSchema(metadata.outputSchema as Record<string, unknown> | undefined),
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
   *
   * Input validation is hard-failure (returns a structured error) for any tool that has
   * a non-empty inputSchema. Output validation is advisory by default — a mismatch attaches
   * an `outputSchemaWarning` to the successful result. Set `JAK_TOOL_OUTPUT_STRICT=1` to
   * make output mismatches a hard failure (for staging / contract-test environments).
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
        outcome: 'failed',
        error: `Tool '${name}' not found in registry`,
        durationMs: Date.now() - startedAt,
      };
    }

    if (registered.inputZod) {
      const parsed = registered.inputZod.safeParse(input);
      if (!parsed.success) {
        return {
          success: false,
          outcome: 'failed',
          error: `Input validation failed for tool '${name}': ${formatZodError(parsed.error)}`,
          durationMs: Date.now() - startedAt,
        };
      }
    }

    try {
      const output = await registered.executor(input, context);
      const durationMs = Date.now() - startedAt;

      if (registered.outputZod) {
        const parsed = registered.outputZod.safeParse(output);
        if (!parsed.success) {
          const warning = `Output schema mismatch for tool '${name}': ${formatZodError(parsed.error)}`;
          const strict =
            process.env['JAK_TOOL_OUTPUT_STRICT'] === '1' ||
            process.env['JAK_TOOL_OUTPUT_STRICT'] === 'true';
          if (strict) {
            return {
              success: false,
              outcome: 'failed',
              error: warning,
              durationMs,
            };
          }
          const result: ToolResult<TOutput> = {
            success: true,
            data: output as TOutput,
            outcome: inferOutcome(registered.metadata.maturity, output),
            durationMs,
          };
          (result as ToolResult<TOutput> & { outputSchemaWarning?: string }).outputSchemaWarning =
            warning;
          return result;
        }
      }

      return {
        success: true,
        data: output as TOutput,
        outcome: inferOutcome(registered.metadata.maturity, output),
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Honest classification of "throwing" errors. The mock adapters now
      // throw with a `not connected` message — surface that as the
      // not_configured outcome so the cockpit shows a config CTA, not a
      // generic red 'failed'.
      const lower = errorMessage.toLowerCase();
      const outcome: 'not_configured' | 'failed' =
        /not connected|integration.*not configured|connect (gmail|caldav|crm|.*) in settings/i.test(lower)
          ? 'not_configured'
          : 'failed';

      return {
        success: false,
        outcome,
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

  /**
   * Honest summary of registered tools by maturity / category.
   *
   * Tools without an explicit `maturity` are bucketed as 'unclassified' so the
   * truth-check (P0b) can surface coverage gaps. The intent is for this manifest
   * — not the raw registration count — to drive any "production tools" claim
   * in marketing copy and trace UI badges.
   */
  getManifest(): {
    total: number;
    byMaturity: Record<ToolMaturity, number>;
    byCategory: Record<string, number>;
    requiresApproval: number;
    liveTested: number;
    unclassifiedNames: string[];
  } {
    const byMaturity: Record<ToolMaturity, number> = {
      real: 0,
      config_dependent: 0,
      heuristic: 0,
      llm_passthrough: 0,
      experimental: 0,
      test_only: 0,
      unclassified: 0,
    };
    const byCategory: Record<string, number> = {};
    const unclassifiedNames: string[] = [];
    let requiresApproval = 0;
    let liveTested = 0;

    for (const { metadata } of this.tools.values()) {
      const maturity = metadata.maturity ?? 'unclassified';
      byMaturity[maturity] += 1;
      if (maturity === 'unclassified') unclassifiedNames.push(metadata.name);

      const cat = String(metadata.category);
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;

      if (metadata.requiresApproval) requiresApproval += 1;
      if (metadata.liveTested) liveTested += 1;
    }

    return {
      total: this.tools.size,
      byMaturity,
      byCategory,
      requiresApproval,
      liveTested,
      unclassifiedNames,
    };
  }
}

// Export singleton accessor
export const toolRegistry = ToolRegistry.getInstance();

// Export converter so callers / tests can inspect compiled schemas if needed.
export { jsonSchemaToZod };
