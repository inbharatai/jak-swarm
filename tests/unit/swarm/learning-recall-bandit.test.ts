/**
 * learning-recall-bandit.test.ts — Phase 3 recall + bandit selection unit proof.
 *
 * Closes the audit gap "recallLearnings / selectArm / metaOptimise are pure-core-
 * tested only; no live execution path calls them" by exercising the REAL functions
 * the live planner node calls after it produces a plan:
 *   - `recallLearnings` (learning-persist.ts) — the durable recall seam, against
 *     an in-memory Prisma stub returning PROMOTED + CANDIDATE rows.
 *   - `armsForTaskType` (learning-persist.ts) — builds bandit arms from recalled
 *     WORKFLOW learnings (successes=a, failures=b).
 *   - `applyBanditToPlan` (planner-node.ts) — the pure post-plan step that calls
 *     `selectArm` and overrides a task's agentRole + primary tool when autonomy
 *     allows + the pick is exploitation + the config differs.
 *
 * The full planner node also calls `PlannerAgent.execute` (an LLM call), so
 * driving the node end-to-end is env-blocked (no live provider here) — exactly
 * the boundary the live-learning integration test respects. Exercising the
 * real recall + bandit functions with a stub driver + a hand-constructed plan
 * is the honest unit proof of the wiring.
 */
import { describe, it, expect } from 'vitest';
import { AgentRole, HyperAgentMode, AutonomyLevel } from '@jak-swarm/shared';
import type { WorkflowPlan, WorkflowTask, ContingencyTable } from '@jak-swarm/shared';
import {
  recallLearnings,
  armsForTaskType,
  type LearningPersistPrismaClient,
  type RecalledLearning,
} from '../../../packages/swarm/src/hyperagent/learning-persist.js';
import { applyBanditToPlan } from '../../../packages/swarm/src/graph/nodes/planner-node.js';

// ─── In-memory Prisma stub (learningRecord only) ───────────────────────────

interface Row {
  tenantId: string;
  key: string;
  kind: string;
  source: string;
  status: string;
  value: { agentRole?: string; primaryTool?: string; taskType?: string; [k: string]: unknown };
  summary: string;
  tags: string[];
  failureClass: string | null;
  outcomeVerdict: string | null;
  taskVerdict: string | null;
  contingency: ContingencyTable;
  mutualInformation: number | null;
  confidence: number;
  createdAt: string;
  promotedAt: string | null;
  expiredAt: string | null;
}

function stubDb(rows: Row[]): LearningPersistPrismaClient {
  return {
    learningRecord: {
      async findMany(args: unknown) {
        const a = args as { where: { tenantId: string; key: { startsWith: string } | string } };
        return rows.filter((r) => {
          if (r.tenantId !== a.where.tenantId) return false;
          const wk = a.where.key;
          if (typeof wk === 'string') return r.key === wk;
          return r.key.startsWith(wk.startsWith);
        });
      },
      async create() { throw new Error('create not used in recall'); },
      async update() { throw new Error('update not used in recall'); },
    },
  };
}

function promotedRow(
  key: string,
  taskType: string,
  agentRole: string,
  primaryTool: string,
  contingency: ContingencyTable,
  mi: number,
): Row {
  return {
    tenantId: 'tenant-1',
    key,
    kind: 'WORKFLOW',
    source: 'OUTCOME',
    status: 'PROMOTED',
    value: { taskType, agentRole, primaryTool, preferredConfig: `${agentRole}/${primaryTool}` },
    summary: `Config '${agentRole}/${primaryTool}' for '${taskType}' passed.`,
    tags: [`task:${taskType}`, 'verified'],
    failureClass: null,
    outcomeVerdict: 'OUTCOME_SUCCESS',
    taskVerdict: 'TASK_PASSED',
    contingency,
    mutualInformation: mi,
    confidence: mi,
    createdAt: '2026-01-01T00:00:00.000Z',
    promotedAt: '2026-01-02T00:00:00.000Z',
    expiredAt: null,
  };
}

function task(id: string, agentRole: AgentRole, tool: string): WorkflowTask {
  return {
    id,
    name: `Task ${id}`,
    description: 'do it',
    agentRole,
    toolsRequired: [tool],
    riskLevel: 'LOW',
    requiresApproval: false,
    status: 'PENDING',
    dependsOn: [],
    retryable: true,
    maxRetries: 2,
  };
}

