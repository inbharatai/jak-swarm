/**
 * Plan definitions for Jaak managed AI.
 *
 * 1 credit ≈ $0.01 of AI compute cost to Jaak.
 * Plans are defined here and used by:
 *   - Registration (create free subscription)
 *   - Paddle webhooks (upgrade/downgrade)
 *   - Credit check middleware
 *   - Usage display
 */

export interface PlanDefinition {
  id: string;
  name: string;
  priceUsd: number;
  creditsTotal: number;      // Monthly credit allocation
  premiumTotal: number;      // Premium model (Tier 3) credits per month
  dailyCap: number;          // Max credits per day
  perTaskCap: number;        // Max credits per single task
  concurrentCap: number;     // Max concurrent workflows
  maxModelTier: number;      // 1=cheap, 2=balanced, 3=premium
  agents: 'core' | 'all';
  vibeCodingProjects: number;
  byoKeys: boolean;
}

export const PLANS: Record<string, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    creditsTotal: 200,
    premiumTotal: 0,
    dailyCap: 30,
    perTaskCap: 10,
    concurrentCap: 1,
    maxModelTier: 1,
    agents: 'core',
    vibeCodingProjects: 1,
    byoKeys: false,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceUsd: 29,
    creditsTotal: 3000,
    premiumTotal: 500,
    dailyCap: 200,
    perTaskCap: 50,
    concurrentCap: 3,
    maxModelTier: 3,
    agents: 'all',
    vibeCodingProjects: 5,
    byoKeys: false,
  },
  team: {
    id: 'team',
    name: 'Team',
    priceUsd: 99,
    creditsTotal: 15000,
    premiumTotal: 3000,
    dailyCap: 600,
    perTaskCap: 100,
    concurrentCap: 10,
    maxModelTier: 3,
    agents: 'all',
    vibeCodingProjects: -1, // unlimited
    byoKeys: true,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    priceUsd: 249,
    creditsTotal: 50000,
    premiumTotal: 15000,
    dailyCap: 2000,
    perTaskCap: 500,
    concurrentCap: 50,
    maxModelTier: 3,
    agents: 'all',
    vibeCodingProjects: -1,
    byoKeys: true,
  },
};

export function getPlan(planId: string): PlanDefinition {
  return PLANS[planId] ?? PLANS['free']!;
}
