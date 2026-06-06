import type {
  AgentTrace,
  ApprovalRequest,
  WorkflowStatus,
} from '@jak-swarm/shared';
import { WorkflowStatus as WS } from '@jak-swarm/shared';
import type { ToolCategory } from '@jak-swarm/shared';
import type { MissionBrief } from '@jak-swarm/agents';
import type { WorkflowPlan } from '@jak-swarm/shared';
import type { RouteMap } from '@jak-swarm/agents';
import type { GuardrailResult } from '@jak-swarm/agents';
import type { VerificationResult } from '@jak-swarm/agents';

export interface SwarmState {
  // Input
  goal: string;
  tenantId: string;
  userId: string;
  workflowId: string;
  industry: string | undefined;
  roleModes: string[];
  idempotencyKey?: string;
  /** Conversation thread history — injected by the backend so the graph
   *  replays with full context instead of an isolated goal string. */
  conversationHistory?: Array<{ role: string; content: string }>;

  // Commander output
  missionBrief: MissionBrief | undefined;
  clarificationNeeded: boolean;
  clarificationQuestion: string | undefined;

  // Planner output
  plan: WorkflowPlan | undefined;

  // Router output
  routeMap: RouteMap | undefined;

  // Execution state
  currentTaskIndex: number;
  taskResults: Record<string, unknown>;
  pendingApprovals: ApprovalRequest[];

  // Guardrail state
  guardrailResult: GuardrailResult | undefined;
  blocked: boolean;

  // Verifier state
  verificationResults: Record<string, VerificationResult>;

  // Parallel execution state
  completedTaskIds?: string[];
  failedTaskIds?: string[];

  // Per-task retry counter: taskId → number of retries attempted
  taskRetryCount: Record<string, number>;

  // Cost tracking
  accumulatedCostUsd: number;
  maxCostUsd?: number;

  // Auto-approval policy.
  //
  // Default policy: every task routed to the approval node pauses at
  // WorkflowStatus.AWAITING_APPROVAL until an operator decides via
  // POST /approvals/:id/decide. Tenants that want lower-risk tasks to
  // skip human review must explicitly set `autoApproveEnabled = true`
  // AND configure an `approvalThreshold` (LOW | MEDIUM | HIGH | CRITICAL).
  //
  // Tasks with risk BELOW that threshold auto-approve; everything at-or-above
  // the threshold still pauses. This keeps landing-page claims ("human
  // approval on high-risk actions") structurally honest: the gate is
  // blocking by default, opt-in-bypass by tenant choice.
  autoApproveEnabled?: boolean;
  approvalThreshold?: string;

  // Tenant browser config
  allowedDomains: string[];
  browserAutomationEnabled: boolean;
  restrictedCategories: ToolCategory[];
  disabledToolNames: string[];
  /**
   * Item C (OpenClaw-inspired Phase 1) — StandingOrder allowedTools
   * whitelist. Non-empty = strict whitelist (only these tools allowed
   * regardless of any other policy). Empty = no whitelist (default-
   * allow + blocklist via disabledToolNames). Plumbed from the
   * scheduler when a StandingOrder is active for the run.
   */
  allowedToolNames: string[];
  connectedProviders: string[];
  /**
   * Coarse plan tier for gating paid external services (Serper, Tavily).
   * Populated from Subscription.maxModelTier at workflow creation.
   * 'free' forces DDG-only search; 'paid' or undefined allows full chain.
   */
  subscriptionTier?: 'free' | 'paid';
  /**
   * User role for privilege-aware routing. TENANT_ADMIN bypasses industry
   * pack restrictions so visible roles (CEO, CTO, etc.) can use the full
   * toolset on the landing page and in demos.
   */
  userRole?: string;

