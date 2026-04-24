import type { AgentTrace, SubscriptionTier } from '@jak-swarm/shared';
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
      durationMs: number;
      /** Truncated output summary; `_notice` / `_warning` / mock flags surfaced honestly. */
      outputSummary: string;
      error?: string;
      timestamp: string;
    }
  | {
      type: 'cost_updated';
      agentRole: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
      costUsd: number;
      timestamp: string;
    };

/**
 * Callback the runtime can wire to route activity events to the client
 * SSE stream. Optional — if unset, BaseAgent silently skips emission
 * (no extra cost, no behavior change for legacy callers).
 */
export type AgentActivityEmitter = (event: AgentActivityEvent) => void;

export interface AgentContextParams {
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
}

export class AgentContext {
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
  readonly subscriptionTier: SubscriptionTier | undefined;
  readonly onActivity: AgentActivityEmitter | undefined;
  private steps: AgentTrace[] = [];

  constructor(params: AgentContextParams) {
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
    this.subscriptionTier = params.subscriptionTier;
    this.onActivity = params.onActivity;
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

  clone(overrides?: Partial<AgentContextParams>): AgentContext {
    return new AgentContext({
      traceId: this.traceId,
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
      subscriptionTier: this.subscriptionTier,
      ...(this.onActivity ? { onActivity: this.onActivity } : {}),
      ...overrides,
    });
  }
}
