'use client';

import { UsageDashboard } from '@/components/billing/UsageDashboard';
import { PricingTable } from '@/components/billing/PricingTable';

export default function BillingPage() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-10">
      {/* Current usage */}
      <UsageDashboard />

      {/* Plan comparison */}
      <div>
        <h2 className="text-lg font-display font-semibold text-white mb-2">Plans</h2>
        <p className="text-sm text-slate-400 mb-6">Choose the right plan for your usage. Upgrade or downgrade anytime.</p>
        <PricingTable />
      </div>
    </div>
  );
}