  // Final state
  status: WorkflowStatus;
  error: string | undefined;
  outputs: unknown[];
  traces: AgentTrace[];
  /**
   * Short-circuit answer produced by the Commander for trivial inputs
   * (greetings, simple factual questions). When set, the swarm graph
   * routes straight to __end__ and the swarm-execution service uses
   * this as the workflow's finalOutput — the Planner/Router/Workers
   * never run.
   */
  directAnswer?: string;
  /**
   * Per-tenant LLM provider preference. Loaded from TenantMemory
   * at workflow start by swarm-execution.service.ts. Propagated
   * to AgentContext for runtime provider selection.
   * 'openai' | 'gemini'. Undefined = use env-var default.
   */
  llmProvider?: 'openai' | 'gemini';
  /**
   * Enable Google Search grounding for Gemini. Falls back to
   * GEMINI_GOOGLE_SEARCH_GROUNDING env var when unset.
   */
  googleSearchGrounding?: boolean;
  /**
   * Vertex AI Search datastore path for Gemini.
   * Falls back to GEMINI_VERTEX_AI_SEARCH_DATASTORE env var when unset.
   */
  vertexAISearchDatastore?: string;
  /** Enable OpenAI's hosted web_search tool. Falls back to env var. */
  openaiWebSearch?: boolean;
}

export function createInitialSwarmState(params: {
  goal: string;
  tenantId: string;
  userId: string;
  workflowId: string;
  industry?: string;
  roleModes?: string[];
  idempotencyKey?: string;
  maxCostUsd?: number;
  autoApproveEnabled?: boolean;
  approvalThreshold?: string;
  allowedDomains?: string[];
  browserAutomationEnabled?: boolean;
  restrictedCategories?: ToolCategory[];
  disabledToolNames?: string[];
  allowedToolNames?: string[];
  connectedProviders?: string[];
  subscriptionTier?: 'free' | 'paid';
  userRole?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  llmProvider?: 'openai' | 'gemini';
  googleSearchGrounding?: boolean;
  vertexAISearchDatastore?: string;
  openaiWebSearch?: boolean;
}): SwarmState {
  return {
    goal: params.goal,
    tenantId: params.tenantId,
    userId: params.userId,
    workflowId: params.workflowId,
    industry: params.industry,
    roleModes: params.roleModes ?? [],
    idempotencyKey: params.idempotencyKey,
    conversationHistory: params.conversationHistory,
    missionBrief: undefined,
    clarificationNeeded: false,
    clarificationQuestion: undefined,
    plan: undefined,
    routeMap: undefined,
    currentTaskIndex: 0,
    taskResults: {},
    pendingApprovals: [],
    guardrailResult: undefined,
    blocked: false,
    verificationResults: {},
    completedTaskIds: [],
    failedTaskIds: [],
    taskRetryCount: {},
    accumulatedCostUsd: 0,
    maxCostUsd: params.maxCostUsd,
    autoApproveEnabled: params.autoApproveEnabled ?? false,
    approvalThreshold: params.approvalThreshold,
    allowedDomains: params.allowedDomains ?? [],
    browserAutomationEnabled: params.browserAutomationEnabled ?? false,
    restrictedCategories: params.restrictedCategories ?? [],
    disabledToolNames: params.disabledToolNames ?? [],
    allowedToolNames: params.allowedToolNames ?? [],
    connectedProviders: params.connectedProviders ?? [],
    subscriptionTier: params.subscriptionTier,
    userRole: params.userRole,
    llmProvider: params.llmProvider,
    googleSearchGrounding: params.googleSearchGrounding,
    vertexAISearchDatastore: params.vertexAISearchDatastore,
    openaiWebSearch: params.openaiWebSearch,
    status: WS.PENDING,
    error: undefined,
    outputs: [],
    traces: [],
  };
}

/** Get current task from state */
export function getCurrentTask(state: SwarmState) {
  if (!state.plan) return undefined;
  return state.plan.tasks[state.currentTaskIndex];
}

/** Check if there are more tasks to process */
export function hasMoreTasks(state: SwarmState): boolean {
  if (!state.plan) return false;
  return state.currentTaskIndex + 1 < state.plan.tasks.length;
}

/** Get current verification result for the current task */
export function getCurrentVerificationResult(state: SwarmState): VerificationResult | undefined {
  const task = getCurrentTask(state);
  if (!task) return undefined;
  return state.verificationResults[task.id];
}
