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
import type {
  AutonomyLevel,
  FailureDiagnosis,
  HyperAgentMode,
  PlanVersion,
  ReplanResult,
  RepairBudget,
  TaskRepairState,
  DiagnosisRecord,
  LearningCandidate,
  OutcomeEvaluation,
} from '@jak-swarm/shared';

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

  // ─── HyperAgent state (Phase 4+) ──────────────────────────────────────────
  // All fields default safely so a workflow with no HyperAgent config behaves
  // exactly as before. The new diagnosis/replanner routing is GATED on
  // `hyperAgentMode !== OFF && hyperAgentEnabled`; when off, the graph never
  // reaches the diagnosis/replanner nodes.
  /** Tenant HyperAgent mode for this run. Undefined/OFF = legacy routing. */
  hyperAgentMode?: HyperAgentMode;
  /** Tenant autonomy level for this run. */
  autonomyLevel?: AutonomyLevel;
  /** Tenant repair budget for this run. */
  repairBudget?: RepairBudget;
  /** Whether the HyperAgent layer is enabled for this tenant. */
  hyperAgentEnabled?: boolean;
  /** 'standard' (legacy) | 'hyperagent' | 'shadow'. */
  executionMode?: 'standard' | 'hyperagent' | 'shadow';
  /** Monotonic plan version counter (0 = original plan). */
  activePlanVersion?: number;
  /** Complete plan history (versioned per spec §13 Phase 4). */
  planHistory?: PlanVersion[];
  /** Per-task unified repair accounting (replaces split retry counters). */
  taskRepairState?: Record<string, TaskRepairState>;
  /** Diagnoses keyed by taskId. */
  failureDiagnoses?: Record<string, FailureDiagnosis>;
  /** Replan results applied so far. */
  repairProposals?: ReplanResult[];
  /** HyperAgent self-healing iteration counter. */
  hyperAgentIteration?: number;
  /** Ceiling on self-healing iterations. */
  maxHyperAgentIterations?: number;
  /** Diagnoses awaiting the replanner, keyed by taskId. */
  pendingDiagnoses?: Record<string, DiagnosisRecord>;

  // ─── HyperAgent self-learning (Phase 5 live wiring) ────────────────────────
  // The learning node (reached after the validator when HyperAgent is ON)
  // evaluates the finished run, extracts typed learning candidates, and
  // persists them through learning-persist.ts. The recall half (Phase 3)
  // populates `relevantLearnings` before the planner runs so prior promotions
  // inform the next plan. All fields default safely so a workflow with
  // HyperAgent OFF never touches them.
  /** Outcome evaluation of the finished run (written by the learning node). */
  outcomeEvaluation?: OutcomeEvaluation;
  /** Learning candidates extracted from this run (written by the learning node). */
  learningCandidates?: LearningCandidate[];
  /** Promoted learnings recalled for this run (written by Phase 3 recall). */
  relevantLearnings?: Array<{ key: string; summary: string; confidence: number }>;
  /** Learnings promoted as a side effect of persisting this run's candidates. */
  promotedLearnings?: Array<{ key: string; mutualInformation: number }>;
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
  // HyperAgent (Phase 4)
  hyperAgentEnabled?: boolean;
  hyperAgentMode?: HyperAgentMode;
  autonomyLevel?: AutonomyLevel;
  repairBudget?: RepairBudget;
  maxHyperAgentIterations?: number;
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
    // HyperAgent — safe defaults (OFF / standard / no history).
    hyperAgentEnabled: params.hyperAgentEnabled ?? false,
    hyperAgentMode: params.hyperAgentMode,
    autonomyLevel: params.autonomyLevel,
    repairBudget: params.repairBudget,
    executionMode: params.hyperAgentEnabled ? 'hyperagent' : 'standard',
    activePlanVersion: 0,
    planHistory: [],
    taskRepairState: {},
    failureDiagnoses: {},
    repairProposals: [],
    hyperAgentIteration: 0,
    maxHyperAgentIterations: params.maxHyperAgentIterations ?? 3,
    pendingDiagnoses: {},
    // Self-learning — empty until the learning node / recall populate them.
    outcomeEvaluation: undefined,
    learningCandidates: [],
    relevantLearnings: [],
    promotedLearnings: [],
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
