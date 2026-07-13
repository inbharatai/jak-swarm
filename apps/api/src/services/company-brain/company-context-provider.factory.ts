/**
 * Company Brain agent-context provider factory.
 *
 * The single authoritative assembly point for the `CompanyContextProvider`
 * wired into `BaseAgent.companyContextProvider` at API boot. It formally
 * provides BOTH:
 *   - `getApprovedProfile` — the stable approved CompanyProfile, and
 *   - `getContextPackage` — the task-specific, permission-filtered Graph V2
 *     evidence package.
 *
 * This factory exists so the wiring is testable without booting Fastify, and
 * so the contract is explicit: an agent provider that silently omits
 * `getContextPackage` can no longer hide behind an optional cast — the
 * `CompanyContextProvider` interface now requires it.
 *
 * Role and tenant are never taken from an HTTP body here. They arrive from the
 * trusted `AgentContext` (the agent's own role enum + the authenticated
 * tenantId) via the PromptBuilder call site.
 */
import type { CompanyContextProvider } from '@jak-swarm/agents';
import type { FastifyBaseLogger } from 'fastify';
import type { CompanyProfileService } from './company-profile.service.js';
import type { CompanyBrainV2Service } from './company-brain-v2.service.js';

export interface CompanyContextProviderDeps {
  profileSvc: CompanyProfileService;
  brainSvc: CompanyBrainV2Service;
  log: FastifyBaseLogger;
}

export function createCompanyContextProvider(deps: CompanyContextProviderDeps): CompanyContextProvider {
  const { profileSvc, brainSvc, log } = deps;

  return {
    getApprovedProfile: async (tenantId: string) => {
      try {
        const row = await profileSvc.getApproved(tenantId);
        if (!row) return null;
        return {
          name: row.name,
          industry: row.industry,
          description: row.description,
          productsServices: row.productsServices,
          targetCustomers: row.targetCustomers,
          brandVoice: row.brandVoice,
          competitors: row.competitors,
          pricing: row.pricing,
          websiteUrl: row.websiteUrl,
          goals: row.goals,
          constraints: row.constraints,
          preferredChannels: row.preferredChannels,
        };
      } catch {
        // Schema may not be deployed yet (migration 16 pending). Return null
        // so agents fall back to their default system prompt.
        return null;
      }
    },

    getContextPackage: async (input) => {
      try {
        return await brainSvc.getContextPackage(input);
      } catch (error) {
        // Graph V2 may not be migrated yet, or retrieval failed. Non-blocking:
        // the agent continues with the approved CompanyProfile alone, but
        // observably — never silently. The PromptBuilder also logs the empty
        // / injected outcomes; this logs the unavailable/failed boundary.
        log.warn(
          { tenantId: input.tenantId, agentRole: input.agentRole, err: error instanceof Error ? error.message : String(error) },
          '[company-brain] getContextPackage unavailable — Graph V2 not migrated or retrieval failed; agents continue with approved CompanyProfile only',
        );
        return null;
      }
    },
  };
}