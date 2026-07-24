const capabilities = [
  {
    title: 'Shared workflow participants',
    body: 'Owners, editors, reviewers, and viewers can join the same tenant-scoped workflow session.',
    evidencePath: 'packages/db/prisma/migrations/125_multiplayer_collaboration/migration.sql',
  },
  {
    title: 'Presence and task control',
    body: 'Heartbeat-based presence shows who is active, while short control leases prevent conflicting task interventions.',
    evidencePath: 'apps/api/src/services/workflow-collaboration.service.ts',
  },
  {
    title: 'Human ↔ agent handoffs',
    body: 'A task can move to a teammate, pause the workflow, accept a human result, and continue dependent agent work.',
    evidencePath: 'apps/api/src/routes/task-assignments.routes.ts',
  },
  {
    title: 'Safe task redirection',
    body: 'Editors can pause a run, change a task, version the plan, and resume without silently rewriting history.',
    evidencePath: 'apps/api/src/routes/workflow-collaboration.routes.ts',
  },
  {
    title: 'One collaboration timeline',
    body: 'Comments, joins, handoffs, redirects, approvals, and runtime events are persisted and streamed to the session.',
    evidencePath: 'apps/api/src/routes/workflows/workflow-stream.routes.ts',
  },
  {
    title: 'Replayable work',
    body: 'The replay endpoint combines participants, session events, traces, approvals, human tasks, artifacts, and audit records.',
    evidencePath: 'apps/web/src/app/(dashboard)/workflows/[workflowId]/session/page.tsx',
  },
] as const;

export default function MultiplayerSection() {
  return (
    <section id="multiplayer" className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(56,189,248,0.08),transparent_36%)]" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-300">Multiplayer AI</p>
          <h2 className="mt-4 text-3xl font-display font-bold tracking-tight text-white sm:text-5xl">
            Agent work becomes a shared team session.
          </h2>
          <p className="mt-5 text-base leading-7 text-zinc-300 sm:text-lg">
            People do not receive a read-only transcript after the agents finish. They join the same workflow, see what is happening, redirect individual tasks, take over work, approve external actions, and inspect the complete history.
          </p>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((capability, index) => (
            <article
              key={capability.title}
              data-evidence-path={capability.evidencePath}
              className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition-colors hover:border-sky-300/25 hover:bg-sky-300/[0.035]"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-300/20 bg-sky-300/10 text-xs font-bold text-sky-200">
                {String(index + 1).padStart(2, '0')}
              </div>
              <h3 className="mt-5 text-lg font-display font-semibold text-white">{capability.title}</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-400">{capability.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] px-5 py-4 text-sm leading-6 text-zinc-300">
          <span className="font-semibold text-amber-200">Beta boundary:</span> JAK provides multiplayer workflow execution and a durable event history. It is not yet a character-level collaborative document editor or an offline CRDT system.
        </div>
      </div>
    </section>
  );
}
