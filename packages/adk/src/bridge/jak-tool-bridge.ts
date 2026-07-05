/**
 * JAK-to-ADK Tool Bridge — converts JAK ToolRegistry tools into
 * @google/adk FunctionTool instances.
 *
 * Each JAK tool's JSON Schema is converted to a Zod schema (matching
 * ADK's FunctionTool contract), and the executor is bridged to call
 * JAK's ToolRegistry.execute() with proper tenant context.
 *
 * This bridge is the key integration point: it lets ADK LlmAgents
 * use ALL of JAK's existing tools (web_search, email, calendar, CRM,
 * browser, etc.) without duplicating any tool logic.
 */

import { z } from 'zod';
import { AsyncLocalStorage } from 'node:async_hooks';
import { FunctionTool, GOOGLE_SEARCH } from '@google/adk';
import type { ToolMetadata, ToolExecutionContext } from '@jak-swarm/shared';
import { getTenantToolRegistry } from '@jak-swarm/tools';

// ─── Context thread ────────────────────────────────────────────────────────
// ADK FunctionTool.execute receives (input, tool_context) but JAK's
// ToolRegistry.execute needs a full ToolExecutionContext. We thread it
// via AsyncLocalStorage so concurrent ADK runs on the stateless Fastify
// API each see their OWN context. The prior implementation used a
// module-level mutable singleton (`let currentExecutionContext`) that was
// `set` on entry and `clear`ed in a finally — a CRITICAL concurrency bug:
// two interleaved ADK runs (different tenants) would read each other's
// context (cross-tenant data leakage) or `undefined`, and the first-
// finishing run's `clear` would wipe the context out from under the
// still-running one. AsyncLocalStorage propagates per-async-chain across
// awaits, which is exactly the guarantee the ADK `Runner.runAsync`
// `for await` loop needs.

const executionContextAls = new AsyncLocalStorage<ToolExecutionContext>();

/**
 * Run `fn` with `ctx` as the JAK execution context for any ADK tool
 * callback invoked synchronously or across awaits within `fn`. Replaces
 * the prior set/clear module-global (which was a concurrency bug).
 */
export function withJakExecutionContext<T>(ctx: ToolExecutionContext, fn: () => T): T {
  return executionContextAls.run(ctx, fn);
}

/** Get the current JAK execution context (internal use by bridge). */
export function getJakExecutionContext(): ToolExecutionContext | undefined {
  return executionContextAls.getStore();
}

// ─── JSON Schema → Zod converter ────────────────────────────────────────────
// Reuses JAK's jsonSchemaToZod logic but adapted for standalone use
// (no circular dep on the tools package's internal converter).

/**
 * Convert a JSON Schema object to a Zod schema for ADK FunctionTool.
 * Handles: string, number, integer, boolean, array, object, enum, $ref.
 * Falls back to z.any() for unrecognized patterns.
 */
export function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.any();

  const s = schema as Record<string, unknown>;

  // Already a Zod schema
  if (s._def) return schema as z.ZodTypeAny;

  // Enum
  if (Array.isArray(s.enum) && s.enum.length > 0 && s.type === 'string') {
    return z.enum(s.enum as [string, ...string[]]);
  }

  // OneOf/AnyOf — use union
  if (Array.isArray(s.oneOf) && s.oneOf.length > 0) {
    const members = s.oneOf.map((sub: unknown) => jsonSchemaToZod(sub));
    return z.union([members[0] as z.ZodTypeAny, members[1] as z.ZodTypeAny, ...members.slice(2)] as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  const type = s.type as string | undefined;

  switch (type) {
    case 'string': {
      let str = z.string();
      if (s.format === 'email') str = z.string().email() as unknown as z.ZodString;
      if (s.format === 'url') str = z.string().url() as unknown as z.ZodString;
      if (s.format === 'uuid') str = z.string().uuid() as unknown as z.ZodString;
      if (typeof s.minLength === 'number') str = (str as z.ZodString).min(s.minLength);
      if (typeof s.maxLength === 'number') str = (str as z.ZodString).max(s.maxLength);
      return str;
    }
    case 'number':
    case 'integer': {
      let num = z.number();
      if (type === 'integer') num = num.int() as unknown as z.ZodNumber;
      if (typeof s.minimum === 'number') num = (num as z.ZodNumber).min(s.minimum);
      if (typeof s.maximum === 'number') num = (num as z.ZodNumber).max(s.maximum);
      return num;
    }
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array': {
      const items = jsonSchemaToZod(s.items);
      let arr = z.array(items);
      if (typeof s.minItems === 'number') arr = arr.min(s.minItems);
      if (typeof s.maxItems === 'number') arr = arr.max(s.maxItems);
      return arr;
    }
    case 'object':
    default: {
      const props = s.properties as Record<string, unknown> | undefined;
      if (!props || typeof props !== 'object') return z.record(z.any());

      const required = new Set(Array.isArray(s.required) ? s.required as string[] : []);
      const shape: Record<string, z.ZodTypeAny> = {};

      for (const [key, val] of Object.entries(props)) {
        const propSchema = jsonSchemaToZod(val);
        shape[key] = required.has(key) ? propSchema : propSchema.optional();
      }

      let obj = z.object(shape);
      if (s.additionalProperties === false) {
        obj = obj.strict() as unknown as typeof obj;
      } else {
        obj = obj.passthrough() as unknown as typeof obj;
      }
      return obj;
    }
  }
}

