/**
 * hyperagent-measured-learning-impact.test.ts — Phase 4 honesty-gate proof.
 *
 * Proves the self-learning loop is wired end-to-end at the live-graph integration
 * level: OBSERVE → PERSIST → PROMOTE (information-theoretic gate) → RECALL →
 * BANDIT-SELECT → APPLY. The "measured impact" is the config selection the
 * promoted learning drives: a run that recalls a PROMOTED config overrides the
 * plan to that config; an un-recalling control run does not. That is a real,
 * attributable, measured effect — not an LLM-guess.
 *
 * What is exercised against the REAL code (no stubs for these):
 *   - the real `learningNode` (the live graph node wired in Phase 2);
 *   - the real `persistLearningCandidates` + `gateLearning` + `mergeContingency`
 *     (the Phase 1 durable accrual + information-theoretic gate);
 *   - the real `recallLearnings` + `armsForTaskType` + `selectArm` (Phase 3);
 *   - the real `afterValidator` conditional edge (Phase 2) routing a terminal
 *     run to the learning node when HyperAgent is ON;
 *   - a real `StateGraph(SwarmStateAnnotation)` compiled + invoked.
 *
 * What is stubbed (and why that's honest):
 *   - The validator node is a stub that produces a terminal COMPLETED/FAILED
 *     state with a plan + verification, so the learning node has a real
 *     finished-run state to evaluate. The REAL validator's job is to compute
 *     that terminal state from worker output — it is not what this loop
 *     proves. (The full LLM-driven commander→planner→worker→verifier→validator
 *     chain that would turn a recalled learning into a measurably better
 *     *outcome* is env-blocked — no live provider here. That is the
 *     production-proven bar, NOT claimed.)
 *
 * Honest framing: integration-graph-proven, NOT production-proven.
 */
import { describe, it, expect } from 'vitest';
import { StateGraph, START, END } from '@langchain/langgraph';
import {
  AgentRole,
  AutonomyLevel,
  HyperAgentMode,
  RiskLevel,
  TaskStatus,
  WorkflowStatus,
} from '../../packages/shared/src/index.js';
import type { WorkflowPlan, WorkflowTask, ContingencyTable } from '../../packages/shared/src/index.js';
import type { VerificationResult } from '../../packages/agents/src/index.js';
import { SwarmStateAnnotation } from '../../packages/swarm/src/workflow-runtime/index.js';
import { afterValidator } from '../../packages/swarm/src/graph/edges.js';
import { learningNode } from '../../packages/swarm/src/graph/nodes/learning-node.js';
import { applyBanditToPlan } from '../../packages/swarm/src/graph/nodes/planner-node.js';
import {
  recallLearnings,
  type LearningPersistPrismaClient,
} from '../../packages/swarm/src/hyperagent/learning-persist.js';
import { composeConfigKey } from '../../packages/swarm/src/hyperagent/learning-extractor.js';

/**
 * Phase 7: the learning key is now a composite, order-invariant, dimensioned by
 * industry + risk level. Compute the expected key from the SAME dimensions the
 * outcome evaluator stamps (plan.industry='TECHNOLOGY', task.riskLevel=LOW) so
 * the assertions stay correct if the labelled-key format ever changes.
 */
function expectedKey(tool: string): string {
  return composeConfigKey({
    taskType: 'research',
    agentRole: AgentRole.WORKER_RESEARCH,
    toolSet: [tool],
    industry: 'TECHNOLOGY',
    riskLevel: 'LOW',
  });
}

// ─── In-memory Prisma stub (learningRecord, full upsert-by-key) ─────────────

