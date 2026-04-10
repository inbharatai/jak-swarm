import { EventEmitter } from 'node:events';
import { WorkflowStatus, TaskStatus } from '@jak-swarm/shared';
import type { WorkflowTask } from '@jak-swarm/shared';
import type { SwarmState } from '../state/swarm-state.js';
import {
  getCurrentTask,
  hasMoreTasks,
  getCurrentVerificationResult,
} from '../state/swarm-state.js';
import { commanderNode } from './nodes/commander-node.js';
import { plannerNode } from './nodes/planner-node.js';
import { routerNode } from './nodes/router-node.js';
import { guardrailNode } from './nodes/guardrail-node.js';
import { workerNode } from './nodes/worker-node.js';
import { verifierNode } from './nodes/verifier-node.js';
import { approvalNode } from './nodes/approval-node.js';
import { validatorNode } from './nodes/validator-node.js';
import { replannerNode } from './nodes/replanner-node.js';
import { getReadyTasks, getSkippedTasks } from './task-scheduler.js';

export type NodeName =
  | 'commander'
  | 'planner'
  | 'router'
  | 'guardrail'
  | 'worker'
  | 'verifier'
  | 'approval'
  | 'validator'
  | 'replanner'
  | '__end__'
  | '__clarification__';

export type NodeHandler = (state: SwarmState) => Promise<Partial<SwarmState>>;

/**
 * Edge routing functions — determine next node from current state.
 * These mirror LangGraph conditional edge semantics.
 */

export function afterCommander(state: SwarmState): NodeName {
  if (state.clarificationNeeded) return '__clarification__';
  return 'planner';
}

export function afterGuardrail(state: SwarmState): NodeName {
  if (state.blocked) return '__end__';
  const task = getCurrentTask(state);
  if (!task) return '__end__';
  if (task.requiresApproval) return 'approval';
  return 'worker';
}

export function afterApproval(state: SwarmState): NodeName {
  // If the last pending approval was rejected, end the workflow
  const lastApproval = state.pendingApprovals[state.pendingApprovals.length - 1];
  if (lastApproval?.status === 'REJECTED') return '__end__';
  return 'worker';
}

export function afterVerifier(state: SwarmState): NodeName {
  const currentResult = getCurrentVerificationResult(state);

  if (currentResult && !currentResult.passed && currentResult.needsRetry) {
    // Enforce per-task retry limit to prevent infinite loops
    const task = getCurrentTask(state);
    const MAX_TASK_RETRIES = 3;
    const retries = task ? (state.taskRetryCount[task.id] ?? 0) : MAX_TASK_RETRIES;
    if (retries < MAX_TASK_RETRIES) {
      return 'worker';
    }
    // Exhausted retries — treat as passed (move on)
  }

  if (hasMoreTasks(state)) {
    return 'guardrail';
  }

  return '__end__';
}

/**
 * SwarmGraph — a self-contained orchestrator that processes a SwarmState
 * through the full agent pipeline.
 *
 * NOTE: This is a manual implementation of a StateGraph to avoid requiring
 * the @langgraph/langgraph package at runtime. It implements the same
 * node-edge-conditional-edge pattern as LangGraph but as plain TypeScript.
 *
 * To use with LangGraph, replace SwarmGraph.run() with the compiled LangGraph
 * graph and use LangGraph's interrupt() mechanism for the approval node.
 */
export interface SwarmGraphEvents {
  'node:enter': (data: { node: string; taskId?: string; timestamp: Date }) => void;
  'node:exit': (data: { node: string; taskId?: string; timestamp: Date; durationMs: number }) => void;
}

export class SwarmGraph extends EventEmitter {
  private nodes: Map<NodeName, NodeHandler> = new Map();
  private readonly BASE_MAX_STEPS = 100;
  private readonly STEPS_PER_TASK = 10; // Each task: commander→planner→...→verifier

  /** Optional callback: returns true if the given workflow should be cancelled. */
  shouldStop?: (workflowId: string) => boolean;

  /** Optional callback: returns true if the given workflow should be paused. */
  shouldPause?: (workflowId: string) => boolean;

