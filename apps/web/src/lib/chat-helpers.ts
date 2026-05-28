import type { TaskStatus } from '@/types';
import type { CockpitState } from '@/components/chat/ChatWorkspace';

/** Map the planner's task-status string (lowercase) to UI TaskStatus. */
export function mapPlanStatus(s: string): TaskStatus {
  const u = s.toUpperCase();
  if (u === 'IN_PROGRESS' || u === 'COMPLETED' || u === 'FAILED' || u === 'AWAITING_APPROVAL' || u === 'SKIPPED' || u === 'PENDING') {
    return u as TaskStatus;
  }
  return 'PENDING';
}

/** Update the first task matching `agentRole` to a new status. Tasks are
 *  named with WORKER_* role keys; we match by suffix-insensitive substring
 *  to handle "PLANNER" / "WORKER_RESEARCH" / "Research" variants the
 *  swarm graph uses across nodes. */
export function updateCockpitTaskStatus(
  setCockpit: React.Dispatch<React.SetStateAction<Record<string, CockpitState>>>,
  workflowId: string,
  agentRole: string,
  newStatus: TaskStatus,
): void {
  setCockpit((prev) => {
    const cur = prev[workflowId];
    if (!cur?.plan?.steps?.length) return prev;
    const upper = agentRole.toUpperCase();
    let touched = false;
    const steps = cur.plan.steps.map((s) => {
      if (touched) return s;
      const sRole = s.agentRole.toUpperCase();
      // Match exact OR strip WORKER_ prefix and substring match either way
      if (
        sRole === upper ||
        sRole === `WORKER_${upper}` ||
        upper === `WORKER_${sRole.replace(/^WORKER_/, '')}` ||
        sRole.endsWith(upper) ||
        upper.endsWith(sRole.replace(/^WORKER_/, ''))
      ) {
        touched = true;
        return { ...s, status: newStatus };
      }
      return s;
    });
    if (!touched) return prev;
    return {
      ...prev,
      [workflowId]: {
        ...cur,
        plan: { ...cur.plan, steps },
      },
    };
  });
}

/** Cockpit cost line. Reuses the chat footer formatting logic. */
export function formatCockpitCost(cockpit: CockpitState): string {
  const totalTokens = cockpit.promptTokens + cockpit.completionTokens;
  const tokenLabel =
    totalTokens >= 1_000_000
      ? `${(totalTokens / 1_000_000).toFixed(1)}M tokens`
      : totalTokens >= 1_000
        ? `${(totalTokens / 1_000).toFixed(1)}k tokens`
        : `${totalTokens} tokens`;
  const callsLabel = `${cockpit.calls} call${cockpit.calls === 1 ? '' : 's'}`;
  const runtimeLabel = cockpit.runtimes && cockpit.runtimes.size > 0
    ? Array.from(cockpit.runtimes).join('+')
    : null;
  const modelLabel = cockpit.models && cockpit.models.size > 0
    ? Array.from(cockpit.models).join(',')
    : null;
  const stack = [runtimeLabel, modelLabel].filter(Boolean).join(' · ');

  if (cockpit.costUsd > 0) {
    const costLabel =
      cockpit.costUsd >= 0.01
        ? `$${cockpit.costUsd.toFixed(4)}`
        : `$${cockpit.costUsd.toFixed(6)}`;
    const base = `${costLabel} · ${callsLabel} · ${tokenLabel}`;
    return stack ? `${base} · ${stack}` : base;
  }
  const base = `${callsLabel} · ${tokenLabel}`;
  return stack ? `${base} · ${stack}` : base;
}

// Stage 2.6 helper — format an honest per-workflow cost footer.
// Shape: "$0.0042 · 6 calls · 12k tokens". Keep values human-readable;
// $0 falls through to "Tracked: 6 calls · 12k tokens" so the user knows
// cost tracking happened even when all calls were on free-tier models.
export function formatCostFooter(cost: {
  costUsd: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}): string {
  const totalTokens = cost.promptTokens + cost.completionTokens;
  const tokenLabel =
    totalTokens >= 1_000_000
      ? `${(totalTokens / 1_000_000).toFixed(1)}M tokens`
      : totalTokens >= 1_000
        ? `${(totalTokens / 1_000).toFixed(1)}k tokens`
        : `${totalTokens} tokens`;
  const callsLabel = `${cost.calls} call${cost.calls === 1 ? '' : 's'}`;
  if (cost.costUsd > 0) {
    const costLabel =
      cost.costUsd >= 0.01
        ? `$${cost.costUsd.toFixed(4)}`
        : `$${cost.costUsd.toFixed(6)}`;
    return `${costLabel} · ${callsLabel} · ${tokenLabel}`;
  }
  return `Tracked: ${callsLabel} · ${tokenLabel}`;
}
