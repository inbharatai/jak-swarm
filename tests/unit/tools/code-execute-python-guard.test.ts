import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { toolRegistry } from '../../../packages/tools/src/registry/tool-registry.js';
import { registerBuiltinTools } from '../../../packages/tools/src/builtin/index.js';
import type { ToolExecutionContext } from '../../../packages/shared/src/types/tool.js';

const ctx: ToolExecutionContext = {
  tenantId: 'test-tenant',
  userId: 'test-user',
  workflowId: 'test-wf',
  runId: 'test-run',
  // approvalId bypasses the per-tool gate (Phase 4) — these tests
  // exercise the Python sandbox guard, not the approval policy.
  approvalId: 'apr_test_bypass',
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

  it('ALSO blocks host JavaScript execution under NODE_ENV=production (vm is NOT a security boundary)', async () => {
    // Previously this test asserted JS ran in production "because the JS path
    // is sandboxed" — that was a false premise. Node's `vm` is explicitly NOT a
    // security mechanism: the dev sandbox blocks the trivially-named globals
    // (process/require/timers) but the exposed built-ins carry the real
    // `Function` constructor on their prototype chain, so untrusted code escapes
    // with e.g. `this.constructor.constructor('return process')()` and reaches
    // the host. Host JS is therefore production-disabled like host Python.
    process.env.NODE_ENV = 'production';

    const result = await toolRegistry.execute<{
      stdout: string;
      stderr: string;
      error?: boolean;
      errorCode?: string;
      language?: string;
    }>('code_execute', { language: 'javascript', code: 'console.log("hi"); 1 + 2' }, ctx);

    expect(result.success).toBe(true); // structured error, did not throw
    expect(result.data?.error).toBe(true);
    expect(result.data?.errorCode).toBe('HOST_JS_DISABLED_IN_PRODUCTION');
    expect(result.data?.stderr).toMatch(/sandbox_exec/);
    expect(result.data?.stderr).toMatch(/not a security boundary/);
  });

  it('blocks the "js" alias under NODE_ENV=production too', async () => {
    process.env.NODE_ENV = 'production';
    const result = await toolRegistry.execute<{ errorCode?: string }>(
      'code_execute',
      { language: 'js', code: '1+1' },
      ctx,
    );
    expect(result.data?.errorCode).toBe('HOST_JS_DISABLED_IN_PRODUCTION');
  });

  it('still runs JavaScript under NON-production (dev convenience, NOT a security control)', async () => {
    process.env.NODE_ENV = 'test';
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

describe('code_execute — vm is not a security boundary (honest escape documentation)', () => {
  // This test DOCUMENTS why host JS is production-disabled. The dev sandbox
  // blocks the trivially-named globals (process/require/timers) but the
  // exposed built-ins carry the real `Function` constructor on their prototype
  // chain, so untrusted code escapes the vm sandbox and reaches the host
  // `process`. We assert the escape reaches `process` (harmless read of
  // `typeof process`), proving the sandbox is NOT a security control and the
  // production-disable + sandbox_exec routing is the real mitigation.
  it('the dev vm sandbox is escapable: untrusted code reaches the host `process`', async () => {
    process.env.NODE_ENV = 'test';
    const escapeCode = `this.constructor.constructor('return typeof process')()`;
    const result = await toolRegistry.execute<{ result: unknown; stdout: string; error?: boolean }>(
      'code_execute',
      { language: 'javascript', code: escapeCode },
      ctx,
    );
    // If the sandbox were a real boundary, `process` would be undefined and the
    // result would be 'undefined'. Instead the escape reaches the HOST process
    // (an object), proving the sandbox is escapable.
    expect(result.success).toBe(true);
    expect(String(result.data?.result)).toBe('object');
  });
});
