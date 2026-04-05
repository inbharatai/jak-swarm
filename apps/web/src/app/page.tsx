import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import {
  ArrowRight,
  Zap,
  Shield,
  BarChart3,
  Globe,
  Cpu,
  FileText,
  HeartPulse,
  Scale,
  ShoppingCart,
  Truck,
  Factory,
  GraduationCap,
  Building2,
  Utensils,
} from 'lucide-react';

// Check if user has a token cookie (server-side)
async function getServerSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('jak_token');
  return token?.value ?? null;
}

const FEATURES = [
  {
    icon: Zap,
    title: 'Lightning-Fast Swarms',
    description: 'Spawn specialized agents in milliseconds. Orchestrate complex workflows with intelligent task decomposition.',
  },
  {
    icon: Shield,
    title: 'Enterprise-Grade Security',
    description: 'Role-based access control, approval workflows, risk assessment, and full audit trails for every action.',
  },
  {
    icon: BarChart3,
    title: 'Real-Time Observability',
    description: 'Live trace viewer, cost/latency analytics, and swarm inspector to understand every agent decision.',
  },
  {
    icon: Globe,
    title: 'Industry-Aware Intelligence',
    description: 'Pre-configured industry packs with domain-specific knowledge, tools, and compliance policies.',
  },
  {
    icon: Cpu,
    title: 'Multi-Model Support',
    description: 'Route tasks to the optimal model — GPT-4o, Claude, Gemini — based on task type and cost targets.',
  },
  {
    icon: FileText,
    title: 'Knowledge Memory',
    description: 'Persistent tenant memory across sessions. Agents learn from past workflows and user preferences.',
  },
];

const INDUSTRIES = [
  { name: 'Finance', icon: BarChart3, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-900/20' },
  { name: 'Healthcare', icon: HeartPulse, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20' },
  { name: 'Legal', icon: Scale, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  { name: 'Retail', icon: ShoppingCart, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  { name: 'Logistics', icon: Truck, color: 'text-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
  { name: 'Manufacturing', icon: Factory, color: 'text-slate-500', bg: 'bg-slate-50 dark:bg-slate-900/20' },
  { name: 'Technology', icon: Cpu, color: 'text-indigo-500', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
  { name: 'Real Estate', icon: Building2, color: 'text-teal-500', bg: 'bg-teal-50 dark:bg-teal-900/20' },
  { name: 'Education', icon: GraduationCap, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  { name: 'Hospitality', icon: Utensils, color: 'text-pink-500', bg: 'bg-pink-50 dark:bg-pink-900/20' },
];

export default async function HomePage() {
  const token = await getServerSession();
  if (token) {
    redirect('/home');
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold">JAK Swarm</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Get Started
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
        {/* Background gradient */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="absolute left-1/2 top-0 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-background/80 px-4 py-1.5 text-sm backdrop-blur-sm">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-muted-foreground">Now in production</span>
          </div>

          <h1 className="mb-6 text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
            Your intelligent{' '}
            <span className="gradient-text">swarm is ready</span>
          </h1>

          <p className="mb-10 text-xl text-muted-foreground max-w-2xl mx-auto">
            Deploy autonomous AI agent swarms across your enterprise workflows.
            Orchestrate research, analysis, code, and communication — with full
            observability, approvals, and control.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 transition-all hover:shadow-xl hover:-translate-y-0.5"
            >
              Get Started Free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl border px-8 py-3.5 text-base font-semibold hover:bg-accent transition-all"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Industries */}
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Built for every industry</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Pre-configured industry packs with domain-specific tools, knowledge, and compliance policies.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {INDUSTRIES.map(industry => {
              const Icon = industry.icon;
              return (
                <div
                  key={industry.name}
                  className={`flex flex-col items-center gap-3 rounded-xl border p-6 text-center card-hover cursor-pointer ${industry.bg}`}
                >
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-white dark:bg-background shadow-sm`}>
                    <Icon className={`h-6 w-6 ${industry.color}`} />
                  </div>
                  <span className="text-sm font-medium">{industry.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-4 py-20 sm:px-6 lg:px-8 bg-muted/30">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Everything you need for production AI</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              JAK Swarm is designed for teams that need reliability, observability, and control.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(feature => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="rounded-xl border bg-card p-6 space-y-3 card-hover"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-4xl font-bold mb-6">
            Ready to deploy your swarm?
          </h2>
          <p className="text-xl text-muted-foreground mb-10">
            Join enterprises deploying autonomous AI across finance, healthcare, legal, and more.
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-10 py-4 text-base font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 transition-all hover:shadow-xl hover:-translate-y-0.5"
          >
            Get Started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <p>© 2026 JAK Swarm. Autonomous Agent Platform.</p>
      </footer>
    </main>
  );
}
