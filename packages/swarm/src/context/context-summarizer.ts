/**
 * Context Summarization Engine
 *
 * Manages context window budget across multi-step workflow execution.
 * Inspired by DeerFlow's SummarizationMiddleware but adapted for JAK's
 * multi-task DAG architecture where each task can accumulate results
 * from upstream dependencies.
 *
 * Key differences from DeerFlow:
 * - Operates at SwarmState level (not single conversation)
 * - Summarizes task results, not chat messages
 * - Respects task dependency graph (keep recent, summarize upstream)
 * - Budget is per-node-call, not per-thread
 */
import type { SwarmState } from '../state/swarm-state.js';

export interface SummarizationConfig {
  /** Maximum tokens for task results context (default: 16000) */
  maxContextTokens: number;
  /** Fraction of context to keep when summarizing (default: 0.5) */
  keepFraction: number;
  /** Minimum messages to trigger summarization (default: 6) */
  minTaskResults: number;
}

const DEFAULT_CONFIG: SummarizationConfig = {
  maxContextTokens: 16000,
  keepFraction: 0.5,
  minTaskResults: 6,
};

/** Rough token estimate: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if the accumulated task results exceed the context budget.
 */
export function needsSummarization(
  state: SwarmState,
  config: Partial<SummarizationConfig> = {},
): boolean {
  const { maxContextTokens, minTaskResults } = { ...DEFAULT_CONFIG, ...config };

  const resultEntries = Object.entries(state.taskResults);
  if (resultEntries.length < minTaskResults) return false;

  const totalTokens = resultEntries.reduce((sum, [, value]) => {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    return sum + estimateTokens(str);
  }, 0);

  return totalTokens > maxContextTokens;
}

/**
 * Summarize older task results to reduce context size.
 *
 * Strategy:
 * 1. Keep the most recent N task results intact (current + direct deps)
 * 2. Compress older results to key-value summaries
 * 3. Respect the token budget
 *
 * @param state The current SwarmState
 * @param config Summarization configuration
 * @returns Updated taskResults with older entries summarized
 */
export function summarizeTaskResults(
  state: SwarmState,
  config: Partial<SummarizationConfig> = {},
): Record<string, unknown> {
  const { maxContextTokens, keepFraction } = { ...DEFAULT_CONFIG, ...config };

  const entries = Object.entries(state.taskResults);
  if (entries.length === 0) return state.taskResults;

  // Sort by task order in the plan (earlier tasks first)
  const taskOrder = new Map(
    (state.plan?.tasks ?? []).map((t, i) => [t.id, i]),
  );
  const sorted = entries.sort(([a], [b]) => {
    return (taskOrder.get(a) ?? 0) - (taskOrder.get(b) ?? 0);
  });

  // Find current task and its direct dependencies to protect
  const currentTask = state.plan?.tasks[state.currentTaskIndex];
  const protectedIds = new Set<string>();
  if (currentTask) {
    protectedIds.add(currentTask.id);
    for (const depId of currentTask.dependsOn) {
      protectedIds.add(depId);
    }
  }
  // Also protect the last 2 completed tasks
  const completedTasks = (state.plan?.tasks ?? [])
    .filter(t => t.status === 'COMPLETED')
    .slice(-2);
  for (const t of completedTasks) {
    protectedIds.add(t.id);
  }

  const targetTokens = Math.floor(maxContextTokens * keepFraction);
  const result: Record<string, unknown> = {};
  let tokenCount = 0;

  // First pass: add protected entries
  for (const [taskId, value] of sorted) {
    if (protectedIds.has(taskId)) {
      result[taskId] = value;
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      tokenCount += estimateTokens(str);
    }
  }

  // Second pass: summarize non-protected entries
  for (const [taskId, value] of sorted) {
    if (protectedIds.has(taskId)) continue;

    const str = typeof value === 'string' ? value : JSON.stringify(value);
    const fullTokens = estimateTokens(str);

    if (tokenCount + fullTokens <= targetTokens) {
      // Fits in budget — keep as-is
      result[taskId] = value;
      tokenCount += fullTokens;
    } else {
      // Over budget — create compressed summary
      const summary = compressTaskResult(taskId, value);
      const summaryTokens = estimateTokens(typeof summary === 'string' ? summary : JSON.stringify(summary));
      if (tokenCount + summaryTokens <= maxContextTokens) {
        result[taskId] = summary;
        tokenCount += summaryTokens;
      }
      // If even the summary doesn't fit, drop it entirely
    }
  }

  return result;
}

/**
 * Compress a single task result to a short summary.
 */
function compressTaskResult(taskId: string, value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return {
      _summarized: true,
      _taskId: taskId,
      summary: value.length > 300 ? value.slice(0, 300) + '...' : value,
    };
  }

  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const summary: Record<string, unknown> = { _summarized: true, _taskId: taskId };

    // Keep status/error fields but truncate content
    if ('status' in obj) summary['status'] = obj['status'];
    if ('error' in obj) summary['error'] = obj['error'];
    if ('result' in obj) {
      const r = String(obj['result']);
      summary['result'] = r.length > 200 ? r.slice(0, 200) + '...' : r;
    }
    if ('output' in obj) {
      const o = String(obj['output']);
      summary['output'] = o.length > 200 ? o.slice(0, 200) + '...' : o;
    }

    return summary;
  }

  return { _summarized: true, _taskId: taskId, value: String(value).slice(0, 200) };
}

/**
 * Apply summarization to SwarmState if needed.
 * This is the main entry point — call before each node execution.
 */
export function applySummarizationIfNeeded(
  state: SwarmState,
  config?: Partial<SummarizationConfig>,
): SwarmState {
  if (!needsSummarization(state, config)) return state;

  const summarizedResults = summarizeTaskResults(state, config);
  return {
    ...state,
    taskResults: summarizedResults,
  };
}
