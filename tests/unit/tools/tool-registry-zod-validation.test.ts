import { describe, it, expect, afterEach } from 'vitest';
import { ToolRegistry, jsonSchemaToZod } from '../../../packages/tools/src/registry/tool-registry.js';
import { ToolCategory, ToolRiskClass } from '../../../packages/shared/src/types/tool.js';
import type { ToolExecutionContext, ToolMetadata } from '../../../packages/shared/src/types/tool.js';

const ctx: ToolExecutionContext = {
  tenantId: 't',
  userId: 'u',
  workflowId: 'w',
  taskId: 'task',
};

const registry = ToolRegistry.getInstance();
const TEST_TOOL = '__zod_test_tool__';

function meta(inputSchema: Record<string, unknown>, outputSchema: Record<string, unknown> = {}): ToolMetadata {
  return {
    name: TEST_TOOL,
    description: 'zod validation test',
    category: ToolCategory.RESEARCH,
    riskClass: ToolRiskClass.READ_ONLY,
    requiresApproval: false,
    inputSchema,
    outputSchema,
    version: '1.0.0',
  };
}

afterEach(() => {
  registry.deregister(TEST_TOOL);
  delete process.env['JAK_TOOL_OUTPUT_STRICT'];
});

describe('jsonSchemaToZod', () => {
  it('converts a nested object schema with required fields, arrays, enums, and formats', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        priority: { type: 'string', enum: ['low', 'med', 'high'] },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
        meta: {
          type: 'object',
          properties: {
            count: { type: 'integer', minimum: 0 },
          },
          required: ['count'],
        },
      },
      required: ['email', 'priority'],
    });

    expect(
      schema.safeParse({ email: 'a@b.com', priority: 'high', tags: ['x'], meta: { count: 3 } })
        .success,
    ).toBe(true);

    // bad email format
    expect(schema.safeParse({ email: 'not-an-email', priority: 'high' }).success).toBe(false);
    // bad enum
    expect(schema.safeParse({ email: 'a@b.com', priority: 'urgent' }).success).toBe(false);
    // empty required array
    expect(schema.safeParse({ email: 'a@b.com', priority: 'low', tags: [] }).success).toBe(false);
    // bad nested integer
    expect(
      schema.safeParse({ email: 'a@b.com', priority: 'low', meta: { count: -1 } }).success,
    ).toBe(false);
    // missing required top-level
    expect(schema.safeParse({ email: 'a@b.com' }).success).toBe(false);
  });

  it('returns z.any() for malformed/unknown schemas without throwing', () => {
    expect(jsonSchemaToZod(undefined).safeParse('whatever').success).toBe(true);
    expect(jsonSchemaToZod({ type: 'fictional' }).safeParse({ a: 1 }).success).toBe(true);
  });

  it('passes any schema with a _def property through unchanged (Zod schema detection)', () => {
    // Any object carrying _def is treated as an already-compiled Zod schema.
    const sentinel = { _def: 'pre-compiled', safeParse: () => ({ success: true }) };
    expect(jsonSchemaToZod(sentinel)).toBe(sentinel);
  });

  it('bare { type: object } accepts any record', () => {
    const schema = jsonSchemaToZod({ type: 'object' });
    expect(schema.safeParse({ a: 1, b: 'two' }).success).toBe(true);
    expect(schema.safeParse('not an object').success).toBe(false);
  });
});

describe('ToolRegistry deep input validation', () => {
  it('rejects input that violates a nested required field', async () => {
    registry.register(
      meta({
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1 },
          options: {
            type: 'object',
            properties: { limit: { type: 'integer', minimum: 1 } },
            required: ['limit'],
          },
        },
        required: ['query'],
      }),
      async () => ({ ok: true }),
    );

    const result = await registry.execute(TEST_TOOL, { query: 'q', options: {} }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/options\.limit/);
  });

  it('rejects empty required string', async () => {
    registry.register(
      meta({
        type: 'object',
        properties: { name: { type: 'string', minLength: 1 } },
        required: ['name'],
      }),
      async () => ({ ok: true }),
    );

    const result = await registry.execute(TEST_TOOL, { name: '' }, ctx);
    expect(result.success).toBe(false);
  });

  it('rejects invalid enum value', async () => {
    registry.register(
      meta({
        type: 'object',
        properties: { mode: { type: 'string', enum: ['fast', 'slow'] } },
        required: ['mode'],
      }),
      async () => ({ ok: true }),
    );

    const result = await registry.execute(TEST_TOOL, { mode: 'medium' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/mode/);
  });

  it('passes valid input through to executor', async () => {
    registry.register(
      meta({
        type: 'object',
        properties: { n: { type: 'number' } },
        required: ['n'],
      }),
      async (input) => ({ doubled: (input as { n: number }).n * 2 }),
    );

    const result = await registry.execute<{ doubled: number }>(TEST_TOOL, { n: 4 }, ctx);
    expect(result.success).toBe(true);
    expect(result.data?.doubled).toBe(8);
  });
});

describe('ToolRegistry output validation', () => {
  it('attaches outputSchemaWarning when output mismatches schema (warn-only by default)', async () => {
    registry.register(
      meta(
        { type: 'object', properties: {} },
        {
          type: 'object',
          properties: { count: { type: 'integer' } },
          required: ['count'],
        },
      ),
      async () => ({ count: 'not-a-number' }),
    );

    const result = await registry.execute(TEST_TOOL, {}, ctx);
    expect(result.success).toBe(true);
    expect((result as typeof result & { outputSchemaWarning?: string }).outputSchemaWarning).toMatch(/count/);
  });

  it('hard-fails on output mismatch when JAK_TOOL_OUTPUT_STRICT=1', async () => {
    process.env['JAK_TOOL_OUTPUT_STRICT'] = '1';

    registry.register(
      meta(
        { type: 'object', properties: {} },
        {
          type: 'object',
          properties: { count: { type: 'integer' } },
          required: ['count'],
        },
      ),
      async () => ({ count: 'oops' }),
    );

    const result = await registry.execute(TEST_TOOL, {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Output schema mismatch/);
  });
});