function plan(tasks: WorkflowTask[]): WorkflowPlan {
  return {
    id: 'plan-1',
    name: 'plan',
    goal: 'research',
    industry: 'TECHNOLOGY',
    tasks,
    createdAt: new Date('2026-01-01') as unknown as Date,
    updatedAt: new Date('2026-01-01') as unknown as Date,
  };
}

describe('Phase 3 — recallLearnings', () => {
  it('returns only PROMOTED rows for the given task types, sorted by MI desc', async () => {
    const db = stubDb([
      promotedRow('cfg:research:WORKER_RESEARCH:web_search', 'research', 'WORKER_RESEARCH', 'web_search', { a: 6, b: 0, c: 0, d: 6 }, 1.0),
      promotedRow('cfg:research:WORKER_RESEARCH:ddg', 'research', 'WORKER_RESEARCH', 'ddg', { a: 4, b: 2, c: 2, d: 4 }, 0.42),
      // CANDIDATE — must be filtered out (not yet earned governing behaviour).
      { ...promotedRow('cfg:research:WORKER_RESEARCH:serper', 'research', 'WORKER_RESEARCH', 'serper', { a: 1, b: 0, c: 0, d: 0 }, 0), status: 'CANDIDATE' },
      // Different task type — must NOT be returned for a research-only recall.
      promotedRow('cfg:email:WORKER_EMAIL:send_email', 'email', 'WORKER_EMAIL', 'send_email', { a: 6, b: 0, c: 0, d: 6 }, 1.0),
    ]);
    const recalled = await recallLearnings({ db, tenantId: 'tenant-1', taskTypes: ['research'] });
    expect(recalled.length).toBe(2);
    expect(recalled[0]!.key).toBe('cfg:research:WORKER_RESEARCH:web_search'); // MI 1.0 first
    expect(recalled[1]!.key).toBe('cfg:research:WORKER_RESEARCH:ddg'); // MI 0.42 second
    expect(recalled.every((r) => r.taskType === 'research')).toBe(true);
    // Config dimension extracted from the value JSON.
    expect(recalled[0]!.agentRole).toBe('WORKER_RESEARCH');
    expect(recalled[0]!.primaryTool).toBe('web_search');
  });

  it('returns an empty array when no PROMOTED rows exist for the task type', async () => {
    const db = stubDb([
      { ...promotedRow('cfg:research:WORKER_RESEARCH:serper', 'research', 'WORKER_RESEARCH', 'serper', { a: 1, b: 0, c: 0, d: 0 }, 0), status: 'CANDIDATE' },
    ]);
    const recalled = await recallLearnings({ db, tenantId: 'tenant-1', taskTypes: ['research'] });
    expect(recalled).toEqual([]);
  });

  it('is tenant-scoped — a different tenant sees no rows', async () => {
    const db = stubDb([promotedRow('cfg:research:WORKER_RESEARCH:web_search', 'research', 'WORKER_RESEARCH', 'web_search', { a: 6, b: 0, c: 0, d: 6 }, 1.0)]);
    const recalled = await recallLearnings({ db, tenantId: 'other-tenant', taskTypes: ['research'] });
    expect(recalled).toEqual([]);
  });
});

