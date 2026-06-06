/**
 * ADK LlmAgent wrappers for JAK's key agent roles.
 *
 * Each wrapper creates an @google/adk LlmAgent with:
 * - The same role-specific instruction (simplified from JAK's PromptBuilder output)
 * - JAK tools bridged via FunctionTool (from jak-tool-bridge.ts)
 * - Provider-native search (GOOGLE_SEARCH for Gemini, web_search for OpenAI)
 * - Model selection based on JAK's tier map
 *
 * These agents are used inside the ADK orchestration pipeline
 * (adk-pipeline.ts) when JAK_ADK_MODE=1.
 */

import { LlmAgent } from '@google/adk';
import type { ToolMetadata } from '@jak-swarm/shared';
import { buildAdkToolsArray } from '../bridge/jak-tool-bridge.js';

// ─── Model selection ────────────────────────────────────────────────────────

/**
 * Map JAK agent roles to appropriate Gemini/OpenAI model strings.
 * Uses Gemini Flash for cost efficiency (same as JAK's tier 2 default).
 */
function modelForRole(role: string, provider: 'gemini' | 'openai'): string {
  if (provider === 'openai') {
    // OpenAI: use gpt-4o for high-tier, gpt-4o-mini for workers
    const highTierRoles = new Set(['COMMANDER', 'PLANNER', 'VERIFIER']);
    return highTierRoles.has(role.toUpperCase()) ? 'gpt-4o' : 'gpt-4o-mini';
  }

  // Gemini: use Flash for workers, Pro for high-tier
  const proRoles = new Set(['COMMANDER', 'VERIFIER']);
  return proRoles.has(role.toUpperCase()) ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
}

// ─── Agent instructions ─────────────────────────────────────────────────────
// Simplified versions of JAK's PromptBuilder output, focused on the
// essential role behavior. The ADK path trades dynamic prompt assembly
// (memories, company context) for ADK-native orchestration.

const COMMANDER_INSTRUCTION = `You are the Commander agent of JAK Swarm. Your job:
1. Analyze the user's goal and determine if it's clear enough to proceed
2. If unclear, produce a clarification question
3. If clear, produce a MissionBrief with: goalSummary, targetAudience, keyDeliverables, constraints, priority (LOW|MEDIUM|HIGH|CRITICAL)
4. For simple/trivial inputs, produce a directAnswer instead of a full mission

Output valid JSON only: { "missionBrief": {...}, "clarificationNeeded": boolean, "clarificationQuestion": string?, "directAnswer": string? }`;

const PLANNER_INSTRUCTION = `You are the Planner agent of JAK Swarm. Your job:
1. Take a MissionBrief and decompose it into an ordered WorkflowPlan
2. Each task has: id, name, description, agentRole (CEO|CTO|CMO|CFO|COO|HR|LEGAL|SALES|VERIFIER), dependencies[], priority
3. Tasks should be ordered so dependencies come before dependents
4. Include a VERIFIER task at the end for quality assurance

Output valid JSON only: { "plan": { "tasks": [...] } }`;

const WORKER_INSTRUCTION = `You are a {role} agent in JAK Swarm. Your job:
1. Execute the assigned task using the available tools
2. Search the web for current data when needed (use available search tools)
3. Produce a structured output matching the task description
4. If you cannot complete the task, explain what's missing

Be thorough and use real data. Use tools when they help produce better output.`;

const VERIFIER_INSTRUCTION = `You are the Verifier agent of JAK Swarm. Your job:
1. Review each completed task's output against its description
2. Check for: completeness, accuracy, format compliance, hallucinated data
3. For each task, produce a VerificationResult: { taskId, passed, score (0-1), issues[], suggestions[] }
4. Be strict — flag objective errors, not subjective preferences

Output valid JSON only: { "results": [VerificationResult...] }`;

const SYNTHESIS_INSTRUCTION = `You are the Synthesis agent of JAK Swarm. Your job:
1. Collect outputs from all parallel worker agents
2. Merge and synthesize into a coherent final deliverable
3. Resolve any contradictions between worker outputs
4. Ensure the final output directly addresses the original goal

Produce a clear, well-structured final output.`;

// ─── Factory functions ──────────────────────────────────────────────────────

export interface AdkAgentConfig {
  provider: 'gemini' | 'openai';
  jakToolMetadata: ToolMetadata[];
  allowedToolNames?: string[];
  includeSearch?: boolean;
}

/**
 * Create a Commander ADK agent.
 * Uses the highest-tier model and Google Search grounding.
 */
export function createCommanderAdk(config: AdkAgentConfig): LlmAgent {
  const tools = buildAdkToolsArray({
    provider: config.provider,
    jakToolMetadata: config.jakToolMetadata,
    allowedToolNames: config.allowedToolNames,
    includeSearch: config.includeSearch,
  });

  return new LlmAgent({
    name: 'Commander',
    model: modelForRole('COMMANDER', config.provider),
    description: 'Analyzes goals and produces mission briefs or clarification questions',
    instruction: COMMANDER_INSTRUCTION,
    tools,
    outputKey: 'commander_output',
  });
}

/**
 * Create a Planner ADK agent.
 */
export function createPlannerAdk(config: AdkAgentConfig): LlmAgent {
  // Planner doesn't need tools — it produces structured plans
  return new LlmAgent({
    name: 'Planner',
    model: modelForRole('PLANNER', config.provider),
    description: 'Decomposes mission briefs into ordered workflow plans',
    instruction: PLANNER_INSTRUCTION,
    tools: [],
    outputKey: 'planner_output',
  });
}

/**
 * Create a worker ADK agent for a specific role.
 * Each worker gets JAK tools + provider-native search.
 */
export function createWorkerAdk(role: string, config: AdkAgentConfig): LlmAgent {
  const tools = buildAdkToolsArray({
    provider: config.provider,
    jakToolMetadata: config.jakToolMetadata,
    allowedToolNames: config.allowedToolNames,
    includeSearch: config.includeSearch,
  });

  return new LlmAgent({
    name: `${role}_Worker`,
    model: modelForRole(role, config.provider),
    description: `Executes tasks as the ${role} agent using available tools and web search`,
    instruction: WORKER_INSTRUCTION.replace('{role}', role),
    tools,
    outputKey: `${role.toLowerCase()}_output`,
  });
}

/**
 * Create a Verifier ADK agent.
 * Uses the highest-tier model for accuracy.
 */
export function createVerifierAdk(config: AdkAgentConfig): LlmAgent {
  return new LlmAgent({
    name: 'Verifier',
    model: modelForRole('VERIFIER', config.provider),
    description: 'Reviews task outputs for completeness, accuracy, and format compliance',
    instruction: VERIFIER_INSTRUCTION,
    tools: [],
    outputKey: 'verifier_output',
  });
}

/**
 * Create a Synthesis ADK agent (merges parallel worker outputs).
 */
export function createSynthesisAdk(config: AdkAgentConfig): LlmAgent {
  return new LlmAgent({
    name: 'Synthesis',
    model: modelForRole('COMMANDER', config.provider), // Same tier as Commander
    description: 'Merges and synthesizes outputs from parallel worker agents',
    instruction: SYNTHESIS_INSTRUCTION,
    tools: [],
    outputKey: 'synthesis_output',
  });
}