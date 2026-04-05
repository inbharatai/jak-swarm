import type { WorkflowPlan, WorkflowTask } from '@jak-swarm/shared';

/**
 * Detect circular dependencies in the plan. Returns the IDs of tasks
 * that are part of a cycle, or an empty set if no cycles exist.
 */
export function detectCircularDependencies(plan: WorkflowPlan): Set<string> {
  const taskMap = new Map(plan.tasks.map(t => [t.id, t]));
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycleIds = new Set<string>();

  function dfs(taskId: string): boolean {
    if (inStack.has(taskId)) {
      cycleIds.add(taskId);
      return true; // cycle found
    }
    if (visited.has(taskId)) return false;

    visited.add(taskId);
    inStack.add(taskId);

    const task = taskMap.get(taskId);
    if (task) {
      for (const depId of task.dependsOn) {
        if (dfs(depId)) {
          cycleIds.add(taskId);
        }
      }
    }

    inStack.delete(taskId);
    return false;
  }

  for (const task of plan.tasks) {
    dfs(task.id);
  }

  return cycleIds;
}

/**
 * Get all tasks that are ready to execute.
 * A task is ready when ALL of its dependsOn tasks are in completedIds
 * and the task itself is neither completed nor failed nor has failed dependencies.
 */
export function getReadyTasks(
  plan: WorkflowPlan,
  completedIds: Set<string>,
  failedIds: Set<string>,
): WorkflowTask[] {
  const skippedIds = getSkippedTaskIds(plan, failedIds);
  const cyclicIds = detectCircularDependencies(plan);

  return plan.tasks.filter((task) => {
    // Already done or failed or skipped
    if (completedIds.has(task.id)) return false;
    if (failedIds.has(task.id)) return false;
    if (skippedIds.has(task.id)) return false;
    if (cyclicIds.has(task.id)) return false;

    // All dependencies must be completed (not just present — actually completed)
    return task.dependsOn.every((depId) => completedIds.has(depId));
  });
}

/**
 * Get all tasks that should be skipped because they depend (directly or transitively)
 * on a failed task.
 */
export function getSkippedTasks(
  plan: WorkflowPlan,
  failedIds: Set<string>,
): WorkflowTask[] {
  const skippedIds = getSkippedTaskIds(plan, failedIds);
  return plan.tasks.filter((task) => skippedIds.has(task.id));
}

/**
 * Internal helper: compute the set of task IDs that must be skipped
 * due to transitive dependency on failed tasks.
 */
function getSkippedTaskIds(
  plan: WorkflowPlan,
  failedIds: Set<string>,
): Set<string> {
  const skipped = new Set<string>();

  // Build adjacency: task -> tasks that depend on it
  const dependentsOf = new Map<string, string[]>();
  for (const task of plan.tasks) {
    for (const depId of task.dependsOn) {
      const existing = dependentsOf.get(depId) ?? [];
      existing.push(task.id);
      dependentsOf.set(depId, existing);
    }
  }

  // BFS from each failed task to propagate skip status
  const queue = [...failedIds];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const dependents = dependentsOf.get(currentId) ?? [];
    for (const depId of dependents) {
      if (!skipped.has(depId) && !failedIds.has(depId)) {
        skipped.add(depId);
        queue.push(depId);
      }
    }
  }

  return skipped;
}
