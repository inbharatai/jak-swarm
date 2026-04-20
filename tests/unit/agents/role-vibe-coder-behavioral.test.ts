/**
 * Vibe Coding hero role behavioral tests.
 *
 * Covers the 4 world_class-classified agents on the hot path of the Vibe Coder
 * workflow. These are the highest-impact regression targets: any parser or
 * prompt drift in AppArchitect / AppGenerator / AppDebugger / Coder silently
 * degrades the headline product.
 *
 * Same stubbed-callLLM pattern as other role behavioral tests.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AppArchitectAgent,
  AppGeneratorAgent,
  AppDebuggerAgent,
  CoderAgent,
  AgentContext,
} from '@jak-swarm/agents';
import type OpenAI from 'openai';

function stubContext(): AgentContext {
  return new AgentContext({ tenantId: 't-1', userId: 'u-1', workflowId: 'wf-1' });
}

function fakeCompletion(content: string): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: 'stub-1',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'stub',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: { role: 'assistant', content, refusal: null },
      } as unknown as OpenAI.Chat.Completions.ChatCompletion.Choice,
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

function stubLLM<T>(agent: T, payload: unknown): void {
  (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM =
    vi.fn(async () => fakeCompletion(JSON.stringify(payload)));
}

// ─── AppArchitect ──────────────────────────────────────────────────────────

describe('AppArchitectAgent — architecture + fileTree + dataModels + apiEndpoints', () => {
  it('preserves fileTree, dataModels, apiEndpoints, envVars on ARCHITECT_APP', { timeout: 20_000 }, async () => {
    const agent = new AppArchitectAgent('stub-key');
    stubLLM(agent, {
      architecture: 'Next.js App Router with Prisma + Postgres; TailwindCSS styling; Zod validation on API routes.',
      fileTree: [
        { path: 'src/app/page.tsx', purpose: 'Landing page with todo list', language: 'tsx', priority: 'critical' },
        { path: 'src/app/api/todos/route.ts', purpose: 'CRUD for todos', language: 'ts', priority: 'critical' },
        { path: 'prisma/schema.prisma', purpose: 'Todo model', language: 'prisma', priority: 'critical' },
      ],
      dependencies: { next: '^14.0.0', react: '^18.0.0', '@prisma/client': '^5.0.0' },
      devDependencies: { typescript: '^5.0.0', prisma: '^5.0.0' },
      routes: [
        { path: '/', page: 'src/app/page.tsx', description: 'Landing + todo list' },
      ],
      dataModels: [
        { name: 'Todo', fields: [{ name: 'id', type: 'string' }, { name: 'title', type: 'string' }, { name: 'done', type: 'boolean' }] },
      ],
      apiEndpoints: [
        { method: 'GET', path: '/api/todos', description: 'List todos' },
        { method: 'POST', path: '/api/todos', description: 'Create todo' },
      ],
      componentHierarchy: 'RootLayout > HomePage > TodoList > TodoItem',
      authStrategy: 'None (MVP)',
      envVars: [
        { key: 'DATABASE_URL', description: 'Postgres connection string', required: true },
      ],
      confidence: 0.9,
    });

    const result = await agent.execute(
      { action: 'ARCHITECT_APP', description: 'Todo list with Prisma', framework: 'nextjs' },
      stubContext(),
    );

    expect(result.fileTree).toHaveLength(3);
    expect(result.fileTree[0]?.priority).toBe('critical');
    expect(result.dependencies['@prisma/client']).toMatch(/\^5/);
    expect(result.routes).toHaveLength(1);
    expect(result.dataModels).toHaveLength(1);
    expect(result.apiEndpoints).toHaveLength(2);
    expect(result.envVars?.[0]?.key).toBe('DATABASE_URL');
    expect(result.envVars?.[0]?.required).toBe(true);
    expect(result.confidence).toBe(0.9);
  });

  it('falls back with low confidence on non-JSON output', async () => {
    const agent = new AppArchitectAgent('stub-key');
    (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM = vi.fn(
      async () => fakeCompletion('Architecture: use Next.js.'),
    );
    const result = await agent.execute(
      { action: 'ARCHITECT_APP', description: 'any app' },
      stubContext(),
    );
    expect(result.fileTree).toEqual([]);
    expect(result.dataModels).toEqual([]);
    expect(result.apiEndpoints).toEqual([]);
    expect(result.confidence).toBeLessThan(0.7);
  });
});

// ─── AppGenerator ──────────────────────────────────────────────────────────

describe('AppGeneratorAgent — files[] + explanation output schema', () => {
  it('preserves generated files with full content and language', async () => {
    const agent = new AppGeneratorAgent('stub-key');
    stubLLM(agent, {
      files: [
        {
          path: 'src/app/page.tsx',
          content: `'use client';\nimport { useState } from 'react';\nexport default function Page() {\n  const [items, setItems] = useState<string[]>([]);\n  return <main>{items.length} todos</main>;\n}\n`,
          language: 'tsx',
        },
        {
          path: 'src/app/api/todos/route.ts',
          content: `import { NextResponse } from 'next/server';\nexport async function GET() { return NextResponse.json({ todos: [] }); }\n`,
          language: 'ts',
        },
      ],
      explanation: 'Generated a Next.js page + GET handler for todos.',
      confidence: 0.88,
    });

    const result = await agent.execute(
      {
        action: 'GENERATE_BATCH',
        framework: 'nextjs',
        fileTree: [
          { path: 'src/app/page.tsx', purpose: 'Todo list', language: 'tsx', priority: 'critical' },
        ],
      },
      stubContext(),
    );

    expect(result.files).toHaveLength(2);
    // No truncation — the agent must preserve what the LLM sent.
    expect(result.files[0]?.content).toContain('useState');
    expect(result.files[0]?.content).not.toContain('// TODO');
    expect(result.files[0]?.content).not.toContain('...');
    expect(result.files[1]?.content).toContain('NextResponse');
    expect(result.explanation).toContain('Generated');
  });

  it('degrades gracefully when LLM returns plain text', async () => {
    const agent = new AppGeneratorAgent('stub-key');
    (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM = vi.fn(
      async () => fakeCompletion('Sorry, I could not generate code.'),
    );
    const result = await agent.execute(
      { action: 'GENERATE_BATCH', framework: 'nextjs' },
      stubContext(),
    );
    expect(result.files).toEqual([]);
    expect(result.confidence).toBeLessThan(0.5);
    // Upgrade 2026-04-20: fallback now flags manual-review + attaches build-
    // readiness diagnostics so the Vibe Coder pipeline knows not to proceed.
    expect(result.explanation).toMatch(/manual review required/i);
    expect(result.buildReadiness?.typecheckPasses).toBe(false);
    expect(result.diagnostics?.some((d) => d.severity === 'error')).toBe(true);
  });
});

// ─── AppDebugger ───────────────────────────────────────────────────────────

describe('AppDebuggerAgent — diagnosis + rootCause + fixes + requiresUserInput', () => {
  it('preserves structured debug output with surgical fixes', async () => {
    const agent = new AppDebuggerAgent('stub-key');
    stubLLM(agent, {
      diagnosis: "Type error: 'items' is possibly undefined in ItemList.tsx:22",
      rootCause: 'Missing null check on an async-loaded state',
      fixes: [
        {
          path: 'src/components/ItemList.tsx',
          content: `'use client';\nimport { useState, useEffect } from 'react';\nexport function ItemList() {\n  const [items, setItems] = useState<string[] | null>(null);\n  useEffect(() => {\n    fetch('/api/items').then((r) => r.json()).then((d) => setItems(d.items));\n  }, []);\n  if (!items) return <div>Loading...</div>;\n  return <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>;\n}\n`,
          explanation: 'Added loading guard before rendering list',
        },
      ],
      preventionAdvice: 'Initialize async state with null and guard before render.',
      confidence: 0.82,
      requiresUserInput: false,
    });

    const result = await agent.execute(
      {
        action: 'SELF_DEBUG_LOOP',
        errorLog: "Type error in ItemList.tsx:22 — 'items' is possibly undefined",
        errorType: 'type',
        affectedFiles: ['src/components/ItemList.tsx'],
      },
      stubContext(),
    );

    expect(result.diagnosis).toContain('ItemList.tsx');
    expect(result.rootCause).toContain('null check');
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0]?.content).toContain('Loading');
    expect(result.fixes[0]?.explanation).toBeTruthy();
    expect(result.requiresUserInput).toBe(false);
  });

  it('surfaces requiresUserInput=true when fix is ambiguous', async () => {
    const agent = new AppDebuggerAgent('stub-key');
    stubLLM(agent, {
      diagnosis: 'Missing env var STRIPE_SECRET_KEY at build time',
      rootCause: 'Build references process.env.STRIPE_SECRET_KEY but none provided',
      fixes: [],
      confidence: 0.3,
      requiresUserInput: true,
      userQuestion: 'What value should I set for STRIPE_SECRET_KEY? This is infra-side — I cannot guess.',
    });
    const result = await agent.execute(
      { action: 'SELF_DEBUG_LOOP', errorLog: 'missing env', errorType: 'build' },
      stubContext(),
    );
    expect(result.requiresUserInput).toBe(true);
    expect(result.userQuestion).toContain('STRIPE_SECRET_KEY');
    expect(result.fixes).toEqual([]);
  });
});

// ─── Coder ─────────────────────────────────────────────────────────────────

describe('CoderAgent — code + tests + reviewFindings output schema', () => {
  it('preserves code, tests, architecture, reviewFindings on WRITE_CODE', async () => {
    const agent = new CoderAgent('stub-key');
    stubLLM(agent, {
      language: 'typescript',
      code: `export function fibonacci(n: number): number {\n  if (n < 2) return n;\n  let a = 0, b = 1;\n  for (let i = 2; i <= n; i++) { [a, b] = [b, a + b]; }\n  return b;\n}\n`,
      explanation: 'Iterative Fibonacci — O(n) time, O(1) space. Handles edge cases n=0 and n=1.',
      tests: `import { fibonacci } from './fib';\nimport { test, expect } from 'vitest';\ntest('fib(0) === 0', () => expect(fibonacci(0)).toBe(0));\ntest('fib(10) === 55', () => expect(fibonacci(10)).toBe(55));\n`,
      architecture: 'Single pure function in src/lib/fib.ts with vitest coverage in src/lib/fib.test.ts',
      reviewFindings: [
        { severity: 'low', finding: 'No input validation for negative n', suggestion: 'Throw on n < 0 if domain requires' },
      ],
      confidence: 0.9,
    });

    const result = await agent.execute(
      { action: 'WRITE_CODE', description: 'Fibonacci function', language: 'typescript' },
      stubContext(),
    );

    expect(result.code).toContain('fibonacci');
    expect(result.tests).toContain('test');
    expect(result.reviewFindings).toHaveLength(1);
    expect(result.reviewFindings?.[0]?.severity).toBe('low');
    expect(result.architecture).toContain('src/lib/fib.ts');
  });

  it('preserves reviewFindings on REVIEW_CODE', async () => {
    const agent = new CoderAgent('stub-key');
    stubLLM(agent, {
      language: 'typescript',
      code: '',
      explanation: 'Review complete — 2 findings.',
      reviewFindings: [
        { severity: 'high', finding: 'SQL injection in buildQuery()', suggestion: 'Use parameterized queries via `$queryRaw` Prisma helper' },
        { severity: 'medium', finding: 'Missing rate limiting on /login', suggestion: 'Add middleware.ts with 5 req/min/IP' },
      ],
      confidence: 0.85,
    });
    const result = await agent.execute(
      { action: 'REVIEW_CODE', language: 'typescript', code: 'function buildQuery(id) { return `SELECT * FROM users WHERE id=${id}`; }' },
      stubContext(),
    );
    expect(result.reviewFindings?.[0]?.severity).toBe('high');
    expect(result.reviewFindings?.[0]?.finding).toContain('SQL injection');
  });
});
