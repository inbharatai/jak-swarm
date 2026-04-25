# Benchmark results — OpenAI-first runtime

**Status:** scenarios + harness + CLI runner shipped; live run not executed in this audit (would spend ~$0.05 of OpenAI credit and require an interactive shell with `OPENAI_API_KEY` set).

**To run:**

```bash
export OPENAI_API_KEY=sk-...
pnpm bench:runtime              # 4 LLM scenarios, OpenAI only, ~$0.05
pnpm bench:runtime -- --core    # 7 persona-core scenarios instead
```

Output is written to:

- `qa/_generated/bench-runtime.json` — machine-readable
- `qa/benchmark-results-openai-first.md` — overwrites this file with the live results

## Scenarios — what runs

| # | Scenario | Run mode | Status | Notes |
|---|---|---|---|---|
| 1 | Simple planning task (PLANNER role) | llm | shipped | Decomposes a single goal into 1-3 tasks. Asserts WORKER_CONTENT routing. |
| 2 | Research task (WORKER_RESEARCH) | llm | shipped | LangGraph framework comparison. Asserts the 3 frameworks appear in output. |
| 3 | CMO LinkedIn post (WORKER_CONTENT) | llm | shipped | 200-300 word launch post. Asserts JAK Swarm + enterprise/business mention. |
| 4 | VibeCoder file inspection (WORKER_CODER) | llm | shipped | Inspect a TS module, list functions, suggest improvement. |
| 5 | Approval-required action | integration | deferred | Requires DB + approval-node + SSE stack. See verification recipe below. |
| 6 | Mock/draft adapter truth | integration | deferred | Requires real tool registry + tenant policy. See recipe. |
| 7 | Async/background worker task | integration | deferred | Requires queue worker + Redis pub/sub. See recipe. |
| 8 | Cockpit event visibility | integration | deferred | Requires browser + EventSource. See recipe. |
| 9 | Workflow cancel | integration | deferred | Requires SwarmRunner + cancel signals. See recipe. |
| 10 | Workflow resume | integration | deferred | Requires DbWorkflowStateStore + WorkflowRuntime.resume. See recipe. |

**Honest scope:** the in-process LLM harness can prove correctness of scenarios 1-4 (LLM call → schema-validated output). Scenarios 5-10 require the full deployed stack and are documented as integration-suite work. The CLI runner reports them as "deferred to integration suite" with the verification recipe baked into the JSON output instead of pretending they ran.

## Integration scenario verification recipes

These run against staging or local `pnpm start:dev` with browser DevTools open. Each is a manual checklist the human verifier walks through.

### 5. Approval-required action

1. Send a chat message: `"Send an email to test@example.com saying hello"`.
2. Open DevTools → Network → Filter `/stream`.
3. Confirm an event with `type: "paused"` and `reason: "awaiting_approval"` arrives within ~10s.
4. Confirm the chat shows an approval link (added in Stage 2.4 of the cockpit work).
5. Confirm the right-hand cockpit drawer shows the workflow status badge as `awaiting_approval`.

**Pass criteria:** SSE `paused` event arrives, cockpit badge flips, approval link appears.

### 6. Mock/draft adapter truth

1. Ensure `GMAIL_EMAIL` is unset in the deploy env.
2. Trigger any workflow that calls `send_email` or `create_email_draft`.
3. Open DevTools → Network → `/stream`.
4. Find the `tool_completed` event for the email tool.
5. Confirm the event payload carries `outcome: "not_configured"` (not `"real_success"`).
6. In the chat, confirm the tool row shows "⚙ not connected" (not "✓ done").

**Pass criteria:** outcome field is `not_configured` AND UI badge reflects it.

### 7. Async/background worker task

1. Submit a long-running workflow (e.g. a multi-step research task).
2. Within ~5s, navigate away from `/workspace` (or close the browser tab).
3. Wait 30s. Reopen `/workspace`.
4. Look up the workflow via `/swarm`. Confirm it reached `COMPLETED` (or progressed past where you left it).
5. Confirm DB `workflow.completedAt` is set and `workflow.totalCostUsd > 0`.

**Pass criteria:** workflow finishes despite browser disconnect; final state persisted to DB.

### 8. Cockpit event visibility — all SSE event types

Run a multi-step workflow (e.g. `"Write a SWOT for an AI company"`) and verify ALL of these arrive in `/stream`:

- `connected`
- `started`
- `plan_created`
- `worker_started`
- `tool_called` (if the planner/worker uses any tools)
- `tool_completed`
- `cost_updated` (one per LLM call)
- `worker_completed`
- `completed`

**Pass criteria:** all 8 expected event types observed at least once across the run.

### 9. Workflow cancel

1. Start a long workflow.
2. Within ~5s, call `DELETE /workflows/:id`.
3. Confirm the workflow status flips to `CANCELLED` within ~5s (next node boundary check).
4. Confirm no further `worker_started` / `cost_updated` events fire.
5. DB `workflow.completedAt` should be set, `workflow.error` should mention cancellation.

**Pass criteria:** runtime honors cancel cooperatively at next boundary; no orphaned events.

### 10. Workflow resume

1. Start a workflow that triggers an approval gate (see scenario 5).
2. Confirm DB `workflow.status === 'PAUSED'` and an approval row exists.
3. Call `POST /approvals/:id/decide` with `{ decision: 'APPROVED' }`.
4. Confirm a new `started` (or equivalent) event in `/stream` for the same workflowId.
5. Confirm the workflow continues to `COMPLETED` with the saved checkpoint state intact (e.g. previously-completed tasks are NOT re-run).

**Pass criteria:** resume continues from the saved checkpoint, not from scratch.

## Why this isn't a full benchmark report yet

The harness is built. The scenarios are real. The CLI is wired. What's missing is **the actual run**, which requires either:

- The user running `pnpm bench:runtime` locally with a real OpenAI key (one-shot, ~$0.05 cost), OR
- A CI workflow that runs it on every push (would need an OPENAI_API_KEY secret in GitHub Actions)

This file gets overwritten with real numbers the first time `pnpm bench:runtime` runs. The integration-deferred section above is independent — those scenarios produce no LLM cost and run only via the human verification checklist.
