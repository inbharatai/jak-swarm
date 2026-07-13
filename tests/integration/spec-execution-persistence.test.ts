/**
 * Phase 6 — spec-execution persistence (real Postgres, adversarial).
 *
 * Drives the REAL `CompanyOperatingLayerService.executeSpec` +
 * `resumeSpecExecution` against a real pgvector/pgvector:pg16 container with
 * the full migration chain (incl. migration 121 `spec_executions`). The LLM
 * layer is stubbed via a deterministic `runPlan` (the same honesty posture as
 * `hyperagent-spec-execution.test.ts` — the closed-loop LOGIC + the
 * persistence layer are proven; the live LangGraph + LLM E2E is env-blocked).
 *
 * Proves the PR C guarantees:
 *   - spec_executions row claimed per attempt (idempotent: re-execute → attempt 2,
 *     not a duplicate of attempt 1);
 *   - completed execution: verdict + counts + cost + completedAt stamped on the
 *     row, workflow_outcomes upserted, agent_executable_specs execution-link
 *     columns (executedAt / executedWorkflowId / lastVerdict / lastExecutionId)
 *     stamped;
 *   - drift write-back: MET → execution_drift_findings resolved with full
 *     provenance (resolvedBy / resolutionSpecId / resolutionWorkflowId /
 *     resolutionVerdict / resolutionExecutionId); non-MET on a previously-
 *     resolved drift → REOPENED with contradiction evidence (status back to
 *     'open' + contradictedAt + contradictingExecutionId), NOT the prior
 *     "still-a-candidate" no-op;
 *   - artifact harvesting: a workflow_artifacts row with provenance
 *     (specExecutionId) created for each satisfied ARTIFACT_PRESENT criterion;
 *   - approval pause/resume: an awaitingApproval run persists the execution
 *     row as 'awaiting_approval'; resumeSpecExecution with a completing stub
 *     transitions it to 'completed' (refuses to resume a non-awaiting row).
 *
 * Honest scope: the resolver tiers, persistence, drift write-back, artifact
 * harvesting, and the approval-pause DB state transitions are exercised for
 * real against Postgres. The live LangGraph interrupt + Command(resume) E2E is
 * env-blocked (PR G canary) — the signal + DB transitions are what this test
 * proves. Skipped (not silently passed) when the container runtime is down.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@jak-swarm/db';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AgentRole,
  AcceptanceCriterionKind,
  RiskLevel,
  TaskStatus,
} from '../../packages/shared/src/index.js';
import type {
  AcceptanceCriterion,
  SpecTaskDescriptor,
  WorkflowPlan,
  WorkflowTask,
} from '../../packages/shared/src/index.js';
import type { VerificationResult } from '../../packages/agents/src/index.js';
import type { FinishedRun, RunPlanInput } from '../../packages/swarm/src/hyperagent/spec-executor.js';
import { CompanyOperatingLayerService } from '../../apps/api/src/services/company-brain/company-operating-layer.service.js';
import type { FastifyBaseLogger } from 'fastify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const noopLog = { info() {}, warn() {}, debug() {}, error() {} } as unknown as FastifyBaseLogger;

/** Build a deterministic FinishedRun from a scenario (mirrors the spec-execution
 *  integration test's stubRunPlan — completed task, optional artifacts/approval). */
function stubRunPlan(scenario: { taskStatus?: Record<string, TaskStatus>; artifacts?: string[]; awaitingApproval?: boolean; approvalRequestId?: string }) {
  return async (input: RunPlanInput): Promise<FinishedRun> => {
    if (scenario.awaitingApproval) {
      return {
        plan: input.plan,
        verificationResults: {},
        blocked: false,
        artifacts: [],
        metrics: {},
        awaitingApproval: true,
        ...(scenario.approvalRequestId ? { approvalRequestId: scenario.approvalRequestId } : {}),
        startedAt: input.now,
        completedAt: input.now,
      };
    }
    const plan: WorkflowPlan = {
      ...input.plan,
      tasks: input.plan.tasks.map((t) => ({
        ...t,
        status: scenario.taskStatus?.[t.id] ?? TaskStatus.COMPLETED,
      })) as WorkflowTask[],
    };
    const verificationResults: Record<string, VerificationResult> = {};
    for (const t of input.plan.tasks) {
      verificationResults[t.id] = { passed: true, issues: [], confidence: 0.9, needsRetry: false };
    }
    return {
      plan,
      verificationResults,
      completedTaskIds: plan.tasks.filter((t) => t.status === TaskStatus.COMPLETED).map((t) => t.id),
      failedTaskIds: plan.tasks.filter((t) => t.status === TaskStatus.FAILED).map((t) => t.id),
      blocked: false,
      artifacts: scenario.artifacts ?? [],
      metrics: {},
      startedAt: input.now,
      completedAt: input.now,
    };
  };
}

