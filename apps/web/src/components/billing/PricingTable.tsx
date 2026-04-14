'use client';

import { useState, useEffect } from 'react';
import { usageApi } from '@/lib/api-client';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    credits: '200 / month',
    daily: '30 / day',
    models: 'Standard (Tier 1)',
    features: ['5 core agents', '1 vibe coding project', 'Community support'],
    highlighted: false,
    paddleLink: null,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$29',
    period: '/mo',
    credits: '3,000 / month',
    daily: '200 / day',
    models: 'All tiers (including Premium)',
    features: ['All 39 agents', '5 vibe coding projects', '500 premium credits', 'Email support'],
    highlighted: true,
    paddleLink: process.env.NEXT_PUBLIC_PADDLE_PRO_LINK ?? null,
  },
  {
    id: 'team',
    name: 'Team',
    price: '$99',
    period: '/mo',
    credits: '15,000 / month',
    daily: '600 / day',
    models: 'All tiers',
    features: ['All agents + custom', 'Unlimited projects', '3,000 premium credits', 'BYO API keys', 'Priority support'],
    highlighted: false,
    paddleLink: process.env.NEXT_PUBLIC_PADDLE_TEAM_LINK ?? null,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$249',
    period: '/mo',
    credits: '50,000 / month',
    daily: '2,000 / day',
    models: 'All tiers + custom',
    features: ['Everything in Team', '15,000 premium credits', 'SSO', 'Dedicated support', 'Custom integrations'],
    highlighted: false,
    paddleLink: null, // Contact sales
  },
];

export function PricingTable() {
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);

  useEffect(() => {
    usageApi.getUsage().then((data) => {
      setCurrentPlan(data.plan);
    }).catch(() => {});
  }, []);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {PLANS.map((plan) => {
        const isCurrent = currentPlan === plan.id;
        return (
          <div
            key={plan.id}
            className={`rounded-2xl p-6 transition-all ${
              plan.highlighted
                ? 'bg-gradient-to-b from-emerald-500/10 to-transparent border-emerald-500/30 border-2 ring-1 ring-emerald-500/20'
                : 'border border-white/10 bg-white/[0.02]'
            }`}
          >
            {plan.highlighted && (
              <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-2">Most Popular</div>
            )}

            <h3 className="text-lg font-display font-semibold text-white">{plan.name}</h3>
            <div className="flex items-baseline gap-1 mt-2 mb-4">
              <span className="text-3xl font-display font-bold text-white">{plan.price}</span>
              {plan.period && <span className="text-sm text-slate-500">{plan.period}</span>}
            </div>

            <div className="space-y-2 mb-6 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">{'●'}</span>
                <span>{plan.credits} credits</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-amber-400">{'●'}</span>
                <span>{plan.daily} daily limit</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-blue-400">{'●'}</span>
                <span>{plan.models}</span>
              </div>
            </div>

            <ul className="space-y-1.5 mb-6 text-xs text-slate-400">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {isCurrent ? (
              <button disabled className="w-full rounded-lg py-2.5 text-sm font-semibold bg-white/5 text-slate-500 border border-white/10 cursor-not-allowed">
                Current Plan
              </button>
            ) : plan.paddleLink ? (
              <a
                href={plan.paddleLink}
                className={`block w-full rounded-lg py-2.5 text-sm font-semibold text-center transition-all ${
                  plan.highlighted
                    ? 'bg-gradient-to-r from-emerald-500 to-amber-400 text-[#09090b] hover:opacity-90'
                    : 'bg-white/5 text-white border border-white/10 hover:bg-white/10'
                }`}
              >
                {plan.price === '$0' ? 'Get Started' : `Upgrade to ${plan.name}`}
              </a>
            ) : plan.id === 'enterprise' ? (
              <a
                href="mailto:contact@inbharat.ai?subject=Jaak Enterprise"
                className="block w-full rounded-lg py-2.5 text-sm font-semibold text-center bg-white/5 text-white border border-white/10 hover:bg-white/10"
              >
                Contact Sales
              </a>
            ) : (
              <button className="w-full rounded-lg py-2.5 text-sm font-semibold bg-white/5 text-white border border-white/10 hover:bg-white/10">
                Get Started
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
