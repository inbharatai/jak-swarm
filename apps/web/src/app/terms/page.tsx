import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — JAK Swarm',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 inline-block">&larr; Back to home</Link>
        <h1 className="text-3xl font-display font-bold mb-8">Terms of Service</h1>
        <div className="prose dark:prose-invert prose-sm max-w-none space-y-6 text-muted-foreground">
          <p><strong>Last updated:</strong> April 2026</p>

          <h2 className="text-xl font-display font-semibold text-foreground">1. Acceptance</h2>
          <p>By using JAK Swarm, you agree to these terms. JAK Swarm is provided by InBharat AI.</p>

          <h2 className="text-xl font-display font-semibold text-foreground">2. Service Description</h2>
          <p>JAK Swarm is an open-source multi-agent AI platform. The hosted version provides managed infrastructure for running autonomous agent workflows, vibe coding, and integrations.</p>

          <h2 className="text-xl font-display font-semibold text-foreground">3. User Responsibilities</h2>
          <p>You are responsible for the content you generate using JAK Swarm agents. You must not use the platform to generate harmful, illegal, or deceptive content. You are responsible for securing your API keys and credentials.</p>

          <h2 className="text-xl font-display font-semibold text-foreground">4. Data & Privacy</h2>
          <p>We process data as described in our <Link href="/privacy" className="text-emerald-400 hover:underline">Privacy Policy</Link>. Your workflow data, agent outputs, and generated code remain yours.</p>

          <h2 className="text-xl font-display font-semibold text-foreground">5. API Usage & Costs</h2>
          <p>LLM API costs are billed to your own managed AI backend keys. JAK Swarm does not mark up API costs. Platform subscription fees are separate from API usage costs.</p>

          <h2 className="text-xl font-display font-semibold text-foreground">6. Open Source License</h2>
          <p>The JAK Swarm codebase is licensed under the MIT License. You may self-host, modify, and distribute the software according to the license terms.</p>

          <h2 className="text-xl font-display font-semibold text-foreground">7. Limitation of Liability</h2>
          <p>JAK Swarm is provided &ldquo;as is&rdquo; without warranty. We are not liable for any damages arising from the use of AI-generated content, code, or automated actions.</p>

          <h2 className="text-xl font-display font-semibold text-foreground">8. Contact</h2>
          <p>Questions about these terms? Email <a href="mailto:contact@inbharat.ai" className="text-emerald-400 hover:underline">contact@inbharat.ai</a>.</p>
        </div>
      </div>
    </main>
  );
}
