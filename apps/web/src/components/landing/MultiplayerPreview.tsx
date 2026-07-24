const people = [
  { initials: 'RG', label: 'Founder', tone: 'bg-emerald-400 text-zinc-950' },
  { initials: 'PS', label: 'Reviewer', tone: 'bg-amber-300 text-zinc-950' },
  { initials: 'HB', label: 'Marketing', tone: 'bg-sky-300 text-zinc-950' },
];

const rows = [
  {
    owner: 'Research Agent',
    state: 'Redirected',
    detail: 'Focus changed to Hindi, Assamese, and Bengali offline-first users.',
    stateClass: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  },
  {
    owner: 'Finance Reviewer',
    state: 'Human input',
    detail: 'Verify the market-size claim before dependent work continues.',
    stateClass: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  },
  {
    owner: 'Content Agent',
    state: 'Waiting',
    detail: 'Blocked until the reviewer submits a verified result.',
    stateClass: 'border-white/10 bg-white/[0.04] text-zinc-300',
  },
];

export default function MultiplayerPreview() {
  return (
    <div
      className="mx-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/85 text-left shadow-2xl shadow-emerald-950/20"
      aria-label="Illustration of a shared JAK workflow session"
    >
      <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">Shared workflow session</p>
          <p className="mt-1 text-sm font-semibold text-white sm:text-base">Launch an offline-first AI campaign</p>
        </div>
        <div className="flex items-center gap-2" aria-label="Three human participants present">
          {people.map((person) => (
            <div key={person.initials} className="group relative">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-zinc-950 ${person.tone}`}>
                {person.initials}
              </div>
              <span className="pointer-events-none absolute right-0 top-10 z-20 hidden whitespace-nowrap rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-200 group-hover:block">
                {person.label}
              </span>
            </div>
          ))}
          <span className="ml-1 inline-flex items-center gap-1.5 text-xs text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
            3 people live
          </span>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">One task graph</p>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-medium text-emerald-200">
              Paused for review
            </span>
          </div>
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={row.owner} className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-black/30 text-[10px] font-mono text-zinc-400">
                    {index + 1}
                  </span>
                  <p className="text-sm font-semibold text-white">{row.owner}</p>
                  <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium ${row.stateClass}`}>
                    {row.state}
                  </span>
                </div>
                <p className="mt-2 pl-8 text-xs leading-5 text-zinc-400">{row.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <aside className="border-t border-white/10 bg-black/20 p-5 sm:p-6 lg:border-l lg:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Shared timeline</p>
          <div className="mt-4 space-y-5">
            <TimelineItem actor="Founder" action="created the goal" time="09:41" />
            <TimelineItem actor="Marketing" action="redirected Research Agent" time="09:44" accent />
            <TimelineItem actor="JAK" action="versioned the plan" time="09:44" />
            <TimelineItem actor="Finance" action="received a human task" time="09:45" warning />
          </div>
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.025] p-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Control</p>
            <p className="mt-1 text-xs leading-5 text-zinc-300">Pause, redirect, hand off, approve, and replay without losing the workflow history.</p>
          </div>
        </aside>
      </div>

      <p className="border-t border-white/10 px-5 py-3 text-center text-[10px] text-zinc-600 sm:px-6">
        Illustrative view of the implemented multiplayer workflow model.
      </p>
    </div>
  );
}

function TimelineItem({
  actor,
  action,
  time,
  accent = false,
  warning = false,
}: {
  actor: string;
  action: string;
  time: string;
  accent?: boolean;
  warning?: boolean;
}) {
  const dot = warning ? 'bg-amber-300' : accent ? 'bg-sky-300' : 'bg-emerald-400';
  return (
    <div className="relative pl-5">
      <span className={`absolute left-0 top-1 h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      <p className="text-xs leading-5 text-zinc-300">
        <span className="font-semibold text-white">{actor}</span> {action}
      </p>
      <p className="text-[10px] text-zinc-600">{time}</p>
    </div>
  );
}
