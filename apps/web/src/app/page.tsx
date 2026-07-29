import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowRightIcon, CheckIcon, GitHubIcon, JakLogo } from '@/components/landing/LandingSvg';
import MultiplayerPreview from '@/components/landing/MultiplayerPreview';
import LandingRedirectClient from '@/components/landing/LandingRedirectClient';
import LandingNavClient from '@/components/landing/LandingNavClient';

const MultiplayerSection = dynamic(() => import('@/components/landing/MultiplayerSection'), { loading: () => <SectionSkeleton /> });
const EngineDuo = dynamic(() => import('@/components/landing/EngineDuo'), { loading: () => <SectionSkeleton /> });
const CompanyBrain = dynamic(() => import('@/components/landing/CompanyBrain'), { loading: () => <SectionSkeleton /> });
const Hyperagent = dynamic(() => import('@/components/landing/Hyperagent'), { loading: () => <SectionSkeleton /> });
const HowItWorks = dynamic(() => import('@/components/landing/HowItWorks'), { loading: () => <SectionSkeleton /> });
const ProductCockpit = dynamic(() => import('@/components/landing/ProductCockpit'), { loading: () => <SectionSkeleton /> });
const ShowTheWork = dynamic(() => import('@/components/landing/ShowTheWork'), { loading: () => <SectionSkeleton /> });
const PainSection = dynamic(() => import('@/components/landing/PainSection'), { loading: () => <SectionSkeleton /> });
const TrustLayer = dynamic(() => import('@/components/landing/TrustLayer'), { loading: () => <SectionSkeleton /> });
const JAKShield = dynamic(() => import('@/components/landing/JAKShield'), { loading: () => <SectionSkeleton /> });
const PremiumCTA = dynamic(() => import('@/components/landing/PremiumCTA'), { loading: () => <SectionSkeleton /> });

function SectionSkeleton() {
  return <div className="mx-auto my-16 h-64 max-w-5xl animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" aria-hidden="true" />;
}

const PRICING = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'A hosted starter plan for trying the core runtime.',
    features: ['200 credits / month', '30 credits / day', '1 concurrent workflow', 'Core agents', '1 vibe coding project', 'Tier 1 model access'],
    cta: 'Start Free',
    href: '/register',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$29',
    period: '/mo',
    description: 'Higher limits and the complete specialist-agent roster.',
    features: ['3,000 credits / month', '200 credits / day', '3 concurrent workflows', 'All 38 specialist agents', '5 vibe coding projects', '500 premium credits'],
    cta: 'Start Pro',
    href: '/register',
    highlighted: true,
  },
  {
    name: 'Team',
    price: '$99',
    period: '/mo',
    description: 'Shared execution capacity for growing teams.',
    features: ['15,000 credits / month', '600 credits / day', '10 concurrent workflows', 'All 38 specialist agents', 'Unlimited vibe coding projects', '3,000 premium credits', 'Bring your own provider keys'],
    cta: 'Start Team',
    href: '/register',
    highlighted: false,
  },
  {
    name: 'Enterprise',
    price: '$249',
    period: '/mo',
    description: 'The highest hosted limits, with enterprise deployment discussions handled directly.',
    features: ['50,000 credits / month', '2,000 credits / day', '50 concurrent workflows', 'All 38 specialist agents', 'Unlimited vibe coding projects', '15,000 premium credits', 'Bring your own provider keys'],
    cta: 'Contact Us',
    href: 'mailto:contact@inbharat.ai',
    highlighted: false,
  },
] as const;

