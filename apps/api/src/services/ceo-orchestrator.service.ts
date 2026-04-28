/**
 * CEOOrchestratorService — Final hardening / Gap A.
 *
 * Top-level orchestrator that wraps the standard workflow pipeline with
 * the "executive experience" — Company Brain context loading, executive-
 * function tagging (CMO/CTO/CFO/COO), and an LLM-generated executive
 * summary at the end.
 *
 * It is NOT a new agent. It composes existing services:
 *   1. Loads CompanyProfile (Company Brain) + emits `ceo_context_loaded`
 *   2. Detects intent + executive functions needed + emits `ceo_goal_understood`
 *      and `ceo_workflow_selected`
 *   3. Surfaces missing inputs as `ceo_blocker_detected` events
 *   4. Hands off to the standard workflow runtime (which runs Commander/
 *      Planner/Router/Workers/Verifier through LangGraph)
 *   5. After workflow completes, generates an executive summary via LLM
 *      and emits `ceo_final_summary_generated`
 *
 * Honesty rules:
 *   - If no CompanyProfile exists, `ceo_context_loaded` reports
 *     `profileStatus: 'missing'` with empty fields. NEVER fabricate.
 *   - If executive summary generation fails (no API key, LLM error),
 *     emits `ceo_final_summary_generated` with summary= explicit error
 *     message; never silent-passes.
 *   - The CEO experience is gated: the caller passes `mode: 'ceo'` OR
 *     the goal text matches CEO trigger phrases. Without that, the
 *     standard workflow runs without CEO wrapping.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import type { WorkflowLifecycleEmitter } from '@jak-swarm/swarm';
import type { Industry } from '@jak-swarm/shared';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CEOContext {
  workflowId: string;
  tenantId: string;
  userId: string;
  goal: string;
  industry?: Industry;
  /** Lifecycle emitter for ceo_* events (and pass-through to workflow events). */
  onLifecycle?: WorkflowLifecycleEmitter;
}

export interface CEOPreFlightResult {
  /** Whether the request triggers CEO wrapping (vs standard workflow). */
  isCEOMode: boolean;
  /** Detected primary intent (e.g. 'business_review', 'company_audit'). */
  intent: string;
  intentConfidence: number | null;
  /** Which executive functions are likely needed. */
  executiveFunctions: ExecutiveFunction[];
  /** Agent roles to involve (mapped from executive functions). */
  agentRoles: string[];
  /** Workflow label the CEO has chosen for this goal. */
  workflow: string;
  /** Missing CompanyProfile fields the CEO flagged. */
  blockers: string[];
  /** CompanyProfile fields actually loaded (empty when no profile). */
  profileFieldsLoaded: string[];
  /** Status of the CompanyProfile lookup. */
  profileStatus: 'user_approved' | 'manual' | 'extracted' | 'missing';
}

export interface CEOSummaryInput {
  workflowId: string;
  tenantId: string;
  goal: string;
  intent: string;
  executiveFunctions: ExecutiveFunction[];
  /** Final outputs from the workflow (worker.execute results). */
  outputs: unknown[];
  /** Final status (COMPLETED / FAILED / etc). */
  status: string;
  /** Workflow error if any. */
  error?: string;
  durationMs: number;
}

export interface CEOSummaryResult {
  summary: string;
  nextActions: string[];
  /** Honest error when summary generation failed. */
  generationError?: string;
}

export type ExecutiveFunction = 'CEO' | 'CMO' | 'CTO' | 'CFO' | 'COO';

// ─── CEO trigger detection ────────────────────────────────────────────────

