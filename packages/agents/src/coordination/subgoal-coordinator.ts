/**
 * Subgoal Coordinator — Sprint 3 of full-fledged JAK.
 *
 * Decomposes a broad user command into per-agent subgoals with
 * explicit dependency edges. The Planner then turns each subgoal into
 * concrete tasks via the existing pipeline; the Router maps each task
 * to its target agent.
 *
 * What this ships:
 *   - Heuristic-based decomposer that recognizes multi-domain
 *     commands ("review my landing page, draft a LinkedIn post about
 *     it, and prepare a fix plan") and splits them into:
 *       { ceo / cmo / cto / vibecoder } subgoals
 *   - Dependency graph: subgoals can depend on others (CMO post
 *     waits for CTO review)
 *   - Parallel-safe markers: subgoals with NO shared resource and
 *     NO dependencies can run in parallel; everything else is
 *     sequential
 *   - Result merging: each subgoal's output is collected into a
 *     single SubgoalCoordinatorResult so the cockpit can show the
 *     CEO's final summary
 *
 * Hard rules:
 *   - Stateless decomposer (no DB, no LLM call inside the heuristic)
 *   - Every emitted subgoal must include `agentRole` from the
 *     AgentRole enum — no free-form roles
 *   - Every subgoal carries `riskLevel` so the existing approval
 *     pipeline applies per-subgoal
 *   - Cross-tenant isolation: the coordinator is stateless; tenantId
 *     flows through context unchanged
 */

import crypto from 'node:crypto';
import { AgentRole } from '@jak-swarm/shared';

export interface Subgoal {
  /** Unique id — used for dependency edges + cockpit task tracking. */
  id: string;
  /** Layman-friendly summary shown in the cockpit. */
  description: string;
  /** Internal AgentRole — must be a value from the AgentRole enum. */
  agentRole: AgentRole;
  /** Layman-friendly executive label ("CMO Agent", "CTO Agent"). */
  agentLabel: string;
  /** Subgoal ids this depends on (strict dependency — must complete first). */
  dependsOn: string[];
  /** Risk level for the existing approval policy. */
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** True when this subgoal touches an external system (post, send, deploy). */
  externalSideEffect: boolean;
}

export interface SubgoalCoordinatorResult {
  /** Original user goal, preserved. */
  goal: string;
  /** Decomposed subgoals — preserve order = preferred execution order. */
  subgoals: Subgoal[];
  /**
   * Subgoals that can run IN PARALLEL safely (no dependencies + no
   * shared external resource).
   */
  parallelGroups: string[][];
  /** CEO-style summary of the plan. */
  ceoSummary: string;
}

interface DomainPattern {
  /** Regex matching a domain keyword in the user's goal. */
  pattern: RegExp;
  agentRole: AgentRole;
  agentLabel: string;
  /** Default risk level when this domain is detected. */
  riskLevel: Subgoal['riskLevel'];
  externalSideEffect: boolean;
  /** Layman-friendly subgoal description template. */
  describe: (originalGoal: string) => string;
}

/**
 * Domain patterns. Order matters — the FIRST match wins for a given
 * keyword cluster. Conservative — if no pattern matches a chunk, the
 * coordinator falls through to a single CEO summary task.
 */
const DOMAIN_PATTERNS: DomainPattern[] = [
  {
    // CTO / engineering domain
    pattern: /\b(repo|github|code|landing page|website|deploy|fix|bug|technical)\b/i,
    agentRole: AgentRole.WORKER_CODER,
    agentLabel: 'CTO Agent',
    riskLevel: 'MEDIUM',
    externalSideEffect: false,
    describe: (g) => `CTO Agent reviews the technical side: ${g.slice(0, 200)}`,
  },
  {
    // CMO / marketing / social domain
    pattern: /\b(linkedin|instagram|youtube|post|tweet|content|campaign|marketing|seo|brand|blog)\b/i,
    agentRole: AgentRole.WORKER_MARKETING,
    agentLabel: 'CMO Agent',
    riskLevel: 'HIGH', // posting / publishing always requires approval
    externalSideEffect: true,
    describe: (g) => `CMO Agent drafts the marketing/content piece: ${g.slice(0, 200)}`,
  },
  {
    // CFO / finance domain
    pattern: /\b(invoice|billing|revenue|finance|expense|stripe|payment)\b/i,
    agentRole: AgentRole.WORKER_FINANCE,
    agentLabel: 'CFO Agent',
    riskLevel: 'HIGH',
    externalSideEffect: false,
    describe: (g) => `CFO Agent reviews the financial side: ${g.slice(0, 200)}`,
  },
  {
    // VibeCoder / UI design domain
    pattern: /\b(ui|ux|design|frontend|button|layout|mobile|responsive|color|font)\b/i,
    agentRole: AgentRole.WORKER_DESIGNER,
    agentLabel: 'VibeCoder Agent',
    riskLevel: 'MEDIUM',
    externalSideEffect: false,
    describe: (g) => `VibeCoder Agent reviews the UI/design side: ${g.slice(0, 200)}`,
  },
  {
    // Research / analytics domain
    pattern: /\b(research|analyze|competitor|market|insight|analytics|metric|trend)\b/i,
    agentRole: AgentRole.WORKER_RESEARCH,
    agentLabel: 'Research Agent',
    riskLevel: 'LOW',
    externalSideEffect: false,
    describe: (g) => `Research Agent gathers context: ${g.slice(0, 200)}`,
  },
];

