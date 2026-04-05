import type { ToolCall } from '@jak-swarm/shared';
import type { VerificationResult } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';

// ─── Validation Warning ──────────────────────────────────────────────────────

export interface ValidationWarning {
  check: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ValidationResult {
  passed: boolean;
  warnings: ValidationWarning[];
}

// ─── Hallucination Patterns (lightweight heuristic layer) ────────────────────

const GROUNDING_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\b(as of|according to|data shows|research indicates|studies show)\b.*\b\d+%\b/i,
    description: 'Statistical claim without tool-result backing',
  },
  {
    pattern: /\b(confirmed|verified|processed|completed|sent)\b.*\b(successfully|automatically)\b/i,
    description: 'Action completion claim — needs tool-call evidence',
  },
  {
    pattern: /\b(I have already|I already|I've already|I just|I went ahead and)\b/i,
    description: 'Agent self-reports action without tool-call evidence',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidJson(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'object') return true;
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Checks whether the output contradicts itself by looking for opposing
 * sentiment markers in the same text block.
 */
function detectContradictions(text: string): string[] {
  const contradictions: string[] = [];

  const pairs: Array<[RegExp, RegExp, string]> = [
    [/\bsuccess(ful|fully)?\b/i, /\bfail(ed|ure|s)?\b/i, 'Claims both success and failure'],
    [/\bincreased?\b/i, /\bdecreased?\b/i, 'Claims both increase and decrease of the same metric'],
    [/\bapproved?\b/i, /\brejected?\b/i, 'Claims both approved and rejected'],
    [/\bno (?:issues|errors|problems)\b/i, /\berror|issue|problem\b/i, 'States no issues but references issues'],
  ];

  for (const [positive, negative, msg] of pairs) {
    if (positive.test(text) && negative.test(text)) {
      contradictions.push(msg);
    }
  }

  return contradictions;
}

/**
 * Checks whether factual claims in the output are grounded in tool call results.
 */
function checkGrounding(
  outputStr: string,
  toolCalls: ToolCall[] | undefined,
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  if (!toolCalls || toolCalls.length === 0) {
    // No tool calls — any action claim is suspicious
    for (const { pattern, description } of GROUNDING_PATTERNS) {
      if (pattern.test(outputStr)) {
        warnings.push({
          check: 'grounding',
          message: description,
          severity: 'high',
        });
      }
    }
    return warnings;
  }

  // Build a set of successful tool names
  const executedTools = new Set<string>();
  for (const tc of toolCalls) {
    if (!tc.error) {
      executedTools.add(tc.toolName);
    }
  }

  for (const { pattern, description } of GROUNDING_PATTERNS) {
    if (pattern.test(outputStr)) {
      // If agent claims action but no matching tool was executed, flag it
      if (executedTools.size === 0) {
        warnings.push({
          check: 'grounding',
          message: description,
          severity: 'high',
        });
      }
    }
  }

  return warnings;
}

// ─── Main Validator Node ─────────────────────────────────────────────────────

/**
 * Double-validation node — runs AFTER the verifier as an independent second check.
 *
 * It performs:
 *  1. Schema check: is the output valid JSON with expected shape?
 *  2. Cross-reference: do claims match tool call results?
 *  3. Consistency: does the output contradict itself?
 *  4. Grounding: are factual claims backed by tool results?
 *
 * If validation fails it adds warnings but does NOT fail the task.
 */
export async function validatorNode(state: SwarmState): Promise<Partial<SwarmState>> {
  // ── Disabled via env ─────────────────────────────────────────────────────
  if (process.env['JAK_DOUBLE_VALIDATION'] === 'false') {
    return {};
  }

  const task = getCurrentTask(state);
  if (!task) return {};

  const taskOutput = state.taskResults[task.id];
  const verificationResult: VerificationResult | undefined =
    state.verificationResults[task.id];

  // Only run when verifier has already PASSED. If verifier failed, no point
  // in double-checking — the task is already flagged.
  if (!verificationResult?.passed) {
    return {};
  }

  const warnings: ValidationWarning[] = [];

  // ── 1. Schema check ──────────────────────────────────────────────────────
  if (!isValidJson(taskOutput)) {
    warnings.push({
      check: 'schema',
      message: 'Task output is not valid JSON',
      severity: 'medium',
    });
  } else if (typeof taskOutput === 'object' && taskOutput !== null) {
    const obj = taskOutput as Record<string, unknown>;
    // A well-formed output should have at least one meaningful key
    if (Object.keys(obj).length === 0) {
      warnings.push({
        check: 'schema',
        message: 'Task output is an empty object',
        severity: 'medium',
      });
    }
  }

  // ── 2. Stringify for text-based checks ────────────────────────────────────
  const outputStr =
    typeof taskOutput === 'string' ? taskOutput : JSON.stringify(taskOutput ?? '');

  // ── 3. Cross-reference: extract tool calls from traces ────────────────────
  // The traces array in state may contain tool call info from the current task's
  // worker execution. We extract them for grounding checks.
  const taskTraces = state.traces.filter(
    (t) => t.agentRole === task.agentRole,
  );
  const toolCalls: ToolCall[] = [];
  for (const trace of taskTraces) {
    if (trace.toolCalls) {
      toolCalls.push(...trace.toolCalls);
    }
  }

  const groundingWarnings = checkGrounding(outputStr, toolCalls.length > 0 ? toolCalls : undefined);
  warnings.push(...groundingWarnings);

  // ── 4. Consistency check ──────────────────────────────────────────────────
  const contradictions = detectContradictions(outputStr);
  for (const contradiction of contradictions) {
    warnings.push({
      check: 'consistency',
      message: contradiction,
      severity: 'medium',
    });
  }

  // ── 5. Placeholder / garbage check ────────────────────────────────────────
  if (/lorem ipsum/i.test(outputStr)) {
    warnings.push({
      check: 'quality',
      message: 'Output contains placeholder text (Lorem ipsum)',
      severity: 'high',
    });
  }

  if (outputStr.length < 10 && task.toolsRequired.length > 0) {
    warnings.push({
      check: 'quality',
      message: 'Output appears trivially short for a task requiring tool usage',
      severity: 'medium',
    });
  }

  // ── Build result ──────────────────────────────────────────────────────────
  if (warnings.length === 0) {
    // Clean bill of health — no state changes needed
    return {};
  }

  // Attach warnings to the task result but do NOT fail the task.
  // We store them alongside the existing verification result so downstream
  // consumers (UI, analytics) can surface them.
  const updatedVerification: VerificationResult = {
    ...verificationResult,
    // Keep passed=true — validator only warns, never overrides verifier verdict
    passed: true,
    issues: [
      ...verificationResult.issues,
      ...warnings.map((w) => `[validator/${w.check}] ${w.message}`),
    ],
  };

  // Annotate the plan task with a warning flag (status stays COMPLETED)
  const updatedPlan = state.plan
    ? {
        ...state.plan,
        tasks: state.plan.tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                error: t.error
                  ? `${t.error} | Validator warnings: ${warnings.map((w) => w.message).join('; ')}`
                  : `Validator warnings: ${warnings.map((w) => w.message).join('; ')}`,
              }
            : t,
        ),
      }
    : state.plan;

  return {
    verificationResults: { [task.id]: updatedVerification },
    plan: updatedPlan,
  };
}