export default function HomePage() {
  return (
    <>
      <style>{`
        @keyframes hero-enter {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .landing-hero {
          background: linear-gradient(135deg, #09090b, #071712, #09090b, #171207);
          background-size: 320% 320%;
          animation: gradient-shift 18s ease infinite;
        }
        .hero-enter { animation: hero-enter 0.8s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .landing-root h1.font-display,
        .landing-root h2.font-display,
        .landing-root h3.font-display { line-height: 1.16; padding-bottom: 0.05em; }
        @media (prefers-reduced-motion: reduce) {
          .landing-hero { animation: none; }
          .hero-enter { animation: none; }
        }
      `}</style>

      <a href="#main-content" className="skip-link">Skip to main content</a>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'JAK Swarm',
            description: 'JAK Swarm pairs Company Brain — a cited, permission-filtered graph of company evidence — with Hyperagent, a governed execution layer that runs approved plans, measures outcomes, and repairs bounded failures. Humans join the same live workflow session to watch, redirect, hand off, approve, and replay agent work.',
            applicationCategory: 'BusinessApplication',
            operatingSystem: 'Web',
            offers: [
              { '@type': 'Offer', price: '0', priceCurrency: 'USD', name: 'Free' },
              { '@type': 'Offer', price: '29', priceCurrency: 'USD', name: 'Pro' },
              { '@type': 'Offer', price: '99', priceCurrency: 'USD', name: 'Team' },
              { '@type': 'Offer', price: '249', priceCurrency: 'USD', name: 'Enterprise' },
            ],
            featureList: [
              'Company Brain cited evidence graph',
              'Hyperagent governed repair and learning loop',
              'Reviewer-approved executable specifications',
              'Tri-state acceptance measurement (MET / UNMET / UNVERIFIABLE)',
              'Shared human-agent workflow sessions',
              'Approval-gated external actions',
              'Replayable workflow history',
              '38 specialist agents',
              '122 classified tools',
              '15 connectors',
            ],
          }),
        }}
      />

      <LandingRedirectClient />

      <main id="main-content" className="landing-root min-h-screen overflow-x-hidden bg-[#09090b] font-sans text-white">
        <LandingNavClient />

        <section className="landing-hero relative overflow-hidden px-4 pb-24 pt-32 sm:px-6 lg:px-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(52,211,153,0.13),transparent_34%),radial-gradient(circle_at_82%_35%,rgba(251,191,36,0.09),transparent_30%)]" aria-hidden="true" />
          <div className="hero-enter relative z-10 mx-auto max-w-6xl text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="rounded-full border border-sky-300/25 bg-sky-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-200">Evidence-grounded AI beta</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-300">0.1.0-beta.0</span>
              <a href="#jak-shield" className="rounded-full border border-rose-300/25 bg-rose-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-200 hover:bg-rose-300/15">Governed by JAK Shield</a>
            </div>

            <h1 className="mx-auto mt-8 max-w-5xl text-4xl font-display font-bold tracking-tight sm:text-6xl lg:text-7xl">
              Company Brain + Hyperagent
              <span className="block bg-gradient-to-r from-emerald-300 via-sky-300 to-amber-300 bg-clip-text text-transparent">for evidence-grounded execution.</span>
            </h1>

            <p className="mx-auto mt-6 max-w-3xl text-base leading-7 text-zinc-300 sm:text-xl sm:leading-8">
              JAK Swarm builds cited understanding from your company&rsquo;s evidence, turns execution gaps into approved plans, and runs those plans through governed agents that verify outcomes and repair bounded failures — with humans in the loop at every risky step.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              {['Company Brain evidence graph', 'Hyperagent repair loop', '38 specialist agents', '122 classified tools', '15 connectors', 'Multiplayer control room'].map((item) => (
                <span key={item} className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-zinc-300">{item}</span>
              ))}
            </div>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/trial" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-300 to-amber-300 px-7 py-3.5 text-sm font-bold text-zinc-950 transition-transform hover:-translate-y-0.5 sm:w-auto">
                Start controlled beta
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <a href="#engines" className="inline-flex w-full items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-7 py-3.5 text-sm font-semibold text-white hover:bg-white/[0.07] sm:w-auto">
                See the two engines
              </a>
              <a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-7 py-3.5 text-sm font-semibold text-zinc-300 hover:border-white/25 hover:text-white sm:w-auto">
                <GitHubIcon className="h-4 w-4" />
                GitHub
              </a>
            </div>

            <p className="mt-4 text-xs text-zinc-500">30-day controlled beta · daily safety caps · no credit card required</p>

            <div className="mt-14">
              <MultiplayerPreview />
            </div>
          </div>
        </section>

        <section id="engines" className="border-b border-white/5 bg-white/[0.015] px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300">The two engines</p>
              <h2 className="mt-4 text-3xl font-display font-bold sm:text-5xl">Cited understanding in. Governed execution out.</h2>
              <p className="mt-5 text-base leading-7 text-zinc-400">Company Brain turns company evidence into a cited, permission-filtered graph of artifacts, claims, and execution drift. Hyperagent turns approved specifications into governed execution — measuring outcomes, diagnosing failures, and repairing bounded work. Multiplayer, connectors, and the specialist-agent runtime support these two engines.</p>
            </div>
            <EngineDuo />
          </div>
        </section>

        <MultiplayerSection />

        <CompanyBrain />
        <Hyperagent />
        <HowItWorks />
        <ProductCockpit />
        <ShowTheWork />
        <PainSection />
        <TrustLayer />
        <JAKShield />

        <section id="audit" className="relative px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl rounded-3xl border border-orange-300/15 bg-orange-300/[0.035] p-6 sm:p-10">
            <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-300">Auditability</p>
                <h2 className="mt-4 text-3xl font-display font-bold sm:text-5xl">Evidence is collected while the work happens.</h2>
                <p className="mt-5 text-base leading-7 text-zinc-300">JAK records approvals, traces, artifacts, human interventions, and signed evidence bundles. The compliance pack seeds 182 controls across SOC 2, HIPAA, and ISO 27001; this is operational tooling, not third-party certification.</p>
                <Link href="/audit/runs" className="mt-7 inline-flex items-center gap-2 rounded-xl border border-orange-300/25 bg-orange-300/10 px-5 py-3 text-sm font-semibold text-orange-100 hover:bg-orange-300/15">
                  Open audit workspace
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </div>
              <ul className="space-y-3 text-sm text-zinc-300">
                {[
                  '63 SOC 2 controls seeded',
                  '37 HIPAA Security Rule controls seeded',
                  '82 ISO/IEC 27001:2022 controls seeded',
                  'Reviewer-gated workpapers and signed evidence packs',
                  'No claim of certification or third-party attestation',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 rounded-xl border border-white/8 bg-black/15 p-3">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="pricing" className="border-y border-white/5 bg-white/[0.015] px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Hosted beta pricing</p>
              <h2 className="mt-4 text-3xl font-display font-bold sm:text-5xl">Clear limits, without invented extras.</h2>
              <p className="mt-5 text-base leading-7 text-zinc-400">The open-source core remains MIT licensed and self-hostable. The plans below reflect the current hosted credit, concurrency, model-tier, and project configuration.</p>
            </div>

            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {PRICING.map((tier) => (
                <article key={tier.name} className={`flex h-full flex-col rounded-2xl border p-6 ${tier.highlighted ? 'border-emerald-300/40 bg-emerald-300/[0.06] shadow-xl shadow-emerald-950/20' : 'border-white/10 bg-white/[0.025]'}`}>
                  {tier.highlighted ? <span className="mb-4 w-fit rounded-full bg-emerald-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-950">Most popular</span> : null}
                  <h3 className="text-lg font-display font-semibold">{tier.name}</h3>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-4xl font-display font-bold">{tier.price}</span>
                    <span className="text-sm text-zinc-500">{tier.period}</span>
                  </div>
                  <p className="mt-3 min-h-16 text-sm leading-6 text-zinc-400">{tier.description}</p>
                  <ul className="mt-5 space-y-2.5 text-sm text-zinc-300">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5">
                        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-7">
                    {tier.href.startsWith('mailto:') ? (
                      <a href={tier.href} className="block rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-center text-sm font-semibold text-amber-100 hover:bg-amber-300/15">{tier.cta}</a>
                    ) : (
                      <Link href={tier.href} className={`block rounded-xl px-4 py-3 text-center text-sm font-semibold ${tier.highlighted ? 'bg-gradient-to-r from-emerald-300 to-amber-300 text-zinc-950' : 'border border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.07]'}`}>{tier.cta}</Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <p className="mt-6 text-center text-xs text-zinc-600">Beta plan limits may change before general availability.</p>
          </div>
        </section>

        <PremiumCTA />

        <footer className="border-t border-white/5 px-4 py-14 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <JakLogo size={28} />
                <span className="font-display font-bold">JAK Swarm</span>
              </div>
              <p className="mt-4 max-w-md text-sm leading-6 text-zinc-500">A multiplayer workspace for human and AI teams, backed by durable workflows, evidence-grounded company context, approval gates, repair logic, and replayable execution history.</p>
              <p className="mt-3 text-xs text-zinc-600">Working beta · self-hostable · MIT licensed · not yet enterprise-SLA ready</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Product</h4>
              <ul className="mt-4 space-y-2.5 text-sm text-zinc-500">
                <li><a href="#multiplayer" className="hover:text-white">Multiplayer AI</a></li>
                <li><a href="#company-os" className="hover:text-white">Company Brain</a></li>
                <li><a href="#hyperagent" className="hover:text-white">Hyperagent</a></li>
                <li><a href="#trust" className="hover:text-white">Trust</a></li>
                <li><a href="#pricing" className="hover:text-white">Pricing</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Resources</h4>
              <ul className="mt-4 space-y-2.5 text-sm text-zinc-500">
                <li><a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-white"><GitHubIcon className="h-4 w-4" />GitHub</a></li>
                <li><a href="https://github.com/inbharatai/jak-swarm/blob/main/docs/multiplayer-ai.md" target="_blank" rel="noopener noreferrer" className="hover:text-white">Multiplayer documentation</a></li>
                <li><a href="https://github.com/inbharatai/jak-swarm/blob/main/ARCHITECTURE.md" target="_blank" rel="noopener noreferrer" className="hover:text-white">Architecture</a></li>
                <li><a href="https://github.com/inbharatai/jak-swarm/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer" className="hover:text-white">Security</a></li>
                <li><a href="mailto:contact@inbharat.ai" className="hover:text-white">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="mx-auto mt-10 flex max-w-7xl flex-col gap-2 border-t border-white/5 pt-6 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} JAK Swarm / InBharat AI</span>
            <span>Humans stay in control of high-risk actions.</span>
          </div>
        </footer>
      </main>
    </>
  );
}
