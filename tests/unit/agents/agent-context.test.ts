/**
 * Unit tests for AgentContext constructor, defaults, clone, and trace management.
 * No external API calls required.
 */
import { describe, it, expect } from 'vitest';
import { AgentContext } from '../../../packages/agents/src/base/agent-context.js';
import type { AgentTrace } from '../../../packages/shared/src/index.js';

function makeTrace(partial: Partial<AgentTrace> = {}): AgentTrace {
  return {
    agentRole: 'WORKER_RESEARCH',
    input: { query: 'test' },
    output: { answer: 'test result' },
    toolCalls: [],
    startedAt: new Date(),
    completedAt: new Date(),
    durationMs: 10,
    tokensUsed: { prompt: 100, completion: 50, total: 150 },
    costUsd: 0.001,
    ...partial,
  };
}

describe('AgentContext', () => {
  // ── constructor defaults ──

  it('generates runId and traceId defaults when not provided', () => {
    const ctx = new AgentContext({
      tenantId: 'tnt_1',
      userId: 'usr_1',
      workflowId: 'wf_1',
    });
    expect(ctx.runId).toBeTruthy();
    expect(ctx.traceId).toBeTruthy();
    expect(ctx.runId).not.toBe(ctx.traceId);
  });

  it('uses provided traceId and runId when given', () => {
    const ctx = new AgentContext({
      traceId: 'trc_explicit',
      runId: 'run_explicit',
      tenantId: 'tnt_1',
      userId: 'usr_1',
      workflowId: 'wf_1',
    });
    expect(ctx.traceId).toBe('trc_explicit');
    expect(ctx.runId).toBe('run_explicit');
  });

  it('sets required identity fields correctly', () => {
    const ctx = new AgentContext({
      tenantId: 'tnt_abc',
      userId: 'usr_abc',
      workflowId: 'wf_abc',
    });
    expect(ctx.tenantId).toBe('tnt_abc');
    expect(ctx.userId).toBe('usr_abc');
    expect(ctx.workflowId).toBe('wf_abc');
  });

  it('defaults connectedProviders to empty array', () => {
    const ctx = new AgentContext({ tenantId: 't', userId: 'u', workflowId: 'w' });
    expect(ctx.connectedProviders).toEqual([]);
  });

  it('defaults browserAutomationEnabled to false', () => {
    const ctx = new AgentContext({ tenantId: 't', userId: 'u', workflowId: 'w' });
    expect(ctx.browserAutomationEnabled).toBe(false);
  });

  it('defaults restrictedCategories to empty array', () => {
    const ctx = new AgentContext({ tenantId: 't', userId: 'u', workflowId: 'w' });
    expect(ctx.restrictedCategories).toEqual([]);
  });

  it('defaults approvalId to undefined', () => {
    const ctx = new AgentContext({ tenantId: 't', userId: 'u', workflowId: 'w' });
    expect(ctx.approvalId).toBeUndefined();
  });

  it('defaults industry to undefined', () => {
    const ctx = new AgentContext({ tenantId: 't', userId: 'u', workflowId: 'w' });
    expect(ctx.industry).toBeUndefined();
  });

  it('respects explicit browser + policy fields', () => {
    const ctx = new AgentContext({
      tenantId: 't',
      userId: 'u',
      workflowId: 'w',
      browserAutomationEnabled: true,
      connectedProviders: ['gmail', 'slack'],
      restrictedCategories: ['BROWSER' as import('@jak-swarm/shared').ToolCategory],
      approvalId: 'apr_123',
      industry: 'healthcare',
    });
    expect(ctx.browserAutomationEnabled).toBe(true);
    expect(ctx.connectedProviders).toEqual(['gmail', 'slack']);
    expect(ctx.restrictedCategories).toEqual(['BROWSER']);
    expect(ctx.approvalId).toBe('apr_123');
    expect(ctx.industry).toBe('healthcare');
  });

  // ── trace management ──

  it('starts with an empty trace list', () => {
    const ctx = new AgentContext({ tenantId: 't', userId: 'u', workflowId: 'w' });
    expect(ctx.getTraces()).toHaveLength(0);
  });

  it('addTrace appends a trace and getTraces returns all', () => {
    const ctx = new AgentContext({ tenantId: 't', userId: 'u', workflowId: 'w' });
    const t1 = makeTrace();
    const t2 = makeTrace({ agentRole: 'WORKER_EMAIL' });
    ctx.addTrace(t1);
    ctx.addTrace(t2);
    const traces = ctx.getTraces();
    expect(traces).toHaveLength(2);
    expect(traces[0]).toBe(t1);
    expect(traces[1]).toBe(t2);
  });

  it('getTraces returns a copy, not the internal array', () => {
    const ctx = new AgentContext({ tenantId: 't', userId: 'u', workflowId: 'w' });
    ctx.addTrace(makeTrace());
    const traces1 = ctx.getTraces();
    traces1.push(makeTrace());
    // Original should be unaffected
    expect(ctx.getTraces()).toHaveLength(1);
  });

  // ── clone ──

  it('clone preserves all fields when no overrides given', () => {
    const original = new AgentContext({
      traceId: 'trc_orig',
      runId: 'run_orig',
      tenantId: 'tnt_orig',
      userId: 'usr_orig',
      workflowId: 'wf_orig',
      industry: 'fintech',
      approvalId: 'apr_orig',
      connectedProviders: ['email'],
      browserAutomationEnabled: true,
    });

    const cloned = original.clone();
    expect(cloned.traceId).toBe(original.traceId);
    expect(cloned.runId).toBe(original.runId);
    expect(cloned.tenantId).toBe(original.tenantId);
    expect(cloned.userId).toBe(original.userId);
    expect(cloned.workflowId).toBe(original.workflowId);
    expect(cloned.industry).toBe(original.industry);
    expect(cloned.approvalId).toBe(original.approvalId);
    expect(cloned.connectedProviders).toEqual(original.connectedProviders);
    expect(cloned.browserAutomationEnabled).toBe(original.browserAutomationEnabled);
  });

  it('clone applies overrides correctly', () => {
    const original = new AgentContext({
      tenantId: 'tnt_a',
      userId: 'usr_a',
      workflowId: 'wf_a',
      browserAutomationEnabled: false,
    });

    const cloned = original.clone({ browserAutomationEnabled: true, approvalId: 'apr_new' });
    expect(cloned.tenantId).toBe('tnt_a');   // unchanged
    expect(cloned.browserAutomationEnabled).toBe(true);
    expect(cloned.approvalId).toBe('apr_new');
  });

  it('cloned context has an independent trace list', () => {
    const original = new AgentContext({ tenantId: 't', userId: 'u', workflowId: 'w' });
    original.addTrace(makeTrace());

    const cloned = original.clone();
    // Cloned starts with empty traces (clone does not carry over addTrace calls)
    expect(cloned.getTraces()).toHaveLength(0);

    cloned.addTrace(makeTrace({ agentRole: 'WORKER_EMAIL' }));
    // Original should still only have one
    expect(original.getTraces()).toHaveLength(1);
  });
});
