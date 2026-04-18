import { describe, it, expect, vi } from 'vitest';
import {
  DockerBuildChecker,
  extractAffectedFiles,
  capErrorLog,
  type DockerRunner,
  type DockerBuildRunOptions,
  type DockerBuildRunResult,
} from '@jak-swarm/swarm';
import type { GeneratedFile } from '@jak-swarm/agents';

/**
 * Tests for the Docker-backed build checker. All Docker invocations are stubbed
 * through the DockerRunner interface — these tests never shell out, so they
 * run the same on Windows/macOS/Linux and in CI without Docker installed.
 *
 * The real RealDockerRunner is exercised separately by scripts/bench-vibe-coder.ts
 * (gated on Docker availability), which is intentionally an out-of-band benchmark
 * rather than a unit test.
 */

function tsx(path: string, content: string): GeneratedFile {
  return { path, content, language: 'tsx' };
}

function ts(path: string, content: string): GeneratedFile {
  return { path, content, language: 'typescript' };
}

/**
 * Build a stub runner that returns a canned result and records every call.
 * Set `available: false` to simulate Docker absent.
 */
function stubRunner(
  result: Partial<DockerBuildRunResult> & { exitCode: number; stdout?: string; stderr?: string },
  opts: { available?: boolean; throws?: Error } = {},
): DockerRunner & { calls: DockerBuildRunOptions[] } {
  const calls: DockerBuildRunOptions[] = [];
  return {
    calls,
    isAvailable: () => opts.available ?? true,
    runBuild: vi.fn(async (runOpts: DockerBuildRunOptions) => {
      calls.push(runOpts);
      if (opts.throws) throw opts.throws;
      return {
        exitCode: result.exitCode,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        durationMs: result.durationMs ?? 1234,
        command: result.command ?? 'npm install && npx next build',
      };
    }),
  };
}

describe('DockerBuildChecker — graceful skip paths', () => {
  it('returns skipped=true when Docker is not available (does not fail the workflow)', async () => {
    const runner = stubRunner({ exitCode: 0 }, { available: false });
    const checker = new DockerBuildChecker({ runner });

    const result = await checker.check([tsx('src/app/page.tsx', 'export default function Page() { return null; }')]);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toMatch(/Docker not available/);
    expect(runner.calls).toHaveLength(0);
  });

  it('returns skipped=true when the runner itself throws (not a build failure)', async () => {
    const runner = stubRunner({ exitCode: 0 }, { throws: new Error('ENOSPC: disk full') });
    const checker = new DockerBuildChecker({ runner });

    const result = await checker.check([tsx('src/app/page.tsx', 'export default function Page() { return null; }')]);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toMatch(/Docker runner error: ENOSPC/);
  });

  it('fails hard on zero files — that is a caller bug, not a Docker problem', async () => {
    const runner = stubRunner({ exitCode: 0 });
    const checker = new DockerBuildChecker({ runner });

    const result = await checker.check([]);

    expect(result.ok).toBe(false);
    expect(result.skipped).toBeUndefined();
    expect(result.errorLog).toMatch(/zero files/);
    expect(runner.calls).toHaveLength(0);
  });
});

describe('DockerBuildChecker — passes clean builds', () => {
  it('reports ok=true with duration when exit code is 0', async () => {
    const runner = stubRunner({
      exitCode: 0,
      stdout: '✓ Compiled successfully\n',
      durationMs: 42_000,
    });
    const checker = new DockerBuildChecker({ runner });

    const result = await checker.check([tsx('src/app/page.tsx', 'export default function Page() { return null; }')]);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBeFalsy();
    expect(result.durationMs).toBe(42_000);
  });

  it('forwards framework + command override to the runner', async () => {
    const runner = stubRunner({ exitCode: 0 });
    const checker = new DockerBuildChecker({
      runner,
      framework: 'vite',
      timeoutMs: 90_000,
      buildCommand: 'echo custom',
    });

    await checker.check([ts('src/index.ts', 'export const x = 1;')]);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.framework).toBe('vite');
    expect(runner.calls[0]?.timeoutMs).toBe(90_000);
    expect(runner.calls[0]?.buildCommand).toBe('echo custom');
  });
});

