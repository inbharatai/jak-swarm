import { WorkflowStatus } from '@jak-swarm/shared';
import { AgentRole, HyperAgentMode, AutonomyLevel, AutonomyCapability } from '@jak-swarm/shared';
import type { MetaOptimiserConfig, WorkflowPlan, WorkflowTask } from '@jak-swarm/shared';
import { PlannerAgent, AgentContext } from '@jak-swarm/agents';
import type { PlannerOutput } from '@jak-swarm/agents';
import { evaluateForConfig } from '@jak-swarm/security';
import type { SwarmState } from '../../state/swarm-state.js';
import { getActivityEmitter } from '../../supervisor/activity-registry.js';
import { hyperAgentActive } from '../edges.js';
import {
  recallLearnings,
  armsForTaskType,
  type LearningPersistPrismaClient,
  type RecalledLearning,
} from '../../hyperagent/learning-persist.js';
import { selectArm } from '../../hyperagent/meta-optimiser.js';

/**
 * Optional deps the live graph injects into the planner node (Phase 3).
 *
 * When `db` is present AND HyperAgent is active for the run, the planner
 * recalls PROMOTED learnings for the plan's task types and runs bandit
 * selection over competing configs — closing the "recall/selectArm never
 * called in the live path" audit gap. Both steps are non-fatal: a recall or
 * bandit error never fails the plan (the plan the LLM produced stands).
 *
 * Omitting `db` (the default for every legacy caller + tests that don't
 * exercise recall) keeps the planner byte-for-byte identical to before.
 */
export interface PlannerNodeDeps {
  /** Prisma seam for learningRecord recall. When omitted, no recall/bandit. */
  db?: LearningPersistPrismaClient;
  /** Bandit strategy config (default = DEFAULT_META_OPTIMISER_CONFIG). */
  bandit?: MetaOptimiserConfig;
}

export async function plannerNode(
  state: SwarmState,
  deps: PlannerNodeDeps = {},
): Promise<Partial<SwarmState>> {
  if (!state.missionBrief) {
    return {
      error: 'Planner node received no mission brief',
      status: WorkflowStatus.FAILED,
    };
  }

  const agent = new PlannerAgent();

  const context = new AgentContext({
    agentRole: 'PLANNER',
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
    idempotencyKey: state.idempotencyKey,
    allowedDomains: state.allowedDomains,
    ...(state.llmProvider ? { llmProvider: state.llmProvider } : {}),
  });

  const result = await agent.execute(state.missionBrief, context) as PlannerOutput;

  const traces = context.getTraces();

  // Emit the plan to the live SSE stream + audit translator. Without this the
  // cockpit never receives plan_created and the planJson replay column is
  // never populated, so reconnecting clients see no plan.
  const onActivity = getActivityEmitter(state.workflowId);
  if (onActivity && result.plan) {
    onActivity({
      type: 'plan_created',
      planId: state.workflowId + '-plan',
      plan: result.plan as { goal?: string; tasks: unknown[] },
      timestamp: new Date().toISOString(),
    });
  }

  // ─── HyperAgent Phase 3: recall + bandit selection (post-plan) ───────────
  // Only when the HyperAgent layer is ON and a recall db was injected. Recall
  // is keyed by the plan's task-type prefixes (the LLM has just produced the
  // plan, so task types are known now). PROMOTED learnings populate
  // state.relevantLearnings (the replanner reads them on a later failure) and
  // feed the bandit, which selects among competing configs of each task type.
  // Application (overriding a task's agentRole + primary tool) is gated on
  // ASSISTED+ autonomy AND an exploitation (non-exploration) pick — a real
  // customer run is never gambled on an under-sampled exploration arm.
  let plan = result.plan;
  let relevantLearnings: SwarmState['relevantLearnings'];
  let banditSelections: NonNullable<SwarmState['banditSelections']> | undefined;
  if (hyperAgentActive(state) && deps.db && plan) {
    try {
      const taskTypes = [
        ...new Set(
          plan.tasks
            .map((t) => t.id.split('_')[0])
            .filter((tt): tt is string => Boolean(tt)),
        ),
      ];
      const recalled = await recallLearnings({
        db: deps.db,
        tenantId: state.tenantId,
        taskTypes,
      });
      if (recalled.length > 0) {
        relevantLearnings = recalled.map((r) => ({
          key: r.key,
          summary: r.summary,
          confidence: r.confidence,
        }));
      }
      const applyBandit = evaluateForConfig(
        {
          hyperAgentEnabled: state.hyperAgentEnabled ?? false,
          hyperAgentMode: state.hyperAgentMode ?? HyperAgentMode.OFF,
          autonomyLevel: state.autonomyLevel ?? AutonomyLevel.L0,
        },
        AutonomyCapability.REPLAN_WITHIN_APPROVED,
      ).allowed;
      const sel = applyBanditToPlan(plan, recalled, applyBandit, deps.bandit);
      plan = sel.plan;
      banditSelections = sel.selections;
    } catch {
      // Non-fatal: recall/bandit must never fail the plan. The LLM-produced
      // plan stands; the run continues without recalled memory.
    }
  }

  return {
    plan,
    status: WorkflowStatus.ROUTING,
    traces,
    ...(relevantLearnings ? { relevantLearnings } : {}),
    ...(banditSelections && banditSelections.length > 0 ? { banditSelections } : {}),
  };
}