  constructor() {
    super();
    this.nodes.set('commander', commanderNode);
    this.nodes.set('planner', plannerNode);
    this.nodes.set('router', routerNode);
    this.nodes.set('guardrail', guardrailNode);
    this.nodes.set('worker', workerNode);
    this.nodes.set('verifier', verifierNode);
    this.nodes.set('approval', approvalNode);
    this.nodes.set('validator', validatorNode);
    this.nodes.set('replanner', replannerNode);
  }

  async run(initialState: SwarmState): Promise<SwarmState> {
    let state: SwarmState = { ...initialState };
    let currentNode: NodeName = 'commander';
    let steps = 0;
    const taskCount = initialState.plan?.tasks.length ?? 5;
    const maxSteps = Math.min(500, Math.max(this.BASE_MAX_STEPS, taskCount * this.STEPS_PER_TASK));

    while (currentNode !== '__end__' && currentNode !== '__clarification__' && steps < maxSteps) {
      steps++;

      // Check for user-initiated stop/pause
      if (this.shouldStop?.(state.workflowId)) {
        state = { ...state, status: WorkflowStatus.CANCELLED, error: 'Stopped by user' };
        break;
      }
      if (this.shouldPause?.(state.workflowId)) {
        state = { ...state, status: WorkflowStatus.AWAITING_APPROVAL };
        this.emit('state:updated', { workflowId: state.workflowId, state });
        break;
      }

      const handler = this.nodes.get(currentNode);
      if (!handler) {
        state = {
          ...state,
          error: `Unknown node: ${currentNode}`,
          status: WorkflowStatus.FAILED,
        };
        break;
      }

      try {
        const taskId = getCurrentTask(state)?.id;
        const updates = await this.executeNode(currentNode, handler, state, taskId);
        state = this.mergeState(state, updates);
        this.emit('state:updated', { workflowId: state.workflowId, state });

        // Accumulate cost from new traces
        const nodeCost = (updates.traces ?? []).reduce((sum: number, t: { costUsd?: unknown }) => {
          const cost = typeof t.costUsd === 'number' && Number.isFinite(t.costUsd) ? t.costUsd : 0;
          return sum + cost;
        }, 0);
        if (nodeCost > 0) {
          state = { ...state, accumulatedCostUsd: (state.accumulatedCostUsd ?? 0) + nodeCost };
        }
        // Check budget
        if (state.maxCostUsd && state.accumulatedCostUsd > state.maxCostUsd) {
          state = {
            ...state,
            error: `Workflow budget exceeded: $${state.accumulatedCostUsd.toFixed(4)} of $${state.maxCostUsd.toFixed(2)} limit`,
            status: WorkflowStatus.FAILED,
          };
          break;
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const failedTask = getCurrentTask(state);

        if (failedTask && state.plan) {
          // Mark this task as failed but don't kill the workflow
          state = {
            ...state,
            plan: {
              ...state.plan,
              tasks: state.plan.tasks.map((t) =>
                t.id === failedTask.id
                  ? { ...t, status: TaskStatus.FAILED, error: errorMessage }
                  : t,
              ),
            },
            error: undefined, // Clear workflow-level error
          };

          // Skip to next viable task
          const plan = state.plan!;
          const failedIds = new Set(
            plan.tasks.filter(t => t.status === TaskStatus.FAILED).map(t => t.id)
          );
          const completedIds = new Set(
            plan.tasks.filter(t => t.status === TaskStatus.COMPLETED).map(t => t.id)
          );
          const skipped = getSkippedTasks(plan, failedIds);
          const skippedIds = new Set(skipped.map(t => t.id));

          // Find next non-failed, non-skipped, non-completed task
          let nextIndex = -1;
          for (let i = 0; i < plan.tasks.length; i++) {
            const task = plan.tasks[i]!;
            if (!completedIds.has(task.id) && !failedIds.has(task.id) && !skippedIds.has(task.id)) {
              // Check all deps are completed
              if (task.dependsOn.every(dep => completedIds.has(dep))) {
                nextIndex = i;
                break;
              }
            }
          }

          if (nextIndex >= 0) {
            state = { ...state, currentTaskIndex: nextIndex };
            currentNode = 'guardrail';
            continue;
          }
          // No viable tasks remain — fall through to termination
        }

        // No task context or no viable tasks — fail the workflow
        state = {
          ...state,
          error: `Error in node '${currentNode}': ${errorMessage}`,
          status: WorkflowStatus.FAILED,
        };
        break;
      }

      // Check for terminal conditions
      if (state.status === WorkflowStatus.FAILED || state.status === WorkflowStatus.CANCELLED) {
        break;
      }

      // Check for awaiting approval — pause graph
      if (state.status === WorkflowStatus.AWAITING_APPROVAL) {
        break;
      }

      // Determine next node
      currentNode = this.getNextNode(currentNode, state);

      // Increment retry counter when verifier sends task back to worker
      if (currentNode === 'worker') {
        const retryTask = getCurrentTask(state);
        if (retryTask) {
          state = {
            ...state,
            taskRetryCount: {
              ...state.taskRetryCount,
              [retryTask.id]: (state.taskRetryCount[retryTask.id] ?? 0) + 1,
            },
          };
        }
      }

      // Advance task index when moving from verifier to guardrail (next task)
      if (currentNode === 'guardrail' && state.plan) {
        const vResult = getCurrentVerificationResult(state);
        const taskPassed = !vResult || vResult.passed || (!vResult.needsRetry);
        if (taskPassed) {
          state = {
            ...state,
            currentTaskIndex: state.currentTaskIndex + 1,
          };
        }
      }
    }

    if (steps >= maxSteps) {
      state = {
        ...state,
        error: `Workflow exceeded maximum step limit (${maxSteps} steps)`,
        status: WorkflowStatus.FAILED,
      };
    }

    if (state.status === WorkflowStatus.EXECUTING || state.status === WorkflowStatus.VERIFYING) {
      const failedCount = state.plan?.tasks.filter(t => t.status === TaskStatus.FAILED).length ?? 0;
      const completedCount = state.plan?.tasks.filter(t => t.status === TaskStatus.COMPLETED).length ?? 0;
      if (failedCount > 0 && completedCount > 0) {
        state = { ...state, status: WorkflowStatus.COMPLETED, error: `Partial success: ${completedCount} tasks completed, ${failedCount} failed` };
      } else if (failedCount > 0 && completedCount === 0) {
        state = { ...state, status: WorkflowStatus.FAILED };
      } else {
        state = { ...state, status: WorkflowStatus.COMPLETED };
      }
    }

    // Post-workflow learning: persist a summary of what worked/failed
    // so future workflows in this tenant benefit from past experience.
    this.persistWorkflowLearning(state).catch(() => { /* non-critical */ });

    return state;
  }

  /**
   * Persist workflow outcome to tenant memory for continuous improvement.
   * Non-blocking — failures here never affect the workflow result.
   */
  private async persistWorkflowLearning(state: SwarmState): Promise<void> {
    try {
      const { toolRegistry } = await import('@jak-swarm/tools');
      if (!toolRegistry.has('memory_store')) return;

      const completedTasks = state.plan?.tasks.filter(t => t.status === 'COMPLETED') ?? [];
      const failedTasks = state.plan?.tasks.filter(t => t.status === 'FAILED') ?? [];

      if (completedTasks.length === 0 && failedTasks.length === 0) return;

      const learning = {
        workflowId: state.workflowId,
        goal: state.goal,
        industry: state.industry,
        status: state.status,
        taskCount: state.plan?.tasks.length ?? 0,
        completedCount: completedTasks.length,
        failedCount: failedTasks.length,
        failedTaskDescriptions: failedTasks.map(t => ({ name: t.name, error: t.error })),
        successPatterns: completedTasks.map(t => ({ role: t.agentRole, name: t.name })),
        timestamp: new Date().toISOString(),
      };

      await toolRegistry.execute(
        'memory_store',
        {
          key: `workflow_learning:${state.workflowId}`,
          value: learning,
          type: 'KNOWLEDGE',
          source: 'swarm-graph-auto-learning',
        },
        {
          tenantId: state.tenantId,
          userId: state.userId,
          workflowId: state.workflowId,
          runId: state.workflowId,
        },
      );
    } catch {
      // Non-critical — don't fail the workflow for a memory write error
    }
  }

  async resume(
    state: SwarmState,
    approvalDecision: { status: 'APPROVED' | 'REJECTED' | 'DEFERRED'; comment?: string },
  ): Promise<SwarmState> {
    // Update the pending approval
    const updatedApprovals = state.pendingApprovals.map((apr, idx) =>
      idx === state.pendingApprovals.length - 1
        ? {
            ...apr,
            status: approvalDecision.status,
            reviewedAt: new Date(),
          }
        : apr,
    );

    const updatedState: SwarmState = {
      ...state,
      pendingApprovals: updatedApprovals,
      status: WorkflowStatus.EXECUTING,
    };

    if (approvalDecision.status === 'REJECTED') {
      return {
        ...updatedState,
        status: WorkflowStatus.CANCELLED,
        error: `Task rejected by reviewer: ${approvalDecision.comment ?? 'No reason provided'}`,
      };
    }

    // Continue from worker node for the approved task only
    const workerHandler = this.nodes.get('worker')!;
    const verifierHandler = this.nodes.get('verifier')!;

    try {
      // Execute the approved task: worker → verifier
      const workerUpdates = await this.executeNode('worker', workerHandler, updatedState);
      let resumedState = this.mergeState(updatedState, workerUpdates);
      this.emit('state:updated', { workflowId: resumedState.workflowId, state: resumedState });

      const verifierUpdates = await this.executeNode('verifier', verifierHandler, resumedState);
      resumedState = this.mergeState(resumedState, verifierUpdates);
      this.emit('state:updated', { workflowId: resumedState.workflowId, state: resumedState });

      if (
        resumedState.status === WorkflowStatus.FAILED ||
        resumedState.status === WorkflowStatus.CANCELLED ||
        resumedState.status === WorkflowStatus.AWAITING_APPROVAL
      ) {
        return resumedState;
      }

      // Mark current task as complete and advance
      const currentTask = getCurrentTask(resumedState);
      const completedIds = new Set(resumedState.completedTaskIds ?? []);
      const failedIds = new Set(resumedState.failedTaskIds ?? []);
      if (currentTask) {
        const vResult = resumedState.verificationResults[currentTask.id];
        if (!vResult || vResult.passed) {
          completedIds.add(currentTask.id);
        } else {
          failedIds.add(currentTask.id);
        }
      }

      resumedState = {
        ...resumedState,
        completedTaskIds: [...completedIds],
        failedTaskIds: [...failedIds],
        currentTaskIndex: resumedState.currentTaskIndex + 1,
      };

      // Check if there are more tasks — if so, run them through the parallel engine
      if (resumedState.plan) {
        const readyTasks = getReadyTasks(resumedState.plan, completedIds, failedIds);
        if (readyTasks.length > 0) {
          // Delegate remaining tasks to runParallel logic by continuing from current state
          return this.runParallel(resumedState);
        }
      }

      if (
        resumedState.status === WorkflowStatus.EXECUTING ||
        resumedState.status === WorkflowStatus.VERIFYING
      ) {
        resumedState = { ...resumedState, status: WorkflowStatus.COMPLETED };
      }

      return resumedState;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        ...updatedState,
        error: `Error resuming: ${errorMessage}`,
        status: WorkflowStatus.FAILED,
      };
    }
  }