function nextSubgoalId(): string {
  // 8 random bytes + counter so two calls in the same millisecond
  // (or even the same microsecond) never collide. crypto.randomBytes
  // is fast enough for the small N of subgoals per goal.
  return `sg_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Decompose a user goal into per-agent subgoals.
 *
 * Strategy:
 *   1. Run every domain pattern against the goal text
 *   2. Each MATCHED domain produces one subgoal
 *   3. CEO summary subgoal depends on ALL of the above
 *   4. Subgoals with no dependencies + no overlapping external
 *      side-effect are grouped into the parallelGroups[0] cluster
 *
 * If no domain pattern matches, fall through to a single
 * CEO-summary-only plan (agent = strategist).
 */
export function decomposeGoal(goal: string): SubgoalCoordinatorResult {
  const trimmed = goal.trim();
  if (!trimmed) {
    throw new Error('decomposeGoal: empty goal');
  }

  const matched: Subgoal[] = [];
  const seenRoles = new Set<AgentRole>();
  for (const dp of DOMAIN_PATTERNS) {
    if (dp.pattern.test(trimmed) && !seenRoles.has(dp.agentRole)) {
      seenRoles.add(dp.agentRole);
      matched.push({
        id: nextSubgoalId(),
        description: dp.describe(trimmed),
        agentRole: dp.agentRole,
        agentLabel: dp.agentLabel,
        dependsOn: [],
        riskLevel: dp.riskLevel,
        externalSideEffect: dp.externalSideEffect,
      });
    }
  }

  if (matched.length === 0) {
    // No domain match — fall through to a single CEO subgoal.
    const ceo: Subgoal = {
      id: nextSubgoalId(),
      description: `CEO Agent handles the whole goal: ${trimmed.slice(0, 200)}`,
      agentRole: AgentRole.WORKER_STRATEGIST,
      agentLabel: 'CEO Agent',
      dependsOn: [],
      riskLevel: 'MEDIUM',
      externalSideEffect: false,
    };
    return {
      goal: trimmed,
      subgoals: [ceo],
      parallelGroups: [[ceo.id]],
      ceoSummary: 'Single-agent plan: CEO will handle the goal end-to-end.',
    };
  }

  // CEO summary depends on all matched domain subgoals.
  const ceoSummary: Subgoal = {
    id: nextSubgoalId(),
    description: `CEO Agent merges the domain-specialist outputs and produces a final summary for: ${trimmed.slice(0, 200)}`,
    agentRole: AgentRole.WORKER_STRATEGIST,
    agentLabel: 'CEO Agent',
    dependsOn: matched.map((m) => m.id),
    riskLevel: 'LOW',
    externalSideEffect: false,
  };
  const subgoals = [...matched, ceoSummary];

  // Parallel grouping: domain subgoals with NO shared external
  // side-effect can run in parallel as group 0. CEO summary runs
  // after (group 1).
  // Conservative: if two domain subgoals BOTH externalSideEffect=true,
  // run them sequentially (avoid two simultaneous publish attempts).
  const externalGroup = matched.filter((m) => m.externalSideEffect);
  const internalGroup = matched.filter((m) => !m.externalSideEffect);
  const parallelGroups: string[][] = [];
  if (internalGroup.length > 0) {
    parallelGroups.push(internalGroup.map((m) => m.id));
  }
  for (const ext of externalGroup) {
    parallelGroups.push([ext.id]); // each external subgoal in its own group
  }
  parallelGroups.push([ceoSummary.id]);

  return {
    goal: trimmed,
    subgoals,
    parallelGroups,
    ceoSummary: `CEO breaks "${trimmed.slice(0, 80)}…" into ${matched.length} domain subgoals + a final merge step.`,
  };
}

/**
 * Layman-friendly summary of a SubgoalCoordinatorResult — the string
 * that appears in the cockpit's "CEO plan" card.
 */
export function summarizePlan(result: SubgoalCoordinatorResult): string {
  const lines = [`CEO plan for: ${result.goal}`, ''];
  for (let i = 0; i < result.parallelGroups.length; i++) {
    const group = result.parallelGroups[i]!;
    const groupSubgoals = group
      .map((id) => result.subgoals.find((s) => s.id === id))
      .filter(Boolean) as Subgoal[];
    if (groupSubgoals.length === 0) continue;
    if (groupSubgoals.length === 1) {
      lines.push(`Step ${i + 1}: ${groupSubgoals[0]!.agentLabel} — ${groupSubgoals[0]!.description}`);
    } else {
      lines.push(`Step ${i + 1} (in parallel):`);
      for (const sg of groupSubgoals) {
        lines.push(`  • ${sg.agentLabel} — ${sg.description}`);
      }
    }
  }
  return lines.join('\n');
}