/** A valid AgentRole value set, for defensive validation of recalled configs. */
const VALID_ROLES: ReadonlySet<string> = new Set(Object.values(AgentRole) as string[]);

/**
 * Run bandit config selection over a plan's tasks. For each task, if ≥1
 * PROMOTED WORKFLOW config learning exists for its task type, build arms and
 * call `selectArm`. Apply the override only when autonomy allows AND the pick
 * is exploitation AND the selected config differs from the task's current
 * config. Returns the (possibly revised) plan + a record of every selection
 * (applied or not) for cockpit visibility. Pure given (plan, recalled, applyAllowed).
 *
 * Exported for direct unit testing of the recall→bandit→override logic without
 * having to drive the full planner (which needs an LLM). The live planner node
 * is the only call site in production.
 */
export function applyBanditToPlan(
  plan: WorkflowPlan,
  recalled: ReadonlyArray<RecalledLearning>,
  applyAllowed: boolean,
  banditCfg?: MetaOptimiserConfig,
): { plan: WorkflowPlan; selections: NonNullable<SwarmState['banditSelections']> } {
  const selections: NonNullable<SwarmState['banditSelections']> = [];
  const tasks = plan.tasks.map((task) => {
    const taskType = task.id.split('_')[0] ?? '';
    const arms = armsForTaskType(recalled, taskType);
    if (arms.length === 0) return task;
    const selection = selectArm(arms, banditCfg);
    const chosen = arms.find((a) => a.id === selection.armId);
    const selectedConfig = chosen?.configVersionId;
    const currentConfig = `${task.agentRole}/${task.toolsRequired[0] ?? ''}`;
    const applied =
      applyAllowed &&
      !selection.exploration &&
      selectedConfig !== undefined &&
      selectedConfig !== currentConfig;
    selections.push({
      taskId: task.id,
      taskType,
      selectedKey: selection.armId,
      selectedConfig,
      applied,
      strategy: selection.strategy,
      score: selection.score,
      reason: selection.reason,
    });
    if (!applied || !selectedConfig) return task;
    // Override the task's agent role + primary tool to the bandit-selected
    // config. The config string is `${agentRole}/${primaryTool}`; both halves
    // came from a prior run's WorkflowTask, so the role is a valid AgentRole —
    // validate defensively before casting (a corrupted row must never crash).
    const slash = selectedConfig.indexOf('/');
    if (slash <= 0) return task;
    const roleStr = selectedConfig.slice(0, slash);
    const tool = selectedConfig.slice(slash + 1);
    if (!VALID_ROLES.has(roleStr) || !tool) return task;
    return {
      ...task,
      agentRole: roleStr as AgentRole,
      toolsRequired: [tool, ...task.toolsRequired.slice(1)],
    } satisfies WorkflowTask;
  });
  return { plan: { ...plan, tasks }, selections };
}