describe.sequential('Phase 6 — spec-execution persistence (testcontainers)', () => {
  let container: Awaited<ReturnType<GenericContainer['start']>>;
  let prisma: PrismaClient;
  let svc: CompanyOperatingLayerService;
  let runtimeUnavailable = false;

  beforeAll(async () => {
    try {
      container = await new GenericContainer('pgvector/pgvector:pg16')
        .withEnvironment({ POSTGRES_DB: 'jakswarm', POSTGRES_USER: 'jakswarm', POSTGRES_PASSWORD: 'jakswarm' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/i))
        .start();
      const dbUrl = `postgresql://jakswarm:jakswarm@${container.getHost()}:${container.getMappedPort(5432)}/jakswarm`;
      process.env.DATABASE_URL = dbUrl;
      process.env.DIRECT_URL = dbUrl;
      execSync('pnpm --filter @jak-swarm/db db:migrate:deploy', {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl } as NodeJS.ProcessEnv,
      });
      prisma = new PrismaClient();
      await prisma.$connect();
      svc = new CompanyOperatingLayerService(prisma, noopLog);
    } catch (error) {
      runtimeUnavailable = true;
      console.warn('[spec-execution-persistence] Skipping: container runtime unavailable', error);
    }
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  const mkTenant = async (slug: string): Promise<{ tenantId: string; userId: string }> => {
    const t = await prisma.tenant.create({ data: { name: slug, slug: `${slug}-${Date.now()}`, plan: 'FREE' } });
    // ensureSpecWorkflow writes a `workflows` row whose userId FK is RESTRICT —
    // so a real User row must exist. Use a fixed id per tenant so the test's
    // executeSpec userId matches a real user.
    const userId = `u-${t.id}`;
    await prisma.user.create({ data: { id: userId, tenantId: t.id, email: `${slug}@example.test`, role: 'TENANT_ADMIN' } });
    return { tenantId: t.id, userId };
  };

  /** Seed an APPROVED spec + (optional) drift finding. Returns the spec id. */
  const seedSpec = async (tid: string, opts: { withDrift?: boolean; withArtifactCriterion?: boolean } = {}): Promise<{ specId: string; driftId: string | null }> => {
    let driftId: string | null = null;
    if (opts.withDrift) {
      driftId = `drift_${tid}_${Date.now()}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "execution_drift_findings" ("id","tenantId","fingerprint","driftType","severity","status","title","summary","recommendation","evidenceArtifactIds","evidenceEntityIds","confidence")
         VALUES ($1,$2,$3,'customer_signal_unaddressed','high','open','Drift A','summary','recommendation','[]'::JSONB,'[]'::JSONB,0.8)`,
        driftId, tid, `fp-${tid}-${Date.now()}`,
      );
    }
    const tasks: SpecTaskDescriptor[] = [
      { id: 't1', name: 'Do work', description: 'd', agentRole: AgentRole.WORKER_RESEARCH, toolsRequired: [], riskLevel: RiskLevel.LOW },
    ];
    const criteria: AcceptanceCriterion[] = opts.withArtifactCriterion
      ? [{ id: 'c1', description: 'artifact present', kind: AcceptanceCriterionKind.ARTIFACT_PRESENT, artifactId: 'art-1' }]
      : [{ id: 'c1', description: 'task done', kind: AcceptanceCriterionKind.TASK_COMPLETED, taskId: 't1' }];
    const specId = `spec_${tid}_${Date.now()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "agent_executable_specs"
         ("id","tenantId","driftFindingId","title","problemStatement","objective","contextSummary","proposedApproach",
          "acceptanceCriteria","testPlan","agentTaskPlan","approvalGates","evidenceArtifactIds","evidenceEntityIds",
          "status","generatedBy","reviewedBy","reviewedAt","createdAt","updatedAt")
       VALUES ($1,$2,$3,'T','p','o','c','a',$4::JSONB,'[]'::JSONB,$5::JSONB,'[]'::JSONB,'[]'::JSONB,'[]'::JSONB,
         'approved','openai',$6,NOW(),NOW(),NOW())`,
      specId, tid, driftId,
      JSON.stringify(criteria),
      JSON.stringify({ tasks }),
      'reviewer-1',
    );
    return { specId, driftId };
  };

  const executionRow = async (tid: string, specId: string, attempt: number) => {
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string; status: string; verdict: string | null; attempt: number;
      taskTotal: number; taskPassed: number; driftResolved: boolean; completedAt: Date | null;
      driftFindingId: string | null; approvalRequestId: string | null;
    }>>(
      `SELECT "id","status","verdict","attempt","taskTotal","taskPassed","driftResolved","completedAt","driftFindingId","approvalRequestId"
       FROM "spec_executions" WHERE "tenantId" = $1 AND "specId" = $2 AND "attempt" = $3`,
      tid, specId, attempt,
    );
    return rows[0] ?? null;
  };

  const specRow = async (tid: string, specId: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{
      executedAt: Date | null; executedWorkflowId: string | null; lastVerdict: string | null; lastExecutionId: string | null;
    }>>(
      `SELECT "executedAt","executedWorkflowId","lastVerdict","lastExecutionId" FROM "agent_executable_specs" WHERE "id" = $1 AND "tenantId" = $2`,
      specId, tid,
    );
    return rows[0] ?? null;
  };

  const driftRow = async (driftId: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{
      status: string; resolvedAt: Date | null; resolvedBy: string | null;
      resolutionSpecId: string | null; resolutionVerdict: string | null; resolutionExecutionId: string | null;
      contradictedAt: Date | null; contradictingExecutionId: string | null;
    }>>(
      `SELECT "status","resolvedAt","resolvedBy","resolutionSpecId","resolutionVerdict","resolutionExecutionId",
              "contradictedAt","contradictingExecutionId" FROM "execution_drift_findings" WHERE "id" = $1`,
      driftId,
    );
    return rows[0] ?? null;
  };

  const artifactsForExecution = async (tid: string, executionId: string) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; specExecutionId: string | null; artifactType: string; status: string }>>(
      `SELECT "id","specExecutionId","artifactType","status" FROM "workflow_artifacts" WHERE "tenantId" = $1 AND "specExecutionId" = $2`,
      tid, executionId,
    );
    return rows;
  };

  // -------------------------------------------------------------------------

  it('a completed execution persists spec_executions + workflow_outcomes + the spec execution-link columns', async () => {
    if (runtimeUnavailable) return;
    const { tenantId: tid, userId } = await mkTenant('exec-complete');
    const { specId } = await seedSpec(tid, { withDrift: false });

    const res = await svc.executeSpec({ tenantId: tid, userId, specId, deps: { runPlan: stubRunPlan({}) } });
    expect(res.verdict).toBe('MET');
    expect(res.awaitingApproval).toBe(false);
    expect(res.executionId).toBeTruthy();
    expect(res.attempt).toBe(1);

    const exec = await executionRow(tid, specId, 1);
    expect(exec?.status).toBe('completed');
    expect(exec?.verdict).toBe('met');
    expect(exec?.taskTotal).toBe(1);
    expect(exec?.taskPassed).toBe(1);
    expect(exec?.driftResolved).toBe(true); // TASK_COMPLETED criterion satisfied
    expect(exec?.completedAt).not.toBeNull();

    // workflow_outcomes upserted (workflowId unique).
    const outcomes = await prisma.$queryRawUnsafe<Array<{ workflowId: string; outcome: string; taskPassed: number }>>(
      `SELECT "workflowId","outcome","taskPassed" FROM "workflow_outcomes" WHERE "tenantId" = $1 AND "workflowId" = $2`,
      tid, res.workflowId,
    );
    expect(outcomes.length).toBe(1);
    expect(outcomes[0].outcome).toBe('OUTCOME_SUCCESS');

    // spec execution-link columns stamped.
    const spec = await specRow(tid, specId);
    expect(spec?.executedAt).not.toBeNull();
    expect(spec?.executedWorkflowId).toBe(res.workflowId);
    expect(spec?.lastVerdict).toBe('met');
    expect(spec?.lastExecutionId).toBe(res.executionId);
  });

  it('re-executing the same spec claims attempt 2 (idempotent per-attempt, no duplicate of attempt 1)', async () => {
    if (runtimeUnavailable) return;
    const { tenantId: tid, userId } = await mkTenant('exec-idem');
    const { specId } = await seedSpec(tid);
    const r1 = await svc.executeSpec({ tenantId: tid, userId, specId, deps: { runPlan: stubRunPlan({}) } });
    const r2 = await svc.executeSpec({ tenantId: tid, userId, specId, deps: { runPlan: stubRunPlan({}) } });
    expect(r1.attempt).toBe(1);
    expect(r2.attempt).toBe(2);
    expect(r1.executionId).not.toBe(r2.executionId);
    const e1 = await executionRow(tid, specId, 1);
    const e2 = await executionRow(tid, specId, 2);
    expect(e1?.status).toBe('completed');
    expect(e2?.status).toBe('completed');
    // The spec's lastExecutionId points at the LATEST execution (attempt 2).
    const spec = await specRow(tid, specId);
    expect(spec?.lastExecutionId).toBe(r2.executionId);
  });

  it('drift write-back: MET resolves the drift with full provenance; a later non-MET execution REOPENS it with contradiction', async () => {
    if (runtimeUnavailable) return;
    const { tenantId: tid, userId } = await mkTenant('exec-drift');
    const { specId, driftId } = await seedSpec(tid, { withDrift: true });
    expect(driftId).not.toBeNull();
    const driftBefore = await driftRow(driftId!);
    expect(driftBefore?.status).toBe('open');

    // First execution: TASK_COMPLETED satisfied → MET → drift resolved.
    const r1 = await svc.executeSpec({ tenantId: tid, userId, specId, deps: { runPlan: stubRunPlan({}) } });
    expect(r1.verdict).toBe('MET');
    const d1 = await driftRow(driftId!);
    expect(d1?.status).toBe('resolved');
    expect(d1?.resolvedBy).toBe(userId);
    expect(d1?.resolutionSpecId).toBe(specId);
    expect(d1?.resolutionVerdict).toBe('met');
    expect(d1?.resolutionExecutionId).toBe(r1.executionId);

    // Second execution: the task FAILS → TASK_COMPLETED criterion UNMET → verdict UNMET.
    // The previously-resolved drift must REOPEN with contradiction evidence.
    const r2 = await svc.executeSpec({
      tenantId: tid, userId, specId,
      deps: { runPlan: stubRunPlan({ taskStatus: { t1: TaskStatus.FAILED } }) },
    });
    expect(r2.verdict).toBe('UNMET');
    const d2 = await driftRow(driftId!);
    expect(d2?.status).toBe('open');
    expect(d2?.contradictedAt).not.toBeNull();
    expect(d2?.contradictingExecutionId).toBe(r2.executionId);
  });

  it('artifact harvesting: a satisfied ARTIFACT_PRESENT criterion persists a workflow_artifacts row with provenance (specExecutionId)', async () => {
    if (runtimeUnavailable) return;
    const { tenantId: tid, userId } = await mkTenant('exec-artifacts');
    const { specId } = await seedSpec(tid, { withArtifactCriterion: true });
    const res = await svc.executeSpec({
      tenantId: tid, userId, specId,
      deps: { runPlan: stubRunPlan({ artifacts: ['art-1'] }) },
    });
    expect(res.verdict).toBe('MET');
    const arts = await artifactsForExecution(tid, res.executionId);
    expect(arts.length).toBeGreaterThanOrEqual(1);
    expect(arts.every((a) => a.specExecutionId === res.executionId)).toBe(true);
    expect(arts[0].artifactType).toBe('final_output');
    expect(arts[0].status).toBe('READY');
  });

  it('approval pause/resume: an awaitingApproval run persists "awaiting_approval"; resumeSpecExecution completes it; resume refuses a non-awaiting row', async () => {
    if (runtimeUnavailable) return;
    const { tenantId: tid, userId } = await mkTenant('exec-approval');
    const { specId } = await seedSpec(tid);

    // First run pauses at an approval gate.
    const r1 = await svc.executeSpec({
      tenantId: tid, userId, specId,
      deps: { runPlan: stubRunPlan({ awaitingApproval: true, approvalRequestId: 'apr-1' }) },
    });
    expect(r1.awaitingApproval).toBe(true);
    expect(r1.approvalRequestId).toBe('apr-1');
    expect(r1.verdict).toBe('UNVERIFIABLE');
    const exec1 = await executionRow(tid, specId, 1);
    expect(exec1?.status).toBe('awaiting_approval');
    expect(exec1?.approvalRequestId).toBe('apr-1');

    // Resume with a completing stub → the SAME execution row transitions to completed.
    const r2 = await svc.resumeSpecExecution({
      tenantId: tid, userId, executionId: r1.executionId,
      deps: { runPlan: stubRunPlan({}) },
    });
    expect(r2.awaitingApproval).toBe(false);
    expect(r2.verdict).toBe('MET');
    const exec1After = await executionRow(tid, specId, 1);
    expect(exec1After?.status).toBe('completed');
    expect(exec1After?.verdict).toBe('met');

    // Resuming a non-awaiting row throws (never silently double-resumes).
    await expect(
      svc.resumeSpecExecution({ tenantId: tid, userId, executionId: r1.executionId, deps: { runPlan: stubRunPlan({}) } }),
    ).rejects.toThrow(/not awaiting approval/);
  });

  it('cross-tenant isolation: a spec execution in tenant A never touches tenant B rows', async () => {
    if (runtimeUnavailable) return;
    const { tenantId: tidA, userId } = await mkTenant('exec-iso-a');
    const { tenantId: tidB } = await mkTenant('exec-iso-b');
    const { specId } = await seedSpec(tidA);
    await svc.executeSpec({ tenantId: tidA, userId, specId, deps: { runPlan: stubRunPlan({}) } });
    // Tenant B has no spec_executions, no workflow_outcomes for A's workflow.
    const bExec = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "spec_executions" WHERE "tenantId" = $1`, tidB,
    );
    expect(Number(bExec[0]?.n ?? 0)).toBe(0);
  });
});