  private async executeNode(
    nodeName: NodeName,
    handler: NodeHandler,
    state: SwarmState,
    taskId?: string,
  ): Promise<Partial<SwarmState>> {
    const NODE_TIMEOUT_MS = 120_000; // 2 minutes per node
    const enterTime = new Date();
    this.emit('node:enter', { node: nodeName, taskId, timestamp: enterTime });

    let updates: Partial<SwarmState>;
    try {
      updates = await Promise.race([
        handler(state),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Node '${nodeName}' timed out after ${NODE_TIMEOUT_MS / 1000}s`)), NODE_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      // Timeout or handler error — emit exit event, then rethrow so the caller's catch block handles it
      const exitTime = new Date();
      this.emit('node:exit', { node: nodeName, taskId, timestamp: exitTime, durationMs: exitTime.getTime() - enterTime.getTime() });
      throw err;
    }

    const exitTime = new Date();
    this.emit('node:exit', {
      node: nodeName,
      taskId,
      timestamp: exitTime,
      durationMs: exitTime.getTime() - enterTime.getTime(),
    });

    return updates;
  }

  /**
   * Run the swarm graph with parallel task execution.
   * Uses the task scheduler to identify independent tasks and runs them concurrently.
   * Falls back to sequential if plan has no parallelizable structure.
   */
  async runParallel(initialState: SwarmState): Promise<SwarmState> {
    let state: SwarmState = { ...initialState };

    // Immediate budget gate: if already over budget on entry, fail fast
    if (state.maxCostUsd != null && state.accumulatedCostUsd >= state.maxCostUsd) {
      return {
        ...state,
        error: `Workflow budget exceeded: $${state.accumulatedCostUsd.toFixed(4)} of $${state.maxCostUsd.toFixed(2)} limit`,
        status: WorkflowStatus.FAILED,
      };
    }

    // Phase 1: Run commander + planner + router sequentially (planning phase)
    const planningNodes: NodeName[] = ['commander', 'planner', 'router'];
    for (const nodeName of planningNodes) {
      const handler = this.nodes.get(nodeName);
      if (!handler) {
        return {
          ...state,
          error: `Unknown node: ${nodeName}`,
          status: WorkflowStatus.FAILED,
        };
      }

      if (state.clarificationNeeded) break;

      this.emit('agent:activity', {
        workflowId: state.workflowId,
        agentRole: nodeName.toUpperCase(),
        taskName: `${nodeName} phase`,
        type: 'worker_started',
        timestamp: new Date().toISOString(),
      });

      const planNodeStart = Date.now();

      try {
        const updates = await this.executeNode(nodeName, handler, state);
        state = this.mergeState(state, updates);

        this.emit('agent:activity', {
          workflowId: state.workflowId,
          agentRole: nodeName.toUpperCase(),
          taskName: `${nodeName} phase`,
          type: 'worker_completed',
          success: true,
          durationMs: Date.now() - planNodeStart,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          ...state,
          error: `Error in node '${nodeName}': ${errorMessage}`,
          status: WorkflowStatus.FAILED,
        };
      }

      if (state.status === WorkflowStatus.FAILED || state.status === WorkflowStatus.CANCELLED) {
        return state;
      }
    }

    if (state.clarificationNeeded || !state.plan) {
      return state;
    }

    // Capture plan reference after narrowing — used throughout the parallel phase
    const plan = state.plan;

    // Phase 2: Parallel task execution
    const completedIds = new Set<string>(state.completedTaskIds ?? []);
    const failedIds = new Set<string>(state.failedTaskIds ?? []);
    let iterations = 0;
    const taskCount = plan.tasks.length;
    const maxIterations = Math.min(500, Math.max(this.BASE_MAX_STEPS, taskCount * this.STEPS_PER_TASK));

    while (iterations < maxIterations) {
      iterations++;

      // Check for user-initiated stop/pause
      if (this.shouldStop?.(state.workflowId)) {
        state = { ...state, status: WorkflowStatus.CANCELLED, error: 'Stopped by user' };
        break;
      }
      if (this.shouldPause?.(state.workflowId)) {
        state = { ...state, status: WorkflowStatus.AWAITING_APPROVAL };
        this.emit('state:updated', { workflowId: state.workflowId, state });
        break;
      }

      const currentPlan = state.plan ?? plan;
      const readyTasks = getReadyTasks(currentPlan, completedIds, failedIds);
      if (readyTasks.length === 0) break;

      // Execute all ready tasks in parallel: guardrail -> worker -> verifier per task
      // Limit concurrency to prevent resource exhaustion
      const MAX_CONCURRENT_TASKS = 5;
      const batches: WorkflowTask[][] = [];
      for (let i = 0; i < readyTasks.length; i += MAX_CONCURRENT_TASKS) {
        batches.push(readyTasks.slice(i, i + MAX_CONCURRENT_TASKS));
      }

      // Pre-batch budget gate: if budget is already exceeded, stop before spending more
      if (state.maxCostUsd && state.accumulatedCostUsd >= state.maxCostUsd) {
        state = {
          ...state,
          error: `Workflow budget exceeded: $${state.accumulatedCostUsd.toFixed(4)} of $${state.maxCostUsd.toFixed(2)} limit`,
          status: WorkflowStatus.FAILED,
        };
        break;
      }

      const allResults: PromiseSettledResult<{ taskId: string; updates: Partial<SwarmState>; success: boolean }>[] = [];
      let budgetBreached = false;
      for (const batch of batches) {
        // Pre-batch budget check: stop scheduling new batches if over budget
        if (state.maxCostUsd && state.accumulatedCostUsd >= state.maxCostUsd) {
          budgetBreached = true;
          break;
        }

        const taskPromises = batch.map((task) =>
          this.executeTaskPipeline(state, task, completedIds, failedIds),
        );
        const batchResults = await Promise.allSettled(taskPromises);
        allResults.push(...batchResults);

        // Accumulate cost from this batch immediately so next batch check is accurate
        for (const br of batchResults) {
          if (br.status === 'fulfilled') {
            const batchCost = (br.value.updates.traces ?? []).reduce((sum: number, t: { costUsd?: unknown }) => {
              const cost = typeof t.costUsd === 'number' && Number.isFinite(t.costUsd) ? t.costUsd : 0;
              return sum + cost;
            }, 0);
            if (batchCost > 0) {
              state = { ...state, accumulatedCostUsd: (state.accumulatedCostUsd ?? 0) + batchCost };
            }
          }
        }
      }

      const results = allResults;

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { taskId, updates, success } = result.value;
          state = this.mergeState(state, updates);
          if (success) {
            completedIds.add(taskId);
          } else {
            failedIds.add(taskId);
          }
        } else {
          // Promise rejected — should not happen given our error handling, but be safe
          state = this.mergeState(state, {
            error: `Parallel task execution error: ${String(result.reason)}`,
          });
        }
      }

      // Update state with current completed/failed tracking
      state = {
        ...state,
        completedTaskIds: [...completedIds],
        failedTaskIds: [...failedIds],
      };

      // Post-batch budget enforcement: fail workflow if cost exceeded
      if (budgetBreached || (state.maxCostUsd && state.accumulatedCostUsd > state.maxCostUsd)) {
        state = {
          ...state,
          error: `Workflow budget exceeded: $${state.accumulatedCostUsd.toFixed(4)} of $${state.maxCostUsd?.toFixed(2)} limit`,
          status: WorkflowStatus.FAILED,
        };
        break;
      }

      // Check if we need to stop (all remaining tasks depend on failed tasks)
      const latestPlan = state.plan ?? plan;
      const skipped = getSkippedTasks(latestPlan, failedIds);
      const allTaskIds = new Set(latestPlan.tasks.map((t) => t.id));
      const doneOrSkipped = new Set([...completedIds, ...failedIds, ...skipped.map((t) => t.id)]);
      if (doneOrSkipped.size >= allTaskIds.size) break;
    }

    // Mark skipped tasks in the plan
    const finalPlan = state.plan ?? plan;
    const skippedTasks = getSkippedTasks(finalPlan, failedIds);
    if (skippedTasks.length > 0) {
      state = {
        ...state,
        plan: {
          ...finalPlan,
          tasks: finalPlan.tasks.map((t) =>
            skippedTasks.some((s) => s.id === t.id)
              ? { ...t, status: TaskStatus.SKIPPED }
              : t,
          ),
        },
      };
    }

    // ─── AUTO-REPAIR: If tasks failed, attempt replanning and retry ───────────
    const MAX_REPLAN_ATTEMPTS = 1;
    let replanAttempt = 0;

    while (failedIds.size > 0 && completedIds.size > 0 && replanAttempt < MAX_REPLAN_ATTEMPTS) {
      replanAttempt++;
      this.emit('node:enter', { node: 'auto-repair', timestamp: new Date() });

      try {
        // Use the dedicated replanner node for failure recovery
        const replannerHandler = this.nodes.get('replanner');
        if (!replannerHandler) break;

        const replanState: SwarmState = {
          ...state,
          failedTaskIds: [...failedIds],
          completedTaskIds: [...completedIds],
        };

        // The replanner will see the failed tasks and create alternatives
        const replanUpdates = await this.executeNode('replanner', replannerHandler, replanState);
        const replanResult = this.mergeState(state, replanUpdates);

        if (!replanResult.plan || replanResult.plan.tasks.length === 0) break;

        // Find NEW tasks (not in the original plan)
        const originalTaskIds = new Set((state.plan ?? plan).tasks.map(t => t.id));
        const newTasks = replanResult.plan.tasks.filter(t => !originalTaskIds.has(t.id));

        if (newTasks.length === 0) break;

        // Merge new tasks into existing plan
        const mergedPlan = {
          ...replanResult.plan,
          tasks: [
            ...(state.plan ?? plan).tasks,
            ...newTasks,
          ],
        };

        state = { ...state, plan: mergedPlan };

        // Execute only the new tasks
        const newCompletedIds = new Set(completedIds);
        const newFailedIds = new Set<string>();

        for (const newTask of newTasks) {
          // Check dependencies
          if (!newTask.dependsOn.every(dep => newCompletedIds.has(dep))) continue;

          try {
            const result = await this.executeTaskPipeline(state, newTask, newCompletedIds, newFailedIds);
            state = this.mergeState(state, result.updates);
            if (result.success) {
              newCompletedIds.add(result.taskId);
              completedIds.add(result.taskId);
            } else {
              newFailedIds.add(result.taskId);
              failedIds.add(result.taskId);
            }
          } catch {
            failedIds.add(newTask.id);
          }
        }

        state = {
          ...state,
          completedTaskIds: [...completedIds],
          failedTaskIds: [...failedIds],
        };
      } catch {
        // Replan failed — continue to final status determination
        break;
      }

      this.emit('node:exit', { node: 'auto-repair', timestamp: new Date(), durationMs: 0 });
    }

    // Determine final status
    if (failedIds.size > 0 && completedIds.size === 0) {
      state = { ...state, status: WorkflowStatus.FAILED };
    } else if (failedIds.size > 0 && completedIds.size > 0) {
      state = { ...state, status: WorkflowStatus.COMPLETED, error: `Partial success: ${completedIds.size} completed, ${failedIds.size} failed (auto-repair attempted)` };
    } else if (
      state.status === WorkflowStatus.EXECUTING ||
      state.status === WorkflowStatus.VERIFYING
    ) {
      state = { ...state, status: WorkflowStatus.COMPLETED };
    }

    return state;
  }

  /**
   * Execute the full guardrail -> worker -> verifier pipeline for a single task.
   */
  private async executeTaskPipeline(
    state: SwarmState,
    task: WorkflowTask,
    _completedIds: Set<string>,
    _failedIds: Set<string>,
  ): Promise<{ taskId: string; updates: Partial<SwarmState>; success: boolean }> {
    // Create a state snapshot with this task as current
    const taskIndex = state.plan!.tasks.findIndex((t) => t.id === task.id);
    const taskState: SwarmState = { ...state, currentTaskIndex: taskIndex };

    // 1. Guardrail
    const guardrailHandler = this.nodes.get('guardrail')!;
    const guardrailUpdates = await this.executeNode('guardrail', guardrailHandler, taskState, task.id);
    const afterGuardrailState = this.mergeState(taskState, guardrailUpdates);

    if (afterGuardrailState.blocked) {
      return {
        taskId: task.id,
        updates: {
          ...guardrailUpdates,
          plan: afterGuardrailState.plan
            ? {
                ...afterGuardrailState.plan,
                tasks: afterGuardrailState.plan.tasks.map((t) =>
                  t.id === task.id ? { ...t, status: TaskStatus.FAILED, error: 'Blocked by guardrail' } : t,
                ),
              }
            : undefined,
        },
        success: false,
      };
    }

    // 2. Worker
    this.emit('agent:activity', {
      workflowId: state.workflowId,
      taskId: task.id,
      agentRole: task.agentRole,
      taskName: task.name,
      type: 'worker_started',
      timestamp: new Date().toISOString(),
    });

    const workerStartTime = Date.now();
    const workerHandler = this.nodes.get('worker')!;
    const workerUpdates = await this.executeNode('worker', workerHandler, afterGuardrailState, task.id);
    const workerExitTime = Date.now();
    const afterWorkerState = this.mergeState(afterGuardrailState, workerUpdates);

    // 3. Verifier
    const verifierHandler = this.nodes.get('verifier')!;
    const verifierUpdates = await this.executeNode('verifier', verifierHandler, afterWorkerState, task.id);
    const afterVerifierState = this.mergeState(afterWorkerState, verifierUpdates);

    // Retry loop: if verifier says needsRetry, re-run worker → verifier
    const MAX_TASK_RETRIES = 2;
    let finalState = afterVerifierState;
    let retryCount = 0;

    while (retryCount < MAX_TASK_RETRIES) {
      const vResult = finalState.verificationResults[task.id];
      if (!vResult || vResult.passed || !vResult.needsRetry) break;

      retryCount++;
      // Re-run worker with the same task
      const retryWorkerUpdates = await this.executeNode('worker', workerHandler, finalState, task.id);
      const retryWorkerState = this.mergeState(finalState, retryWorkerUpdates);

      // Re-verify
      const retryVerifierUpdates = await this.executeNode('verifier', verifierHandler, retryWorkerState, task.id);
      finalState = this.mergeState(retryWorkerState, retryVerifierUpdates);
    }

    const verificationResult = finalState.verificationResults[task.id];
    const passed = verificationResult?.passed ?? true;

    this.emit('agent:activity', {
      workflowId: state.workflowId,
      taskId: task.id,
      agentRole: task.agentRole,
      taskName: task.name,
      type: 'worker_completed',
      success: passed,
      durationMs: workerExitTime - workerStartTime,
      toolCalls: (workerUpdates.traces ?? []).reduce((sum: number, t: unknown) => sum + (((t as Record<string, unknown>).toolCalls as unknown[] | undefined)?.length ?? 0), 0),
      timestamp: new Date().toISOString(),
    });

    // Force needsRetry to false after exhausting retries to prevent infinite loops
    if (verificationResult && !verificationResult.passed && retryCount >= MAX_TASK_RETRIES) {
      finalState = {
        ...finalState,
        verificationResults: {
          ...finalState.verificationResults,
          [task.id]: { ...verificationResult, needsRetry: false },
        },
      };
    }

    // 4. Validator — double-validation after verifier passes (non-blocking)
    if (passed) {
      const validatorHandler = this.nodes.get('validator');
      if (validatorHandler) {
        try {
          const validatorUpdates = await this.executeNode('validator', validatorHandler, finalState, task.id);
          finalState = this.mergeState(finalState, validatorUpdates);
        } catch {
          // Validator is advisory — never fails the task
        }
      }
    }

    // Merge all updates
    const combinedUpdates: Partial<SwarmState> = {
      taskResults: {
        ...guardrailUpdates.taskResults,
        ...(finalState.taskResults ?? {}),
      },
      verificationResults: {
        ...guardrailUpdates.verificationResults,
        ...(finalState.verificationResults ?? {}),
      },
      traces: [
        ...(guardrailUpdates.traces ?? []),
        ...(workerUpdates.traces ?? []),
        ...(verifierUpdates.traces ?? []),
      ],
      outputs: finalState.outputs ?? workerUpdates.outputs,
      plan: finalState.plan,
    };

    return {
      taskId: task.id,
      updates: combinedUpdates,
      success: passed,
    };
  }

  private getNextNode(current: NodeName, state: SwarmState): NodeName {
    switch (current) {
      case 'commander':
        return afterCommander(state);
      case 'planner':
        return 'router';
      case 'router':
        return 'guardrail';
      case 'guardrail':
        return afterGuardrail(state);
      case 'approval':
        return afterApproval(state);
      case 'worker':
        return 'verifier';
      case 'verifier':
        return afterVerifier(state);
      default:
        return '__end__';
    }
  }

  private mergeState(current: SwarmState, updates: Partial<SwarmState>): SwarmState {
    const merged: SwarmState = { ...current };

    for (const [key, value] of Object.entries(updates)) {
      const k = key as keyof SwarmState;

      if (value === undefined) continue;

      // Array fields: append
      if (k === 'traces' || k === 'outputs' || k === 'pendingApprovals' || k === 'completedTaskIds' || k === 'failedTaskIds') {
        const currentArr = (current[k] as unknown[]) ?? [];
        const newArr = Array.isArray(value) ? value : [value];
        (merged[k] as unknown[]) = [...currentArr, ...newArr];
      }
      // Record fields: merge
      else if (k === 'taskResults' || k === 'verificationResults') {
        (merged[k] as Record<string, unknown>) = {
          ...(current[k] as Record<string, unknown>),
          ...(value as Record<string, unknown>),
        };
      }
      // Scalar fields: replace
      else {
        (merged[k] as unknown) = value;
      }
    }

    return merged;
  }
}

export function buildSwarmGraph(): SwarmGraph {
  return new SwarmGraph();
}
