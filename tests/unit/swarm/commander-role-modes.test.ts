import { describe, expect, it } from 'vitest';
import { buildCommanderInput } from '../../../packages/swarm/src/graph/nodes/commander-node.js';

describe('buildCommanderInput', () => {
  it('returns original goal when no role modes are provided', () => {
    const goal = 'Draft a launch plan for next quarter';
    expect(buildCommanderInput(goal, [])).toBe(goal);
  });

  it('appends normalized role modes to commander input', () => {
    const goal = 'Plan product roadmap and GTM timeline';
    const input = buildCommanderInput(goal, ['cto', 'cmo', 'automation']);

    expect(input).toContain(goal);
    expect(input).toContain('Role focus modes selected by user: CTO, CMO, Auto.');
  });

  it('deduplicates role modes and handles aliases', () => {
    const goal = 'Review system architecture and implementation details';
    const input = buildCommanderInput(goal, ['code', 'coding', 'Code', 'research']);

    expect(input).toContain('Role focus modes selected by user: Code, Research.');
  });

  // ─── Canonical agent-role mapping (new in Sprint 3) ─────────────────────
  // The dashboard role picker used to be purely cosmetic — labels appended
  // to the goal string. Sprint 3 introduces an explicit mapping from UX
  // role IDs to AgentRole enum values and tells the Commander to bias
  // task assignment toward those workers. These tests pin the mapping.

  it('emits the canonical AgentRole preference block for known UX roles', () => {
    const goal = 'Review the NDA I uploaded';
    const input = buildCommanderInput(goal, ['cto', 'cmo', 'ceo']);

    expect(input).toContain('PREFER these worker agents');
    expect(input).toContain('WORKER_TECHNICAL');
    expect(input).toContain('WORKER_MARKETING');
    expect(input).toContain('WORKER_STRATEGIST');
  });

  it('maps every documented UX role to its canonical AgentRole', () => {
    const cases: Array<[string, string]> = [
      ['cto', 'WORKER_TECHNICAL'],
      ['cmo', 'WORKER_MARKETING'],
      ['ceo', 'WORKER_STRATEGIST'],
      ['coding', 'WORKER_CODER'],
      ['research', 'WORKER_RESEARCH'],
      ['design', 'WORKER_DESIGNER'],
      ['automation', 'WORKER_OPS'],
    ];
    for (const [uxRole, agentRole] of cases) {
      const out = buildCommanderInput('do the thing', [uxRole]);
      expect(out).toContain(agentRole);
    }
  });

  it('drops unknown UX roles from the preference block', () => {
    const input = buildCommanderInput('goal', ['not-a-real-role', 'cto']);
    // Known role still resolves.
    expect(input).toContain('WORKER_TECHNICAL');
    // Unknown role is NOT in the preference block (the AgentRole mapping
    // silently drops it rather than routing incorrectly).
    expect(input).not.toContain('NOT-A-REAL-ROLE');
  });

  it('deduplicates canonical roles when aliases map to the same worker', () => {
    const input = buildCommanderInput('goal', ['coding', 'code']);
    // Both aliases -> WORKER_CODER; should appear exactly once in the list.
    const matches = input.match(/WORKER_CODER/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('does not emit the preference block when roleModes is empty', () => {
    const input = buildCommanderInput('goal', []);
    expect(input).not.toContain('PREFER these worker agents');
    expect(input).not.toContain('WORKER_');
  });
});
