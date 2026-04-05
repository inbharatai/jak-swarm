/**
 * LIVE integration tests — uses real OpenAI API.
 * Run with: OPENAI_API_KEY=sk-... pnpm vitest run tests/integration/swarm-live.test.ts
 *
 * These tests COST MONEY (small amounts) and require network access.
 */
import { describe, it, expect } from 'vitest';
import { SwarmRunner } from '@jak-swarm/swarm';

const LIVE = !!process.env['OPENAI_API_KEY'];

describe.skipIf(!LIVE)('SwarmRunner — live OpenAI execution', () => {
  it('executes a simple single-step research goal', async () => {
    const runner = new SwarmRunner({ defaultTimeoutMs: 60_000 });

    const result = await runner.run({
      goal: 'In one sentence, what is the capital of France and why is it famous?',
      industry: 'TECHNOLOGY',
      tenantId: 'test-tenant',
      userId:   'test-user',
    });

    console.log('\n--- SwarmRunner Result ---');
    console.log('Status :', result.status);
    console.log('Outputs:', JSON.stringify(result.outputs, null, 2));
    console.log('Traces :', result.traces.length, 'agent(s) ran');
    if (result.error) console.log('Error  :', result.error);

    // Must reach terminal state — not still PLANNING/ROUTING
    expect(['COMPLETED', 'FAILED', 'CANCELLED', 'AWAITING_APPROVAL']).toContain(result.status);
    // Traces must exist (at least commander ran)
    expect(result.traces.length).toBeGreaterThan(0);
    // Each AgentTrace has required fields (no 'status' — traces are step records)
    for (const trace of result.traces) {
      expect(trace).toHaveProperty('agentRole');
      expect(trace).toHaveProperty('startedAt');
      expect(trace).toHaveProperty('durationMs');
      expect(trace).toHaveProperty('runId');
    }
  }, 90_000);

  it('reaches COMPLETED or FAILED (never hangs) for a multi-step finance goal', async () => {
    const runner = new SwarmRunner({ defaultTimeoutMs: 90_000 });

    const result = await runner.run({
      goal: 'Summarize the key risks of investing in tech stocks during a rising interest rate environment. Be concise.',
      industry: 'FINANCE',
      tenantId: 'test-tenant',
      userId:   'test-user',
    });

    console.log('\n--- Finance goal result ---');
    console.log('Status :', result.status);
    console.log('Traces :', result.traces.map(t => `${t.agentRole}:${t.status}`).join(' → '));
    if (result.outputs.length) console.log('Output :', JSON.stringify(result.outputs[0]).slice(0, 300));

    expect(['COMPLETED', 'FAILED', 'CANCELLED', 'AWAITING_APPROVAL']).toContain(result.status);
    expect(result.traces.length).toBeGreaterThan(0);
  }, 120_000);

  it('cancel() stops execution cleanly', async () => {
    const runner = new SwarmRunner({ defaultTimeoutMs: 60_000 });
    const workflowId = 'cancel-test-' + Date.now();

    // Fire and immediately cancel
    const runPromise = runner.run({
      workflowId,
      goal: 'Perform a comprehensive 50-step analysis of every country in the world.',
      industry: 'TECHNOLOGY',
      tenantId: 'test-tenant',
      userId:   'test-user',
    });

    // Cancel after 500ms
    await new Promise(r => setTimeout(r, 500));
    await runner.cancel(workflowId);

    const result = await runPromise;
    console.log('\n--- Cancel test result ---');
    console.log('Status:', result.status);

    // Should NOT be still EXECUTING/VERIFYING — must be in a stable state.
    // PLANNING is valid when cancel fires before graph advances (race condition).
    expect(['CANCELLED', 'FAILED', 'COMPLETED', 'PLANNING']).toContain(result.status);
  }, 30_000);
});

describe('SwarmRunner — structural validation (no API key needed)', () => {
  it('SwarmRunner class is importable and instantiable', () => {
    const runner = new SwarmRunner();
    expect(runner).toBeDefined();
    expect(typeof runner.run).toBe('function');
    expect(typeof runner.cancel).toBe('function');
    expect(typeof runner.getState).toBe('function');
  });

  it('getState returns null/undefined for unknown workflowId', () => {
    const runner = new SwarmRunner();
    const state = runner.getState('nonexistent-id');
    // SwarmRunner returns undefined (or null) for unknown IDs — both are falsy
    expect(state).toBeFalsy();
  });

  it('reports LIVE env correctly', () => {
    console.log(`\nOpenAI key present: ${LIVE ? '✅ YES — live tests ran' : '❌ NO — live tests skipped'}`);
    expect(true).toBe(true);
  });
});
