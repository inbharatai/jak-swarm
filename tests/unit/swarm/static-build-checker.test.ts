import { describe, it, expect } from 'vitest';
import { staticBuildChecker } from '@jak-swarm/swarm';
import type { GeneratedFile } from '@jak-swarm/agents';

/**
 * Tests for the TypeScript-compiler-backed build checker. Verifies the
 * checker catches real LLM-generated failure modes fast (sub-second) without
 * needing Docker / disk / npm install.
 */

function tsx(path: string, content: string): GeneratedFile {
  return { path, content, language: 'tsx' };
}

describe('staticBuildChecker — accepts valid code', () => {
  it('passes a minimal valid Next.js page', async () => {
    const result = await staticBuildChecker.check([
      tsx(
        'src/app/page.tsx',
        `export default function Page(): JSX.Element { return <div>hi</div> as unknown as JSX.Element; }`,
      ),
    ]);
    expect(result.ok).toBe(true);
  });

  it('passes pure TypeScript with local types', async () => {
    const result = await staticBuildChecker.check([
      {
        path: 'src/lib/util.ts',
        content: `export function add(a: number, b: number): number { return a + b; }`,
        language: 'typescript',
      },
    ]);
    expect(result.ok).toBe(true);
  });

  it('ignores module-not-found for npm packages (Vercel resolves those)', async () => {
    const result = await staticBuildChecker.check([
      tsx(
        'src/app/page.tsx',
        `
        import React from 'react';
        import Link from 'next/link';
        export default function Page() { return React.createElement('div', null, 'x'); }
      `,
      ),
    ]);
    // No TS2307 (cannot find module) should leak through.
    expect(result.ok).toBe(true);
  });

  it('passes empty list as ok (nothing to check, matching heuristic checker for clarity)', async () => {
    const result = await staticBuildChecker.check([
      { path: 'README.md', content: '# App', language: 'markdown' },
    ]);
    // Only non-compilable files present → ok.
    expect(result.ok).toBe(true);
  });
});

describe('staticBuildChecker — catches syntax errors', () => {
  it('catches truncated function (missing closing brace)', async () => {
    const result = await staticBuildChecker.check([
      tsx('src/app/page.tsx', `export default function Page() { const x = 1;`),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errorLog).toMatch(/TS1005|TS1128|TS1161/);
    expect(result.affectedFiles).toContain('src/app/page.tsx');
  });

  it('catches invalid JSX', async () => {
    const result = await staticBuildChecker.check([
      tsx(
        'src/app/page.tsx',
        `export default function Page() { return <div><span></div>; }`,
      ),
    ]);
    expect(result.ok).toBe(false);
  });

  it('catches missing comma in object literal', async () => {
    const result = await staticBuildChecker.check([
      {
        path: 'src/lib/cfg.ts',
        content: `export const cfg = { a: 1 b: 2 };`,
        language: 'typescript',
      },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('staticBuildChecker — catches local type errors', () => {
  it('catches calling undefined local function', async () => {
    const result = await staticBuildChecker.check([
      {
        path: 'src/lib/util.ts',
        content: `export function run(): number { return missingFn(); }`,
        language: 'typescript',
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errorLog).toMatch(/Cannot find name 'missingFn'/);
  });

  it('catches wrong arity to user-defined function', async () => {
    const result = await staticBuildChecker.check([
      {
        path: 'src/lib/util.ts',
        content: `
          function add(a: number, b: number): number { return a + b; }
          export const x = add(1);
        `,
        language: 'typescript',
      },
    ]);
    expect(result.ok).toBe(false);
    // TS2554 = expected N arguments, got M
    expect(result.errorLog).toMatch(/TS2554|Expected \d+ arguments/);
  });

  it('catches duplicate export declarations', async () => {
    const result = await staticBuildChecker.check([
      {
        path: 'src/lib/util.ts',
        content: `
          export const x = 1;
          export const x = 2;
        `,
        language: 'typescript',
      },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('staticBuildChecker — zero / bad input', () => {
  it('fails on zero files', async () => {
    const result = await staticBuildChecker.check([]);
    expect(result.ok).toBe(false);
    expect(result.errorLog).toMatch(/zero files/);
  });

  it('caps errorLog on many diagnostics', async () => {
    // Generate a file with many syntax errors.
    const content = Array.from({ length: 50 }, () => 'foo(').join('\n');
    const result = await staticBuildChecker.check([
      { path: 'src/broken.ts', content, language: 'typescript' },
    ]);
    expect(result.ok).toBe(false);
    // The cap applies so it won't balloon the debugger's token budget.
    expect(result.errorLog?.length ?? 0).toBeLessThan(20_000);
  });
});
