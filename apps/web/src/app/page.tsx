import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';

async function getServerSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('jak_token');
  return token?.value ?? null;
}

/* ─── Data ──────────────────────────────────────────────────────────────────── */

const AGENTS = [
  {
    emoji: '\u{1F468}\u{200D}\u{1F4BC}',
    role: 'CEO Agent',
    description: 'Strategic planning, OKR generation, and cross-department coordination.',
    tasks: ['Quarterly planning', 'Resource allocation', 'Decision memos'],
  },
  {
    emoji: '\u{1F468}\u{200D}\u{1F4BB}',
    role: 'CTO Agent',
    description: 'Architecture decisions, code reviews, and tech stack evaluation.',
    tasks: ['System design', 'Tech debt audit', 'Vendor analysis'],
  },
  {
    emoji: '\u{1F4E3}',
    role: 'CMO Agent',
    description: 'Campaign strategy, content creation, and brand positioning.',
    tasks: ['Go-to-market plans', 'SEO audits', 'Social campaigns'],
  },
  {
    emoji: '\u{2699}\u{FE0F}',
    role: 'Engineer Agent',
    description: 'Code generation, debugging, testing, and CI/CD pipeline management.',
    tasks: ['Feature implementation', 'Bug fixes', 'PR reviews'],
  },
  {
    emoji: '\u{2696}\u{FE0F}',
    role: 'Legal Agent',
    description: 'Contract review, compliance checks, and policy drafting.',
    tasks: ['NDA review', 'GDPR compliance', 'Terms of service'],
  },
  {
    emoji: '\u{1F4C8}',
    role: 'Marketing Agent',
    description: 'Content writing, email sequences, and analytics reporting.',
    tasks: ['Blog posts', 'Email funnels', 'A/B test analysis'],
  },
];

const FEATURES = [
  { title: '74 Tools', description: 'File, code, browser, email, calendar, search, and more.' },
  { title: '22 Browser Tools', description: 'Full Puppeteer automation with screenshot and DOM extraction.' },
  { title: 'Real Gmail & Calendar', description: 'Native IMAP/SMTP and CalDAV integration. Not mocked.' },
  { title: 'MCP Gateway', description: 'Model Context Protocol for seamless tool orchestration.' },
  { title: 'Workflow Scheduling', description: 'Cron-based recurring workflows with Temporal or built-in runner.' },
  { title: 'Multi-Modal Vision', description: 'Screenshot analysis, image understanding, and visual QA.' },
];

const PRICING = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For individuals exploring AI automation.',
    features: ['5 workflows / day', '1 user', 'Basic agents', 'Community support', 'Public templates'],
    cta: 'Start Free',
    href: '/register',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$49',
    period: '/mo',
    description: 'For teams shipping with AI at scale.',
    features: [
      'Unlimited workflows',
      '5 team members',
      'All 33 agents',
      'All integrations',
      'Priority support',
      'Custom templates',
      'API access',
    ],
    cta: 'Start Pro',
    href: '/register',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For organizations with advanced needs.',
    features: [
      'Everything in Pro',
      'Unlimited team',
      'SSO / SAML',
      'Dedicated support',
      'SLA guarantee',
      'On-prem deployment',
      'Custom agent training',
    ],
    cta: 'Contact Us',
    href: 'mailto:contact@inbharat.ai',
    highlighted: false,
  },
];

const COMPARISON = [
  {
    feature: 'Autonomous agents',
    jak: '33 specialized',
    crewai: 'User-defined',
    langgraph: 'User-defined',
    devin: '1 (coding)',
  },
  {
    feature: 'Built-in tools',
    jak: '74',
    crewai: '~20',
    langgraph: 'BYO',
    devin: 'IDE only',
  },
  {
    feature: 'Browser automation',
    jak: '22 tools',
    crewai: 'Limited',
    langgraph: 'No',
    devin: 'Yes',
  },
  {
    feature: 'Real email / calendar',
    jak: 'Native',
    crewai: 'No',
    langgraph: 'No',
    devin: 'No',
  },
  {
    feature: 'Multi-model routing',
    jak: '6 providers',
    crewai: 'OpenAI',
    langgraph: 'Any',
    devin: 'Proprietary',
  },
  {
    feature: 'Open source',
    jak: 'MIT',
    crewai: 'MIT',
    langgraph: 'MIT',
    devin: 'No',
  },
  {
    feature: 'Self-hosted',
    jak: 'Yes',
    crewai: 'Yes',
    langgraph: 'Yes',
    devin: 'No',
  },
];

const FAQS = [
  {
    q: 'Is it really free?',
    a: 'Yes. The free tier gives you 5 workflows per day with basic agents. No credit card required. The open-source version is MIT-licensed and always free to self-host.',
  },
  {
    q: 'Do I need to code?',
    a: 'No. Describe your goal in plain English and the agents figure out the rest. Power users can customize agent behavior, tools, and workflows through the dashboard.',
  },
  {
    q: 'What LLMs does it support?',
    a: 'OpenAI (GPT-4o), Anthropic (Claude), Google (Gemini), DeepSeek, OpenRouter (100+ models), and local Ollama models. Tasks are automatically routed to the optimal model.',
  },
  {
    q: 'Can I self-host?',
    a: 'Absolutely. JAK Swarm is fully open source under the MIT license. Deploy on your own infrastructure with Docker Compose or Kubernetes. Your data never leaves your servers.',
  },
  {
    q: 'How is data secured?',
    a: 'All API keys are AES-256-GCM encrypted at rest. Role-based access control, approval workflows for sensitive operations, and full audit trails on every agent action.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes, cancel your subscription at any time with no penalties. Your data remains accessible for 30 days after cancellation.',
  },
];

