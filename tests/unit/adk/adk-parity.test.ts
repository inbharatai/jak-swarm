/**
 * adk-parity.test.ts — HyperAgent Phase 11 ADK parity pure cores.
 *
 * Pins the three parity fixes from the Phase 0 audit:
 *   - rolesFromPlan: ADK worker roles come from the Planner plan, not caller roleModes;
 *   - partitionRolesIntoWaves: dependency-ordered waves (Kahn topo-sort) so a
 *     depended-on role's wave runs before its dependents' wave;
 *   - shouldPauseForApproval + applyApprovalDecision: the approval pause/resume
 *     seam — high-risk tools pause for a gate decision; deny/approval_required ⇒
 *     the tool does NOT execute.
 *
 * Pure + deterministic; no live LLM / ADK Runner needed.
 */
import { describe, it, expect } from 'vitest';
import { AgentRole, RiskLevel, TaskStatus, ToolCategory, ToolRiskClass } from '../../../packages/shared/src/index.js';
import type { ToolMetadata, WorkflowPlan, WorkflowTask } from '../../../packages/shared/src/index.js';
import {
  rolesFromPlan,
  partitionRolesIntoWaves,
  shouldPauseForApproval,
  applyApprovalDecision,
} from '../../../packages/adk/src/orchestration/adk-parity.js';
import type { ApprovalDecision } from '../../../packages/adk/src/orchestration/adk-parity.js';
import { withApprovalGate, getApprovalGate } from '../../../packages/adk/src/bridge/jak-tool-bridge.js';

function task(over: Partial<WorkflowTask> & { id: string }): WorkflowTask {
  return {
    name: `task-${over.id}`,
    description: 'd',
    agentRole: AgentRole.WORKER_RESEARCH,
    toolsRequired: ['web_search'],
    riskLevel: RiskLevel.LOW,
    requiresApproval: false,
    status: TaskStatus.PENDING,
    dependsOn: [],
    retryable: true,
    maxRetries: 2,
    ...over,
  } as WorkflowTask;
}

