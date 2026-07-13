/**
 * adk-langgraph-governance.test.ts — HyperAgent Phase 5 (P0 architectural).
 *
 * Pins that ADK execution is unified UNDER LangGraph governance: the pure
 * orchestration router (`chooseOrchestrationPath`) decides which engine runs
 * and whether ADK (when it runs) is GOVERNED, and the governed-ADK param
 * builders (`buildGovernedAdkParams` / `buildAdkApprovalGate`) thread the
 * approval gate (and a Planner plan, when supplied) into `runWithAdk` so there
 * is no ungoverned execution route.
 *
 * The three cases the plan specifies, exercised against the pure decision core
 * the swarm-execution service consults:
 *
 *   1. HyperAgent ON, no ADK opt-in → LangGraph runs (primary='langgraph'):
 *      the service's `primary === 'adk'` branch is skipped, so ADK is NOT
 *      invoked and no governed params are built. This is the governed default.
 *   2. ADK opt-in + HyperAgent ON → ADK runs GOVERNED: `buildGovernedAdkParams`
 *      threads BOTH the Planner plan AND the approval gate (assert the stubs
 *      are received). The approval gate pauses high-risk tools for approval.
 *   3. ADK opt-in + HyperAgent OFF → today's legacy ADK path unchanged: no
 *      governed params threaded (`{}`), so `runWithAdk` derives roles from
 *      `workerRoles`/roleModes with no gate — byte-for-byte the prior behavior.
 *
 * Honest scope: this file tests the governance DECISION + param-threading
 * contract (the closeable-in-code core, pure). The full service E2E with real
 * ADK + Prisma stays integration/env-blocked (real @google/adk run needs
 * JAK_ADK_MODE=1 + provider keys; not faked here).
 */
import { describe, it, expect } from 'vitest';
import {
  ToolRiskClass,
  AgentRole,
  RiskLevel,
  TaskStatus,
} from '../../packages/shared/src/index.js';
import type { ToolMetadata, WorkflowPlan, WorkflowTask } from '../../packages/shared/src/index.js';
import {
  chooseOrchestrationPath,
  buildGovernedAdkParams,
  buildAdkApprovalGate,
} from '../../packages/adk/src/orchestration/orchestration-router.js';
import type { ApprovalGate } from '../../packages/adk/src/orchestration/adk-parity.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

function toolMetadata(over: Partial<ToolMetadata> = {}): ToolMetadata {
  return {
    name: 'some_tool',
    description: 'a tool',
    category: 'READ_ONLY' as never,
    riskClass: ToolRiskClass.READ_ONLY,
    requiresApproval: false,
    inputSchema: {},
    outputSchema: {},
    version: '1.0.0',
    ...over,
  } as ToolMetadata;
}

// ─── The orchestration decision matrix ────────────────────────────────────────

describe('Phase 5 chooseOrchestrationPath — LangGraph is the governed primary when HyperAgent is ON', () => {
  it('HyperAgent ON + no ADK opt-in → LangGraph primary (ADK not invoked; governed default)', () => {
    const d = chooseOrchestrationPath({ hyperAgentEnabled: true, adkRequested: false });
    expect(d.primary).toBe('langgraph');
    // The service only runs ADK inside `if (primary === 'adk')` — so ADK is
    // NOT invoked and no governed params are built for this cell.
    expect(d.adkGoverned).toBe(true);
  });

  it('HyperAgent ON + ADK opt-in → ADK primary GOVERNED (plan+gate threaded)', () => {
    const d = chooseOrchestrationPath({ hyperAgentEnabled: true, adkRequested: true });
    expect(d.primary).toBe('adk');
    expect(d.adkGoverned).toBe(true);
  });

  it('HyperAgent OFF + ADK opt-in → ADK primary LEGACY (unchanged — no governance threaded)', () => {
    const d = chooseOrchestrationPath({ hyperAgentEnabled: false, adkRequested: true });
    expect(d.primary).toBe('adk');
    expect(d.adkGoverned).toBe(false);
  });

  it('HyperAgent OFF + no ADK opt-in → LangGraph primary (unchanged)', () => {
    const d = chooseOrchestrationPath({ hyperAgentEnabled: false, adkRequested: false });
    expect(d.primary).toBe('langgraph');
    expect(d.adkGoverned).toBe(false);
  });

  it('the ONLY cell that changes vs the prior ADK-first code is ON+opt-in: ungoverned → governed', () => {
    // Prior code: `if (JAK_ADK_MODE==='1') run ADK (ungoverned)` regardless of
    // HyperAgent. Now: when HyperAgent is ON and ADK is opted in, adkGoverned
    // is true (governance threaded). When HyperAgent is OFF, adkGoverned is
    // false (byte-for-byte legacy). Pin both sides of that boundary.
    expect(chooseOrchestrationPath({ hyperAgentEnabled: true, adkRequested: true }).adkGoverned).toBe(true);
    expect(chooseOrchestrationPath({ hyperAgentEnabled: false, adkRequested: true }).adkGoverned).toBe(false);
  });
});

// ─── Governed-ADK param threading ─────────────────────────────────────────────

