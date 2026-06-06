import type { AgentTrace, SubscriptionTier, ToolOutcome } from '@jak-swarm/shared';
import { generateId, generateTraceId } from '@jak-swarm/shared';
import type { ToolCategory } from '@jak-swarm/shared';

/**
 * Real-time activity events BaseAgent emits during tool loops + LLM calls.
 * Wired by the workflow runtime (swarm-graph / LangGraph) so the client
 * SSE stream can show live tool-call + cost events in the chat cockpit.
 *
 * Stage 2 of the agent-run-cockpit audit (qa/client-agent-visibility-audit.md).
 */
export type AgentActivityEvent =
  | {
      type: 'tool_called';
      agentRole: string;
      toolName: string;
      /** Truncated, serializable input summary (<= 500 chars). */
      inputSummary: string;
      timestamp: string;
    }
  | {
      type: 'tool_completed';
      agentRole: string;
      toolName: string;
      success: boolean;
      /**
       * Honest outcome from the tool registry — `real_success` / `draft_created`
       * / `mock_provider` / `not_configured` / `blocked_requires_config` /
       * `failed`. The cockpit reads this directly to render the status badge
       * instead of guessing from substrings in outputSummary. Optional only
       * for backwards compatibility with old emit sites; new code always sets it.
       */
      outcome?: ToolOutcome;
      durationMs: number;
      /** Truncated output summary; `_notice` / `_warning` / mock flags surfaced honestly. */
      outputSummary: string;
      error?: string;
      timestamp: string;
    }
  | {
      type: 'cost_updated';
      agentRole: string;
      /** Runtime that produced the call ('openai-responses' | 'legacy' | 'langgraph-shim'). */
      runtime?: string;
      /** Resolved model name (e.g. 'gpt-5.4'). */
      model: string;
      promptTokens: number;
      completionTokens: number;
      /** Sum of prompt + completion tokens (mirrors OpenAI usage.total_tokens). */
      totalTokens?: number;
      /**
       * Sprint 2.2 / Item I — number of input tokens served from OpenAI
       * prompt cache. When set, indicates the cached portion of
       * promptTokens (cachedReadTokens <= promptTokens). costUsd already
       * reflects the discount; this field is for cockpit visibility.
       */
      cachedReadTokens?: number;
      /** Sprint 2.2 / Item I — reasoning tokens (o-series models). */
      reasoningTokens?: number;
      /**
       * Sprint 2.4 / Item G — PII redaction stats for this LLM call.
       * Only set when at least one PII match was found + replaced. The
       * cockpit shows a "PII redacted" badge with the totals.
       * Keys are PIIType strings ('EMAIL', 'PHONE', etc.).
       */
      piiRedacted?: {
        /** Per-type match count. Empty type-keys mean that type was not seen. */
        byType: Record<string, number>;
        /** Total match instances detected (includes duplicates). */
        totalMatches: number;
        /** Distinct placeholders generated (de-duplicated values). */
        uniquePlaceholders: number;
      };
      costUsd: number;
      /** Run id (the workflow id at top level). */
      runId?: string;
      /** Step id within the workflow — usually the agent role doing this call. */
      stepId?: string;
      timestamp: string;
    }
  // Sprint 2.1 / Item K — Router emits one of these per task → agentRole
  // mapping it produced. The swarm-execution.service.ts onAgentActivity
  // handler translates each to a workflow-lifecycle `agent_assigned` event
  // for the cockpit + AuditLog.
  | {
      type: 'agent_assigned';
      taskId: string;
      taskName?: string;
      agentRole: string;
      /** Optional reason the Router chose this agent (verb match, fallback, etc.) */
      routingReason?: string;
      timestamp: string;
    }
  // Sprint 2.1 / Item K — Verifier emits these at entry / exit so the
  // cockpit shows a dedicated verification panel rather than inferring
  // from `step_started`/`step_completed` with agentRole='VERIFIER'.
  | {
      type: 'verification_started';
      taskId: string;
      taskName?: string;
      timestamp: string;
    }
  | {
      type: 'verification_completed';
      taskId: string;
      taskName?: string;
      passed: boolean;
      /** 0-1; the Verifier's confidence in its judgment (heuristic-grounded today). */
      groundingScore?: number;
      /** Issues array length when passed=false. */
      issueCount?: number;
      timestamp: string;
    }
  // Sprint 2.2 / Item H — emitted when the worker-node compresses
  // accumulated state.taskResults before building the agent input.
  // The cockpit shows a "context compressed" badge so users see why a
  // long-running workflow's later steps may reference summarized inputs.
  | {
      type: 'context_summarized';
      taskId: string;
      taskName?: string;
      /** How many task results existed in state before summarization. */
      inputTaskResultCount: number;
      /** Heuristic token count before compression (word*1.33 / chars/4 mix). */
      estimatedTokensBefore: number;
      /** Heuristic token count after compression. */
      estimatedTokensAfter: number;
      timestamp: string;
    }
  // Phase 4 follow-up — emitted by BaseAgent.executeWithTools when
  // ToolRegistry.execute returns outcome:'approval_required'. The
  // worker-node / API layer subscribes and (a) creates an
  // ApprovalRequest row for the user, (b) pauses the workflow at
  // AWAITING_APPROVAL, (c) re-issues the tool call once approved with
  // approvalId in context. The chokepoint is the tool registry; this
  // event is the contract between the agent and the API layer.
  | {
      type: 'tool_approval_required';
      agentRole: string;
      /** Internal tool name (the executor that was blocked). */
      toolName: string;
      /** ToolActionCategory from the centralized policy: SAFE_READ /
       *  WRITE / EXTERNAL_POST / DESTRUCTIVE / CREDENTIAL / INSTALL. */
      category: string;
      /** Layman-friendly reason the gate fired. */
      reason: string;
      /** Truncated proposed input — same shape as inputSummary above. */
      inputSummary: string;
      /** Hash of the proposed input for ApprovalRequest payload binding. */
      proposedDataHash?: string;
      timestamp: string;
    };