function plan(tasks: WorkflowTask[]): WorkflowPlan {
  return {
    id: 'plan-1', name: 'p', goal: 'g', industry: 'general', tasks,
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function tool(name: string, over: Partial<ToolMetadata> = {}): ToolMetadata {
  return {
    name,
    description: 'd',
    category: ToolCategory.WEBHOOK,
    riskClass: ToolRiskClass.READ_ONLY,
    requiresApproval: false,
    inputSchema: {},
    outputSchema: {},
    version: '1',
    ...over,
  };
}

describe('rolesFromPlan — roles from the Planner plan (parity fix)', () => {
  it('extracts unique agentRoles in first-appearance order', () => {
    const p = plan([
      task({ id: 'a', agentRole: AgentRole.WORKER_RESEARCH }),
      task({ id: 'b', agentRole: AgentRole.WORKER_WRITER }),
      task({ id: 'c', agentRole: AgentRole.WORKER_RESEARCH }), // duplicate role
    ]);
    expect(rolesFromPlan(p)).toEqual([AgentRole.WORKER_RESEARCH, AgentRole.WORKER_WRITER]);
  });

  it('returns an empty array for an empty plan', () => {
    expect(rolesFromPlan(plan([]))).toEqual([]);
  });
});

describe('partitionRolesIntoWaves — dependency-ordered waves', () => {
  it('puts independent tasks in wave 0 and dependents in later waves', () => {
    const p = plan([
      task({ id: 'a', agentRole: AgentRole.WORKER_RESEARCH }),
      task({ id: 'b', agentRole: AgentRole.WORKER_RESEARCH, dependsOn: ['a'] }),
      task({ id: 'c', agentRole: AgentRole.WORKER_WRITER, dependsOn: ['b'] }),
    ]);
    const waves = partitionRolesIntoWaves(p);
    expect(waves).toEqual([[AgentRole.WORKER_RESEARCH], [AgentRole.WORKER_RESEARCH], [AgentRole.WORKER_WRITER]]);
  });

  it('parallel independent tasks share wave 0 (unique roles)', () => {
    const p = plan([
      task({ id: 'a', agentRole: AgentRole.WORKER_RESEARCH }),
      task({ id: 'b', agentRole: AgentRole.WORKER_WRITER }),
      task({ id: 'c', agentRole: AgentRole.WORKER_RESEARCH }), // same wave, dup role
    ]);
    const waves = partitionRolesIntoWaves(p);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toEqual([AgentRole.WORKER_RESEARCH, AgentRole.WORKER_WRITER]);
  });

  it('respects the longest dependency chain (diamond)', () => {
    // a → b → d ; a → c → d  ⇒ d is wave 2 (max depth).
    const p = plan([
      task({ id: 'a', agentRole: AgentRole.WORKER_RESEARCH }),
      task({ id: 'b', agentRole: AgentRole.WORKER_WRITER, dependsOn: ['a'] }),
      task({ id: 'c', agentRole: AgentRole.WORKER_WRITER, dependsOn: ['a'] }),
      task({ id: 'd', agentRole: AgentRole.VERIFIER, dependsOn: ['b', 'c'] }),
    ]);
    const waves = partitionRolesIntoWaves(p);
    expect(waves[0]).toEqual([AgentRole.WORKER_RESEARCH]);
    expect(waves[1]).toEqual([AgentRole.WORKER_WRITER]);
    expect(waves[2]).toEqual([AgentRole.VERIFIER]);
  });

  it('returns one empty wave for an empty plan', () => {
    expect(partitionRolesIntoWaves(plan([]))).toEqual([[]]);
  });

  it('is deterministic', () => {
    const p = plan([
      task({ id: 'a', agentRole: AgentRole.WORKER_RESEARCH }),
      task({ id: 'b', agentRole: AgentRole.WORKER_WRITER, dependsOn: ['a'] }),
    ]);
    expect(partitionRolesIntoWaves(p)).toEqual(partitionRolesIntoWaves(p));
  });
});

describe('shouldPauseForApproval', () => {
  it('pauses when requiresApproval is true', () => {
    expect(shouldPauseForApproval(tool('t', { requiresApproval: true }))).toBe(true);
  });

  it('pauses for EXTERNAL_SIDE_EFFECT + DESTRUCTIVE risk classes', () => {
    expect(shouldPauseForApproval(tool('t', { riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT }))).toBe(true);
    expect(shouldPauseForApproval(tool('t', { riskClass: ToolRiskClass.DESTRUCTIVE }))).toBe(true);
  });

  it('does NOT pause for READ_ONLY tools without requiresApproval', () => {
    expect(shouldPauseForApproval(tool('web_search', { riskClass: ToolRiskClass.READ_ONLY }))).toBe(false);
  });
});

describe('applyApprovalDecision — pause/resume resolution', () => {
  it('allow ⇒ may execute (approved)', () => {
    const d: ApprovalDecision = { verdict: 'allow', reason: 'ok' };
    expect(applyApprovalDecision(d)).toMatchObject({ mayExecute: true, outcome: 'approved' });
  });

  it('deny ⇒ may NOT execute (denied)', () => {
    const d: ApprovalDecision = { verdict: 'deny', reason: 'too risky' };
    expect(applyApprovalDecision(d)).toMatchObject({ mayExecute: false, outcome: 'denied' });
  });

  it('approval_required ⇒ may NOT execute (recorded for review)', () => {
    const d: ApprovalDecision = { verdict: 'approval_required' };
    expect(applyApprovalDecision(d)).toMatchObject({ mayExecute: false, outcome: 'approval_required' });
  });
});

describe('withApprovalGate (AsyncLocalStorage pause/resume seam)', () => {
  it('returns undefined outside any with-block', () => {
    expect(getApprovalGate()).toBeUndefined();
  });

  it('exposes the gate inside the with-block and clears it after', () => {
    const gate = async () => ({ verdict: 'allow' as const });
    withApprovalGate(gate, () => {
      expect(getApprovalGate()).toBe(gate);
    });
    expect(getApprovalGate()).toBeUndefined();
  });

  it('propagates the gate across awaits within the same async chain', async () => {
    const gate = async () => ({ verdict: 'deny' as const, reason: 'no' });
    const seen = await withApprovalGate(gate, async () => {
      const a = getApprovalGate();
      await Promise.resolve();
      const b = getApprovalGate();
      return [a, b];
    });
    expect(seen).toEqual([gate, gate]);
    expect(getApprovalGate()).toBeUndefined();
  });

  it('null gate ⇒ getApprovalGate returns null (pause seam disabled, legacy behavior)', () => {
    withApprovalGate(null, () => {
      expect(getApprovalGate()).toBeNull();
    });
    expect(getApprovalGate()).toBeUndefined();
  });

  it('two concurrent chains see their OWN gates without cross-contamination', async () => {
    const gA = async () => ({ verdict: 'allow' as const });
    const gB = async () => ({ verdict: 'deny' as const, reason: 'b' });
    const run = async (g: typeof gA, expectId: string) => {
      return withApprovalGate(g, async () => {
        await Promise.resolve();
        const got = getApprovalGate();
        return got === g ? expectId : 'mismatch';
      });
    };
    const [a, b] = await Promise.all([run(gA, 'A'), run(gB, 'B')]);
    expect(a).toBe('A');
    expect(b).toBe('B');
  });
});