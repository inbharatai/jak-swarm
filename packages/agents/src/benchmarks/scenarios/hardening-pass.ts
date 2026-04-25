/**
 * Hardening pass benchmark scenarios.
 *
 * The user explicitly listed these 10 scenarios as the minimum proof set:
 *   1. Simple planning task
 *   2. Research task
 *   3. CMO task
 *   4. VibeCoder file inspection task
 *   5. Approval-required action
 *   6. Mock/draft adapter truth test
 *   7. Async worker task
 *   8. Cockpit event visibility test
 *   9. Workflow cancel test
 *  10. Workflow resume test
 *
 * Note on scope:
 *   The benchmark harness in this folder runs LLM-level scenarios — it
 *   constructs in-process runtimes and exercises a single agent's
 *   `respond` / `callTools` path. Scenarios 5, 6, 7, 8, 9, 10 require
 *   the FULL workflow stack (DB + queue worker + approval-node + SSE
 *   route). Those are documented here as scenarios but their
 *   `runMode` is set to 'integration' and the harness skips them with
 *   a clear note. The CLI runner reports them as "deferred to integration
 *   suite" instead of pretending they ran.
 *
 *   Scenarios 1-4 run end-to-end against the runtimes the harness was
 *   designed for — pure LLM correctness checks.
 */

import type { BenchmarkScenario } from '../harness.js';

export type ScenarioRunMode = 'llm' | 'integration';

export interface HardeningScenario extends BenchmarkScenario {
  runMode: ScenarioRunMode;
  /** Why the integration scenarios can't run in this in-process harness. */
  integrationNote?: string;
}

export const HARDENING_PASS_SCENARIOS: HardeningScenario[] = [
  {
    id: 'planning-simple',
    name: '1. Simple planning task',
    role: 'PLANNER',
    runMode: 'llm',
    goal:
      'Decompose this goal into 1-3 tasks: "Write a 200-word LinkedIn post for JAK Swarm enterprise launch."',
    expect: [
      /tasks/i,
      /WORKER_CONTENT/i,
      /linkedin|post|content/i,
    ],
    timeoutMs: 60_000,
  },
  {
    id: 'research-task',
    name: '2. Research task',
    role: 'WORKER_RESEARCH',
    runMode: 'llm',
    goal:
      'Research current state of LangGraph as a multi-agent orchestration framework. List 3 strengths and 3 weaknesses.',
    expect: [/langgraph/i, /strength/i, /weakness/i],
    timeoutMs: 180_000,
  },
  {
    id: 'cmo-linkedin-post',
    name: '3. CMO writes LinkedIn launch post (200-300 words)',
    role: 'WORKER_CONTENT',
    runMode: 'llm',
    goal:
      'Write a 200-300 word LinkedIn announcement for JAK Swarm — enterprise multi-agent platform. Hook → 3 capabilities → CTA.',
    expect: [/jak swarm/i, /enterprise|business|platform/i],
    timeoutMs: 120_000,
  },
  {
    id: 'vibecoder-inspect',
    name: '4. VibeCoder inspects a file and reports on structure',
    role: 'WORKER_CODER',
    runMode: 'llm',
    goal:
      'Given a TypeScript module that exports a function `add(a:number,b:number):number` and one called `subtract`, list the functions, their signatures, and one improvement you would suggest.',
    expect: [/add/i, /subtract/i, /(number|signature|param)/i],
    timeoutMs: 60_000,
  },
  {
    id: 'approval-required',
    name: '5. Approval-required action — workflow halts at AWAITING_APPROVAL',
    role: 'WORKER_EMAIL',
    runMode: 'integration',
    integrationNote:
      'Requires the full SwarmGraph + approval-node + DB. Verify by sending "Send an email to test@example.com about X" with autoApproveEnabled=false and confirming `paused` SSE event arrives + DB workflow.status === PAUSED.',
    goal: '(integration scenario — see runMode)',
  },
  {
    id: 'mock-draft-truth',
    name: '6. Mock / draft adapter truth — outcome surfaced honestly',
    role: 'WORKER_EMAIL',
    runMode: 'integration',
    integrationNote:
      'Requires real tool registry + tenant policy. Verify by calling email tool when GMAIL_EMAIL is unset; ' +
      'tool registry should return ToolResult with outcome="not_configured", and the cockpit ' +
      'tool_completed event should display "⚙ not connected" (not green ✓ success).',
    goal: '(integration scenario — see runMode)',
  },
  {
    id: 'async-worker',
    name: '7. Async / background worker task — events stream while detached',
    role: 'WORKER_RESEARCH',
    runMode: 'integration',
    integrationNote:
      'Requires queue worker + Redis pub/sub. Verify by enqueuing a workflow via POST /workflows, ' +
      'closing the SSE connection, reopening it, and confirming events resume from the current state.',
    goal: '(integration scenario — see runMode)',
  },
  {
    id: 'cockpit-event-visibility',
    name: '8. Cockpit event visibility — all 7 SSE events fire end-to-end',
    role: 'COMMANDER',
    runMode: 'integration',
    integrationNote:
      'Requires browser + SSE listener. Verify by running a multi-step workflow and confirming each of the ' +
      'documented event types arrives in DevTools Network → EventSource: started, plan_created, worker_started, ' +
      'tool_called, tool_completed, cost_updated, worker_completed, completed.',
    goal: '(integration scenario — see runMode)',
  },
  {
    id: 'workflow-cancel',
    name: '9. Workflow cancel — runtime honors cancel signal at next node boundary',
    role: 'COMMANDER',
    runMode: 'integration',
    integrationNote:
      'Requires SwarmRunner + cancel signals. Verify by starting a long workflow then calling DELETE /workflows/:id; ' +
      'workflow.status should flip to CANCELLED within ~5s (the next node boundary checks the cancel flag) and ' +
      'no further SSE events fire after the cancel event.',
    goal: '(integration scenario — see runMode)',
  },
  {
    id: 'workflow-resume',
    name: '10. Workflow resume — approval grant continues from saved checkpoint',
    role: 'COMMANDER',
    runMode: 'integration',
    integrationNote:
      'Requires DbWorkflowStateStore + approval-node + WorkflowRuntime.resume. Verify by triggering a ' +
      'workflow that pauses for approval, granting it via POST /approvals/:id/decide with APPROVED, ' +
      'and confirming the workflow continues to COMPLETED with the saved state intact.',
    goal: '(integration scenario — see runMode)',
  },
];

/**
 * Convenience helper for the CLI runner — split scenarios by mode so
 * integration scenarios can be skipped with a clear "deferred" note
 * instead of silently failing.
 */
export function partitionByMode(scenarios: HardeningScenario[]): {
  llm: HardeningScenario[];
  integration: HardeningScenario[];
} {
  return {
    llm: scenarios.filter((s) => s.runMode === 'llm'),
    integration: scenarios.filter((s) => s.runMode === 'integration'),
  };
}
