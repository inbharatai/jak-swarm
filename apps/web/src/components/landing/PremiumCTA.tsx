import Link from 'next/link';

// These values are truth-locked by scripts/check-docs-truth.ts.
const CTA_STATS = [
  { value: '38', label: 'Agents' },
  { value: '122', label: 'Tools' },
  { value: '15', label: 'Integrations' },
  { value: 'MIT', label: 'Open Source' },
] as const;

export default function PremiumCTA() {
  return (
    <section className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8" aria-label="Get started with JAK">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(52,211,153,0.1),transparent_35%),radial-gradient(circle_at_70%_60%,rgba(251,191,36,0.07),transparent_28%)]" aria-hidden="true" />
      <div className="relative mx-auto max-w-5xl rounded-3xl border border-white/10 bg-zinc-950/75 px-6 py-12 text-center shadow-2xl shadow-black/30 sm:px-12 sm:py-16">
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-5 sm:grid-cols-4">
          {CTA_STATS.map((stat) => (
            <div key={stat.label} className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
              <p className="bg-gradient-to-r from-emerald-300 to-amber-300 bg-clip-text text-2xl font-display font-bold text-transparent">{stat.value}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">{stat.label}</p>
            </div>
          ))}
        </div>

        <p className="mt-12 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-300">Build with your team, not beside it</p>
        <h2 className="mx-auto mt-4 max-w-4xl text-4xl font-display font-bold tracking-tight text-white sm:text-6xl">
          Put people and agents in the same room.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg">
          Start a controlled beta workflow, invite teammates, intervene when direction changes, and keep approvals and evidence attached to the work itself.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/trial" className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-emerald-300 to-amber-300 px-7 py-3.5 text-sm font-bold text-zinc-950 transition-transform hover:-translate-y-0.5 sm:w-auto">
            Start 30-day beta
          </Link>
          <a href="https://github.com/inbharatai/jak-swarm/blob/main/docs/multiplayer-ai.md" target="_blank" rel="noopener noreferrer" className="inline-flex w-full items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-7 py-3.5 text-sm font-semibold text-white hover:bg-white/[0.07] sm:w-auto">
            Read the multiplayer docs
          </a>
        </div>

        <p className="mt-5 text-xs text-zinc-600">Working beta · self-hostable · high-risk actions remain approval-gated</p>
      </div>
    </section>
  );
}
