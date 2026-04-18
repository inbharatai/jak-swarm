import { describe, it, expect, vi } from 'vitest';
import {
  runVibeCoderWorkflow,
  heuristicBuildChecker,
  passThroughBuildChecker,
  type BuildChecker,
  type VibeCoderEvent,
} from '@jak-swarm/swarm';
import type {
  AppArchitectResult,
  AppGeneratorResult,
  AppDebuggerResult,
  AppDeployerResult,
  GeneratedFile,
} from '@jak-swarm/agents';

/**
 * Behavioral tests for the Vibe Coder end-to-end workflow.
 *
 * The workflow is pure async code — it accepts injectable agent stubs, so we
 * don't need real LLM calls to verify the chain / retry loop / failure paths.
 *
 * We stub the 4 agents via the `agents` injection point and the build checker
 * via `buildChecker` so every test is deterministic.
 */

function stubAgent<TResult>(fn: (input: unknown) => TResult): { execute: (input: unknown) => Promise<TResult> } {
  return { execute: async (input: unknown) => fn(input) };
}

function architecture(partial: Partial<AppArchitectResult> = {}): AppArchitectResult {
  return {
    action: 'ARCHITECT_APP',
    architecture: 'stub arch',
    fileTree: [{ path: 'src/app/page.tsx', purpose: 'home', language: 'tsx', priority: 'critical' }],
    dependencies: { next: '14.2.0' },
    routes: [],
    dataModels: [],
    apiEndpoints: [],
    componentHierarchy: '',
    confidence: 0.8,
    ...partial,
  };
}

function generatorResult(files: GeneratedFile[]): AppGeneratorResult {
  return {
    action: 'GENERATE_BATCH',
    files,
    explanation: 'stub generation',
    confidence: 0.8,
  };
}

function debuggerResult(partial: Partial<AppDebuggerResult> = {}): AppDebuggerResult {
  return {
    action: 'SELF_DEBUG_LOOP',
    diagnosis: 'stub diagnosis',
    rootCause: 'stub root cause',
    fixes: [],
    confidence: 0.8,
    ...partial,
  };
}

function deployerSuccess(url = 'https://stub-app.vercel.app'): AppDeployerResult {
  return {
    action: 'DEPLOY_VERCEL',
    deploymentUrl: url,
    deploymentId: 'dpl_stub',
    status: 'success',
    confidence: 0.9,
  };
}

const baseParams = {
  workflowId: 'wf-test',
  tenantId: 'tnt-test',
  userId: 'usr-test',
  description: 'build me a todo app',
};

// ─── Happy path: first-pass generation builds cleanly ──────────────────────

describe('runVibeCoderWorkflow — happy path', () => {
  it('runs architect → generator → build-check → deployer in order and returns completed', async () => {
    const events: string[] = [];
    const onProgress = (e: VibeCoderEvent) => events.push(e.type);

    const result = await runVibeCoderWorkflow({
      ...baseParams,
      deployAfterBuild: true,
      buildChecker: passThroughBuildChecker,
      onProgress,
      agents: {
        architect: stubAgent<AppArchitectResult>(() => architecture()) as never,
        generator: stubAgent<AppGeneratorResult>(() =>
          generatorResult([{ path: 'src/app/page.tsx', content: 'export default function Page() {}', language: 'tsx' }]),
        ) as never,
        debugger: stubAgent<AppDebuggerResult>(() => debuggerResult()) as never,
        deployer: stubAgent<AppDeployerResult>(() => deployerSuccess()) as never,
      },
    });

    expect(result.status).toBe('completed');
    expect(result.files).toHaveLength(1);
    expect(result.deployment?.deploymentUrl).toBe('https://stub-app.vercel.app');
    expect(result.debugAttempts).toBe(0);
    expect(events).toEqual([
      'architect:start',
      'architect:ok',
      'generator:start',
      'generator:ok',
      'build_check:start',
      'build_check:ok',
      'deployer:start',
      'deployer:ok',
      'completed',
    ]);
  });

  it('skips deployer when deployAfterBuild=false', async () => {
    const result = await runVibeCoderWorkflow({
      ...baseParams,
      deployAfterBuild: false,
      buildChecker: passThroughBuildChecker,
      agents: {
        architect: stubAgent<AppArchitectResult>(() => architecture()) as never,
        generator: stubAgent<AppGeneratorResult>(() =>
          generatorResult([{ path: 'a.tsx', content: 'x', language: 'tsx' }]),
        ) as never,
        debugger: stubAgent<AppDebuggerResult>(() => debuggerResult()) as never,
        deployer: stubAgent<AppDeployerResult>(() => {
          throw new Error('deployer should not be called');
        }) as never,
      },
    });

    expect(result.status).toBe('completed');
    expect(result.deployment).toBeUndefined();
  });
});