/**
 * Callback the runtime can wire to route activity events to the client
 * SSE stream. Optional — if unset, BaseAgent silently skips emission
 * (no extra cost, no behavior change for legacy callers).
 */
export type AgentActivityEmitter = (event: AgentActivityEvent) => void;

export interface AgentLLMUsage {
  runtime?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  costUsd: number;
  timestamp: string;
}

export interface AgentContextParams {
  agentRole?: string;
  traceId?: string;
  runId?: string;
  tenantId: string;
  userId: string;
  workflowId: string;
  industry?: string;
  approvalId?: string;
  idempotencyKey?: string;
  connectedProviders?: string[];
  browserAutomationEnabled?: boolean;
  allowedDomains?: string[];
  restrictedCategories?: ToolCategory[];
  disabledToolNames?: string[];
  /**
   * Item C (OpenClaw-inspired Phase 1) — StandingOrder allowedTools
   * whitelist. When set AND non-empty, ONLY the named tools are
   * permitted regardless of any other allow signal. When empty/unset,
   * the registry falls back to the default-allow + blocklist semantics.
   * Plumbed from `WorkflowExecuteParams.allowedToolNames` (set by the
   * scheduler when a StandingOrder is active).
   */
  allowedToolNames?: string[];
  /**
   * Coarse plan tier for gating paid external services. Propagated to every
   * ToolExecutionContext the agent creates so search adapters can pick
   * between the paid Serper/Tavily chain vs the free DDG fallback.
   */
  subscriptionTier?: SubscriptionTier;
  /**
   * Real-time event emitter wired by the workflow runtime. When set,
   * BaseAgent calls it on every tool start/end + LLM cost event so the
   * client SSE feed shows live activity. Optional — legacy callers who
   * don't set it get identical behavior to before.
   */
  onActivity?: AgentActivityEmitter;
  /**
   * Per-tenant LLM provider preference. When set, the agent should
   * use this provider instead of the process.env default. Values:
   * 'openai' | 'gemini'. Undefined = use env-var default.
   */
  llmProvider?: 'openai' | 'gemini';
  /**
   * Per-tenant decrypted API key for the selected provider.
   * When set, overrides the process.env key. Resolved from
   * TenantMemory at workflow-start time by swarm-execution.service.ts.
   */
  llmApiKey?: string;
  /**
   * Enable Google Search grounding for Gemini (adds { googleSearch: {} } to tools).
   * Only effective when llmProvider='gemini'. Ignored for OpenAI.
   * Falls back to GEMINI_GOOGLE_SEARCH_GROUNDING env var when unset.
   */
  googleSearchGrounding?: boolean;
  /**
   * Vertex AI Search datastore path for Gemini (e.g. "projects/.../dataStores/...").
   * Only effective when llmProvider='gemini'. Ignored for OpenAI.
   * Falls back to GEMINI_VERTEX_AI_SEARCH_DATASTORE env var when unset.
   */
  vertexAISearchDatastore?: string;
  /**
   * Enable OpenAI's hosted web_search tool. Provides real-time web access
   * natively without Serper/Tavily. Mirrors Gemini's Google Search grounding.
   * Only effective when llmProvider='openai'. Ignored for Gemini.
   * Falls back to OPENAI_WEB_SEARCH env var when unset.
   */
  openaiWebSearch?: boolean;
}