describe('Phase 3 — armsForTaskType', () => {
  it('builds one arm per PROMOTED WORKFLOW config with successes=a, failures=b', () => {
    const recalled: RecalledLearning[] = [
      { key: 'cfg:research:WORKER_RESEARCH:web_search', kind: 'WORKFLOW', taskType: 'research', agentRole: 'WORKER_RESEARCH', primaryTool: 'web_search', summary: '', confidence: 1, contingency: { a: 6, b: 0, c: 0, d: 6 }, mutualInformation: 1.0 },
      { key: 'cfg:research:WORKER_RESEARCH:ddg', kind: 'WORKFLOW', taskType: 'research', agentRole: 'WORKER_RESEARCH', primaryTool: 'ddg', summary: '', confidence: 0.42, contingency: { a: 4, b: 2, c: 2, d: 4 }, mutualInformation: 0.42 },
      // POLICY learning — NOT a config arm (repair preference, not a competing config).
      { key: 'cfg:research:TOOL_UNAVAILABLE:web_search:tool', kind: 'POLICY', taskType: 'research', summary: '', confidence: 0.5, contingency: { a: 0, b: 3, c: 3, d: 0 }, mutualInformation: 0.3 },
    ];
    const arms = armsForTaskType(recalled, 'research');
    expect(arms.length).toBe(2);
    expect(arms[0]!.id).toBe('cfg:research:WORKER_RESEARCH:web_search');
    expect(arms[0]!.successes).toBe(6);
    expect(arms[0]!.failures).toBe(0);
    expect(arms[0]!.configVersionId).toBe('WORKER_RESEARCH/web_search');
  });

  it('returns no arms for a task type with no WORKFLOW learnings', () => {
    const arms = armsForTaskType([], 'research');
    expect(arms).toEqual([]);
  });
});

describe('Phase 3 — applyBanditToPlan (recall → selectArm → override)', () => {
  it('applies the bandit-selected config when ASSISTED+ + exploitation + config differs', () => {
    // The plan asks for research with ddg (a weaker config). A PROMOTED web_search
    // arm has the higher empirical mean (6/6 vs 4/6). UCB1 exploitation picks it;
    // at ASSISTED the override applies → the task is rewritten to web_search.
    const p = plan([task('research_1', AgentRole.WORKER_RESEARCH, 'ddg')]);
    const recalled: RecalledLearning[] = [
      { key: 'cfg:research:WORKER_RESEARCH:web_search', kind: 'WORKFLOW', taskType: 'research', agentRole: 'WORKER_RESEARCH', primaryTool: 'web_search', summary: '', confidence: 1, contingency: { a: 6, b: 0, c: 0, d: 6 }, mutualInformation: 1.0 },
      { key: 'cfg:research:WORKER_RESEARCH:ddg', kind: 'WORKFLOW', taskType: 'research', agentRole: 'WORKER_RESEARCH', primaryTool: 'ddg', summary: '', confidence: 0.42, contingency: { a: 4, b: 2, c: 2, d: 4 }, mutualInformation: 0.42 },
    ];
    const { plan: revised, selections } = applyBanditToPlan(p, recalled, true);
    expect(revised.tasks[0]!.agentRole).toBe(AgentRole.WORKER_RESEARCH);
    expect(revised.tasks[0]!.toolsRequired[0]).toBe('web_search'); // overridden ddg→web_search
    expect(selections.length).toBe(1);
    expect(selections[0]!.applied).toBe(true);
    expect(selections[0]!.selectedConfig).toBe('WORKER_RESEARCH/web_search');
  });

  it('records the selection but does NOT override when autonomy blocks (OBSERVE)', () => {
    // Same recall as above, but applyAllowed=false (OBSERVE mode: observe+propose,
    // never mutate). The plan must stay ddg; the selection is still recorded for
    // cockpit visibility so an operator can see what the bandit would have picked.
    const p = plan([task('research_1', AgentRole.WORKER_RESEARCH, 'ddg')]);
    const recalled: RecalledLearning[] = [
      { key: 'cfg:research:WORKER_RESEARCH:web_search', kind: 'WORKFLOW', taskType: 'research', agentRole: 'WORKER_RESEARCH', primaryTool: 'web_search', summary: '', confidence: 1, contingency: { a: 6, b: 0, c: 0, d: 6 }, mutualInformation: 1.0 },
    ];
    const { plan: revised, selections } = applyBanditToPlan(p, recalled, false);
    expect(revised.tasks[0]!.toolsRequired[0]).toBe('ddg'); // unchanged
    expect(selections.length).toBe(1);
    expect(selections[0]!.applied).toBe(false);
    expect(selections[0]!.selectedConfig).toBe('WORKER_RESEARCH/web_search');
  });

  it('leaves the plan unchanged when the selected config equals the current config', () => {
    // Plan already asks for web_search (the PROMOTED config). The bandit picks
    // web_search; selectedConfig === currentConfig → no override, applied=false.
    const p = plan([task('research_1', AgentRole.WORKER_RESEARCH, 'web_search')]);
    const recalled: RecalledLearning[] = [
      { key: 'cfg:research:WORKER_RESEARCH:web_search', kind: 'WORKFLOW', taskType: 'research', agentRole: 'WORKER_RESEARCH', primaryTool: 'web_search', summary: '', confidence: 1, contingency: { a: 6, b: 0, c: 0, d: 6 }, mutualInformation: 1.0 },
    ];
    const { plan: revised, selections } = applyBanditToPlan(p, recalled, true);
    expect(revised.tasks[0]!.toolsRequired[0]).toBe('web_search');
    expect(selections[0]!.applied).toBe(false);
  });

  it('leaves the plan unchanged when no PROMOTED learnings exist for the task type', () => {
    const p = plan([task('research_1', AgentRole.WORKER_RESEARCH, 'ddg')]);
    const { plan: revised, selections } = applyBanditToPlan(p, [], true);
    expect(revised.tasks[0]!.toolsRequired[0]).toBe('ddg');
    expect(selections).toEqual([]);
  });

  it('does not crash on a corrupted config string (defensive validation)', () => {
    // A learning row whose value produced a configVersionId with no slash must
    // never crash the planner — the override is skipped, the plan stands.
    const p = plan([task('research_1', AgentRole.WORKER_RESEARCH, 'ddg')]);
    const recalled = [
      { key: 'cfg:research:BADCONFIG', kind: 'WORKFLOW', taskType: 'research', agentRole: undefined, primaryTool: undefined, summary: '', confidence: 1, contingency: { a: 6, b: 0, c: 0, d: 6 }, mutualInformation: 1.0 },
    ] as RecalledLearning[];
    const { plan: revised, selections } = applyBanditToPlan(p, recalled, true);
    // arm built (configVersionId undefined) → selectArm returns it; selectedConfig
    // undefined → applied=false (selectedConfig !== currentConfig is false because
    // undefined !== 'WORKER_RESEARCH/ddg' is true... but applied requires
    // selectedConfig !== undefined, so applied=false).
    expect(revised.tasks[0]!.toolsRequired[0]).toBe('ddg');
    expect(selections[0]!.applied).toBe(false);
  });
});