// ─── Debug-retry loop ──────────────────────────────────────────────────────

describe('runVibeCoderWorkflow — debug-retry loop', () => {
  it('calls debugger when build fails and succeeds after fix', async () => {
    let buildCheckCalls = 0;
    const flakyChecker: BuildChecker = {
      async check() {
        buildCheckCalls += 1;
        // First call fails, second succeeds (after debugger fix applied).
        return buildCheckCalls === 1
          ? { ok: false, errorLog: 'TS2307: Cannot find module', affectedFiles: ['src/app/page.tsx'] }
          : { ok: true };
      },
    };

    let debuggerCalled = 0;
    const events: string[] = [];

    const result = await runVibeCoderWorkflow({
      ...baseParams,
      buildChecker: flakyChecker,
      onProgress: (e) => events.push(e.type),
      agents: {
        architect: stubAgent<AppArchitectResult>(() => architecture()) as never,
        generator: stubAgent<AppGeneratorResult>(() =>
          generatorResult([{ path: 'src/app/page.tsx', content: 'broken;', language: 'tsx' }]),
        ) as never,
        debugger: stubAgent<AppDebuggerResult>(() => {
          debuggerCalled += 1;
          return debuggerResult({
            fixes: [{ path: 'src/app/page.tsx', content: 'fixed export {};', explanation: 'added missing export' }],
          });
        }) as never,
        deployer: stubAgent<AppDeployerResult>(() => deployerSuccess()) as never,
      },
    });

    expect(result.status).toBe('completed');
    expect(result.debugAttempts).toBe(1);
    expect(debuggerCalled).toBe(1);
    expect(buildCheckCalls).toBe(2);
    // The file was replaced by the debugger's fix.
    expect(result.files[0]?.content).toBe('fixed export {};');
    expect(events).toContain('build_check:failed');
    expect(events).toContain('debugger:ok');
  });

  it('fails after maxDebugRetries when build keeps failing', async () => {
    let debuggerCalled = 0;
    const alwaysFailChecker: BuildChecker = {
      async check() {
        return { ok: false, errorLog: 'persistent failure', affectedFiles: ['a.tsx'] };
      },
    };

    const result = await runVibeCoderWorkflow({
      ...baseParams,
      maxDebugRetries: 2,
      buildChecker: alwaysFailChecker,
      agents: {
        architect: stubAgent<AppArchitectResult>(() => architecture()) as never,
        generator: stubAgent<AppGeneratorResult>(() =>
          generatorResult([{ path: 'a.tsx', content: 'x', language: 'tsx' }]),
        ) as never,
        debugger: stubAgent<AppDebuggerResult>(() => {
          debuggerCalled += 1;
          return debuggerResult({
            fixes: [{ path: 'a.tsx', content: `attempt ${debuggerCalled}`, explanation: 'try again' }],
          });
        }) as never,
        deployer: stubAgent<AppDeployerResult>(() => {
          throw new Error('deployer should not be called on failure');
        }) as never,
      },
    });

    expect(result.status).toBe('failed');
    expect(result.debugAttempts).toBe(2);
    expect(debuggerCalled).toBe(2);
    expect(result.error).toMatch(/2 debug attempts/);
  });

  it('pauses with needs_user_input when debugger requests clarification', async () => {
    const alwaysFailChecker: BuildChecker = {
      async check() {
        return { ok: false, errorLog: 'ambiguous error' };
      },
    };

    const result = await runVibeCoderWorkflow({
      ...baseParams,
      buildChecker: alwaysFailChecker,
      agents: {
        architect: stubAgent<AppArchitectResult>(() => architecture()) as never,
        generator: stubAgent<AppGeneratorResult>(() =>
          generatorResult([{ path: 'a.tsx', content: 'x', language: 'tsx' }]),
        ) as never,
        debugger: stubAgent<AppDebuggerResult>(() =>
          debuggerResult({
            requiresUserInput: true,
            userQuestion: 'Did you want authentication or not?',
          }),
        ) as never,
        deployer: stubAgent<AppDeployerResult>(() => {
          throw new Error('deployer should not be called');
        }) as never,
      },
    });

    expect(result.status).toBe('needs_user_input');
    expect(result.userQuestion).toBe('Did you want authentication or not?');
  });
});

