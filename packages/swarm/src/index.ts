// Graph edges (Sprint 2.5 / A.6 — extracted from deleted swarm-graph.ts)
// SwarmGraph + buildSwarmGraph + SwarmGraph class deleted; LangGraph is
// the only orchestrator. Edge functions remain because the LangGraph
// builder reuses them.
export {
  afterCommander,
  afterGuardrail,
  afterApproval,
  afterVerifier,
} from './graph/edges.js';
export type { NodeName } from './graph/edges.js';

// Nodes (for testing/extension)
export { commanderNode } from './graph/nodes/commander-node.js';
export { plannerNode } from './graph/nodes/planner-node.js';
export { routerNode } from './graph/nodes/router-node.js';
export { guardrailNode } from './graph/nodes/guardrail-node.js';
export { workerNode } from './graph/nodes/worker-node.js';
export type { BrowserExecutionPlan, BrowserActionShape, BrowserActionRisk, IntentConfidence, BrowserIntentCandidate } from './graph/nodes/worker-node.js';
export { buildBrowserExecutionPlan } from './graph/nodes/worker-node.js';
export { verifierNode } from './graph/nodes/verifier-node.js';
export { approvalNode } from './graph/nodes/approval-node.js';
export { validatorNode } from './graph/nodes/validator-node.js';
export type { ValidationWarning, ValidationResult } from './graph/nodes/validator-node.js';

// Task Scheduler
export { getReadyTasks, getSkippedTasks } from './graph/task-scheduler.js';

// State
export {
  createInitialSwarmState,
  getCurrentTask,
  hasMoreTasks,
  getCurrentVerificationResult,
} from './state/swarm-state.js';
export type { SwarmState } from './state/swarm-state.js';
export { InMemoryStateStore } from './state/workflow-state-store.js';
export type { WorkflowStateStore } from './state/workflow-state-store.js';
// Phase 5 — run-lifecycle state machine
export {
  isLegalTransition,
  isTerminalStatus,
  assertTransition,
  transition as transitionStatus,
  IllegalTransitionError,
  TERMINAL,
} from './state/run-lifecycle.js';
export type { MinimalLogger } from './state/run-lifecycle.js';

// Workflow runtime — LangGraph (Sprint 2.5 / A.6 deleted SwarmGraphRuntime)
export {
  getWorkflowRuntime,
  LangGraphRuntime,
  WorkflowPausedError,
  NOOP_LIFECYCLE_EMITTER,
  safeEmitLifecycle,
  PostgresCheckpointSaver,
  buildLangGraph,
  makeRunnableConfig,
  SwarmStateAnnotation,
} from './workflow-runtime/index.js';
export type {
  WorkflowRuntime,
  StartContext,
  ResumeDecision,
  WorkflowSnapshot,
  WorkflowLifecycleEvent,
  WorkflowLifecycleEmitter,
  CheckpointPrismaClient,
} from './workflow-runtime/index.js';

// Runner
export { SwarmRunner } from './runner/swarm-runner.js';

// Workflows — higher-level orchestrations that compose agents outside the
// general SwarmGraph (e.g., the cyclic Vibe Coder debug-retry chain).
export {
  runVibeCoderWorkflow,
  heuristicBuildChecker,
  passThroughBuildChecker,
} from './workflows/vibe-coder-workflow.js';
export type {
  VibeCoderParams,
  VibeCoderResult,
  VibeCoderEvent,
  VibeCoderEventType,
  BuildChecker,
  BuildResult,
} from './workflows/vibe-coder-workflow.js';
export { staticBuildChecker } from './workflows/static-build-checker.js';
export {
  DockerBuildChecker,
  RealDockerRunner,
  dockerBuildChecker,
  extractAffectedFiles,
  capErrorLog,
} from './workflows/docker-build-checker.js';
export type {
  DockerRunner,
  DockerBuildCheckerOptions,
  DockerBuildRunOptions,
  DockerBuildRunResult,
} from './workflows/docker-build-checker.js';
export type { RunParams, SwarmResult, ApprovalDecision } from './runner/swarm-runner.js';

