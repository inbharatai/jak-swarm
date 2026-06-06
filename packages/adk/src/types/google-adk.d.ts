/**
 * Type augmentation for @google/adk v1.2.0.
 *
 * The package's runtime ESM (dist/esm/common.js) re-exports LlmAgent,
 * SequentialAgent, ParallelAgent, FunctionTool, Runner, InMemorySessionService,
 * etc. from its main entry — but the type declarations (dist/types/index.d.ts)
 * omit them. This augmentation fills the gap so `import { LlmAgent } from
 * '@google/adk'` works at both compile time and runtime.
 */
declare module '@google/adk' {
  // ─── Agents ───────────────────────────────────────────────────────────────

  export { LlmAgent } from '@google/adk/agents/llm_agent';
  export { isLlmAgent } from '@google/adk/agents/llm_agent';
  export { SequentialAgent } from '@google/adk/agents/sequential_agent';
  export { isSequentialAgent } from '@google/adk/agents/sequential_agent';
  export { ParallelAgent } from '@google/adk/agents/parallel_agent';
  export { isParallelAgent } from '@google/adk/agents/parallel_agent';
  export { LoopAgent } from '@google/adk/agents/loop_agent';
  export { isLoopAgent } from '@google/adk/agents/loop_agent';
  export { BaseAgent } from '@google/adk/agents/base_agent';
  export { isBaseAgent } from '@google/adk/agents/base_agent';
  export { InvocationContext } from '@google/adk/agents/invocation_context';
  export { Context } from '@google/adk/agents/context';
  export { ReadonlyContext } from '@google/adk/agents/readonly_context';

  // ─── Tools ────────────────────────────────────────────────────────────────

  export { FunctionTool } from '@google/adk/tools/function_tool';
  export { isFunctionTool } from '@google/adk/tools/function_tool';
  export { BaseTool } from '@google/adk/tools/base_tool';
  export { isBaseTool } from '@google/adk/tools/base_tool';
  export { BaseToolset } from '@google/adk/tools/base_toolset';
  export { isBaseToolset } from '@google/adk/tools/base_toolset';
  export { GoogleSearchTool } from '@google/adk/tools/google_search_tool';
  export { GOOGLE_SEARCH } from '@google/adk/tools/google_search_tool';
  export { VertexAiSearchTool } from '@google/adk/tools/vertex_ai_search_tool';

  // ─── Runner ───────────────────────────────────────────────────────────────

  export { Runner } from '@google/adk/runner/runner';
  export { isRunner } from '@google/adk/runner/runner';
  export { InMemoryRunner } from '@google/adk/runner/in_memory_runner';

  // ─── Sessions ─────────────────────────────────────────────────────────────

  export { InMemorySessionService } from '@google/adk/sessions/in_memory_session_service';
  export { BaseSessionService } from '@google/adk/sessions/base_session_service';
  export { Session } from '@google/adk/sessions/session';
  export { State } from '@google/adk/sessions/state';

  // ─── Events ───────────────────────────────────────────────────────────────

  export { Event } from '@google/adk/events/event';

  // ─── Models ───────────────────────────────────────────────────────────────

  export { BaseLlm } from '@google/adk/models/base_llm';
  export { Gemini } from '@google/adk/models/google_llm';
}