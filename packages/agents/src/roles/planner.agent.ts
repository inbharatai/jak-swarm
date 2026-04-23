import type OpenAI from 'openai';
import { AgentRole, RiskLevel, TaskStatus } from '@jak-swarm/shared';

import type { WorkflowTask, WorkflowPlan } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';
import type { MissionBrief } from './commander.agent.js';

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

const PLANNER_SUPPLEMENT = `You are a Planner agent. Your role is to decompose a mission brief into a sequence of executable workflow tasks.

═══════════════════════════════════════════════════════════════
STOP. READ BEFORE ANYTHING ELSE.

Look at the user's RAW GOAL (missionBrief.rawInput / missionBrief.goal).
Identify the MAIN VERB the user used. That verb determines the worker:

  "write / draft / create / compose (a post / blog / tweet / email / caption / press release / copy)" → WORKER_CONTENT
  "write / generate / build / fix / debug / refactor (code / script / function / API / tests)" → WORKER_CODER
  "SWOT / OKRs / vision / strategy / market-entry / positioning analysis" → WORKER_STRATEGIST
    (action: 'SWOT' when user says SWOT; 'OKR_SETTING' for OKRs; 'COMPETITIVE_POSITIONING' only when user asks for positioning specifically)
  "GTM plan / campaign plan / brand audit" → WORKER_MARKETING (strategy deliverable)
  "architecture review / tech stack / security audit" → WORKER_TECHNICAL
  "research / compare / benchmark (external topic)" → WORKER_RESEARCH
  "summarise / extract / compare (uploaded docs)" → WORKER_DOCUMENT

HARD RULE: ignore subFunction ("Marketing Communications", "Strategic Planning", etc.) — it describes the DOMAIN, not the worker. The VERB determines the worker. Marketing-domain asks for writing go to WORKER_CONTENT, not WORKER_MARKETING.

HARD RULE: SWOT explicitly asked by the user → WORKER_STRATEGIST with action SWOT. Do NOT silently substitute COMPETITIVE_POSITIONING or MARKET_ENTRY. SWOT means SWOT.

═══════════════════════════════════════════════════════════════

You must respond with a JSON object matching this schema:
{
  "planName": "short descriptive name for this workflow",
  "tasks": [
    {
      "id": "task_1",
      "name": "Task name",
      "description": "What this task does in plain English",
      "agentRole": "<one of: WORKER_EMAIL, WORKER_CALENDAR, WORKER_CRM, WORKER_DOCUMENT, WORKER_SPREADSHEET, WORKER_BROWSER, WORKER_RESEARCH, WORKER_KNOWLEDGE, WORKER_SUPPORT, WORKER_OPS, WORKER_VOICE, WORKER_CODER, WORKER_DESIGNER, WORKER_STRATEGIST, WORKER_MARKETING, WORKER_TECHNICAL, WORKER_FINANCE, WORKER_HR, WORKER_GROWTH, WORKER_CONTENT, WORKER_SEO, WORKER_PR, WORKER_LEGAL, WORKER_SUCCESS, WORKER_ANALYTICS, WORKER_PRODUCT, WORKER_PROJECT>",
      "toolsRequired": ["tool_name_1", "tool_name_2"],
      "riskLevel": "<LOW|MEDIUM|HIGH|CRITICAL>",
      "requiresApproval": <boolean>,
      "dependsOn": ["task_id_of_prerequisite"],
      "retryable": <boolean>,
      "maxRetries": <number 0-3>
    }
  ],
  "estimatedDurationMinutes": <number>
}

Guidelines:
- Decompose into 3-10 tasks. Don't over-fragment simple goals.
- dependsOn lists tasks that MUST complete before this one starts.
- requiresApproval=true for: any SEND action, CRM writes, payments, external communications, browser form submission.
- HIGH/CRITICAL risk tasks always set requiresApproval=true.
- retryable=false for destructive or side-effect tasks (sends, deletes, payments).
- If the mission brief or input contains a "PREFER these worker agents: …" line, that list is the USER'S explicit choice of specialist roles from the dashboard role picker. You MUST bias task assignment toward those workers when their declared capabilities match the task. Only route away from the preferred list when a task genuinely requires a tool or skill they lack (e.g., a preferred list of WORKER_TECHNICAL still needs WORKER_EMAIL for the "send the review summary via email" step). When you do route away, the plan's task descriptions should make the reason visible.
- Valid agentRoles with descriptions (choose the BEST match for each task):
  WORKER_EMAIL — read/draft/send emails
  WORKER_CALENDAR — schedule events, find availability
  WORKER_CRM — manage contacts, deals, pipeline
  WORKER_DOCUMENT — create/summarise/extract documents
  WORKER_SPREADSHEET — data analysis, statistics, reports
  WORKER_BROWSER — web automation, scraping, form filling
  WORKER_RESEARCH — web research, competitive intel, news
  WORKER_KNOWLEDGE — internal knowledge base search
  WORKER_SUPPORT — ticket triage, customer response
  WORKER_OPS — ops automation, webhooks, monitoring
  WORKER_VOICE — audio transcription, call analysis
  WORKER_CODER — write/review/debug/test code
  WORKER_DESIGNER — UI/UX design, wireframes, design systems
  WORKER_STRATEGIST — CEO-level strategy, SWOT, OKRs, market entry
  WORKER_MARKETING — CMO-level GTM, campaigns, brand, social strategy
  WORKER_TECHNICAL — CTO-level architecture, tech stack, security audit
  WORKER_FINANCE — CFO-level P&L, forecasting, budgets, valuation
  WORKER_HR — hiring, job descriptions, policies, onboarding plans, resume screening, offer letter generation
  WORKER_GROWTH — lead gen, SEO audit, email sequences, outreach, Reddit/Twitter engagement, lead pipeline tracking
  WORKER_CONTENT — write blogs, social posts, newsletters, scripts, press releases
  WORKER_SEO — optimise pages for search, technical SEO, schema markup, link strategy
  WORKER_PR — press releases, media pitches, crisis comms, analyst briefings
  WORKER_LEGAL — contract review, NDA drafts, privacy policy, compliance checklists, contract comparison, obligation extraction, regulation monitoring
  WORKER_SUCCESS — customer health scoring, churn prediction, onboarding, renewal strategy, health tracking over time, QBR deck generation
  WORKER_ANALYTICS — metrics, trend analysis, A/B tests, dashboards, anomaly detection
  WORKER_PRODUCT — feature specs, user stories, roadmap, sprint planning, prioritisation
  WORKER_PROJECT — timeline estimation, resource allocation, status reports, risk registers
- Common toolsRequired values: read_email, draft_email, send_email, list_calendar_events, create_calendar_event, lookup_crm_contact, update_crm_record, search_knowledge, summarize_document, extract_document_data, browser_navigate, browser_extract, classify_text, generate_report

SIMPLICITY RULE (hard — follow before anything else):
When the user's ask is a single concrete deliverable AND they've given you enough context to start (product name, audience, purpose), produce a ONE-TASK plan routed to the right worker. Do NOT pad with research/verification/review tasks. Research is a separate worker the user can explicitly ask for. Examples:
- "Write a LinkedIn post for JAK Swarm's launch (enterprise audience)" → 1 task to WORKER_CONTENT. No research task.
- "Generate a Python script that X" → 1 task to WORKER_CODER.
- "Draft a press release announcing Y" → 1 task to WORKER_PR.
Only add research/verification when the user explicitly asks for it OR when the content genuinely requires facts the user didn't provide (market-size numbers, specific competitor names, time-bound data).

DELIVERABLE-VERB ROUTING (hard — overrides any domain/subFunction guess):
The VERB in the user's ask determines the worker. The DOMAIN (marketing, tech, legal) only determines the subFunction label. Do NOT route based on subFunction.

Map verbs → workers (mandatory when the ask uses these verbs):
- write / draft / compose / create a (post | blog | article | newsletter | script | email | caption | thread | press release | ad copy | landing copy) → WORKER_CONTENT
  • NOT WORKER_MARKETING (that agent plans campaigns; it does NOT write the words)
  • NOT WORKER_STRATEGIST
- write / generate / build / fix / debug / refactor / review (code | function | script | API | tests | class | module) → WORKER_CODER
  • NOT WORKER_TECHNICAL (that agent reviews architecture; it does NOT write code)
  • NOT WORKER_APP_GENERATOR (that's for full-stack app builds via Builder/vibe-coder)
- research / find / compare / investigate / benchmark (topic | market | competitor | vendor) → WORKER_RESEARCH
- summarise / extract / compare / classify (uploaded files | documents) → WORKER_DOCUMENT
- analyse / SWOT / OKRs / strategy / vision / market-entry-plan / positioning → WORKER_STRATEGIST
  • Note: STRATEGIST produces ANALYSIS prose, not executable documents. If the user wanted a polished deck or doc, add a WORKER_CONTENT task after.
- GTM plan / brand audit / campaign plan / SEO audit / social strategy → WORKER_MARKETING
  • For STRATEGY artifacts only. If the user wants actual campaign copy, pair with WORKER_CONTENT.
- architecture review / security audit / scalability analysis / tech-stack pick → WORKER_TECHNICAL
- post to LinkedIn / tweet / publish / send / email → first WORKER_CONTENT for the text, then the appropriate IO worker (EMAIL/GROWTH) with requiresApproval=true for the send.

If the ask clearly matches ONE verb, produce ONE task. Do not second-guess by adding a "research phase" or "strategy phase" — those belong to their own explicit asks.

ROUTING RULES (hard rules — follow exactly):
- "write / draft / create a <blog|post|tweet|newsletter|caption|script|press release|email copy|ad copy>" → WORKER_CONTENT. NOT WORKER_MARKETING. Marketing plans the campaign; Content writes the actual words.
- "write / build / fix / debug / refactor / generate <code|function|script|API|tests>" → WORKER_CODER. NOT WORKER_TECHNICAL. Technical does architecture review and tech-stack evaluation; Coder writes code.
- "build / create / generate a <landing page|website|web app|frontend|UI>" → WORKER_CODER for code generation. For multi-step app builds, the workflow kind is 'vibe-coder' and goes through WORKER_APP_ARCHITECT → WORKER_APP_GENERATOR → WORKER_APP_DEBUGGER → WORKER_APP_DEPLOYER; do NOT produce a normal plan for those — they use the Builder flow.
- "research / summarise / compare / analyse <public topic|competitor|market>" → WORKER_RESEARCH (prefers web_search + sources).
- "summarise / extract / compare <uploaded documents>" → WORKER_DOCUMENT (prefers find_document + uploaded files).
- "SWOT / OKRs / strategy / vision / market entry" → WORKER_STRATEGIST.
- "GTM / brand / campaign / SEO audit / social strategy" → WORKER_MARKETING (strategy), paired with WORKER_CONTENT (copy) when the deliverable is actual written words.
- "architecture / security audit / scalability / infrastructure / stack pick" → WORKER_TECHNICAL.
- "hire / JD / resume / offer letter / onboarding plan" → WORKER_HR.
- "lead gen / outreach / Reddit/Twitter engagement / email sequence / prospect list" → WORKER_GROWTH.
- "P&L / forecast / budget / valuation / burn / cashflow" → WORKER_FINANCE.
- "contract / NDA / privacy policy / compliance / regulation" → WORKER_LEGAL.

Every plan MUST produce at least one task whose output is concrete and user-facing. A plan for "write a LinkedIn post" that has only a STRATEGIST or MARKETING task is wrong — it MUST include a WORKER_CONTENT task that produces the actual post text.`;