// ─── Failure modes ─────────────────────────────────────────────────────────

describe('runVibeCoderWorkflow — failures', () => {
  it('fails cleanly when Architect throws', async () => {
    const result = await runVibeCoderWorkflow({
      ...baseParams,
      agents: {
        architect: {
          execute: async () => {
            throw new Error('llm timed out');
          },
        } as never,
        generator: stubAgent<AppGeneratorResult>(() => generatorResult([])) as never,
        debugger: stubAgent<AppDebuggerResult>(() => debuggerResult()) as never,
        deployer: stubAgent<AppDeployerResult>(() => deployerSuccess()) as never,
      },
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Architect failed: llm timed out/);
  });

  it('fails cleanly when Generator throws', async () => {
    const result = await runVibeCoderWorkflow({
      ...baseParams,
      buildChecker: passThroughBuildChecker,
      agents: {
        architect: stubAgent<AppArchitectResult>(() => architecture()) as never,
        generator: {
          execute: async () => {
            throw new Error('generator crashed');
          },
        } as never,
        debugger: stubAgent<AppDebuggerResult>(() => debuggerResult()) as never,
        deployer: stubAgent<AppDeployerResult>(() => deployerSuccess()) as never,
      },
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Generator failed: generator crashed/);
  });

  it('reports deployer failure but keeps files in the result (soft failure)', async () => {
    const result = await runVibeCoderWorkflow({
      ...baseParams,
      buildChecker: passThroughBuildChecker,
      agents: {
        architect: stubAgent<AppArchitectResult>(() => architecture()) as never,
        generator: stubAgent<AppGeneratorResult>(() =>
          generatorResult([{ path: 'a.tsx', content: 'x', language: 'tsx' }]),
        ) as never,
        debugger: stubAgent<AppDebuggerResult>(() => debuggerResult()) as never,
        deployer: {
          execute: async () => {
            throw new Error('vercel token invalid');
          },
        } as never,
      },
    });

    // Still 'completed' — the app was built, just not deployed.
    expect(result.status).toBe('completed');
    expect(result.files).toHaveLength(1);
    expect(result.deployment?.status).toBe('failed');
    expect(result.deployment?.error).toMatch(/vercel token invalid/);
  });
});

// ─── heuristicBuildChecker ─────────────────────────────────────────────────

describe('heuristicBuildChecker', () => {
  it('flags empty files', async () => {
    const result = await heuristicBuildChecker.check([
      { path: 'a.tsx', content: '', language: 'tsx' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errorLog).toMatch(/empty file/);
  });

  it('flags TODO placeholders', async () => {
    const result = await heuristicBuildChecker.check([
      { path: 'a.tsx', content: 'export default function Page() {\n  // TODO implement\n}', language: 'tsx' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errorLog).toMatch(/TODO placeholder/);
  });

  it('flags "Not implemented" stubs', async () => {
    const result = await heuristicBuildChecker.check([
      { path: 'a.tsx', content: 'throw new Error("Not implemented");', language: 'tsx' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('flags unbalanced braces', async () => {
    const result = await heuristicBuildChecker.check([
      { path: 'a.tsx', content: 'function x() { { { {', language: 'tsx' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errorLog).toMatch(/unbalanced braces/);
  });

  it('flags zero files as a failure', async () => {
    const result = await heuristicBuildChecker.check([]);
    expect(result.ok).toBe(false);
  });

  it('passes well-formed code', async () => {
    const result = await heuristicBuildChecker.check([
      {
        path: 'src/app/page.tsx',
        content: "export default function Page() {\n  return <div>Hello</div>;\n}",
        language: 'tsx',
      },
    ]);
    expect(result.ok).toBe(true);
  });
});
