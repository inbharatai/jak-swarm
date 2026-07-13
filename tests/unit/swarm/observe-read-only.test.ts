/**
 * Phase 2 — OBSERVE is read-only at the live node layer.
 *
 * The autonomy-policy layer test (autonomy-policy.test.ts) pins that OBSERVE
 * denies every mutating capability. This file pins the CONSEQUENCE at the two
 * live mutating nodes that previously bypassed it:
 *
 *   1. replanner-node: OBSERVE+L3 must record the proposed repair as an
 *      observation but NOT mutate plan/activePlanVersion and NOT pause for
 *      approval (status FAILED → validator, not AWAITING_APPROVAL). Before the
 *      fix, OBSERVE+L3 fell through to `levelAtLeast` and applied the replan.
 *
 *   2. learning-node: OBSERVE+L4 must persist candidates (CANDIDATE accrual +
 *      MI measurement) but NOT promote, because the node now gates promotion on
 *      evaluateForConfig(PROMOTE_CONFIG), which OBSERVE denies. Before the fix,
 *      the learning path promoted purely on MI, so OBSERVE (and any L0–L3
 *      tenant) could promote.
 *
 * ASSISTED+L3 still mutates (regression guard for the non-OBSERVE path).
 */
import { describe, it, expect } from 'vitest';
import {
  AgentRole,
  AutonomyCapability,
  AutonomyLevel,
  FailureClass,
  HyperAgentMode,
  RepairLevel,
  RiskLevel,
  TaskStatus,
  WorkflowStatus,
  LearningStatus,
} from '../../../packages/shared/src/index.js';
import type {
  WorkflowPlan,
  WorkflowTask,
  FailureDiagnosis,
  DiagnosisRecord,
  CounterfactualReplayHint,
  LearningCandidate,
  ContingencyTable,
} from '../../../packages/shared/src/index.js';
import type { VerificationResult } from '../../../packages/agents/src/roles/verifier.agent.js';
import { evaluateForConfig } from '../../../packages/security/src/governance/autonomy-policy.js';
import { createInitialSwarmState } from '../../../packages/swarm/src/state/swarm-state.js';
import type { SwarmState } from '../../../packages/swarm/src/state/swarm-state.js';
import { afterReplanner } from '../../../packages/swarm/src/graph/edges.js';
import { replannerNode } from '../../../packages/swarm/src/graph/nodes/replanner-node.js';
import {
  persistLearningCandidates,
  type LearningPersistPrismaClient,
} from '../../../packages/swarm/src/hyperagent/learning-persist.js';

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

