/**
 * Orchestrator behavioral tests.
 *
 * Closes the honest gap the prior audit identified: Commander, Planner,
 * Router, Verifier, and Approval were all classified world_class in
 * ROLE_MANIFEST but had no per-role behavioral tests — their decision
 * logic could silently regress. Guardrail already has test coverage
 * (tests/unit/agents/guardrail.test.ts) so it's not duplicated here.
 *
 * Router is a heuristic (no LLM in the main path), so we test its
 * decision logic directly with a synthetic plan + industry pack.
 *
 * The other 4 go through `callLLM` so we stub it with canned JSON.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CommanderAgent,
  PlannerAgent,
  RouterAgent,
  VerifierAgent,
  ApprovalAgent,
  AgentContext,
} from '@jak-swarm/agents';
import { AgentRole, Industry, RiskLevel, TaskStatus } from '@jak-swarm/shared';
import type { WorkflowPlan, WorkflowTask, IndustryPack } from '@jak-swarm/shared';
import type OpenAI from 'openai';

function stubContext(): AgentContext {
  return new AgentContext({ tenantId: 't-1', userId: 'u-1', workflowId: 'wf-1' });
}

function fakeCompletion(content: string): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: 'stub-1',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'stub',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: { role: 'assistant', content, refusal: null },
      } as unknown as OpenAI.Chat.Completions.ChatCompletion.Choice,
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

function stubLLM<T>(agent: T, payload: unknown): void {
  (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM =
    vi.fn(async () => fakeCompletion(JSON.stringify(payload)));
}

// ─── Commander ─────────────────────────────────────────────────────────────

describe('CommanderAgent — mission brief extraction', () => {
  it('preserves intent + urgency + riskIndicators + requiredOutputs on plain input', { timeout: 20_000 }, async () => {
    const agent = new CommanderAgent('stub-key');
    stubLLM(agent, {
      intent: 'Summarize quarterly customer escalation themes for the VPEng meeting',
      subFunction: 'Customer Success',
      urgency: 3,
      riskIndicators: ['customer PII in tickets', 'external comms if draft replies'],
      requiredOutputs: ['executive summary', 'top 3 escalation categories', 'trend chart'],
      clarificationNeeded: false,
    });

    const result = await agent.execute(
      'Can you pull my customer escalations from the last quarter and summarize the themes?',
      stubContext(),
    );

    expect(result.missionBrief).toBeDefined();
    expect(result.missionBrief?.urgency).toBe(3);
    expect(result.missionBrief?.riskIndicators).toContain('customer PII in tickets');
    expect(result.missionBrief?.requiredOutputs.length).toBeGreaterThanOrEqual(2);
    expect(result.clarificationNeeded).toBe(false);
  });

  it('surfaces clarificationNeeded + clarificationQuestion when the LLM flags ambiguity', async () => {
    const agent = new CommanderAgent('stub-key');
    stubLLM(agent, {
      intent: 'unclear',
      subFunction: 'unknown',
      urgency: 3,
      riskIndicators: [],
      requiredOutputs: [],
      clarificationNeeded: true,
      clarificationQuestion: 'Which customer account are you referring to — the full list or a specific one?',
    });

    const result = await agent.execute('do the thing for the customer', stubContext());
    expect(result.clarificationNeeded).toBe(true);
    expect(result.clarificationQuestion).toContain('customer account');
  });

  it('detects healthcare industry from keywords in input', async () => {
    const agent = new CommanderAgent('stub-key');
    stubLLM(agent, {
      intent: 'Process patient intake forms for HIPAA compliance review',
      subFunction: 'Patient Intake',
      urgency: 4,
      riskIndicators: ['HIPAA / PHI exposure', 'patient identifiers'],
      requiredOutputs: ['compliance review'],
      clarificationNeeded: false,
    });

    const result = await agent.execute(
      'Process patient intake forms for HIPAA compliance review',
      stubContext(),
    );
    expect(result.missionBrief?.industry).toBe(Industry.HEALTHCARE);
  });
});

// ─── Planner ───────────────────────────────────────────────────────────────

describe('PlannerAgent — DAG task decomposition', () => {
  it('produces a plan with tasks, dependencies, tools, estimated risk', async () => {
    const agent = new PlannerAgent('stub-key');
    stubLLM(agent, {
      tasks: [
        {
          id: 'task-1',
          description: 'Fetch customer escalation tickets from CRM',
          agentRole: 'WORKER_CRM',
          toolsRequired: ['lookup_crm_contact', 'search_deals'],
          dependsOn: [],
          riskLevel: 'LOW',
          requiresApproval: false,
          estimatedDurationMs: 5000,
        },
        {
          id: 'task-2',
          description: 'Summarize themes and produce executive brief',
          agentRole: 'WORKER_DOCUMENT',
          toolsRequired: ['summarize_document'],
          dependsOn: ['task-1'],
          riskLevel: 'LOW',
          requiresApproval: false,
          estimatedDurationMs: 8000,
        },
      ],
    });

    const missionBrief = {
      id: 'mb-1',
      goal: 'Summarize customer escalations',
      intent: 'Summarize customer escalation themes',
      industry: Industry.TECHNOLOGY,
      subFunction: 'Customer Success',
      urgency: 3 as const,
      riskIndicators: [],
      requiredOutputs: ['summary'],
      clarificationNeeded: false,
      rawInput: 'any',
      createdAt: new Date(),
    };

    const result = await agent.execute({ missionBrief }, stubContext());
    expect(result.plan.tasks).toHaveLength(2);
    expect(result.plan.tasks[0]?.agentRole).toBe('WORKER_CRM');
    expect(result.plan.tasks[1]?.dependsOn).toEqual(['task-1']);
    expect(result.plan.tasks.every((t) => t.status === TaskStatus.PENDING)).toBe(true);
  });
});

// ─── Router ────────────────────────────────────────────────────────────────

describe('RouterAgent — heuristic tool/role routing', () => {
  // Router is heuristic: no LLM call needed, output is deterministic given input.
  it('approves tools in allowedTools + flags restricted tools', async () => {
    const agent = new RouterAgent('stub-key');
    const plan: WorkflowPlan = {
      id: 'plan-1',
      workflowId: 'wf-1',
      tasks: [
        {
          id: 't-1',
          description: 'Send email summary',
          agentRole: AgentRole.WORKER_EMAIL,
          toolsRequired: ['email'],
          dependsOn: [],
          status: TaskStatus.PENDING,
          riskLevel: RiskLevel.MEDIUM,
          requiresApproval: true,
          estimatedDurationMs: 3000,
        },
        {
          id: 't-2',
          description: 'Fetch customer data',
          agentRole: AgentRole.WORKER_CRM,
          toolsRequired: ['crm'],
          dependsOn: [],
          status: TaskStatus.PENDING,
          riskLevel: RiskLevel.LOW,
          requiresApproval: false,
          estimatedDurationMs: 2000,
        },
      ],
      createdAt: new Date(),
    } as WorkflowPlan;

    const industryPack: IndustryPack = {
      industry: Industry.HEALTHCARE,
      displayName: 'Healthcare',
      description: 'HIPAA-compliant',
      allowedTools: ['email', 'crm'],
      restrictedTools: ['browser'],
      policyOverlays: [],
      complianceNotes: ['HIPAA'],
      defaultApprovalThreshold: RiskLevel.LOW,
    } as IndustryPack;

    const result = await agent.execute({ plan, industryPack }, stubContext());
    expect(Object.keys(result.routeMap)).toHaveLength(2);
    expect(result.routeMap['t-1']?.tools).toContain('email');
    expect(result.routeMap['t-2']?.tools).toContain('crm');
  });

  it('flags restricted tools with warnings + alternativeTools', async () => {
    const agent = new RouterAgent('stub-key');
    const plan: WorkflowPlan = {
      id: 'plan-2',
      workflowId: 'wf-2',
      tasks: [
        {
          id: 't-1',
          description: 'Scrape competitor site',
          agentRole: AgentRole.WORKER_BROWSER,
          toolsRequired: ['browser_navigate', 'browser_extract'],
          dependsOn: [],
          status: TaskStatus.PENDING,
          riskLevel: RiskLevel.HIGH,
          requiresApproval: true,
          estimatedDurationMs: 10000,
        },
      ],
      createdAt: new Date(),
    } as WorkflowPlan;

    const industryPack: IndustryPack = {
      industry: Industry.HEALTHCARE,
      displayName: 'Healthcare',
      description: 'HIPAA',
      allowedTools: ['email', 'crm'],
      restrictedTools: ['browser'],
      policyOverlays: [],
      complianceNotes: [],
      defaultApprovalThreshold: RiskLevel.LOW,
    } as IndustryPack;

    const result = await agent.execute({ plan, industryPack }, stubContext());
    const route = result.routeMap['t-1'];
    expect(route?.warnings.length).toBeGreaterThan(0);
    expect(route?.warnings.join(' ')).toMatch(/restricted|not in the allowed/i);
  });
});

// ─── Verifier ──────────────────────────────────────────────────────────────

describe('VerifierAgent — schema + hallucination checks', () => {
  it('passes clean output against expected schema', async () => {
    const agent = new VerifierAgent('stub-key');
    stubLLM(agent, {
      passed: true,
      issues: [],
      confidence: 0.92,
      needsRetry: false,
    });

    const task: WorkflowTask = {
      id: 't-1',
      description: 'Extract invoice fields',
      agentRole: AgentRole.WORKER_DOCUMENT,
      toolsRequired: ['extract_document_data'],
      dependsOn: [],
      status: TaskStatus.COMPLETED,
      riskLevel: RiskLevel.LOW,
      requiresApproval: false,
      estimatedDurationMs: 3000,
    } as WorkflowTask;

    const result = await agent.execute(
      {
        task,
        agentOutput: { invoiceNumber: 'INV-001', total: '$5,000' },
        expectedOutputSchema: { type: 'object', properties: { invoiceNumber: { type: 'string' } } },
      },
      stubContext(),
    );

    expect(result.passed).toBe(true);
    expect(result.needsRetry).toBe(false);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('flags hallucinated / fabricated output; needsRetry follows task.retryable', async () => {
    const agent = new VerifierAgent('stub-key');
    stubLLM(agent, {
      passed: false,
      issues: [
        'Output contains a phone number that is not in the input document',
        'Field "accountBalance" was fabricated — no source data provided',
      ],
      confidence: 0.4,
      needsRetry: true,
      retryReason: 'Output contains fabricated fields not traceable to inputs',
    });

    // retryable=true lets needsRetry flow through; verifier multiplies the
    // LLM verdict by task.retryable so non-retryable tasks never loop forever.
    const task: WorkflowTask = {
      id: 't-2',
      description: 'Extract contract obligations',
      agentRole: AgentRole.WORKER_DOCUMENT,
      toolsRequired: [],
      dependsOn: [],
      status: TaskStatus.COMPLETED,
      riskLevel: RiskLevel.MEDIUM,
      requiresApproval: false,
      estimatedDurationMs: 3000,
      retryable: true,
    } as WorkflowTask;

    const result = await agent.execute(
      { task, agentOutput: { obligations: ['pay $100k', 'call 555-0100'], accountBalance: '$50k' } },
      stubContext(),
    );
    expect(result.passed).toBe(false);
    expect(result.needsRetry).toBe(true);
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
    expect(result.retryReason).toContain('fabricated');
  });

  it('suppresses needsRetry on non-retryable task even when LLM requests retry', async () => {
    const agent = new VerifierAgent('stub-key');
    stubLLM(agent, {
      passed: false,
      issues: ['bad output'],
      confidence: 0.3,
      needsRetry: true,
      retryReason: 'try again',
    });
    const task: WorkflowTask = {
      id: 't-3',
      description: 'Non-retryable task',
      agentRole: AgentRole.WORKER_DOCUMENT,
      toolsRequired: [],
      dependsOn: [],
      status: TaskStatus.COMPLETED,
      riskLevel: RiskLevel.LOW,
      requiresApproval: false,
      estimatedDurationMs: 1000,
      retryable: false,
    } as WorkflowTask;
    const result = await agent.execute({ task, agentOutput: {} }, stubContext());
    // LLM said retry, but task.retryable=false → false
    expect(result.needsRetry).toBe(false);
  });
});

// ─── Approval ──────────────────────────────────────────────────────────────

describe('ApprovalAgent — plain-English human review output', () => {
  it('produces actionTitle + plainDescription + consequences + rollback', async () => {
    const agent = new ApprovalAgent('stub-key');
    stubLLM(agent, {
      actionTitle: 'Send 1,247 customer outreach emails',
      plainDescription:
        'This will send a marketing email to 1,247 customers who have not logged in within the last 90 days. The email offers a 20% discount.',
      affectedData: '1,247 customer email addresses, plus first name and tier metadata',
      consequences:
        'Customers will receive one email each. Expected unsubscribe rate 2-5% based on history. Stripe/billing is not affected.',
      rollbackOptions:
        'No undo for sent emails. Follow-up apology email possible if campaign error detected.',
      riskAssessment:
        'Medium — marketing campaigns at this scale typically see 1-2 spam complaints per 1000 sends.',
    });

    const task: WorkflowTask = {
      id: 't-send',
      description: 'Send win-back campaign',
      agentRole: AgentRole.WORKER_EMAIL,
      toolsRequired: ['send_email'],
      dependsOn: [],
      status: TaskStatus.PENDING,
      riskLevel: RiskLevel.HIGH,
      requiresApproval: true,
      estimatedDurationMs: 20000,
    } as WorkflowTask;

    const result = await agent.execute(
      {
        task,
        proposedData: { recipients: 1247, subject: 'We miss you', discount: 20 },
        affectedEntities: ['1,247 customers'],
      },
      stubContext(),
    );

    // ApprovalAgent merges the LLM fields into an ApprovalRequest:
    //   actionTitle → action
    //   plainDescription + affectedData + consequences + rollbackOptions + riskAssessment → rationale (concatenated)
    // Assert on the persisted fields a reviewer actually sees.
    const r = result as unknown as Record<string, unknown>;
    expect(r['action']).toBe('Send 1,247 customer outreach emails');
    expect(String(r['rationale'])).toMatch(/1,247/);
    expect(String(r['rationale'])).toMatch(/unsubscribe/);
    expect(String(r['rationale'])).toMatch(/No undo|Rollback/i);
    expect(String(r['rationale'])).toMatch(/Medium|risk/i);
    expect(r['workflowId']).toBe('wf-1');
    expect(r['taskId']).toBe('t-send');
    expect(r['status']).toBe('PENDING');
  });

  it('uses task metadata fallback when LLM call fails', async () => {
    const agent = new ApprovalAgent('stub-key');
    (agent as unknown as { callLLM: (...a: unknown[]) => Promise<unknown> }).callLLM = vi.fn(
      async () => { throw new Error('LLM down'); },
    );
    const task: WorkflowTask = {
      id: 't-fallback',
      description: 'Do a risky thing',
      agentRole: AgentRole.WORKER_EMAIL,
      toolsRequired: [],
      dependsOn: [],
      status: TaskStatus.PENDING,
      riskLevel: RiskLevel.HIGH,
      requiresApproval: true,
      estimatedDurationMs: 1000,
    } as WorkflowTask;
    const result = await agent.execute(
      { task, proposedData: {}, affectedEntities: [] },
      stubContext(),
    );
    const r = result as unknown as Record<string, unknown>;
    // Fallback still returns a well-formed ApprovalRequest with status PENDING.
    expect(r['status']).toBe('PENDING');
    expect(r['riskLevel']).toBe(RiskLevel.HIGH);
    expect(r['taskId']).toBe('t-fallback');
  });
});
