/**
 * @jak-swarm/adk — Google ADK integration for JAK Swarm.
 *
 * Provides @google/adk-based multi-agent orchestration that satisfies
 * the Google Agents Challenge requirement ("Your project must be built
 * using Agent Development Kit"). Activated via JAK_ADK_MODE=1 env var.
 *
 * Architecture:
 *   - LlmAgent wrappers for Commander, Planner, Workers, Verifier
 *   - SequentialAgent + ParallelAgent orchestration pipeline
 *   - JAK-to-ADK tool bridge (FunctionTool wrappers calling JAK's ToolRegistry)
 *   - ADK Runner bridge (converts ADK events → JAK SwarmState)
 *   - Provider-native search: GOOGLE_SEARCH for Gemini, web_search for OpenAI
 *
 * This package is LAZY-LOADED — @google/adk is only imported when
 * JAK_ADK_MODE=1. The existing LangGraph + OpenAI path is never affected.
 */

// Tool bridge
export {
  withJakExecutionContext,
  getJakExecutionContext,
  withApprovalGate,
  getApprovalGate,
  jsonSchemaToZod,
  jakToolToAdkFunctionTool,
  jakToolsToAdkFunctionTools,
  buildAdkToolsArray,
} from './bridge/jak-tool-bridge.js';

// Agent wrappers
export {
  createCommanderAdk,
  createPlannerAdk,
  createWorkerAdk,
  createVerifierAdk,
  createSynthesisAdk,
  type AdkAgentConfig,
} from './agents/jak-adk-agents.js';

// Orchestration
export {
  buildAdkPipeline,
  buildSimpleAdkPipeline,
  buildWavedPipeline,
  type AdkPipelineConfig,
} from './orchestration/adk-pipeline.js';

// HyperAgent Phase 11 — ADK parity pure cores (waves, roles-from-plan, approval pause/resume)
export {
  rolesFromPlan,
  partitionRolesIntoWaves,
  shouldPauseForApproval,
  applyApprovalDecision,
  type ApprovalGate,
  type ApprovalDecision,
  type ApprovalVerdict,
} from './orchestration/adk-parity.js';

// HyperAgent Phase 5 — unify ADK under LangGraph governance (routing + governed params)
export {
  chooseOrchestrationPath,
  buildGovernedAdkParams,
  buildAdkApprovalGate,
  type OrchestrationDecision,
  type GovernedAdkParams,
  type ApprovalRequestCreator,
} from './orchestration/orchestration-router.js';

// Runner bridge
export {
  runWithAdk,
  type AdkRunResult,
  mapAdkEventToActivities,
  type AdkEventLike,
} from './orchestration/adk-runner.js';

// Agent Engine deployment (Layer 3 — bonus)
export {
  createJakGatewayAgent,
} from './deploy/agent-engine-entry.js';