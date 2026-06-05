import type OpenAI from 'openai';
import { AgentRole, RiskLevel, TaskStatus } from '@jak-swarm/shared';

import type { WorkflowTask, WorkflowPlan } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';
import type { MissionBrief } from './commander.agent.js';
import {
  PlannerResponseSchema,
  type PlannerResponseT,
} from '../runtime/schemas/index.js';
import { decomposeGoal, summarizePlan } from '../coordination/subgoal-coordinator.js';

export interface PlannerOutput {
  plan: WorkflowPlan;
}

const REPLAN_SUPPLEMENT = `You are a Planner agent in REPLAN mode. A previous plan had task failures.
Your job is to create a revised plan that works around the failures while still achieving the goal.

You will receive:
- The original goal and mission brief
- The existing plan with task details
- Which tasks failed and their errors
- Which tasks completed and their results

Create a new plan that:
1. Keeps completed tasks as-is (do NOT re-run them)
2. Replaces or works around failed tasks with alternative approaches
3. Adjusts dependencies to account for the new task structure
4. Maintains the original goal

Respond with the same JSON schema as the normal planner.`;

const PLANNER_SUPPLEMENT = `You are a Planner agent. Decompose the user's goal into a JSON plan.

Output schema:
{
  "planName": "short name",
  "tasks": [
    {
      "id": "task_1",
      "name": "Task name",
      "description": "What this task does",
      "agentRole": "<ONE valid role from the list below>",
      "toolsRequired": ["tool_name"],
      "riskLevel": "LOW|MEDIUM|HIGH|CRITICAL",
      "requiresApproval": boolean,
      "dependsOn": ["task_id"],
      "retryable": boolean,
      "maxRetries": 0-3
    }
  ],
  "estimatedDurationMinutes": number
}

VERB -> WORKER mapping (follow exactly):
- write / draft / compose / create a post|blog|tweet|newsletter|script|press release|caption -> WORKER_CONTENT
- write / generate / build / fix / debug / refactor code|script|function|API|tests -> WORKER_CODER
- review / audit / inspect / check website|URL|page|landing page -> WORKER_TECHNICAL
- research / find / compare / investigate / benchmark topic|market|competitor -> WORKER_RESEARCH
- summarise / extract / compare uploaded files|documents -> WORKER_DOCUMENT
- analyse / SWOT / OKRs / strategy / vision -> WORKER_STRATEGIST
- GTM plan / brand audit / campaign plan / SEO audit -> WORKER_MARKETING
- architecture review / security audit / tech stack -> WORKER_TECHNICAL
- hire / JD / resume / offer letter / onboarding -> WORKER_HR
- lead gen / outreach / email sequence / prospect list -> WORKER_GROWTH
- P&L / forecast / budget / valuation -> WORKER_FINANCE
- contract / NDA / privacy policy / compliance -> WORKER_LEGAL

Rules:
- ONE concrete deliverable = ONE task. Do NOT add research/verify padding.
- 3-10 tasks max. Don't over-fragment.
- requiresApproval=true for any SEND, CRM write, payment, or external publish.
- HIGH/CRITICAL risk always requires approval.
- retryable=false for destructive tasks (sends, deletes, payments).
- If "PREFER these worker agents: X, Y" appears in the goal, bias tasks toward X and Y.
- Every plan must have at least one user-facing deliverable task.`;

