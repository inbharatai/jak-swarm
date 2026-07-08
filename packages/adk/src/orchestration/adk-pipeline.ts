/**
 * ADK Orchestration Pipeline — mirrors JAK's LangGraph DAG using
 * ADK's native SequentialAgent and ParallelAgent.
 *
 * Pipeline: Commander → Planner → [Parallel Workers] → Synthesis → Verifier
 *
 * This is the key artifact for the Google Agents Challenge:
 * it demonstrates ADK-based multi-agent orchestration with:
 * - SequentialAgent for ordered stages (Commander → Planner → Workers → Verifier)
 * - ParallelAgent for concurrent task execution
 * - GOOGLE_SEARCH built-in tool for real-time grounding
 * - JAK tools bridged as FunctionTools
 * - output_key for inter-agent data flow
 *
 * When JAK_ADK_MODE=1, this pipeline replaces JAK's LangGraph graph
 * for workflow execution. The output shape is converted back to
 * SwarmState by the ADK runner bridge.
 */

import { SequentialAgent, ParallelAgent, LlmAgent } from '@google/adk';
import {
  createCommanderAdk,
  createPlannerAdk,
  createWorkerAdk,
  createVerifierAdk,
  createSynthesisAdk,
  type AdkAgentConfig,
} from '../agents/jak-adk-agents.js';

// ─── Pipeline configuration ────────────────────────────────────────────────

export interface AdkPipelineConfig extends AdkAgentConfig {
  /** Worker roles to create (e.g. ['CEO', 'CTO', 'CMO']). Determined at runtime from the plan. */
  workerRoles?: string[];
}

// ─── Pipeline builder ──────────────────────────────────────────────────────

/**
 * Build the full ADK orchestration pipeline.
 *
 * Architecture:
 *   SequentialAgent(root)
 *     ├── CommanderAgent          (outputKey: 'commander_output')
 *     ├── PlannerAgent            (outputKey: 'planner_output')
 *     ├── ParallelAgent(workers)
 *     │     ├── Worker_CEO         (outputKey: 'ceo_output')
 *     │     ├── Worker_CTO         (outputKey: 'cto_output')
 *     │     └── ...               (one per role)
 *     ├── SynthesisAgent           (outputKey: 'synthesis_output')
 *     └── VerifierAgent            (outputKey: 'verifier_output')
 *
 * The ParallelAgent runs all workers concurrently. Each worker writes
 * to its own output_key. The Synthesis agent reads all keys via
 * ADK's session state templating ({ceo_output}, {cto_output}, etc.).
 */
export function buildAdkPipeline(config: AdkPipelineConfig): SequentialAgent {
  // 1. Commander — analyzes goal, produces mission brief
  const commander = createCommanderAdk(config);

  // 2. Planner — decomposes mission into tasks
  const planner = createPlannerAdk(config);

  // 3. Workers — execute tasks in parallel, one per role
  const workerRoles = config.workerRoles ?? ['CEO']; // default if no roles specified
  const workers = workerRoles.map(role => createWorkerAdk(role, config));

  const parallelWorkers = new ParallelAgent({
    name: 'ParallelWorkers',
    subAgents: workers,
    description: 'Executes assigned tasks concurrently across all worker roles',
  });

  // 4. Synthesis — merges parallel worker outputs
  const synthesis = createSynthesisAdk(config);

  // 5. Verifier — quality assurance on final output
  const verifier = createVerifierAdk(config);

  // Build the sequential pipeline
  return new SequentialAgent({
    name: 'JAKSwarmPipeline',
    subAgents: [commander, planner, parallelWorkers, synthesis, verifier],
    description: 'JAK Swarm multi-agent workflow using Google ADK orchestration',
  });
}

/**
 * Build a minimal single-agent pipeline for simple tasks.
 * Uses only Commander + GOOGLE_SEARCH — no planner/parallel workers needed.
 */
export function buildSimpleAdkPipeline(config: AdkPipelineConfig): LlmAgent {
  return createCommanderAdk({
    ...config,
    includeSearch: true,
  });
}

// ─── HyperAgent Phase 11: waved pipeline (ADK parity with LangGraph waves) ───
//
// The flat ParallelAgent runs every worker concurrently regardless of task
// dependencies. The LangGraph path runs dependency-ordered WAVES so a depended-
// on task completes before its dependents start. `buildWavedPipeline` mirrors
// that: a SequentialAgent of ParallelAgents, one ParallelAgent per wave, each
// containing a worker per unique role in that wave. Role names are wave-suffixed
// to keep ADK agent names unique when a role recurs across waves.
//
//   SequentialAgent(root)
//     ├── CommanderAgent
//     ├── PlannerAgent
//     ├── ParallelAgent(wave 1)  ─ Worker_<role>_w0, ...
//     ├── ParallelAgent(wave 2)  ─ Worker_<role>_w1, ...
//     ├── ...
//     ├── SynthesisAgent
//     └── VerifierAgent
//
// OPT-IN: the runner uses this only when the caller supplies a Planner plan
// (hyperAgent mode). Otherwise `buildAdkPipeline` (flat) is used unchanged.
export function buildWavedPipeline(config: AdkPipelineConfig, waves: readonly (readonly string[])[]): SequentialAgent {
  const commander = createCommanderAdk(config);
  const planner = createPlannerAdk(config);

  const waveAgents = waves.map((roles, waveIndex) => {
    const workers = roles.map((role) => createWorkerAdk(role, config, `Worker_${role}_w${waveIndex}`));
    return new ParallelAgent({
      name: `Wave_${waveIndex}`,
      subAgents: workers,
      description: `Wave ${waveIndex}: executes roles ${roles.join(', ')} concurrently`,
    });
  });

  const synthesis = createSynthesisAdk(config);
  const verifier = createVerifierAdk(config);

  return new SequentialAgent({
    name: 'JAKSwarmWavedPipeline',
    subAgents: [commander, planner, ...waveAgents, synthesis, verifier],
    description: 'JAK Swarm multi-agent workflow with dependency-ordered waves (HyperAgent Phase 11)',
  });
}