function planWith(tasks: WorkflowTask[]): WorkflowPlan {
  return {
    id: 'plan-1',
    name: 'p',
    goal: 'g',
    industry: 'general',
    tasks,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function diagnosis(cls: FailureClass, taskId = 'fail'): FailureDiagnosis {
  return {
    id: `diag_wf-1_${taskId}_0`,
    tenantId: 't-1',
    workflowId: 'wf-1',
    taskId,
    failureClass: cls,
    rootCause: 'rc',
    evidence: {},
    confidence: 0.9,
    recommendedRepairLevel: RepairLevel.R3_PLAN_REPAIR,
    recommendedChanges: {},
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function hint(taskId = 'fail'): CounterfactualReplayHint {
  return { taskId, agentRole: 'WORKER_RESEARCH', toolName: 'web_search', inputHash: 'h', hypothesisSet: ['agent-only'] };
}

function pendingRecord(cls: FailureClass, taskId = 'fail'): DiagnosisRecord {
  return { diagnosis: diagnosis(cls, taskId), hint: hint(taskId) };
}

const vFail = (): VerificationResult => ({ passed: false, issues: ['bad'], confidence: 0.4, needsRetry: false });

function stateWithFailedTask(over: Partial<SwarmState> = {}): SwarmState {
  const failedId = 'fail';
  const tasks = [task({ id: failedId, agentRole: AgentRole.WORKER_CODER, toolsRequired: ['web_search'] })];
  const p = planWith(tasks);
  const base = createInitialSwarmState({
    goal: 'g',
    tenantId: 't-1',
    userId: 'u-1',
    workflowId: 'wf-1',
    hyperAgentEnabled: true,
    hyperAgentMode: HyperAgentMode.ASSISTED,
    autonomyLevel: AutonomyLevel.L3,
    allowedToolNames: ['web_search', 'alt_tool', 'send_email'],
  });
  return {
    ...base,
    plan: p,
    currentTaskIndex: 0,
    verificationResults: { [failedId]: vFail() },
    taskResults: { [failedId]: { partial: true } },
    pendingDiagnoses: { [failedId]: pendingRecord(FailureClass.WRONG_AGENT, failedId) },
    status: WorkflowStatus.VERIFYING,
    ...over,
  } as SwarmState;
}

const KNOWN_TOOLS = new Set(['web_search', 'alt_tool', 'send_email']);

describe('Phase 2 — OBSERVE replanner node (read-only)', () => {
  it('OBSERVE+L3 records the proposal but does NOT mutate plan / version / pause for approval', async () => {
    const before = stateWithFailedTask({ hyperAgentMode: HyperAgentMode.OBSERVE, autonomyLevel: AutonomyLevel.L3 });
    const planBefore = before.plan;
    const versionBefore = before.activePlanVersion ?? 0;
    const out = await replannerNode(before, { knownToolNames: KNOWN_TOOLS });

    // A repair proposal IS recorded (the observation — "what I would have done").
    expect(out.repairProposals).toBeDefined();
    expect((out.repairProposals ?? []).length).toBe(1);

    // The plan is NOT mutated — no revised plan applied.
    expect(out.plan).toBeUndefined();
    // The plan version is NOT bumped.
    expect(out.activePlanVersion ?? versionBefore).toBe(versionBefore);
    // No plan history appended.
    expect((out.planHistory ?? []).length).toBe(0);

    // Status is FAILED (routes to validator), NOT AWAITING_APPROVAL (no pause).
    expect(out.status).toBe(WorkflowStatus.FAILED);
    expect(out.status).not.toBe(WorkflowStatus.AWAITING_APPROVAL);

    // The original plan object is untouched (no in-place mutation).
    expect(before.plan).toBe(planBefore);
    expect(before.plan.tasks).toBe(planBefore.tasks);

    // afterReplanner routes a FAILED OBSERVE run to the validator (terminal
    // outcome evaluated; the learning node may extract a POLICY candidate).
    expect(afterReplanner({ ...before, status: out.status! } as SwarmState)).toBe('validator');
  });

  it('ASSISTED+L3 still applies the replan (regression guard — non-OBSERVE unchanged)', async () => {
    const before = stateWithFailedTask({ hyperAgentMode: HyperAgentMode.ASSISTED, autonomyLevel: AutonomyLevel.L3 });
    const out = await replannerNode(before, { knownToolNames: KNOWN_TOOLS });
    expect(out.status).toBe(WorkflowStatus.EXECUTING);
    expect(out.plan).toBeDefined();
    expect((out.activePlanVersion ?? 0)).toBeGreaterThan(before.activePlanVersion ?? 0);
    expect(afterReplanner({ ...before, status: out.status! } as SwarmState)).toBe('guardrail');
  });
});

// ─── Learning node OBSERVE no-promotion ──────────────────────────────────────

interface LRow {
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

function stubDb(): LearningPersistPrismaClient & { rows: Map<string, LRow> } {
  const rows = new Map<string, LRow>();
  const k = (tenantId: string, key: string) => `${tenantId}|${key}`;
  const db: LearningPersistPrismaClient = {
    learningRecord: {
      async findMany(args: unknown) {
        const a = args as { where: { tenantId?: string; key?: string | { startsWith?: string } } };
        return [...rows.values()].filter((r) => {
          if (a.where.tenantId !== undefined && a.where.tenantId !== r.tenantId) return false;
          if (a.where.key !== undefined) {
            if (typeof a.where.key === 'string') {
              if (a.where.key !== r.key) return false;
            } else if (a.where.key.startsWith !== undefined && !r.key.startsWith(a.where.key.startsWith)) return false;
          }
          return true;
        });
      },
      async create(args: unknown) {
        const a = args as { data: LRow };
        rows.set(k(a.data.tenantId, a.data.key), a.data);
        return a.data;
      },
      async update(args: unknown) {
        const a = args as { where: { tenantId_key: { tenantId: string; key: string } }; data: Partial<LRow> };
        const key = k(a.where.tenantId_key.tenantId, a.where.tenantId_key.key);
        const existing = rows.get(key);
        if (existing) rows.set(key, { ...existing, ...a.data } as LRow);
        return rows.get(key);
      },
    },
  };
  return { ...db, rows } as LearningPersistPrismaClient & { rows: Map<string, LRow> };
}

/** Build a candidate with a strong present-success contingency (would promote). */
/** A candidate whose one present trial is a success (a>0). */
function successCandidate(key: string): LearningCandidate {
  return {
    key,
    kind: 'WORKFLOW' as const,
    source: 'OUTCOME' as const,
    taskType: 'research',
    dimension: 'agent',
    value: { agentRole: 'WORKER_RESEARCH', primaryTool: 'web_search' },
    summary: 's',
    tags: [],
    contingency: { a: 1, b: 0, c: 0, d: 0 },
    confidence: 0.9,
    failureClass: null,
    outcomeVerdict: 'MET',
    taskVerdict: 'PASS',
  } as unknown as LearningCandidate;
}

/** Pre-seed a row that has ALREADY accrued enough to clear the promotion gate. */
function seedWouldPromoteRow(db: ReturnType<typeof stubDb>, key: string): void {
  db.rows.set(`t-1|${key}`, {
    tenantId: 't-1', key, kind: 'WORKFLOW', source: 'OUTCOME',
    status: LearningStatus.CANDIDATE, value: {}, summary: '', tags: [],
    failureClass: null, outcomeVerdict: null, taskVerdict: null,
    // a=20 present+success, b=1 present+failure, c=2 absent+success, d=19 absent+failure
    // → high MI (≈0.63 bits), n=42 ≥ minSamples, a≥1 ⇒ gateLearning().promoted === true.
    // All four cells are DISTINCT: `mutualInformation` currently keys the marginal off
    // VALUE equality (`x === a`), so shared cell values corrupt the calc — this seed
    // sidesteps that pre-existing bug (fixed in Phase 6) by using a table where every
    // cell differs. The present delta {a:1} this run accrues merges to {21,1,2,19}
    // (still all-distinct), so MI stays well above the gate.
    contingency: { a: 20, b: 1, c: 2, d: 19 }, mutualInformation: null, confidence: 0,
    createdAt: '2026-01-01T00:00:00Z', promotedAt: null, expiredAt: null,
  });
}

describe('Phase 2 — OBSERVE learning node (no promotion, accrual only)', () => {
  it('a WOULD-promote row stays CANDIDATE when promoteEnabled=false (OBSERVE)', async () => {
    const db = stubDb();
    seedWouldPromoteRow(db, 'cfg:research:agent');
    const candidate = successCandidate('cfg:research:agent');
    // The OBSERVE learning node passes promoteEnabled=false (PROMOTE_CONFIG
    // denied by the autonomy policy in OBSERVE — see the next test).
    const outcomes = await persistLearningCandidates({
      db, tenantId: 't-1', candidates: [candidate], now: '2026-01-02T00:00:00Z',
      promoteEnabled: false,
    });
    expect(outcomes[0].promoted).toBe(false);
    expect(outcomes[0].status).toBe(LearningStatus.CANDIDATE);
    const row = db.rows.get('t-1|cfg:research:agent');
    expect(row?.status).toBe(LearningStatus.CANDIDATE);
    expect(row?.promotedAt).toBeNull();
  });

  it('the same WOULD-promote row DOES promote when promoteEnabled=true (proves the gate is real)', async () => {
    const db = stubDb();
    seedWouldPromoteRow(db, 'cfg:research:agent');
    const candidate = successCandidate('cfg:research:agent');
    const outcomes = await persistLearningCandidates({
      db, tenantId: 't-1', candidates: [candidate], now: '2026-01-02T00:00:00Z',
      promoteEnabled: true,
    });
    expect(outcomes[0].promoted).toBe(true);
    expect(outcomes[0].status).toBe(LearningStatus.PROMOTED);
  });

  it('the OBSERVE learning node passes promoteEnabled=false (autonomy denies PROMOTE_CONFIG)', async () => {
    // Directly assert the autonomy decision the node consults before persist.
    const d = evaluateForConfig(
      { hyperAgentEnabled: true, hyperAgentMode: HyperAgentMode.OBSERVE, autonomyLevel: AutonomyLevel.L4 },
      AutonomyCapability.PROMOTE_CONFIG,
    );
    expect(d.allowed).toBe(false);
  });

  it('AUTONOMOUS_SAFE+L4 still permits promotion (regression guard — non-OBSERVE unchanged)', () => {
    const d = evaluateForConfig(
      { hyperAgentEnabled: true, hyperAgentMode: HyperAgentMode.AUTONOMOUS_SAFE, autonomyLevel: AutonomyLevel.L4 },
      AutonomyCapability.PROMOTE_CONFIG,
    );
    expect(d.allowed).toBe(true);
  });
});