/**
 * Convergence tests for the self-reflection loop.
 *
 * Regression guard for a real production bug: reflectAndCorrect() used
 * a "Be strict" prompt that found 8-10 "major" issues every pass, even
 * after corrections. For strategy/creative content this created a
 * non-converging loop (verifier retries compound it: up to 3 worker
 * re-executions × reflectAndCorrect each).
 *
 * The fix introduces:
 *   1. ReflectionMode ('strict' | 'lenient') — lenient only corrects
 *      objective errors (hallucinations, format violations)
 *   2. Severity gate — lenient mode accepts 'minor' severity
 *   3. maxReflectionPasses cap — hard convergence safety net
 *   4. Re-reflection loop — corrected output is re-reflected up to cap
 */

import { describe, it, expect, vi } from 'vitest';
import { BaseAgent } from '@jak-swarm/agents';
import type { ReflectionMode, ReflectAndCorrectOptions } from '@jak-swarm/agents';
import { AgentRole } from '@jak-swarm/shared';
import { getReflectionMode, ROLE_MANIFEST } from '@jak-swarm/agents';

// ─── Mock agent that controls LLM responses ──────────────────────────────────

class MockAgent extends BaseAgent {
  private mockResponses: Array<{ content: string }> = [];
  private callIndex = 0;

  constructor(role: AgentRole = AgentRole.WORKER_STRATEGIST) {
    super(role, 'stub-key');
  }

  public async execute(): Promise<unknown> {
    return {};
  }

  public setMockResponses(contents: string[]): void {
    this.mockResponses = contents.map((c) => ({ content: c }));
    this.callIndex = 0;
  }

  public get callCount(): number {
    return this.callIndex;
  }

