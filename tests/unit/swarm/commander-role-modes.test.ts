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
});
