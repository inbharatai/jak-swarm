# Multiplayer AI in JAK Swarm

JAK's multiplayer layer puts humans and agents on the same durable workflow rather than adding a second chat system beside the runtime.

## What is implemented

### Shared workflow participants

Every workflow can have first-class participants with one of four roles:

- `OWNER` — the workflow creator
- `EDITOR` — may intervene in work
- `REVIEWER` — may intervene and review approval-gated actions
- `VIEWER` — may watch and comment, but cannot redirect tasks

Presence is based on a 45-second heartbeat window. Participants may claim a short task-control lease so two teammates cannot redirect the same task simultaneously.

### Append-only shared timeline

`workflow_session_events` records human, agent, and system activity with a monotonic sequence number. It is the collaboration history for:

- joins and leaves
- comments and mentions
- human task assignment, acknowledgement, completion, decline, and cancellation
- task redirects and branch controls
- future agent lifecycle mirroring

Events are persisted first and also emitted on the existing `workflow:<workflowId>` SSE channel with `kind: "collaboration"`.

### Human task bridge

The human handoff path is now durable:

```text
Task assigned to a person
  -> TaskAssignment persisted
  -> pendingHumanTasks written into Workflow.stateJson
  -> workflow PAUSED + distributed pause signal
  -> assignee completes the task
  -> result written into taskResults[taskId]
  -> completedTaskIds updated
  -> pendingHumanTasks gate cleared
  -> workflow resumes through the distributed unpause signal
  -> dependent agents continue from the saved checkpoint
```

A pending approval still blocks generic resume. Human completion cannot bypass an unrelated approval gate.

### Safe task redirection

A task may only be redirected while the workflow is `PAUSED`. This prevents the database plan and an executing worker from diverging.

A redirect:

1. updates `Workflow.planJson`;
2. updates the plan embedded in `Workflow.stateJson`;
3. appends a complete snapshot to `plan_versions`;
4. emits a collaboration event;
5. leaves resume as an explicit operation.

The dashboard's multiplayer page performs the safe sequence automatically: pause, wait for the persisted `PAUSED` state, redirect, then unpause.

### Replay

`GET /workflows/:workflowId/replay` returns a consolidated record containing:

- workflow and plan state
- participants
- collaboration events
- agent traces
- approvals
- human tasks
- produced artifacts
- audit events

The dashboard can export this replay as JSON.

## API

All routes require authentication and tenant ownership of the workflow.

```text
GET    /workflows/:workflowId/participants
POST   /workflows/:workflowId/participants/join
POST   /workflows/:workflowId/participants/heartbeat
DELETE /workflows/:workflowId/participants/me

GET    /workflows/:workflowId/session-events
POST   /workflows/:workflowId/comments
POST   /workflows/:workflowId/tasks/:taskId/redirect
GET    /workflows/:workflowId/replay
```

Human assignments continue to use:

```text
POST /task-assignments
POST /task-assignments/:id/acknowledge
POST /task-assignments/:id/complete
POST /task-assignments/:id/decline
POST /task-assignments/:id/cancel
```

## Dashboard

Open:

```text
/workflows/<workflowId>/session
```

The page provides:

- participant presence
- task-control leases
- a shared event timeline
- task-scoped comments
- safe task redirection
- workflow pause/resume controls
- replay export

## Database migration

Migration:

```text
packages/db/prisma/migrations/125_multiplayer_collaboration/migration.sql
```

The service intentionally uses parameterized raw SQL for the two collaboration tables. This keeps the migration additive and avoids requiring every existing Prisma query/client build to know about collaboration models before deployment. Existing workflow, user, trace, approval, and task-assignment models remain unchanged.

## Verification

Run the collaboration integration suite against a real Postgres container:

```bash
pnpm --filter @jak-swarm/tests exec vitest run integration/multiplayer-collaboration.test.ts
```

Then run the normal release gates:

```bash
pnpm typecheck
pnpm test
pnpm check:truth
pnpm lint
```

The integration suite verifies participant persistence, exclusive task control, ordered event history, versioned redirection, dual plan persistence, and human-result injection into saved swarm state.

## Honest boundaries

This release is multiplayer workflow execution, not a general-purpose CRDT editor. It does not yet provide character-level simultaneous document editing, cursor positions, video calling, or offline merge resolution. Comments and intervention events are durable, while the current dashboard refreshes their persisted state on a short interval and the runtime also exposes them over SSE.