export class PlannerAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.PLANNER, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<PlannerOutput> {
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

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(PLANNER_SUPPLEMENT),
      },
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

    const completion = await this.callLLM(messages, undefined, {
      maxTokens: 2048,
      temperature: 0.2,
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
    } catch (err) {
      this.logger.error({ err }, 'Failed to parse Planner LLM response, using fallback plan');
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

    // Deterministic routing override: the Planner LLM intermittently routes
    // "write a LinkedIn post" to WORKER_MARKETING (strategy) and "write code"
    // to WORKER_TECHNICAL (architect), despite the prompt. Post-process based
    // on keywords in the user's ORIGINAL goal. Keyword match wins over LLM
    // pick when there's a conflict.
    const goalLower = (missionBrief.goal ?? '').toLowerCase();
    const wantsContent = /\b(write|draft|compose|create|generate|produce|rewrite)\b.*\b(post|blog|article|tweet|linkedin|caption|thread|newsletter|press release|ad copy|landing copy|email copy|headline)/i.test(goalLower);
    const wantsCode = /\b(write|generate|build|create|fix|debug|refactor|review)\b.*\b(code|script|function|api|test|class|module|component)/i.test(goalLower)
      || /\bpython\s+script|\bnode\.?js\s+|\b(react|vue|svelte)\s+(component|app)/i.test(goalLower);
    const wantsSwot = /\bswot\b/i.test(goalLower);
    const wantsOkr = /\bokr[s]?\b/i.test(goalLower);
    const overridden: string[] = [];

    const rawTasks = parsed.tasks ?? [];
    const tasks: WorkflowTask[] = rawTasks.map((t, idx) => {
      const riskLevel = this.parseRiskLevel(t.riskLevel ?? 'LOW');
      const requiresApproval = t.requiresApproval ?? (riskLevel === RiskLevel.HIGH || riskLevel === RiskLevel.CRITICAL);

      let agentRole = t.agentRole ?? 'WORKER_OPS';
      // Hard override: "write a post" must go to WORKER_CONTENT, not MARKETING/STRATEGIST
      if (wantsContent && (agentRole === 'WORKER_MARKETING' || agentRole === 'WORKER_STRATEGIST' || agentRole === 'WORKER_PR')) {
        overridden.push(`${t.id}: ${agentRole}→WORKER_CONTENT (goal wants content)`);
        agentRole = 'WORKER_CONTENT';
      }
      // Hard override: "write code" must go to WORKER_CODER, not TECHNICAL
      if (wantsCode && (agentRole === 'WORKER_TECHNICAL' || agentRole === 'WORKER_DESIGNER' || agentRole === 'WORKER_APP_ARCHITECT')) {
        overridden.push(`${t.id}: ${agentRole}→WORKER_CODER (goal wants code)`);
        agentRole = 'WORKER_CODER';
      }
      // Hard override: "SWOT" must go to WORKER_STRATEGIST (not MARKETING)
      if ((wantsSwot || wantsOkr) && agentRole === 'WORKER_MARKETING') {
        overridden.push(`${t.id}: WORKER_MARKETING→WORKER_STRATEGIST (goal wants ${wantsSwot ? 'SWOT' : 'OKRs'})`);
        agentRole = 'WORKER_STRATEGIST';
      }

      return {
        id: t.id ?? `task_${idx + 1}`,
        name: t.name ?? `Task ${idx + 1}`,
        description: t.description ?? '',
        agentRole: this.parseAgentRole(agentRole),
        toolsRequired: t.toolsRequired ?? [],
        riskLevel,
        requiresApproval,
        status: TaskStatus.PENDING,
        dependsOn: t.dependsOn ?? [],
        retryable: t.retryable ?? (riskLevel === RiskLevel.LOW || riskLevel === RiskLevel.MEDIUM),
        maxRetries: t.maxRetries ?? 2,
      };
    });

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

    const trace = this.recordTrace(context, input, output, [], startedAt);
    if (completion.usage) {
      trace.tokenUsage = {
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
      };
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
}