describe('Phase 3 — replanner reads state.relevantLearnings (regression)', () => {
  // The replanner used to hardcode relevantLearnings: []. Phase 3 changed it to
  // read state.relevantLearnings ?? []. We assert the SwarmState field exists +
  // defaults empty so the replanner's ?? [] fallback is exercised. The full
  // replanner node is driven by its own integration tests; here we pin the
  // contract the recall step produces for it.
  it('createInitialSwarmState defaults relevantLearnings to [] (replanner ?? [] fallback is safe)', async () => {
    const { createInitialSwarmState } = await import('../../../packages/swarm/src/state/swarm-state.js');
    const s = createInitialSwarmState({ goal: 'g', tenantId: 't', userId: 'u', workflowId: 'w' });
    expect(s.relevantLearnings).toEqual([]);
    expect(s.banditSelections).toEqual([]);
    // Default OFF — HyperAgent nodes unreachable.
    expect(s.hyperAgentEnabled).toBe(false);
  });

  it('createInitialSwarmState honours hyperAgentEnabled + mode + autonomy plumbing', async () => {
    const { createInitialSwarmState } = await import('../../../packages/swarm/src/state/swarm-state.js');
    const s = createInitialSwarmState({
      goal: 'g', tenantId: 't', userId: 'u', workflowId: 'w',
      hyperAgentEnabled: true,
      hyperAgentMode: HyperAgentMode.ASSISTED,
      autonomyLevel: AutonomyLevel.L2,
      maxHyperAgentIterations: 5,
    });
    expect(s.hyperAgentEnabled).toBe(true);
    expect(s.hyperAgentMode).toBe(HyperAgentMode.ASSISTED);
    expect(s.autonomyLevel).toBe(AutonomyLevel.L2);
    expect(s.maxHyperAgentIterations).toBe(5);
    // hyperAgentActive(state) is now true → diagnosis/replanner/learning/recall reachable.
    const { hyperAgentActive } = await import('../../../packages/swarm/src/graph/edges.js');
    expect(hyperAgentActive(s)).toBe(true);
  });
});