// Supervisor
export { SupervisorBus, supervisorBus } from './supervisor/supervisor-bus.js';
export type {
  SupervisorEvent,
  SupervisorEventMap,
  SupervisorEventType,
  WorkflowRequestedEvent,
  WorkflowStartedEvent,
  NodeEnteredEvent,
  NodeCompletedEvent,
  WorkflowCompletedEvent,
  ApprovalRequiredEvent,
  BudgetExceededEvent,
  CircuitOpenEvent,
} from './supervisor/supervisor-bus.js';
export {
  CircuitBreaker,
  CircuitOpenError,
  getCircuitBreaker,
  resetAllCircuitBreakers,
  purgeIdleCircuitBreakers,
} from './supervisor/circuit-breaker.js';
export type { CircuitBreakerOptions, CircuitState } from './supervisor/circuit-breaker.js';

// Context
export {
  needsSummarization,
  summarizeTaskResults,
  applySummarizationIfNeeded,
} from './context/index.js';
export type { SummarizationConfig } from './context/index.js';

// Coordination — unified resilience wrapper (timeout + retry + breaker + error taxonomy)
export {
  executeGuarded,
  classifyError,
  ExecutionError,
} from './coordination/execute-guarded.js';
export type { ExecutionErrorClass, ExecuteGuardedOptions } from './coordination/execute-guarded.js';

// Agent-run cockpit — activity emitter side-channel (Stage 2 of
// qa/client-agent-visibility-audit.md). Workflow runtime registers an
// emitter per run; worker nodes look it up when building AgentContext.
export {
  registerActivityEmitter,
  getActivityEmitter,
  clearActivityEmitter,
} from './supervisor/activity-registry.js';

// Recovery — auto-repair classifier + service used by worker-node on
// task failure. `classifyError` is re-exported as `classifyRepairError`
// because `coordination/execute-guarded.ts` already exports a
// (different) `classifyError`. The apps/api shim re-aliases them.
export {
  classifyError as classifyRepairError,
  decideRepair,
  RepairService,
  defaultRepairService,
} from './recovery/repair-service.js';
export type {
  ErrorClass as RepairErrorClass,
  RepairDecision,
  ClassifyOptions as RepairClassifyOptions,
  RepairContext,
} from './recovery/repair-service.js';

// ─── HyperAgent Phase 13 — Control Centre pure aggregation core ────────────
// Deterministic, no I/O, no clock, fabricates nothing. The API control-centre
// routes select real Prisma rows, map them to these input shapes, call the
// aggregators, stamp `generatedAt`, and return honest views (empty when tables
// are empty — never a fabricated "all healthy"). See control-centre.ts.
export {
  aggregateOverview,
  aggregateRuns,
  aggregateLearnings,
  aggregateOptimizations,
  aggregateExperiments,
  aggregateGovernance,
  aggregateAgentFleet,
  aggregateAutonomy,
  aggregateShield,
} from './hyperagent/control-centre.js';
export type {
  OutcomeInput,
  DiagnosisInput,
  RepairInput,
  PlanVersionInput,
  LearningInput,
  ConfigVersionInput,
  RolloutEventInput,
  HyperAgentConfigInput,
  AgentTraceInput,
  ShieldAuditInput,
} from './hyperagent/control-centre.js';

// ─── HyperAgent Phase 14 — failure-injection framework ─────────────────────
// A PURE, deterministic harness that simulates the 16 spec failure modes and
// runs each through the REAL decision path (classifier → autonomy → Shield →
// budget → replan bound). No I/O, no clock — every scenario is a fixed signal
// so failure handling is reproducible in CI. The live E2E (real tenant + DB +
// Cloud Run worker) is env-gated and lives in tests/e2e; it is never fake-passed
// here. See failure-injection.ts.
export {
  runFailureInjection,
  signalFor,
  isSecurityFailureClass,
  defaultInjectionContext,
  ALL_FAILURE_KINDS,
  FailureKind,
} from './hyperagent/failure-injection.js';
export type {
  FailureInjectionContext,
  FailureInjectionResult,
  FailureAction,
  ShieldResponse,
  ShieldVerdictOutcome,
} from './hyperagent/failure-injection.js';

