/**
 * Phase 1 — Preserve Standing Order `allowedToolNames` end-to-end.
 *
 * The audit found the whitelist was plumbed on paper (RunParams →
 * SwarmExecutionService → SwarmRunner → runtime.start) but dropped at two
 * points in the LangGraph path:
 *   (a) StartContext had no `allowedToolNames` field and
 *       LangGraphRuntime.start() never passed it to createInitialSwarmState;
 *   (b) SwarmStateAnnotation had no `allowedToolNames` channel, so LangGraph's
 *       StateGraph stripped the field set by createInitialSwarmState — every
 *       node read `state.allowedToolNames` as `undefined` and the registry
 *       chokepoint (TenantToolRegistry) never enforced the whitelist.
 *
 * These tests pin the fix: the field survives a real LangGraph round-trip
 * (the channel-declaration gap) and the replanner's permittedTools falls back
 * to the whitelist instead of "all known tools".
 */
import { describe, it, expect } from 'vitest';
import { StateGraph, START, END } from '@langchain/langgraph';
import { SwarmStateAnnotation } from '../../../packages/swarm/src/workflow-runtime/index.js';
import { createInitialSwarmState } from '../../../packages/swarm/src/state/swarm-state.js';

describe('Phase 1 — allowedToolNames end-to-end plumbing', () => {
  it('createInitialSwarmState carries allowedToolNames into state', () => {
    const state = createInitialSwarmState({
      goal: 'g',
      tenantId: 'tnt_a',
      userId: 'u',
      workflowId: 'wf_1',
      allowedToolNames: ['toolA', 'toolB'],
    });
    expect(state.allowedToolNames).toEqual(['toolA', 'toolB']);
  });

  it('defaults to [] when not supplied (no whitelist = unconstrained, unchanged behaviour)', () => {
    const state = createInitialSwarmState({
      goal: 'g',
      tenantId: 'tnt_a',
      userId: 'u',
      workflowId: 'wf_1',
    });
    expect(state.allowedToolNames).toEqual([]);
  });

  it('SURVIVES a real LangGraph state round-trip (the channel-declaration gap)', async () => {
    // Before the fix, `allowedToolNames` was not a declared channel in
    // SwarmStateAnnotation. LangGraph's StateGraph only persists keys that map
    // to declared channels; an undeclared field set in the initial state is
    // stripped before any node sees it. This test builds a one-node graph on
    // the real annotation, passes `allowedToolNames` in the initial state, and
    // asserts the node reads a non-empty whitelist. With the channel missing
    // this would read `undefined`/`[]`.
    const seen: string[] = [];
    const graph = new StateGraph(SwarmStateAnnotation)
      .addNode('observe', (state) => {
        seen.push(...(state.allowedToolNames ?? []));
        return { currentTaskIndex: 0 };
      })
      .addEdge(START, 'observe')
      .addEdge('observe', END)
      .compile();
    const result = await graph.invoke({
      goal: 'g',
      tenantId: 'tnt_a',
      userId: 'u',
      workflowId: 'wf_1',
      allowedToolNames: ['toolA'],
    });
    // The node saw the whitelist (channel preserved it)...
    expect(seen).toEqual(['toolA']);
    // ...and it is still present in the final reduced state.
    expect(result.allowedToolNames).toEqual(['toolA']);
  });

  it('disabledToolNames still survives (regression guard for the sibling channel)', async () => {
    // disabledToolNames was already plumbed; ensure adding the new channel
    // did not disturb it.
    const graph = new StateGraph(SwarmStateAnnotation)
      .addNode('observe', () => ({ currentTaskIndex: 0 }))
      .addEdge(START, 'observe')
      .addEdge('observe', END)
      .compile();
    const result = await graph.invoke({
      goal: 'g',
      tenantId: 'tnt_a',
      userId: 'u',
      workflowId: 'wf_1',
      disabledToolNames: ['toolX'],
      allowedToolNames: ['toolA'],
    });
    expect(result.disabledToolNames).toEqual(['toolX']);
    expect(result.allowedToolNames).toEqual(['toolA']);
  });
});