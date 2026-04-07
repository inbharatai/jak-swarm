import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — JAK Swarm',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#09090b] text-white px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition-colors mb-8 inline-block">&larr; Back to home</Link>
        <h1 className="text-3xl font-display font-bold mb-8">Privacy Policy</h1>
        <div className="prose prose-invert prose-sm max-w-none space-y-6 text-slate-300">
          <p><strong>Last updated:</strong> April 2026</p>

          <h2 className="text-xl font-display font-semibold text-white">1. What We Collect</h2>
          <p>When you use JAK Swarm, we collect: account information (email, name), workflow data (goals, agent outputs, traces), generated code and project files, and usage analytics (token counts, costs, workflow durations).</p>

          <h2 className="text-xl font-display font-semibold text-white">2. How We Use Your Data</h2>
          <p>Your data is used to: execute agent workflows on your behalf, store and display your projects and files, improve the platform (aggregated, anonymized metrics only), and provide customer support.</p>

          <h2 className="text-xl font-display font-semibold text-white">3. Data Storage & Security</h2>
          <p>Data is stored in PostgreSQL (Supabase) with row-level tenant isolation. Integration credentials are encrypted using AES-256-GCM. API keys are stored as one-way hashes. All data in transit uses TLS 1.3.</p>

          <h2 className="text-xl font-display font-semibold text-white">4. Third-Party Services</h2>
          <p>JAK Swarm connects to LLM providers (OpenAI, Anthropic, Google) using your own API keys. We do not store or access your LLM API keys beyond the encrypted credential store. Integration data (Gmail, Slack, GitHub) passes through our servers to execute agent tasks.</p>

          <h2 className="text-xl font-display font-semibold text-white">5. Your Rights</h2>
          <p>You may request export or deletion of your data at any time by contacting <a href="mailto:contact@inbharat.ai" className="text-emerald-400 hover:underline">contact@inbharat.ai</a>. Self-hosted deployments retain full control of all data.</p>

          <h2 className="text-xl font-display font-semibold text-white">6. Data Retention</h2>
          <p>Workflow traces are retained according to your tenant settings (default: 90 days). Project files are retained until you delete the project. Account data is retained until you request deletion.</p>

          <h2 className="text-xl font-display font-semibold text-white">7. Open Source</h2>
          <p>JAK Swarm is open source (MIT license). You can inspect exactly how data is handled by reviewing the <a href="https://github.com/inbharatai/jak-swarm" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">source code</a>.</p>

          <h2 className="text-xl font-display font-semibold text-white">8. Contact</h2>
          <p>For privacy questions: <a href="mailto:contact@inbharat.ai" className="text-emerald-400 hover:underline">contact@inbharat.ai</a></p>
        </div>
      </div>
    </main>
  );
}