interface Row {
  tenantId: string;
  key: string;
  kind: string;
  source: string;
  status: string;
  value: unknown;
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

function stubDb(): LearningPersistPrismaClient & { rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const k = (t: string, key: string) => `${t}|${key}`;
  const db = {
    rows,
    learningRecord: {
      async findMany(args: unknown) {
        const a = args as { where: { tenantId: string; key: { startsWith: string } | string } };
        return [...rows.values()].filter((r) => {
          if (r.tenantId !== a.where.tenantId) return false;
          const wk = a.where.key;
          if (typeof wk === 'string') return r.key === wk;
          return r.key.startsWith(wk.startsWith);
        });
      },
      async create(args: unknown) {
        const d = args as { data: Row };
        rows.set(k(d.data.tenantId, d.data.key), d.data);
        return d.data;
      },
      async update(args: unknown) {
        const a = args as { where: { tenantId_key: { tenantId: string; key: string } }; data: Partial<Row> };
        const key = k(a.where.tenantId_key.tenantId, a.where.tenantId_key.key);
        const cur = rows.get(key);
        if (!cur) throw new Error(`update missing ${key}`);
        rows.set(key, { ...cur, ...a.data });
        return rows.get(key);
      },
    },
  } as unknown as LearningPersistPrismaClient & { rows: Map<string, Row> };
  return db;
}

// ─── Terminal-run state builders ───────────────────────────────────────────

function task(id: string, agentRole: AgentRole, tool: string): WorkflowTask {
  return {
    id,
    name: `Task ${id}`,
    description: 'do the thing',
    agentRole,
    toolsRequired: [tool],
    riskLevel: RiskLevel.LOW,
    requiresApproval: false,
    status: TaskStatus.COMPLETED,
    dependsOn: [],
    retryable: true,
    maxRetries: 2,
  };
}

function plan(agentRole: AgentRole, tool: string): WorkflowPlan {
  return {
    id: 'plan-1',
    name: 'plan',
    goal: 'research',
    industry: 'TECHNOLOGY',
    tasks: [task('research_1', agentRole, tool)],
    createdAt: new Date('2026-01-01') as unknown as Date,
    updatedAt: new Date('2026-01-01') as unknown as Date,
  };
}

function passedVerification(): VerificationResult {
  return { passed: true, issues: [], confidence: 0.9, needsRetry: false };
}
function failedVerification(): VerificationResult {
  return { passed: false, issues: ['no results'], confidence: 0.2, needsRetry: false };
}

/**
 * A terminal COMPLETED run: task config (agentRole/tool) verified-passed.
 *
 * Defaults to AUTONOMOUS_SAFE @ L4 — a promoting config — so the accrual loop
 * can flip a row to PROMOTED. (Promotion is the L4 PROMOTE_CONFIG capability;
 * OBSERVE denies it — see the OBSERVE read-only test at the end of this file.)
 */
function completedState(
  agentRole: AgentRole,
  tool: string,
  mode: HyperAgentMode = HyperAgentMode.AUTONOMOUS_SAFE,
  level = AutonomyLevel.L4,
) {
  return {
    goal: 'research',
    tenantId: 'tenant-1',
    userId: 'user-1',
    workflowId: 'wf-1',
    roleModes: [],
    plan: plan(agentRole, tool),
    verificationResults: { research_1: passedVerification() },
    completedTaskIds: ['research_1'],
    failedTaskIds: [],
    taskRetryCount: {},
    accumulatedCostUsd: 0,
    traces: [],
    outputs: [],
    status: WorkflowStatus.COMPLETED,
    hyperAgentEnabled: true,
    hyperAgentMode: mode,
    autonomyLevel: level,
  };
}

/** A terminal FAILED run: task config (agentRole/tool) verified-failed. */
function failedState(
  agentRole: AgentRole,
  tool: string,
  mode: HyperAgentMode = HyperAgentMode.AUTONOMOUS_SAFE,
  level = AutonomyLevel.L4,
) {
  const t = task('research_1', agentRole, tool);
  t.status = TaskStatus.FAILED;
  t.error = `${tool} returned nothing`;
  return {
    goal: 'research',
    tenantId: 'tenant-1',
    userId: 'user-1',
    workflowId: 'wf-1',
    roleModes: [],
    plan: { ...plan(agentRole, tool), tasks: [t] },
    verificationResults: { research_1: failedVerification() },
    completedTaskIds: [],
    failedTaskIds: ['research_1'],
    taskRetryCount: {},
    accumulatedCostUsd: 0,
    traces: [],
    outputs: [],
    status: WorkflowStatus.FAILED,
    hyperAgentEnabled: true,
    hyperAgentMode: mode,
    autonomyLevel: level,
  };
}

// ─── Test graph: validator stub → real afterValidator → real learningNode ──

function buildGraph(db: LearningPersistPrismaClient, terminalState: ReturnType<typeof completedState>) {
  return new StateGraph(SwarmStateAnnotation)
    .addNode('validator', () => terminalState)
    .addNode('learning', (state: typeof SwarmStateAnnotation.State) =>
      learningNode(state as unknown as Parameters<typeof learningNode>[0], { db }),
    )
    .addEdge(START, 'validator')
    .addConditionalEdges(
      'validator',
      (state: typeof SwarmStateAnnotation.State) => {
        const next = afterValidator(state as unknown as Parameters<typeof afterValidator>[0]);
        return next === 'learning' ? 'learning' : 'end';
      },
      { learning: 'learning', end: END },
    )
    .addEdge('learning', END)
    .compile();
}

const row = (db: ReturnType<typeof stubDb>, key: string): Row | undefined =>
  db.rows.get(`tenant-1|${key}`);

describe('Phase 4 — measured learning impact at the live-graph integration level', () => {
  it('OBSERVE → PERSIST → PROMOTE: 3 web_search successes + 3 ddg failures promote web_search (MI ≥ 0.05) via the REAL gate', async () => {
    const db = stubDb();

    // Interleave 3 COMPLETED web_search runs + 3 FAILED ddg runs through the
    // REAL learning node. Each run accrues present cells for its config and
    // absent cells for the sibling config (the contrast MI needs).
    for (let i = 0; i < 3; i++) {
      const g1 = buildGraph(db, completedState(AgentRole.WORKER_RESEARCH, 'web_search') as ReturnType<typeof completedState>);
      await g1.invoke(completedState(AgentRole.WORKER_RESEARCH, 'web_search'));
      const g2 = buildGraph(db, failedState(AgentRole.WORKER_RESEARCH, 'ddg') as ReturnType<typeof completedState>);
      await g2.invoke(failedState(AgentRole.WORKER_RESEARCH, 'ddg'));
    }

    const webSearch = row(db, expectedKey('web_search'));
    const ddg = row(db, expectedKey('ddg'));
    expect(webSearch).toBeDefined();
    expect(ddg).toBeDefined();

    // The REAL gate promoted web_search (success-correlated) — not asserted by
    // hand; the persist service ran gateLearning over the accrued contingency.
    expect(webSearch!.status).toBe('PROMOTED');
    expect(webSearch!.mutualInformation).toBeGreaterThanOrEqual(0.05);
    // web_search: present+success a=3, absent+failure d=3 → perfect correlation.
    expect(webSearch!.contingency).toEqual({ a: 3, b: 0, c: 0, d: 3 });

    // ddg is failure-correlated (b=3, c=3) — NOT promoted (no present-success).
    expect(ddg!.status).not.toBe('PROMOTED');
  });

  it('RECALL → BANDIT-SELECT → APPLY: a subsequent run recalls the PROMOTED web_search and overrides a ddg plan; the un-recalling control does not', async () => {
    const db = stubDb();
    // Seed the promoted state by running the accrual loop (reuse the prior scenario).
    for (let i = 0; i < 3; i++) {
      const g1 = buildGraph(db, completedState(AgentRole.WORKER_RESEARCH, 'web_search') as ReturnType<typeof completedState>);
      await g1.invoke(completedState(AgentRole.WORKER_RESEARCH, 'web_search'));
      const g2 = buildGraph(db, failedState(AgentRole.WORKER_RESEARCH, 'ddg') as ReturnType<typeof completedState>);
      await g2.invoke(failedState(AgentRole.WORKER_RESEARCH, 'ddg'));
    }
    expect(row(db, expectedKey('web_search'))!.status).toBe('PROMOTED');

    // A subsequent run's planner recalls PROMOTED learnings for the plan's task
    // type + runs bandit selection. The plan asks for ddg; the bandit picks the
    // promoted web_search and (ASSISTED+) applies the override.
    const recalled = await recallLearnings({ db, tenantId: 'tenant-1', taskTypes: ['research'] });
    expect(recalled.length).toBe(1);
    expect(recalled[0]!.key).toBe(expectedKey('web_search'));

    const ddgPlan = plan(AgentRole.WORKER_RESEARCH, 'ddg');
    const { plan: recalledPlan, selections } = applyBanditToPlan(ddgPlan, recalled, true);
    // MEASURED IMPACT: the recalled PROMOTED learning drove a config override.
    expect(recalledPlan.tasks[0]!.toolsRequired[0]).toBe('web_search'); // ddg → web_search
    expect(selections[0]!.applied).toBe(true);

    // CONTROL: with no recalled learnings (empty recall — e.g. a fresh tenant or
    // HyperAgent OFF), the SAME plan is unchanged. This is the measured,
    // attributable difference the promoted learning makes.
    const { plan: controlPlan, selections: controlSelections } = applyBanditToPlan(ddgPlan, [], true);
    expect(controlPlan.tasks[0]!.toolsRequired[0]).toBe('ddg'); // unchanged
    expect(controlSelections).toEqual([]);
  });

  it('QUARANTINE counter-case: a config that only ever fails never promotes (MI stays 0, no success contrast)', async () => {
    const db = stubDb();
    // 6 FAILED runs of serper — no successes anywhere, so the contingency has
    // no present-success cell and MI cannot be nonzero. The gate must NOT
    // promote a failure-only config.
    for (let i = 0; i < 6; i++) {
      const g = buildGraph(db, failedState(AgentRole.WORKER_RESEARCH, 'serper') as ReturnType<typeof completedState>);
      await g.invoke(failedState(AgentRole.WORKER_RESEARCH, 'serper'));
    }
    const serper = row(db, expectedKey('serper'));
    expect(serper).toBeDefined();
    expect(serper!.status).not.toBe('PROMOTED');
    // No sibling config was ever run, so serper has only present-failure (b=6)
    // and no absent-success (c=0) — MI is 0. The gate honestly refuses to govern
    // behaviour on a config it has only ever seen fail with no contrast.
    expect(serper!.contingency.b).toBe(6);
    expect(serper!.mutualInformation ?? 0).toBeLessThan(0.05);
  });

  it('OBSERVE is read-only: the same 3+3 accrual that promotes under AUTONOMOUS_SAFE accrues a clearing contingency but stays CANDIDATE under OBSERVE', async () => {
    // Promotion is the L4 PROMOTE_CONFIG capability, and OBSERVE is read-only at
    // the autonomy-policy layer (Phase 2). The learning node consults
    // evaluateForConfig(..., PROMOTE_CONFIG) before persist; OBSERVE denies it,
    // so promoteEnabled=false. Candidates still accrue + MI is still measured,
    // but no row flips to PROMOTED — even when the contingency would clear the
    // gate. This is the integration-level proof of the same contract pinned in
    // unit/swarm/observe-read-only.test.ts.
    const db = stubDb();
    const observe = (ar: AgentRole, tool: string) => ({
      completed: completedState(ar, tool, HyperAgentMode.OBSERVE, AutonomyLevel.L4),
      failed: failedState(ar, tool, HyperAgentMode.OBSERVE, AutonomyLevel.L4),
    });
    for (let i = 0; i < 3; i++) {
      const ws = observe(AgentRole.WORKER_RESEARCH, 'web_search');
      const g1 = buildGraph(db, ws.completed as ReturnType<typeof completedState>);
      await g1.invoke(ws.completed);
      const ddg = observe(AgentRole.WORKER_RESEARCH, 'ddg');
      const g2 = buildGraph(db, ddg.failed as ReturnType<typeof completedState>);
      await g2.invoke(ddg.failed);
    }
    const webSearch = row(db, expectedKey('web_search'));
    expect(webSearch).toBeDefined();
    // The contingency is the SAME clearing table that promoted web_search under
    // AUTONOMOUS_SAFE above (present+success a=3, absent+failure d=3) — MI is
    // well above the gate — yet the row stays CANDIDATE because OBSERVE denied
    // promotion. Read-only means read-only, including the learning DB.
    expect(webSearch!.contingency).toEqual({ a: 3, b: 0, c: 0, d: 3 });
    expect(webSearch!.mutualInformation).toBeGreaterThanOrEqual(0.05);
    expect(webSearch!.status).toBe('CANDIDATE');
    expect(webSearch!.promotedAt).toBeNull();
  });
});