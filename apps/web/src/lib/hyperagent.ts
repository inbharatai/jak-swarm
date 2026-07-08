/**
 * hyperagent.ts — HyperAgent Control Centre web client (Phase 13).
 *
 * Typed fetchers for the 9 control-centre views exposed by the API at
 * /hyperagent/* (apps/api/src/routes/hyperagent.routes.ts). Each fetcher
 * unwraps the `{ success: true, data }` envelope via `dataFetcher` and
 * returns the shared view model (`@jak-swarm/shared` control-centre types).
 *
 * Honesty contract: the view models carry `dataAvailable` + a `note`. The
 * React layer renders real data when present and an honest empty state
 * (the note) when `dataAvailable === false` — NEVER a fabricated "all healthy".
 */
import { dataFetcher } from './api-client';
import type {
  OverviewView,
  RunsView,
  LearningsView,
  OptimizationsView,
  ExperimentsView,
  GovernanceView,
  AgentFleetView,
  AutonomyView,
  ShieldView,
} from '@jak-swarm/shared';

export const hyperagentApi = {
  overview: () => dataFetcher<OverviewView>('/hyperagent/overview'),
  runs: () => dataFetcher<RunsView>('/hyperagent/runs'),
  learnings: () => dataFetcher<LearningsView>('/hyperagent/learnings'),
  optimizations: () => dataFetcher<OptimizationsView>('/hyperagent/optimizations'),
  experiments: () => dataFetcher<ExperimentsView>('/hyperagent/experiments'),
  governance: () => dataFetcher<GovernanceView>('/hyperagent/governance'),
  agentFleet: () => dataFetcher<AgentFleetView>('/hyperagent/agent-fleet'),
  autonomy: () => dataFetcher<AutonomyView>('/hyperagent/autonomy'),
  shield: () => dataFetcher<ShieldView>('/hyperagent/shield'),
};

// Re-export the view types for the page components.
export type {
  OverviewView,
  RunsView,
  LearningsView,
  OptimizationsView,
  ExperimentsView,
  GovernanceView,
  AgentFleetView,
  AutonomyView,
  ShieldView,
} from '@jak-swarm/shared';