/**
 * Workflow error propagation — Behavioral tests
 *
 * Ensures failed workflows always carry a meaningful error string.
 */
import { describe, it, expect } from 'vitest';
import { SwarmRunner } from '@jak-swarm/swarm';

class BoomRunner extends SwarmRunner {
  constructor() {
    super({ defaultTimeoutMs: 5000, maxConcurrentWorkflows: 5 });
  }
}

describe('Workflow error propagation', () => {
  it('returns a non-empty error string when commander fails', async () => {
    // Force failure by using a missing API key and a fake model name
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_MODEL = 'model-that-does-not-exist';

    const runner = new BoomRunner();
    const result = await runner.run({
      goal: 'CMO + Auto: Review inbharat.ai website',
      tenantId: 't1',
      userId: 'u1',
      roleModes: ['cmo', 'auto'],
    });

    expect(result.status).toBe('FAILED');
    expect(result.error).toBeTruthy();
  });
});