// ─── JAK tool → ADK FunctionTool converter ─────────────────────────────────

/**
 * Convert a single JAK tool metadata + registry reference into an
 * ADK FunctionTool. The FunctionTool's execute handler calls
 * JAK's ToolRegistry with the current execution context.
 */
export function jakToolToAdkFunctionTool(metadata: ToolMetadata): FunctionTool {
  const zodSchema = jsonSchemaToZod(metadata.inputSchema);

  return new FunctionTool({
    name: metadata.name,
    description: metadata.description,
    parameters: zodSchema as z.ZodObject<z.ZodRawShape>,
    execute: async (input: Record<string, unknown>) => {
      const ctx = getJakExecutionContext();
      if (!ctx) {
        return { error: `No JAK execution context set for tool ${metadata.name}` };
      }

      try {
        const tenantRegistry = getTenantToolRegistry(
          ctx.tenantId,
          // Thread the tenant's connected providers so provider-tagged tools
          // are gated correctly. The prior `[]` relied on a shared cached
          // entry having been mutated by a prior caller — a race that broke
          // under concurrency and wiped providers for other callers. With
          // composite-key caching, `[]` would deterministically gate out
          // every provider tool for this tenant; passing the real list is
          // the honest fix.
          ctx.connectedProviders ?? [],
        );
        const result = await tenantRegistry.execute(metadata.name, input, ctx);

        if (result.success) {
          return result.data ?? { success: true };
        }
        return {
          error: result.error ?? `Tool ${metadata.name} failed`,
          outcome: result.outcome,
          outcomeMessage: result.outcomeMessage,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

/**
 * Batch-convert multiple JAK tools to ADK FunctionTools.
 * Filters out tools that aren't applicable for the ADK path.
 */
export function jakToolsToAdkFunctionTools(tools: ToolMetadata[]): FunctionTool[] {
  return tools
    .filter(t => t.maturity !== 'test_only' && t.maturity !== 'unclassified')
    .map(jakToolToAdkFunctionTool);
}

// ─── Search tool factory ───────────────────────────────────────────────────
// Provider-native search: GOOGLE_SEARCH for Gemini, JAK web_search for OpenAI.
// This is the "universal search" strategy — each provider gets its best native option.

/**
 * Get the full tools array for an ADK LlmAgent, including:
 * - Provider-native search tool (GOOGLE_SEARCH for Gemini)
 * - JAK custom tools bridged as FunctionTools
 * - Optionally filtered by allowed tool names
 */
export function buildAdkToolsArray(params: {
  provider: 'gemini' | 'openai';
  jakToolMetadata: ToolMetadata[];
  allowedToolNames?: string[];
  includeSearch?: boolean;
}): Array<FunctionTool | typeof GOOGLE_SEARCH> {
  const tools: Array<FunctionTool | typeof GOOGLE_SEARCH> = [];

  // Provider-native search first
  if (params.includeSearch !== false && params.provider === 'gemini') {
    tools.push(GOOGLE_SEARCH);
  }

  // JAK tools as FunctionTools
  let jakTools = params.jakToolMetadata;
  if (params.allowedToolNames && params.allowedToolNames.length > 0) {
    const allowed = new Set(params.allowedToolNames);
    jakTools = jakTools.filter(t => allowed.has(t.name));
  }

  // Skip web_search if we already have GOOGLE_SEARCH (avoid duplication)
  if (params.provider === 'gemini') {
    jakTools = jakTools.filter(t => t.name !== 'web_search');
  }

  tools.push(...jakToolsToAdkFunctionTools(jakTools));

  return tools;
}