export class PlannerAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.PLANNER, apiKey);
  }

  async _executeImpl(input: unknown, context: AgentContext): Promise<PlannerOutput> {
    const startedAt = new Date();

    // Check if this is a replan request
    const maybeReplan = input as {
      replan?: boolean;
      failedTasks?: unknown[];
      existingPlan?: WorkflowPlan;
      completedResults?: Record<string, unknown>;
      goal?: string;
      missionBrief?: MissionBrief;
    };

    if (maybeReplan.replan) {
      return this.executeReplan(maybeReplan, context, startedAt);
    }

    const missionBrief = input as MissionBrief;

    this.logger.info(
      { runId: context.runId, missionBriefId: missionBrief.id },
      'Planner decomposing mission brief',
    );

    // Sprint 6 Part A — wire SubgoalCoordinator into the planner.
    // Run the deterministic domain decomposer FIRST. When the goal
    // matches multiple domains (e.g., "review my repo and draft a
    // LinkedIn post"), the coordinator returns subgoals + parallel
    // groups + a CEO summary. We pass that decomposition to the LLM
    // as a grounded starting point so the produced plan reflects the
    // multi-agent fan-out the user expected. When the goal matches a
    // single domain or none, the coordinator falls through to a
    // single CEO subgoal — the LLM still produces tasks freely.
    let coordinatorHint: string | null = null;
    try {
      const coord = decomposeGoal(missionBrief.goal);
      // Only include the hint when the decomposition is genuinely
      // multi-domain (more than one specialist). For single-agent
      // goals the LLM is already optimal; the hint adds noise.
      const specialistCount = coord.subgoals.filter(
        (sg) => sg.agentLabel !== 'CEO Agent',
      ).length;
      if (specialistCount >= 2) {
        coordinatorHint = summarizePlan(coord);
      }
    } catch {
      // Empty / malformed goal — let the LLM handle it.
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(PLANNER_SUPPLEMENT),
      },
      ...(coordinatorHint
        ? [
            {
              role: 'system' as const,
              content:
                'SUBGOAL COORDINATOR HINT — the user goal touches multiple domains. ' +
                'Use this decomposition as the starting structure for your plan. ' +
                'Each subgoal should map to at least one task in the plan.\n\n' +
                coordinatorHint,
            },
          ]
        : []),
      {
        role: 'user',
        content: JSON.stringify({
          goal: missionBrief.goal,
          intent: missionBrief.intent,
          industry: missionBrief.industry,
          subFunction: missionBrief.subFunction,
          urgency: missionBrief.urgency,
          riskIndicators: missionBrief.riskIndicators,
          requiredOutputs: missionBrief.requiredOutputs,
        }),
      },
    ];

    // Phase 4: structured output via the LLMRuntime.
    //   - OpenAIRuntime enforces the schema at the Responses API model layer
    //     (no prose drift, no fence-stripping).
    //   - LegacyRuntime turns on JSON mode and validates against the same
    //     schema after parse. ZodError on malformed output -> fallback below.
    let parsed: PlannerResponseT;
    try {
      parsed = await this.runtime.respondStructured(
        messages,
        PlannerResponseSchema,
        {
          maxTokens: 2048,
          temperature: 0.2,
          schemaName: 'PlannerResponse',
          schemaDescription: 'JAK Swarm Planner: structured workflow decomposition',
        },
        context,
      );
    } catch (err) {
      // Same recoverable-vs-fatal split as the Commander. A 401 / model-not-found
      // is a config error and must propagate; a schema mismatch is the LLM
      // responding badly and warrants the deterministic fallback plan.
      const msg = err instanceof Error ? err.message : String(err);
      const isFatalConfig =
        /\b401\b|\b403\b|incorrect api key|invalid api key|model_not_found|model not found|model[- ]?that[- ]?does[- ]?not[- ]?exist|insufficient_quota|api key/i.test(msg);
      if (isFatalConfig) {
        this.logger.error({ err: msg }, 'Planner structured response hit a fatal configuration error; failing the workflow');
        // Record a trace so the workflow doesn't complete silently with 0 traces.
        const errorOutput: PlannerOutput = {
          plan: {
            id: this.generateId('plan_'),
            name: 'Fatal Error Plan',
            goal: missionBrief.goal,
            industry: missionBrief.industry,
            tasks: [],
            estimatedDuration: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        };
        this.recordTrace(context, input, errorOutput, [], startedAt);
        throw err;
      }
      this.logger.warn(
        { err: msg },
        'Planner structured response failed (recoverable schema/transient); using fallback plan',
      );
      parsed = {
        planName: 'Fallback Plan',
        tasks: [
          {
            id: 'task_1',
            name: 'Research and gather information',
            description: missionBrief.goal,
            agentRole: 'WORKER_RESEARCH',
            toolsRequired: ['search_knowledge'],
            riskLevel: 'LOW',
            requiresApproval: false,
            dependsOn: [],
            retryable: true,
            maxRetries: 2,
          },
        ],
        estimatedDurationMinutes: 5,
      };
    }

    const overridden: string[] = [];

    const rawTasks = parsed.tasks ?? [];
    const tasks: WorkflowTask[] = rawTasks.map((t, idx) => {
      const riskLevel = this.parseRiskLevel(t.riskLevel ?? 'LOW');
      const requiresApproval = t.requiresApproval ?? (riskLevel === RiskLevel.HIGH || riskLevel === RiskLevel.CRITICAL);

      return {
        id: t.id ?? `task_${idx + 1}`,
        name: t.name ?? `Task ${idx + 1}`,
        description: t.description ?? '',
        agentRole: this.parseAgentRole(t.agentRole ?? 'WORKER_OPS'),
        toolsRequired: t.toolsRequired ?? [],
        riskLevel,
        requiresApproval,
        status: TaskStatus.PENDING,
        dependsOn: t.dependsOn ?? [],
        retryable: t.retryable ?? (riskLevel === RiskLevel.LOW || riskLevel === RiskLevel.MEDIUM),
        maxRetries: t.maxRetries ?? 2,
      };
    });

    // -- Preferred-role enforcement ----------------------------------------
    // When the user explicitly selected role(s) in the dashboard, EVERY
    // preferred agent MUST appear in the plan at least once. If the LLM
    // routed away from a preferred agent (e.g., WORKER_OPS for a website
    // review), we add a best-effort supporting task so the user sees the
    // role they selected contribute to the workflow.
    const preferredMatch = missionBrief.goal?.match(/PREFER these worker agents: ([^.]+)/i);
    if (preferredMatch && typeof preferredMatch[1] === 'string') {
      const preferredRoles = preferredMatch[1]
        .split(/,\s*/)
        .map((r) => r.trim().toUpperCase())
        .filter((r) => r.length > 0);
      const assignedRoles = new Set(tasks.map((t) => t.agentRole));
      for (const preferred of preferredRoles) {
        if (!assignedRoles.has(preferred as AgentRole)) {
          const lastTaskId = tasks.length > 0 ? tasks[tasks.length - 1]?.id : undefined;
          const supportingTask: WorkflowTask = {
            id: `task_support_${preferred.toLowerCase()}`,
            name: `${this.friendlyRoleName(preferred)} contribution`,
            description: `Apply ${this.friendlyRoleName(preferred)} expertise to support the overall goal: ${missionBrief.goal?.slice(0, 200) ?? ''}`,
            agentRole: this.parseAgentRole(preferred),
            toolsRequired: [],
            riskLevel: RiskLevel.LOW,
            requiresApproval: false,
            status: TaskStatus.PENDING,
            dependsOn: lastTaskId ? [lastTaskId] : [],
            retryable: true,
            maxRetries: 2,
          };
          tasks.push(supportingTask);
          assignedRoles.add(preferred as AgentRole);
          this.logger.info(
            { runId: context.runId, role: preferred },
            'Planner: added supporting task for preferred role that LLM omitted',
          );
        }
      }
    }

    // -- Lightweight validation ----------------------------------------
    // Safety net: if the LLM produced zero tasks, add a fallback so the
    // graph doesn't silently complete. This should be rare with a good prompt.
    if (tasks.length === 0) {
      const fallbackTask: WorkflowTask = {
        id: 'task_fallback_1',
        name: 'Research and execute goal',
        description: missionBrief.goal ?? 'Execute the requested task',
        agentRole: AgentRole.WORKER_OPS,
        toolsRequired: ['search_knowledge'],
        riskLevel: RiskLevel.LOW,
        requiresApproval: false,
        status: TaskStatus.PENDING,
        dependsOn: [],
        retryable: true,
        maxRetries: 2,
      };
      tasks.push(fallbackTask);
      this.logger.warn(
        { runId: context.runId },
        'Planner: zero-task guard triggered -- added fallback task',
      );
    }

    if (overridden.length > 0) {
      this.logger.info(
        { runId: context.runId, overrides: overridden },
        'Planner: deterministic routing overrides applied to LLM plan',
      );
    }

    const plan: WorkflowPlan = {
      id: this.generateId('plan_'),
      name: parsed.planName ?? `${missionBrief.subFunction} Workflow`,
      goal: missionBrief.goal,
      industry: missionBrief.industry,
      tasks,
      estimatedDuration: (parsed.estimatedDurationMinutes ?? 10) * 60,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const output: PlannerOutput = { plan };

    const usageSummary = context.getLLMUsageSummary();
    const trace = this.recordTrace(context, input, output, [], startedAt);
    if (usageSummary) {
      trace.tokenUsage = {
        promptTokens: usageSummary.promptTokens,
        completionTokens: usageSummary.completionTokens,
        totalTokens: usageSummary.totalTokens,
      };
      trace.costUsd = usageSummary.costUsd;
    }

    this.logger.info(
      { planId: plan.id, taskCount: tasks.length },
      'Planner produced workflow plan',
    );

    return output;
  }

  private async executeReplan(
    replanInput: {
      failedTasks?: unknown[];
      existingPlan?: WorkflowPlan;
      completedResults?: Record<string, unknown>;
      goal?: string;
      missionBrief?: MissionBrief;
    },
    context: AgentContext,
    startedAt: Date,
  ): Promise<PlannerOutput> {
    this.logger.info(
      { runId: context.runId, failedCount: replanInput.failedTasks?.length },
      'Planner replanning after failures',
    );

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(`${REPLAN_SUPPLEMENT}\n\n${PLANNER_SUPPLEMENT}`),
      },
      {
        role: 'user',
        content: JSON.stringify({
          mode: 'replan',
          goal: replanInput.goal ?? replanInput.existingPlan?.goal ?? '',
          existingPlan: replanInput.existingPlan
            ? {
                name: replanInput.existingPlan.name,
                tasks: replanInput.existingPlan.tasks.map((t) => ({
                  id: t.id,
                  name: t.name,
                  description: t.description,
                  status: t.status,
                  agentRole: t.agentRole,
                  dependsOn: t.dependsOn,
                })),
              }
            : null,
          failedTasks: replanInput.failedTasks ?? [],
          completedResults: Object.keys(replanInput.completedResults ?? {}),
          missionBrief: replanInput.missionBrief
            ? {
                goal: replanInput.missionBrief.goal,
                intent: replanInput.missionBrief.intent,
                industry: replanInput.missionBrief.industry,
              }
            : null,
        }),
      },
    ];

    const completion = await this.callLLM(messages, undefined, {
      maxTokens: 2048,
      temperature: 0.3,
    });

    const rawContent = completion.choices[0]?.message?.content ?? '{}';

    interface LLMPlanResponse {
      planName?: string;
      tasks?: Array<{
        id?: string;
        name?: string;
        description?: string;
        agentRole?: string;
        toolsRequired?: string[];
        riskLevel?: string;
        requiresApproval?: boolean;
        dependsOn?: string[];
        retryable?: boolean;
        maxRetries?: number;
      }>;
      estimatedDurationMinutes?: number;
    }

    let parsed: LLMPlanResponse;
    try {
      parsed = this.parseJsonResponse<LLMPlanResponse>(rawContent);
    } catch {
      this.logger.error('Failed to parse replan response, returning existing plan');
      return {
        plan: replanInput.existingPlan ?? {
          id: this.generateId('plan_'),
          name: 'Fallback Replan',
          goal: replanInput.goal ?? '',
          industry: replanInput.missionBrief?.industry ?? '',
          tasks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
    }

    const rawTasks = parsed.tasks ?? [];
    const tasks: WorkflowTask[] = rawTasks.map((t, idx) => {
      const riskLevel = this.parseRiskLevel(t.riskLevel ?? 'LOW');
      const requiresApproval = t.requiresApproval ?? (riskLevel === RiskLevel.HIGH || riskLevel === RiskLevel.CRITICAL);

      return {
        id: t.id ?? `replan_task_${idx + 1}`,
        name: t.name ?? `Replan Task ${idx + 1}`,
        description: t.description ?? '',
        agentRole: this.parseAgentRole(t.agentRole ?? 'WORKER_OPS'),
        toolsRequired: t.toolsRequired ?? [],
        riskLevel,
        requiresApproval,
        status: TaskStatus.PENDING,
        dependsOn: t.dependsOn ?? [],
        retryable: t.retryable ?? (riskLevel === RiskLevel.LOW || riskLevel === RiskLevel.MEDIUM),
        maxRetries: t.maxRetries ?? 2,
      };
    });

    const plan: WorkflowPlan = {
      id: this.generateId('replan_'),
      name: parsed.planName ?? `Replanned: ${replanInput.existingPlan?.name ?? 'Workflow'}`,
      goal: replanInput.goal ?? replanInput.existingPlan?.goal ?? '',
      industry: replanInput.missionBrief?.industry ?? replanInput.existingPlan?.industry ?? '',
      tasks,
      estimatedDuration: (parsed.estimatedDurationMinutes ?? 10) * 60,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const output: PlannerOutput = { plan };
    this.recordTrace(context, replanInput, output, [], startedAt);

    this.logger.info(
      { planId: plan.id, taskCount: tasks.length },
      'Planner produced revised plan',
    );

    return output;
  }

  private parseRiskLevel(raw: string): RiskLevel {
    const upper = raw.toUpperCase();
    if (upper === 'LOW') return RiskLevel.LOW;
    if (upper === 'MEDIUM') return RiskLevel.MEDIUM;
    if (upper === 'HIGH') return RiskLevel.HIGH;
    if (upper === 'CRITICAL') return RiskLevel.CRITICAL;
    return RiskLevel.LOW;
  }

  private parseAgentRole(raw: string): AgentRole {
    const valid = Object.values(AgentRole) as string[];
    const upper = raw.toUpperCase();
    if (valid.includes(upper)) return upper as AgentRole;
    return AgentRole.WORKER_OPS;
  }

  private friendlyRoleName(raw: string): string {
    const map: Record<string, string> = {
      WORKER_OPS: 'Ops',
      WORKER_TECHNICAL: 'Technical',
      WORKER_MARKETING: 'Marketing',
      WORKER_STRATEGIST: 'Strategist',
      WORKER_CODER: 'Coder',
      WORKER_RESEARCH: 'Research',
      WORKER_DESIGNER: 'Designer',
      WORKER_LEGAL: 'Legal',
      WORKER_CONTENT: 'Content',
      WORKER_SEO: 'SEO',
      WORKER_PR: 'PR',
      WORKER_FINANCE: 'Finance',
      WORKER_HR: 'HR',
      WORKER_GROWTH: 'Growth',
      WORKER_SUCCESS: 'Success',
      WORKER_ANALYTICS: 'Analytics',
      WORKER_PRODUCT: 'Product',
      WORKER_PROJECT: 'Project',
      WORKER_BROWSER: 'Browser',
      WORKER_EMAIL: 'Email',
      WORKER_CALENDAR: 'Calendar',
      WORKER_CRM: 'CRM',
      WORKER_DOCUMENT: 'Document',
      WORKER_SPREADSHEET: 'Spreadsheet',
      WORKER_SUPPORT: 'Support',
      WORKER_VOICE: 'Voice',
      WORKER_KNOWLEDGE: 'Knowledge',
      WORKER_APP_ARCHITECT: 'App Architect',
      WORKER_APP_GENERATOR: 'App Generator',
      WORKER_APP_DEBUGGER: 'App Debugger',
      WORKER_APP_DEPLOYER: 'App Deployer',
      WORKER_SCREENSHOT_TO_CODE: 'Screenshot-to-Code',
    };
    return map[raw.toUpperCase()] ?? raw;
  }
}