describe('DockerBuildChecker — reports real build failures', () => {
  it('returns ok=false on non-zero exit with combined stdout+stderr in errorLog', async () => {
    const runner = stubRunner({
      exitCode: 1,
      stdout: 'Creating an optimized production build ...\nFailed to compile.\n',
      stderr: './src/app/page.tsx:10:5\nType error: Property "foo" does not exist on type "never"\n',
    });
    const checker = new DockerBuildChecker({ runner });

    const result = await checker.check([
      tsx('src/app/page.tsx', 'export default function Page() { return <div>{x.foo}</div>; }'),
    ]);

    expect(result.ok).toBe(false);
    expect(result.skipped).toBeFalsy();
    expect(result.errorLog).toContain('Failed to compile');
    expect(result.errorLog).toContain('Type error');
  });

  it('extracts affected file paths from Next.js style errors (./src/app/page.tsx:L:C)', async () => {
    const runner = stubRunner({
      exitCode: 1,
      stdout: 'Failed to compile.\n./src/app/page.tsx:10:5\nType error\n',
    });
    const checker = new DockerBuildChecker({ runner });

    const result = await checker.check([
      tsx('src/app/page.tsx', 'bad code'),
      tsx('src/app/other.tsx', 'unrelated'),
    ]);

    expect(result.ok).toBe(false);
    expect(result.affectedFiles).toEqual(['src/app/page.tsx']);
  });

  it('extracts affected file paths from tsc style errors (foo.ts(L,C): error)', async () => {
    const runner = stubRunner({
      exitCode: 1,
      stdout: `src/lib/util.ts(5,3): error TS2322: Type 'string' is not assignable to type 'number'.\n`,
    });
    const checker = new DockerBuildChecker({ runner });

    const result = await checker.check([
      ts('src/lib/util.ts', 'bad code'),
      ts('src/lib/other.ts', 'unrelated'),
    ]);

    expect(result.ok).toBe(false);
    expect(result.affectedFiles).toEqual(['src/lib/util.ts']);
  });

  it('does not list files that are not in the provided set (ignores node_modules noise)', async () => {
    const runner = stubRunner({
      exitCode: 1,
      stdout: 'node_modules/next/dist/server/render.js:100:5 — some internal stack trace\nsrc/app/page.tsx:10:5 Type error\n',
    });
    const checker = new DockerBuildChecker({ runner });

    const result = await checker.check([tsx('src/app/page.tsx', 'bad code')]);

    expect(result.affectedFiles).toEqual(['src/app/page.tsx']);
    expect(result.affectedFiles).not.toContain('node_modules/next/dist/server/render.js');
  });

  it('falls back to a synthetic error message when build output is empty', async () => {
    const runner = stubRunner({ exitCode: 137, stdout: '', stderr: '' });
    const checker = new DockerBuildChecker({ runner });

    const result = await checker.check([tsx('src/app/page.tsx', 'whatever')]);

    expect(result.ok).toBe(false);
    expect(result.errorLog).toMatch(/exited with code 137/);
  });
});

describe('extractAffectedFiles — path normalization', () => {
  it('strips leading ./ from Next.js paths', () => {
    const files = [tsx('src/app/page.tsx', '')];
    const affected = extractAffectedFiles('./src/app/page.tsx:1:1 Error\n', files);
    expect(affected).toEqual(['src/app/page.tsx']);
  });

  it('dedupes the same file reported multiple times', () => {
    const files = [ts('src/lib/a.ts', '')];
    const out = `
      src/lib/a.ts(1,1): error TS1234: x
      src/lib/a.ts(2,1): error TS1234: y
      src/lib/a.ts(3,1): error TS1234: z
    `;
    expect(extractAffectedFiles(out, files)).toEqual(['src/lib/a.ts']);
  });

  it('returns empty array when no known files match', () => {
    const files = [ts('src/lib/a.ts', '')];
    expect(extractAffectedFiles('unrelated stderr noise', files)).toEqual([]);
  });
});

describe('capErrorLog — keeps debugger budget sane', () => {
  it('passes short logs through unchanged', () => {
    const short = 'build failed on line 5';
    expect(capErrorLog(short)).toBe(short);
  });

  it('preserves head and tail of huge logs and notes the elision', () => {
    const big = 'A'.repeat(2000) + '\n' + 'B'.repeat(20_000) + '\n' + 'C'.repeat(2000);
    const capped = capErrorLog(big, 8000);
    expect(capped.length).toBeLessThanOrEqual(8000 + 200); // cap + elision marker
    expect(capped).toContain('chars elided');
    // Tail retained (root cause usually last).
    expect(capped.endsWith('C'.repeat(2000))).toBe(true);
  });
});
