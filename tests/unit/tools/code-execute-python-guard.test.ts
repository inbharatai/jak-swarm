import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { toolRegistry } from '../../../packages/tools/src/registry/tool-registry.js';
import { registerBuiltinTools } from '../../../packages/tools/src/builtin/index.js';
import type { ToolExecutionContext } from '../../../packages/shared/src/types/tool.js';

const ctx: ToolExecutionContext = {
  tenantId: 'test-tenant',
  userId: 'test-user',
  workflowId: 'test-wf',
  taskId: 'test-task',
};

beforeAll(() => {
  if (toolRegistry.list().length === 0) registerBuiltinTools();
});

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

describe('code_execute Python production guard', () => {
  it('blocks host Python execution when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';

    const result = await toolRegistry.execute<{
      stderr: string;
      error?: boolean;
      errorCode?: string;
      language?: string;
    }>('code_execute', { language: 'python', code: 'print("should not run")' }, ctx);

    expect(result.success).toBe(true); // tool returned a structured error, did not throw
    expect(result.data?.error).toBe(true);
    expect(result.data?.errorCode).toBe('HOST_PYTHON_DISABLED_IN_PRODUCTION');
    expect(result.data?.stderr).toMatch(/sandbox_exec/);
  });

  it('also blocks the "py" alias under NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';

    const result = await toolRegistry.execute<{ errorCode?: string }>(
      'code_execute',
      { language: 'py', code: 'print(1)' },
      ctx,
    );

    expect(result.data?.errorCode).toBe('HOST_PYTHON_DISABLED_IN_PRODUCTION');
  });

  it('still allows JavaScript execution under NODE_ENV=production (the JS path is sandboxed)', async () => {
    process.env.NODE_ENV = 'production';

    const result = await toolRegistry.execute<{ stdout: string; result: unknown; error?: boolean }>(
      'code_execute',
      { language: 'javascript', code: 'console.log("hi"); 1 + 2' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.data?.error).toBeUndefined();
    expect(result.data?.stdout).toBe('hi');
  });

  it('does NOT block Python under non-production env (returns either success or a non-guard error)', async () => {
    process.env.NODE_ENV = 'test';

    const result = await toolRegistry.execute<{ errorCode?: string }>(
      'code_execute',
      { language: 'python', code: 'print(1)' },
      ctx,
    );

    // The host may or may not have python3 installed — we only assert that the
    // production guard did NOT fire. Any other error is acceptable here.
    expect(result.data?.errorCode).not.toBe('HOST_PYTHON_DISABLED_IN_PRODUCTION');
  });
});