describe('Phase 5 buildGovernedAdkParams — threads plannerPlan + approvalGate into runWithAdk', () => {
  it('threads BOTH the Planner plan and the approval gate when supplied (governed ADK)', () => {
    const plan = planWith([task({ id: 'a' }), task({ id: 'b', dependsOn: ['a'] })]);
    const gate: ApprovalGate = async () => ({ verdict: 'allow' });
    const params = buildGovernedAdkParams({ plan, approvalGate: gate });
    // The stubs are RECEIVED by runWithAdk via these fields.
    expect(params.plannerPlan).toBe(plan);
    expect(params.approvalGate).toBe(gate);
  });

  it('threads only the approval gate when no plan is wired (default service has no plan pre-run)', () => {
    const gate: ApprovalGate = async () => ({ verdict: 'allow' });
    const params = buildGovernedAdkParams({ approvalGate: gate });
    expect(params.approvalGate).toBe(gate);
    expect(params.plannerPlan).toBeUndefined();
  });

  it('legacy ADK (HyperAgent OFF) threads NOTHING — empty params, runWithAdk uses its defaults', () => {
    // The service calls buildGovernedAdkParams ONLY when adkGoverned; the legacy
    // path supplies `{}`. Pin that empty-in ⇒ empty-out so nothing is threaded.
    const params = buildGovernedAdkParams({});
    expect(params.plannerPlan).toBeUndefined();
    expect(params.approvalGate).toBeUndefined();
  });
});

// ─── The approval gate (safety-critical governance seam) ──────────────────────

describe('Phase 5 buildAdkApprovalGate — high-risk tools pause; low-risk tools run', () => {
  it('allows a low-risk READ_ONLY tool WITHOUT creating an approval request', async () => {
    let createCalls = 0;
    const gate = buildAdkApprovalGate({
      createApprovalRequest: async () => {
        createCalls += 1;
      },
    });
    const decision = await gate('web_search', toolMetadata({ riskClass: ToolRiskClass.READ_ONLY, requiresApproval: false }));
    expect(decision.verdict).toBe('allow');
    expect(createCalls).toBe(0);
  });

  it('pauses (approval_required, tool not executed) a DESTRUCTIVE tool and records the request', async () => {
    let createCalls = 0;
    let lastTool: string | undefined;
    const gate = buildAdkApprovalGate({
      createApprovalRequest: async (toolName) => {
        createCalls += 1;
        lastTool = toolName;
      },
    });
    const decision = await gate(
      'deploy_to_vercel',
      toolMetadata({ riskClass: ToolRiskClass.DESTRUCTIVE, requiresApproval: false }),
    );
    expect(decision.verdict).toBe('approval_required');
    expect(createCalls).toBe(1);
    expect(lastTool).toBe('deploy_to_vercel');
  });

  it('pauses a tool flagged requiresApproval=true even if its riskClass is low', async () => {
    let createCalls = 0;
    const gate = buildAdkApprovalGate({
      createApprovalRequest: async () => {
        createCalls += 1;
      },
    });
    const decision = await gate(
      'send_email',
      toolMetadata({ riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT, requiresApproval: true }),
    );
    expect(decision.verdict).toBe('approval_required');
    expect(createCalls).toBe(1);
  });

  it('fail-closed: if the approval-record persist throws, the tool STILL does not run (approval_required)', async () => {
    const gate = buildAdkApprovalGate({
      createApprovalRequest: async () => {
        throw new Error('db down');
      },
    });
    const decision = await gate(
      'deploy_to_vercel',
      toolMetadata({ riskClass: ToolRiskClass.DESTRUCTIVE }),
    );
    // Never `allow` — a persist failure must not silently auto-run a high-risk tool.
    expect(decision.verdict).toBe('approval_required');
    expect(decision.verdict).not.toBe('allow');
  });
});

// ─── End-to-end decision→params wiring (the service's contract) ───────────────

describe('Phase 5 governance wiring — decision drives whether governed params are built', () => {
  it('HyperAgent ON + opt-in: decision → adk governed → buildGovernedAdkParams threads plan+gate', () => {
    // Mirrors the service: `if (primary === 'adk') { governedParams = adkGoverned ? buildGovernedAdkParams(...) : {} }`.
    const decision = chooseOrchestrationPath({ hyperAgentEnabled: true, adkRequested: true });
    expect(decision.primary).toBe('adk');
    expect(decision.adkGoverned).toBe(true);

    const plan = planWith([task({ id: 'a' })]);
    const gate: ApprovalGate = async () => ({ verdict: 'allow' });
    const governedParams = decision.adkGoverned
      ? buildGovernedAdkParams({ plan, approvalGate: gate })
      : {};
    expect(governedParams.plannerPlan).toBe(plan);
    expect(governedParams.approvalGate).toBe(gate);
  });

  it('HyperAgent OFF + opt-in: decision → adk legacy → NO governed params (unchanged ADK-first path)', () => {
    const decision = chooseOrchestrationPath({ hyperAgentEnabled: false, adkRequested: true });
    expect(decision.primary).toBe('adk');
    expect(decision.adkGoverned).toBe(false);

    const governedParams = decision.adkGoverned ? buildGovernedAdkParams({}) : {};
    expect(governedParams).toEqual({});
    expect(governedParams.plannerPlan).toBeUndefined();
    expect(governedParams.approvalGate).toBeUndefined();
  });

  it('HyperAgent ON + no opt-in: decision → langgraph → ADK block skipped (ADK not invoked)', () => {
    const decision = chooseOrchestrationPath({ hyperAgentEnabled: true, adkRequested: false });
    expect(decision.primary).toBe('langgraph');
    // The service only enters the ADK branch when `primary === 'adk'`; here it
    // does not, so runWithAdk is never imported and no governed params are built.
    expect(decision.primary).not.toBe('adk');
  });
});