// Order matters: more-specific patterns first. The first match wins.
const CEO_TRIGGER_PATTERNS: Array<{ pattern: RegExp; intent: string; functions: ExecutiveFunction[] }> = [
  {
    // Specific: website improvement (must come before broader business-review)
    pattern: /\b(review|audit)\s+(?:my\s+)?(?:company\s+)?website/i,
    intent: 'website_improvement',
    functions: ['CEO', 'CMO'],
  },
  {
    // Specific: audit/compliance documents
    pattern: /\b(audit|compliance)\s+(?:these\s+)?(documents|workpapers|controls)/i,
    intent: 'audit_compliance_workflow',
    functions: ['CEO', 'CFO'],
  },
  {
    // Specific: function-owner request (run my company marketing)
    pattern: /\b(run my (?:company|business)'?s?)\s+(marketing|sales|operations|finance)/i,
    intent: 'function_owner_request',
    functions: ['CMO'],
  },
  {
    // Broad: act as CEO/CMO/etc
    pattern: /\b(act as|as my)\s+(ceo|cmo|cto|cfo|coo)/i,
    intent: 'business_review',
    functions: ['CEO', 'CMO', 'CTO', 'CFO', 'COO'],
  },
  {
    // Broad: review my company/business
    pattern: /\b(review my (?:business|company))/i,
    intent: 'business_review',
    functions: ['CEO', 'CMO', 'CTO', 'CFO'],
  },
  {
    pattern: /\b(business|strategic)\s+(plan|planning|review|audit)/i,
    intent: 'strategic_planning',
    functions: ['CEO', 'CFO', 'COO'],
  },
  {
    pattern: /\bnext steps?\b.*\b(company|business)/i,
    intent: 'strategic_planning',
    functions: ['CEO', 'CMO', 'CTO', 'CFO', 'COO'],
  },
  {
    pattern: /\b(quarterly|weekly|monthly)\s+(plan|planning|review)/i,
    intent: 'periodic_planning',
    functions: ['CEO', 'COO'],
  },
];

const FUNCTION_TO_AGENT_ROLE: Record<ExecutiveFunction, string> = {
  CEO: 'WORKER_STRATEGIST',
  CMO: 'WORKER_MARKETING',
  CTO: 'WORKER_TECHNICAL',
  CFO: 'WORKER_FINANCE',
  COO: 'WORKER_OPS',
};

/**
 * Detect whether a goal triggers CEO wrapping. Returns the detected
 * intent + executive functions + agent roles, OR `isCEOMode: false`
 * when the goal doesn't match any CEO trigger.
 *
 * Pure function — no I/O, no LLM. Safe to call cheaply on every
 * incoming workflow request.
 */
export function detectCEOTrigger(goal: string, explicitMode?: 'ceo' | undefined): {
  isCEOMode: boolean;
  intent: string;
  executiveFunctions: ExecutiveFunction[];
  agentRoles: string[];
  workflow: string;
} {
  if (explicitMode === 'ceo') {
    return {
      isCEOMode: true,
      intent: 'ceo_explicit_mode',
      executiveFunctions: ['CEO', 'CMO', 'CTO', 'CFO', 'COO'],
      agentRoles: ['WORKER_STRATEGIST', 'WORKER_MARKETING', 'WORKER_TECHNICAL', 'WORKER_FINANCE', 'WORKER_OPS'],
      workflow: 'ceo_explicit',
    };
  }
  for (const trig of CEO_TRIGGER_PATTERNS) {
    if (trig.pattern.test(goal)) {
      const functions = Array.from(new Set(trig.functions));
      const agentRoles = functions.map((f) => FUNCTION_TO_AGENT_ROLE[f]);
      return {
        isCEOMode: true,
        intent: trig.intent,
        executiveFunctions: functions,
        agentRoles,
        workflow: trig.intent,
      };
    }
  }
  return {
    isCEOMode: false,
    intent: 'general',
    executiveFunctions: [],
    agentRoles: [],
    workflow: 'standard',
  };
}

// ─── CompanyProfile field discovery ────────────────────────────────────────

const REQUIRED_PROFILE_FIELDS_BY_FUNCTION: Record<ExecutiveFunction, string[]> = {
  CEO: ['name', 'industry', 'description'],
  CMO: ['brandVoice', 'targetCustomers', 'preferredChannels'],
  CTO: ['websiteUrl'],
  CFO: ['pricing'],
  COO: ['constraints'],
};

function detectMissingFields(
  profile: Record<string, unknown> | null,
  functions: ExecutiveFunction[],
): { missing: string[]; loaded: string[] } {
  const required = new Set<string>();
  for (const f of functions) {
    for (const field of REQUIRED_PROFILE_FIELDS_BY_FUNCTION[f]) {
      required.add(field);
    }
  }
  const missing: string[] = [];
  const loaded: string[] = [];
  for (const field of required) {
    const value = profile?.[field];
    const present = value !== null && value !== undefined && (typeof value !== 'string' || value.trim().length > 0);
    if (present) loaded.push(field);
    else missing.push(field);
  }
  return { missing, loaded };
}

// ─── Service ───────────────────────────────────────────────────────────────

export class CEOOrchestratorService {
  constructor(
    private readonly db: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Run the CEO pre-flight phase: detect CEO mode, load Company Brain,
   * identify executive functions + missing inputs, emit ceo_* lifecycle
   * events. Returns a CEOPreFlightResult the caller uses to enrich the
   * workflow start request.
   *
   * This phase happens BEFORE the workflow runtime starts, so the
   * `workflowId` passed in must be the id under which the workflow will
   * start; lifecycle events are tagged with it.
   */
  async preFlight(
    ctx: CEOContext,
    options: { explicitMode?: 'ceo' } = {},
  ): Promise<CEOPreFlightResult> {
    const trigger = detectCEOTrigger(ctx.goal, options.explicitMode);

    // 1. ceo_goal_understood — emitted regardless of CEO mode so the
    //    audit log captures the trigger detection result for every
    //    workflow.
    this.emit(ctx, {
      type: 'ceo_goal_understood',
      workflowId: ctx.workflowId,
      goal: ctx.goal,
      intent: trigger.intent,
      intentConfidence: trigger.isCEOMode ? 0.85 : null,
      timestamp: new Date().toISOString(),
    });

    if (!trigger.isCEOMode) {
      return {
        isCEOMode: false,
        intent: trigger.intent,
        intentConfidence: null,
        executiveFunctions: [],
        agentRoles: [],
        workflow: trigger.workflow,
        blockers: [],
        profileFieldsLoaded: [],
        profileStatus: 'missing',
      };
    }

    // 2. ceo_context_loaded — load CompanyProfile honestly.
    let profile: Record<string, unknown> | null = null;
    let profileStatus: CEOPreFlightResult['profileStatus'] = 'missing';
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (this.db as any).companyProfile.findFirst({
        where: { tenantId: ctx.tenantId, status: { in: ['user_approved', 'manual'] } },
        orderBy: { updatedAt: 'desc' },
      });
      if (row) {
        profile = row as Record<string, unknown>;
        profileStatus = (row.status as CEOPreFlightResult['profileStatus']) ?? 'missing';
      } else {
        // Look at any profile (including extracted-but-not-approved) so we
        // can honestly report what exists vs what's approved.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyRow = await (this.db as any).companyProfile.findFirst({
          where: { tenantId: ctx.tenantId },
          orderBy: { updatedAt: 'desc' },
        });
        if (anyRow) {
          profile = anyRow as Record<string, unknown>;
          profileStatus = (anyRow.status as CEOPreFlightResult['profileStatus']) ?? 'extracted';
        }
      }
    } catch (err) {
      // Schema not present — Migration 16 may not have run. Honest log.
      this.logger?.warn?.(
        { tenantId: ctx.tenantId, err: err instanceof Error ? err.message : String(err) },
        '[CEOOrchestrator] CompanyProfile lookup failed; proceeding with profileStatus=missing',
      );
    }

    const { missing, loaded } = detectMissingFields(profile, trigger.executiveFunctions);

    this.emit(ctx, {
      type: 'ceo_context_loaded',
      workflowId: ctx.workflowId,
      profileFieldsLoaded: loaded,
      profileStatus,
      timestamp: new Date().toISOString(),
    });

    // 3. ceo_workflow_selected
    this.emit(ctx, {
      type: 'ceo_workflow_selected',
      workflowId: ctx.workflowId,
      workflow: trigger.workflow,
      timestamp: new Date().toISOString(),
    });

    // 4. ceo_agents_assigned
    this.emit(ctx, {
      type: 'ceo_agents_assigned',
      workflowId: ctx.workflowId,
      executiveFunctions: trigger.executiveFunctions,
      agentRoles: trigger.agentRoles,
      timestamp: new Date().toISOString(),
    });

    // 5. ceo_blocker_detected — once per blocker so the cockpit can
    //    render an explicit "missing inputs" panel.
    if (missing.length > 0) {
      this.emit(ctx, {
        type: 'ceo_blocker_detected',
        workflowId: ctx.workflowId,
        blocker: profileStatus === 'missing'
          ? 'No approved CompanyProfile for this tenant — agents will operate without company context.'
          : `CompanyProfile is missing fields required by selected executive functions: ${missing.join(', ')}.`,
        missingFields: missing,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      isCEOMode: true,
      intent: trigger.intent,
      intentConfidence: 0.85,
      executiveFunctions: trigger.executiveFunctions,
      agentRoles: trigger.agentRoles,
      workflow: trigger.workflow,
      blockers: missing,
      profileFieldsLoaded: loaded,
      profileStatus,
    };
  }

  /**
   * Generate the executive summary after the workflow completes.
   * Emits `ceo_final_summary_generated`. When LLM is unavailable or
   * fails, emits the same event with an explicit error message in
   * `summary` — NEVER silent-fabricates.
   */
  async generateExecutiveSummary(
    input: CEOSummaryInput,
    onLifecycle?: WorkflowLifecycleEmitter,
  ): Promise<CEOSummaryResult> {
    const startedAt = Date.now();
    let result: CEOSummaryResult;
    try {
      result = await this.callLLMSummary(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn?.(
        { workflowId: input.workflowId, err: msg },
        '[CEOOrchestrator] Executive summary generation failed; surfacing honest error',
      );
      result = {
        summary: `Executive summary unavailable: ${msg}. Workflow finished with status ${input.status}.`,
        nextActions: [],
        generationError: msg,
      };
    }

    const durationMs = Date.now() - startedAt;
    if (onLifecycle) {
      try {
        onLifecycle({
          type: 'ceo_final_summary_generated',
          workflowId: input.workflowId,
          summary: result.summary,
          nextActions: result.nextActions,
          durationMs,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Telemetry must not break flow.
      }
    }
    return result;
  }

  /**
   * LLM call for executive summary. Uses OpenAIRuntime via dynamic
   * import to avoid pulling agents into the apps/api compile graph.
   * When OPENAI_API_KEY is missing, throws — the caller surfaces the
   * honest error in `generationError`.
   */
  private async callLLMSummary(input: CEOSummaryInput): Promise<CEOSummaryResult> {
    if (!process.env['OPENAI_API_KEY']) {
      throw new Error('OPENAI_API_KEY not set — executive summary requires LLM access.');
    }
    const { OpenAIRuntime } = await import('@jak-swarm/agents');
    const { AgentContext } = await import('@jak-swarm/agents');
    const { z } = await import('zod');

    const summarySchema = z.object({
      summary: z.string().min(20).max(2000),
      nextActions: z.array(z.string().min(5).max(300)).max(8),
    });

    const runtime = new OpenAIRuntime({ tier: 2 });
    const context = new AgentContext({
      tenantId: input.tenantId,
      userId: 'ceo-summary',
      workflowId: input.workflowId,
    });

    const outputsPreview = input.outputs
      .map((o, i) => `${i + 1}. ${typeof o === 'string' ? o.slice(0, 500) : JSON.stringify(o).slice(0, 500)}`)
      .join('\n');

    const messages = [
      {
        role: 'system' as const,
        content:
          `You are the CEO of a company using JAK Swarm to run autonomous work. ` +
          `A workflow just completed. Write an honest executive summary (3-6 sentences) ` +
          `describing what was accomplished and ANY caveats. Then list 1-5 concrete next actions ` +
          `the human owner should take. Be specific. Never fabricate metrics. ` +
          `If the workflow failed, say so plainly.`,
      },
      {
        role: 'user' as const,
        content:
          `Goal: ${input.goal}\n` +
          `Intent: ${input.intent}\n` +
          `Executive functions involved: ${input.executiveFunctions.join(', ')}\n` +
          `Final status: ${input.status}\n` +
          (input.error ? `Error: ${input.error}\n` : '') +
          `Duration: ${(input.durationMs / 1000).toFixed(1)}s\n\n` +
          `Outputs from worker agents (first 500 chars each):\n${outputsPreview || '(none)'}\n\n` +
          `Respond with JSON: { "summary": "...", "nextActions": ["...", ...] }`,
      },
    ];

    const result = await runtime.respondStructured(
      messages,
      summarySchema,
      { schemaName: 'ExecutiveSummary', maxTokens: 1024, temperature: 0.3 },
      context,
    );
    return { summary: result.summary, nextActions: result.nextActions };
  }

  // ─── Telemetry helper ──────────────────────────────────────────────────

  private emit(ctx: CEOContext, event: Parameters<NonNullable<CEOContext['onLifecycle']>>[0]): void {
    if (!ctx.onLifecycle) return;
    try {
      ctx.onLifecycle(event);
    } catch {
      // Telemetry must never break the orchestrator path.
    }
  }
}