/* ─── Icons (inline SVG to avoid extra dependencies) ────────────────────────── */

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */

export default async function HomePage() {
  const token = await getServerSession();
  if (token) {
    redirect('/home');
  }

  return (
    <main className="min-h-screen bg-background">
      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-white/5 bg-slate-900/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
              <span className="text-sm font-bold text-white">J</span>
            </div>
            <span className="text-lg font-bold text-white">JAK Swarm</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <a href="#agents" className="hover:text-white transition-colors">Agents</a>
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-slate-400 hover:text-white transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              Get Started
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── 1. Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-slate-900 px-4 pt-24 pb-32 sm:px-6 lg:px-8">
        {/* Gradient orbs */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-b from-blue-600/20 via-indigo-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 left-20 w-72 h-72 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 right-20 w-72 h-72 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* Grid pattern overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

        <div className="relative mx-auto max-w-5xl text-center">
          {/* Badge */}
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm backdrop-blur-sm">
            <span className="text-slate-400">Open Source</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">MIT Licensed</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">74 Tools</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">6 LLM Providers</span>
          </div>

          <h1 className="mb-6 text-5xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
            33 AI Agents. One Platform.{' '}
            <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              Your Entire Company, Automated.
            </span>
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-400 sm:text-xl">
            CEO, CTO, CMO, Engineer, Legal, Finance, HR — all autonomous.
            All working together. Deploy intelligent agent swarms that plan,
            execute, and deliver results.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-600/25 hover:bg-blue-500 hover:shadow-blue-500/30 transition-all hover:-translate-y-0.5"
            >
              Start Free
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="https://github.com/inbharatai/jak-swarm"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-8 py-3.5 text-base font-semibold text-white hover:bg-white/10 transition-all"
            >
              <GitHubIcon className="h-5 w-5" />
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ── 2. Social Proof Bar ─────────────────────────────────────────────── */}
      <section className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-sm font-medium text-slate-500 dark:text-slate-400 mb-6">
            Trusted by developers building the future of work
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <GitHubIcon className="h-5 w-5" />
              <span className="font-medium text-slate-600 dark:text-slate-300">Open Source on GitHub</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              <span>Built with Next.js + TypeScript</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              <span>33 Autonomous Agents</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
              <span>Production Ready</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. How It Works ─────────────────────────────────────────────────── */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">How it works</p>
            <h2 className="text-3xl font-bold sm:text-4xl">Three steps to autonomous operations</h2>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Describe Your Goal',
                description:
                  'Type what you need in plain English. "Draft a go-to-market plan for our new product" or "Review this contract for compliance issues."',
              },
              {
                step: '02',
                title: 'Agents Collaborate',
                description:
                  'A directed acyclic graph (DAG) of specialized agents is assembled. They plan, delegate, execute tools, and verify each other\u2019s work.',
              },
              {
                step: '03',
                title: 'Get Results',
                description:
                  'Compiled output delivered in your dashboard. Documents, code, emails, calendar events, reports \u2014 all with full audit trails.',
              },
            ].map((item) => (
              <div
                key={item.step}
                className="relative rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 transition-all duration-200 hover:shadow-lg hover:-translate-y-1"
              >
                <div className="mb-4 text-4xl font-bold text-slate-200 dark:text-slate-800">
                  {item.step}
                </div>
                <h3 className="mb-2 text-lg font-semibold">{item.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. Agent Showcase ───────────────────────────────────────────────── */}
      <section id="agents" className="px-4 py-24 sm:px-6 lg:px-8 bg-slate-50 dark:bg-slate-900/50">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">Agent Showcase</p>
            <h2 className="text-3xl font-bold sm:text-4xl">Meet your autonomous workforce</h2>
            <p className="mt-4 text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
              Each agent is a specialist with domain knowledge, dedicated tools, and the ability to collaborate with other agents.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {AGENTS.map((agent) => (
              <div
                key={agent.role}
                className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 transition-all duration-200 hover:shadow-lg hover:border-blue-200 dark:hover:border-blue-900 hover:-translate-y-1"
              >
                <div className="mb-4 text-3xl">{agent.emoji}</div>
                <h3 className="mb-2 text-lg font-semibold">{agent.role}</h3>
                <p className="mb-4 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {agent.description}
                </p>
                <div className="flex flex-wrap gap-2">
                  {agent.tasks.map((task) => (
                    <span
                      key={task}
                      className="rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-400"
                    >
                      {task}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. Features Grid ────────────────────────────────────────────────── */}
      <section id="features" className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">Capabilities</p>
            <h2 className="text-3xl font-bold sm:text-4xl">Everything you need for production AI</h2>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 transition-all duration-200 hover:shadow-lg hover:-translate-y-1"
              >
                <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6. Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="px-4 py-24 sm:px-6 lg:px-8 bg-slate-50 dark:bg-slate-900/50">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">Pricing</p>
            <h2 className="text-3xl font-bold sm:text-4xl">Simple, transparent pricing</h2>
            <p className="mt-4 text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
              Start free and scale as you grow. No hidden fees. Cancel anytime.
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-3 max-w-5xl mx-auto">
            {PRICING.map((tier) => (
              <div
                key={tier.name}
                className={`relative rounded-2xl border p-8 transition-all duration-200 hover:-translate-y-1 ${
                  tier.highlighted
                    ? 'border-blue-600 bg-white dark:bg-slate-900 shadow-xl shadow-blue-600/10 scale-[1.02] lg:scale-105'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:shadow-lg'
                }`}
              >
                {tier.highlighted && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white uppercase tracking-wider">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-2">{tier.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">{tier.price}</span>
                    {tier.period && (
                      <span className="text-slate-500 dark:text-slate-400">{tier.period}</span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{tier.description}</p>
                </div>

                <ul className="mb-8 space-y-3">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm">
                      <CheckIcon className="h-5 w-5 shrink-0 text-blue-600" />
                      <span className="text-slate-700 dark:text-slate-300">{feature}</span>
                    </li>
                  ))}
                </ul>

                {tier.href.startsWith('mailto:') ? (
                  <a
                    href={tier.href}
                    className={`block w-full rounded-xl py-3 text-center text-sm font-semibold transition-colors ${
                      tier.highlighted
                        ? 'bg-blue-600 text-white hover:bg-blue-500'
                        : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tier.cta}
                  </a>
                ) : (
                  <Link
                    href={tier.href}
                    className={`block w-full rounded-xl py-3 text-center text-sm font-semibold transition-colors ${
                      tier.highlighted
                        ? 'bg-blue-600 text-white hover:bg-blue-500'
                        : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tier.cta}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 7. Comparison Table ──────────────────────────────────────────────── */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">Comparison</p>
            <h2 className="text-3xl font-bold sm:text-4xl">How JAK Swarm compares</h2>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                  <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-400">Feature</th>
                  <th className="px-6 py-4 text-left font-semibold text-blue-600">JAK Swarm</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-400">CrewAI</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-400">LangGraph</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-600 dark:text-slate-400">Devin</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={`border-b border-slate-100 dark:border-slate-800/50 ${
                      i % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-900/30'
                    }`}
                  >
                    <td className="px-6 py-3.5 font-medium text-slate-700 dark:text-slate-300">{row.feature}</td>
                    <td className="px-6 py-3.5 font-semibold text-blue-600">{row.jak}</td>
                    <td className="px-6 py-3.5 text-slate-600 dark:text-slate-400">{row.crewai}</td>
                    <td className="px-6 py-3.5 text-slate-600 dark:text-slate-400">{row.langgraph}</td>
                    <td className="px-6 py-3.5 text-slate-600 dark:text-slate-400">{row.devin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── 8. FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className="px-4 py-24 sm:px-6 lg:px-8 bg-slate-50 dark:bg-slate-900/50">
        <div className="mx-auto max-w-3xl">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-3">FAQ</p>
            <h2 className="text-3xl font-bold sm:text-4xl">Frequently asked questions</h2>
          </div>

          <div className="space-y-6">
            {FAQS.map((faq) => (
              <div
                key={faq.q}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6"
              >
                <h3 className="font-semibold mb-2">{faq.q}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 9. CTA Section ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-slate-900 px-4 py-24 sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-600/10 to-transparent pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="text-4xl font-bold text-white mb-4 sm:text-5xl">
            Start Automating Today
          </h2>
          <p className="text-lg text-slate-400 mb-10 max-w-xl mx-auto">
            Deploy your autonomous AI workforce in minutes. Free to start, no credit card required.
          </p>
          <Link
            href="/register"
            className="group inline-flex items-center gap-2 rounded-xl bg-blue-600 px-10 py-4 text-base font-semibold text-white shadow-lg shadow-blue-600/25 hover:bg-blue-500 hover:shadow-blue-500/30 transition-all hover:-translate-y-0.5"
          >
            Get Started Free
            <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      {/* ── 10. Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 dark:border-slate-800 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
                <span className="text-sm font-bold text-white">J</span>
              </div>
              <span className="text-lg font-bold">JAK Swarm</span>
            </div>

            {/* Links */}
            <div className="flex items-center gap-6 text-sm text-slate-500 dark:text-slate-400">
              <a
                href="https://github.com/inbharatai/jak-swarm"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-700 dark:hover:text-white transition-colors flex items-center gap-1.5"
              >
                <GitHubIcon className="h-4 w-4" />
                GitHub
              </a>
              <a
                href="https://twitter.com/inbharatai"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-700 dark:hover:text-white transition-colors"
              >
                Twitter
              </a>
              <span>Built by InBharat AI</span>
            </div>

            {/* License */}
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                MIT License
              </span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