// ─── HyperAgent self-learning — live persist + recall + node deps ────────────
// The durable I/O seam (learning-persist.ts) + the live graph node deps the
// service layer injects to wire the self-learning half into the execution path.
export {
  persistLearningCandidates,
  recallLearnings,
  armsForTaskType,
} from './hyperagent/learning-persist.js';
export type {
  LearningPersistPrismaClient,
  LearningGateOverrides,
  PersistLearningCandidatesInput,
  PersistOutcome,
  RecallLearningsInput,
  RecalledLearning,
} from './hyperagent/learning-persist.js';
export type { LearningNodeDeps } from './graph/nodes/learning-node.js';
export type { PlannerNodeDeps } from './graph/nodes/planner-node.js';

// ─── HyperAgent Phase 6 — approved-spec closed loop ───────────────────────
// `executeApprovedSpec` binds the three pure halves (materialise → run →
// harvest → measure → verdict) into one closed loop. `runPlanViaLangGraph` is
// the PRODUCTION run seam (drives the real spec-execution graph; env-blocked at
// every agent call — wired-into-runtime, NOT production-proven here). The
// closed-loop LOGIC is proven by the integration test with a stub runPlan.
export {
  materializePlan,
  acceptanceCriteriaForSpec,
  executeApprovedSpec,
  SpecNotApprovedError,
  SpecPlanValidationError,
} from './hyperagent/spec-executor.js';
export type {
  MaterializePlanInput,
  ExecuteSpecInput,
  ExecuteSpecResult,
  ExecuteSpecDeps,
  RunPlanInput,
  FinishedRun,
} from './hyperagent/spec-executor.js';
export { runPlanViaLangGraph } from './hyperagent/spec-executor-runtime.js';
export type { RunPlanViaLangGraphDeps } from './hyperagent/spec-executor-runtime.js';

// ─── HyperAgent accuracy pass — criteria compiler + citation coverage ─────
// `compileSpecCriteria` converts prose/CUSTOM acceptance criteria into wired
// structured criteria validated against the spec's task plan (never invents a
// binding — unresolvable prose stays CUSTOM/unwired). `measureCitationCoverage`
// scores a worker's output prose against the Brain claims it was served and
// emits the `citation_coverage` harvested metric the acceptance checker binds.
export {
  compileCriteria,
  compileSpecCriteria,
  resolveTaskId,
  validateProposal,
} from './hyperagent/criteria-compiler.js';
export type {
  CompiledCriterion,
  UnboundCriterion,
  CompileCriteriaResult,
  CompileCriteriaInput,
  CriterionProposal,
  CriterionBindingSource,
} from './hyperagent/criteria-compiler.js';
export {
  measureCitationCoverage,
  coverageMetrics,
  splitSentences,
  SUPPORT_THRESHOLD,
  CITATION_COVERAGE_METRIC,
  CITATION_FORM_DENSITY_METRIC,
} from './hyperagent/citation-coverage.js';
export type {
  ServedClaim,
  OutputClaim,
  CitationCoverageReport,
} from './hyperagent/citation-coverage.js';

// ─── HyperAgent Phase 9 — versioned config lifecycle (pure core) ──────────
// The bounded state machine + evidence-gated advancement. The LIVE caller is
// `apps/api/src/services/company-brain/config-lifecycle.service.ts`; these
// pure functions are the deterministic gate the caller enforces (no fake
// advance on HOLD). Re-exported so the service + tests import from one surface.
export {
  ConfigLifecycleError,
  canTransition,
  assertTransition as assertConfigTransition,
  createDraft as createDraftConfig,
  proposeVersion,
  startShadow,
  startCanary,
  promoteVersion,
  rollbackVersion,
  supersede,
  nextRolloutPercent,
  evaluateStage,
  evaluateShadow,
  evaluateCanary,
  rampCanary,
  recordEvent as recordConfigEvent,
  withEvaluation,
} from './hyperagent/config-lifecycle.js';