  /** Override callLLM to return mock responses in order. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async callLLM(): Promise<any> {
    const resp = this.mockResponses[this.callIndex++];
    if (!resp) throw new Error('No more mock responses');
    return {
      choices: [{ message: { role: 'assistant' as const, content: resp.content } }],
    };
  }
}

/** Build a reflection JSON response. */
function reflectionJson(overrides: Partial<{
  hasIssues: boolean; issues: string[]; severity: string; suggestion: string;
}> = {}): string {
  return JSON.stringify({
    hasIssues: overrides.hasIssues ?? false,
    issues: overrides.issues ?? [],
    severity: overrides.severity ?? 'none',
    suggestion: overrides.suggestion ?? '',
    ...overrides,
  });
}

// ─── Severity gate tests ─────────────────────────────────────────────────────

describe('reflectAndCorrect severity gate', () => {
  it('accepts output when severity is "none" (both modes)', async () => {
    const agent = new MockAgent();
    agent.setMockResponses([reflectionJson({ hasIssues: false, severity: 'none' })]);
    const result = await agent.reflectAndCorrect('output', 'task', { mode: 'strict' });
    expect(result.wasChanged).toBe(false);
    expect(result.corrected).toBe('output');
  });

  it('strict mode corrects "minor" severity', async () => {
    const agent = new MockAgent();
    agent.setMockResponses([
      reflectionJson({ hasIssues: true, issues: ['Missing field X'], severity: 'minor' }),
      'corrected output', // correction response
      reflectionJson({ hasIssues: false, severity: 'none' }), // re-reflection accepts
    ]);
    const result = await agent.reflectAndCorrect('original', 'task', {
      mode: 'strict',
      maxReflectionPasses: 2,
    });
    expect(result.wasChanged).toBe(true);
  });

  it('lenient mode accepts "minor" severity without correction', async () => {
    const agent = new MockAgent();
    agent.setMockResponses([
      reflectionJson({ hasIssues: true, issues: ['Could be more detailed'], severity: 'minor' }),
    ]);
    const result = await agent.reflectAndCorrect('original', 'task', { mode: 'lenient' });
    expect(result.wasChanged).toBe(false);
    expect(result.corrected).toBe('original');
    expect(agent.callCount).toBe(1); // Only reflection, no correction
  });

  it('lenient mode still corrects "major" severity', async () => {
    const agent = new MockAgent();
    agent.setMockResponses([
      reflectionJson({ hasIssues: true, issues: ['Hallucinated date'], severity: 'major' }),
      'corrected output',
      reflectionJson({ hasIssues: false, severity: 'none' }),
    ]);
    const result = await agent.reflectAndCorrect('original', 'task', {
      mode: 'lenient',
      maxReflectionPasses: 2,
    });
    expect(result.wasChanged).toBe(true);
  });

  it('both modes correct "critical" severity', async () => {
    const agent = new MockAgent();
    agent.setMockResponses([
      reflectionJson({ hasIssues: true, issues: ['Fabricated source'], severity: 'critical' }),
      'corrected output',
      reflectionJson({ hasIssues: false, severity: 'none' }),
    ]);
    const result = await agent.reflectAndCorrect('original', 'task', {
      mode: 'lenient',
      maxReflectionPasses: 2,
    });
    expect(result.wasChanged).toBe(true);
  });
});

// ─── Convergence loop tests ──────────────────────────────────────────────────

describe('reflectAndCorrect convergence loop', () => {
  it('converges after correction when re-reflection passes', async () => {
    const agent = new MockAgent();
    agent.setMockResponses([
      // Pass 1: reflection finds issues
      reflectionJson({ hasIssues: true, issues: ['Bad format'], severity: 'major' }),
      'corrected output', // Pass 1: correction
      // Pass 2: re-reflection passes
      reflectionJson({ hasIssues: false, severity: 'none' }),
    ]);
    const result = await agent.reflectAndCorrect('original', 'task', {
      mode: 'strict',
      maxReflectionPasses: 2,
    });
    expect(result.wasChanged).toBe(true);
    expect(result.corrected).toBe('corrected output');
    expect(agent.callCount).toBe(3); // reflect + correct + re-reflect
  });

  it('stops at maxReflectionPasses even if issues persist', async () => {
    const agent = new MockAgent();
    // Always finds issues
    agent.setMockResponses([
      reflectionJson({ hasIssues: true, issues: ['Issue 1'], severity: 'major' }),
      'corrected 1',
      reflectionJson({ hasIssues: true, issues: ['Issue 2'], severity: 'major' }),
      'corrected 2',
    ]);
    const result = await agent.reflectAndCorrect('original', 'task', {
      mode: 'strict',
      maxReflectionPasses: 2,
    });
    expect(result.wasChanged).toBe(true);
    expect(agent.callCount).toBe(4); // 2 passes × (reflect + correct)
  });

  it('returns original when maxReflectionPasses is 0', async () => {
    const agent = new MockAgent();
    const result = await agent.reflectAndCorrect('original', 'task', {
      maxReflectionPasses: 0,
    });
    expect(result.wasChanged).toBe(false);
    expect(result.corrected).toBe('original');
    expect(agent.callCount).toBe(0);
  });

  it('handles single pass (maxReflectionPasses=1)', async () => {
    const agent = new MockAgent();
    agent.setMockResponses([
      reflectionJson({ hasIssues: true, issues: ['Bad data'], severity: 'major' }),
      'corrected output',
    ]);
    const result = await agent.reflectAndCorrect('original', 'task', {
      mode: 'strict',
      maxReflectionPasses: 1,
    });
    expect(result.wasChanged).toBe(true);
    // After 1 pass (reflect + correct), loop ends — no re-reflection
    expect(agent.callCount).toBe(2);
  });
});

// ─── Role-manifest reflection mode assignments ────────────────────────────────

describe('Role-manifest reflection mode assignments', () => {
  it('creative/subjective roles get lenient mode', () => {
    expect(getReflectionMode(AgentRole.WORKER_STRATEGIST)).toBe('lenient');
    expect(getReflectionMode(AgentRole.WORKER_MARKETING)).toBe('lenient');
    expect(getReflectionMode(AgentRole.WORKER_CONTENT)).toBe('lenient');
    expect(getReflectionMode(AgentRole.WORKER_GROWTH)).toBe('lenient');
    expect(getReflectionMode(AgentRole.WORKER_HR)).toBe('lenient');
    expect(getReflectionMode(AgentRole.WORKER_PR)).toBe('lenient');
    expect(getReflectionMode(AgentRole.WORKER_SUCCESS)).toBe('lenient');
    expect(getReflectionMode(AgentRole.WORKER_PRODUCT)).toBe('lenient');
    expect(getReflectionMode(AgentRole.WORKER_PROJECT)).toBe('lenient');
    expect(getReflectionMode(AgentRole.WORKER_SEO)).toBe('lenient');
  });

  it('factual/grounded roles get strict mode', () => {
    expect(getReflectionMode(AgentRole.WORKER_RESEARCH)).toBe('strict');
    expect(getReflectionMode(AgentRole.WORKER_DESIGNER)).toBe('strict');
    expect(getReflectionMode(AgentRole.WORKER_FINANCE)).toBe('strict');
    expect(getReflectionMode(AgentRole.WORKER_LEGAL)).toBe('strict');
    expect(getReflectionMode(AgentRole.WORKER_ANALYTICS)).toBe('strict');
    expect(getReflectionMode(AgentRole.WORKER_CODER)).toBe('strict');
    expect(getReflectionMode(AgentRole.WORKER_SPREADSHEET)).toBe('strict');
  });

  it('unspecified roles default to strict', () => {
    expect(getReflectionMode(AgentRole.WORKER_EMAIL)).toBe('strict');
    expect(getReflectionMode(AgentRole.WORKER_OPS)).toBe('strict');
    expect(getReflectionMode(AgentRole.WORKER_BROWSER)).toBe('strict');
  });

  it('orchestrator roles default to strict', () => {
    expect(getReflectionMode(AgentRole.COMMANDER)).toBe('strict');
    expect(getReflectionMode(AgentRole.VERIFIER)).toBe('strict');
  });
});

// ─── Backward compatibility ───────────────────────────────────────────────────

describe('reflectAndCorrect backward compatibility', () => {
  it('accepts legacy { maxTokens } options without mode or maxReflectionPasses', async () => {
    const agent = new MockAgent();
    agent.setMockResponses([reflectionJson({ hasIssues: false, severity: 'none' })]);
    // Calling with the old-style options object — should still work
    const result = await agent.reflectAndCorrect('output', 'task', { maxTokens: 2048 });
    expect(result.wasChanged).toBe(false);
  });
});

// ─── Default mode from role ──────────────────────────────────────────────────

describe('defaultReflectionMode from role', () => {
  it('Strategist agent defaults to lenient mode', async () => {
    const agent = new MockAgent(AgentRole.WORKER_STRATEGIST);
    agent.setMockResponses([reflectionJson({ hasIssues: false, severity: 'none' })]);
    // No explicit mode — should use default from role manifest (lenient for strategist)
    const result = await agent.reflectAndCorrect('output', 'task');
    expect(result.wasChanged).toBe(false);
  });

  it('Finance agent defaults to strict mode', async () => {
    const agent = new MockAgent(AgentRole.WORKER_FINANCE);
    // In strict mode, minor severity triggers correction
    agent.setMockResponses([
      reflectionJson({ hasIssues: true, issues: ['Missing field'], severity: 'minor' }),
      'corrected',
      reflectionJson({ hasIssues: false, severity: 'none' }),
    ]);
    const result = await agent.reflectAndCorrect('output', 'task');
    expect(result.wasChanged).toBe(true);
  });
});