export class AgentContext {
  readonly agentRole: string | undefined;
  readonly traceId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workflowId: string;
  readonly industry: string | undefined;
  readonly approvalId: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly connectedProviders: string[];
  readonly browserAutomationEnabled: boolean;
  readonly allowedDomains: string[];
  readonly restrictedCategories: ToolCategory[];
  readonly disabledToolNames: string[];
  readonly allowedToolNames: string[];
  readonly subscriptionTier: SubscriptionTier | undefined;
  readonly onActivity: AgentActivityEmitter | undefined;
  readonly llmProvider: 'openai' | 'gemini' | undefined;
  readonly llmApiKey: string | undefined;
  readonly googleSearchGrounding: boolean | undefined;
  readonly vertexAISearchDatastore: string | undefined;
  readonly openaiWebSearch: boolean | undefined;
  private steps: AgentTrace[] = [];
  private llmUsages: AgentLLMUsage[] = [];

  constructor(params: AgentContextParams) {
    this.agentRole = params.agentRole;
    this.traceId = params.traceId ?? generateTraceId();
    this.runId = params.runId ?? generateId('run_');
    this.tenantId = params.tenantId;
    this.userId = params.userId;
    this.workflowId = params.workflowId;
    this.industry = params.industry;
    this.approvalId = params.approvalId;
    this.idempotencyKey = params.idempotencyKey;
    this.connectedProviders = params.connectedProviders ?? [];
    this.browserAutomationEnabled = params.browserAutomationEnabled ?? false;
    this.allowedDomains = params.allowedDomains ?? [];
    this.restrictedCategories = params.restrictedCategories ?? [];
    this.disabledToolNames = params.disabledToolNames ?? [];
    this.allowedToolNames = params.allowedToolNames ?? [];
    this.subscriptionTier = params.subscriptionTier;
    this.onActivity = params.onActivity;
    this.llmProvider = params.llmProvider;
    this.llmApiKey = params.llmApiKey;
    this.googleSearchGrounding = params.googleSearchGrounding;
    this.vertexAISearchDatastore = params.vertexAISearchDatastore;
    this.openaiWebSearch = params.openaiWebSearch;
  }

  /** Safe activity-emit helper — swallows errors so emission never breaks agent execution. */
  emitActivity(event: AgentActivityEvent): void {
    if (!this.onActivity) return;
    try {
      this.onActivity(event);
    } catch { /* emission failure must never break the agent */ }
  }

  addTrace(trace: AgentTrace): void {
    this.steps.push(trace);
  }

  getTraces(): AgentTrace[] {
    return [...this.steps];
  }

  recordLLMUsage(usage: AgentLLMUsage): void {
    this.llmUsages.push(usage);
  }

  getLLMUsages(): AgentLLMUsage[] {
    return [...this.llmUsages];
  }

  getLLMUsageSummary(): Pick<AgentLLMUsage, 'promptTokens' | 'completionTokens' | 'totalTokens' | 'costUsd'> | undefined {
    if (this.llmUsages.length === 0) return undefined;
    return this.llmUsages.reduce(
      (acc, usage) => ({
        promptTokens: acc.promptTokens + usage.promptTokens,
        completionTokens: acc.completionTokens + usage.completionTokens,
        totalTokens: acc.totalTokens + usage.totalTokens,
        costUsd: acc.costUsd + usage.costUsd,
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
    );
  }

  clone(overrides?: Partial<AgentContextParams>): AgentContext {
    return new AgentContext({
      traceId: this.traceId,
      agentRole: this.agentRole,
      runId: this.runId,
      tenantId: this.tenantId,
      userId: this.userId,
      workflowId: this.workflowId,
      industry: this.industry,
      approvalId: this.approvalId,
      idempotencyKey: this.idempotencyKey,
      connectedProviders: this.connectedProviders,
      browserAutomationEnabled: this.browserAutomationEnabled,
      allowedDomains: this.allowedDomains,
      restrictedCategories: this.restrictedCategories,
      disabledToolNames: this.disabledToolNames,
      allowedToolNames: this.allowedToolNames,
      subscriptionTier: this.subscriptionTier,
      ...(this.onActivity ? { onActivity: this.onActivity } : {}),
      ...(this.llmProvider ? { llmProvider: this.llmProvider } : {}),
      ...(this.llmApiKey ? { llmApiKey: this.llmApiKey } : {}),
      ...(this.googleSearchGrounding !== undefined ? { googleSearchGrounding: this.googleSearchGrounding } : {}),
      ...(this.vertexAISearchDatastore !== undefined ? { vertexAISearchDatastore: this.vertexAISearchDatastore } : {}),
      ...(this.openaiWebSearch !== undefined ? { openaiWebSearch: this.openaiWebSearch } : {}),
      ...overrides,
    });
  }
}
