import { describe, it, expect } from 'vitest';
import { mapAdkEventToActivities } from '../../../packages/adk/src/orchestration/adk-runner.js';
import { AgentRole } from '@jak-swarm/shared';

/**
 * Locks the ADK-event → JAK-activity mapping that powers Phase 3 cockpit
 * parity. `mapAdkEventToActivities` is a pure function (no I/O) so it can
 * be unit-tested directly without a live LLM or ADK Runner — the only
 * honest way to cover the cockpit-parity translation, since a full ADK run
 * requires a real Gemini/OpenAI key.
 *
 * The mapping is FAITHFUL — ADK's event model is coarser than JAK's
 * LangGraph nodes, so we do NOT fabricate plan_created / verification /
 * context_summarized events. We emit worker_started + worker_completed for
 * each non-user content chunk, and worker_completed(success=false) on
 * error. The swarm-execution onAgentActivity translator then routes
 * worker_started → step_started and worker_completed → step_completed /
 * step_failed.
 */

const WF = 'wf-map';

describe('mapAdkEventToActivities', () => {
  it('returns nothing for a user-authored chunk', () => {
    const out = mapAdkEventToActivities({
      author: 'user',
      content: { parts: [{ text: 'what is the weather?' }] },
    }, WF);
    expect(out).toEqual([]);
  });

  it('returns nothing for an agent chunk with empty content', () => {
    const out = mapAdkEventToActivities({
      author: 'Commander',
      content: { parts: [{ text: '   ' }] },
    }, WF);
    expect(out).toEqual([]);
  });

  it('returns nothing when content is absent', () => {
    expect(mapAdkEventToActivities({ author: 'Commander' }, WF)).toEqual([]);
  });

  it('emits worker_started + worker_completed for a non-user content chunk', () => {
    const out = mapAdkEventToActivities({
      author: 'Commander',
      content: { parts: [{ text: 'Here is a substantive answer for you.' }] },
    }, WF);
    expect(out).toHaveLength(2);
    expect(out[0]?.['type']).toBe('worker_started');
    expect(out[0]?.['agentRole']).toBe(AgentRole.COMMANDER);
    expect(out[0]?.['taskName']).toBe('Commander');
    expect(out[1]?.['type']).toBe('worker_completed');
    expect(out[1]?.['success']).toBe(true);
    expect(out[1]?.['agentRole']).toBe(AgentRole.COMMANDER);
    expect(typeof out[1]?.['contentPreview']).toBe('string');
    expect((out[1]?.['contentPreview'] as string).length).toBeLessThanOrEqual(200);
  });

  it('maps a known agent-role name to the matching AgentRole enum value', () => {
    const out = mapAdkEventToActivities({
      author: 'planner',
      content: { parts: [{ text: 'A substantive plan chunk that is long enough.' }] },
    }, WF);
    expect(out[0]?.['agentRole']).toBe(AgentRole.PLANNER);
  });

  it('falls back to COMMANDER for an unknown agent name', () => {
    const out = mapAdkEventToActivities({
      author: 'Some_Weird_Agent',
      content: { parts: [{ text: 'A substantive chunk that is long enough to count.' }] },
    }, WF);
    expect(out[0]?.['agentRole']).toBe(AgentRole.COMMANDER);
  });

  it('emits a single failure activity (worker_completed success=false) on an error event', () => {
    const out = mapAdkEventToActivities({
      author: 'Commander',
      errorCode: 'INTERNAL',
      errorMessage: 'model call failed',
    }, WF);
    expect(out).toHaveLength(1);
    expect(out[0]?.['type']).toBe('worker_completed');
    expect(out[0]?.['success']).toBe(false);
    expect(out[0]?.['error']).toBe('model call failed');
    expect(out[0]?.['agentRole']).toBe(AgentRole.COMMANDER);
  });

  it('falls back to errorCode when errorMessage is absent', () => {
    const out = mapAdkEventToActivities({
      author: 'Commander',
      errorCode: 'TIMEOUT',
    }, WF);
    expect(out[0]?.['error']).toBe('TIMEOUT');
  });

  it('uses "unknown" as the author fallback', () => {
    const out = mapAdkEventToActivities({
      content: { parts: [{ text: 'A substantive chunk that is long enough to count here.' }] },
    }, WF);
    expect(out[0]?.['taskName']).toBe('unknown');
    expect(out[0]?.['agentRole']).toBe(AgentRole.COMMANDER);
  });

  it('concatenates multiple parts into the content preview', () => {
    const out = mapAdkEventToActivities({
      author: 'Commander',
      content: { parts: [{ text: 'Hello ' }, { text: 'there, this is a substantive chunk.' }] },
    }, WF);
    expect((out[1]?.['contentPreview'] as string)).toContain('Hello there');
  });
});