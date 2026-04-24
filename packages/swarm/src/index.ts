// Graph
export { buildSwarmGraph, SwarmGraph } from './graph/swarm-graph.js';
export {
  afterCommander,
  afterGuardrail,
  afterApproval,
  afterVerifier,
} from './graph/swarm-graph.js';
export type { NodeName, NodeHandler, SwarmGraphEvents } from './graph/swarm-graph.js';

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
export { replannerNode } from './graph/nodes/replanner-node.js';
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
  TERMINAL,
} from './state/run-lifecycle.js';
export type { MinimalLogger } from './state/run-lifecycle.js';

// Phase 6 — workflow runtime interface (orchestration engine abstraction)
export {
  getWorkflowRuntime,
  SwarmGraphRuntime,
  WorkflowPausedError,
} from './workflow-runtime/index.js';
export type {
  WorkflowRuntime,
  StartContext,
  ResumeDecision,
  WorkflowSnapshot,
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

// Memory
export {
  extractMemories,
  deduplicateFacts,
  filterByConfidence,
  formatMemoryBlock,
  buildMemoryQuery,
  rankMemories,
} from './memory/index.js';
export type {
  ExtractedFact,
  MemoryExtractionResult,
  MemoryEntry,
  MemoryQueryOptions,
} from './memory/index.js';

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
