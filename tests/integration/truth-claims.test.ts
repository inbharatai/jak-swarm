import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('Product truth claims', () => {
  it('keeps README agent/tool counters aligned with source of truth', () => {
    const readme = readRepoFile('README.md');
    const toolBuiltin = readRepoFile('packages/tools/src/builtin/index.ts');
    const agentRoles = readRepoFile('packages/shared/src/constants/agent-roles.ts');

    const toolCount = (toolBuiltin.match(/toolRegistry\.register\(/g) ?? []).length;
    const agentCount = (agentRoles.match(/\[AgentRole\./g) ?? []).length;

    const badgeAgent = readme.match(/AI_Agents-(\d+)/);
    // Tools badge was renamed from `Production_Tools-N` → `Classified_Tools-N`
    // in the strict-truth pass (53e92ae). Accept either form so historical
    // audits that cite the old badge keep working.
    const badgeTools = readme.match(/(?:Classified_Tools|Production_Tools)-(\d+)/);

    expect(badgeAgent?.[1]).toBe(String(agentCount));
    expect(badgeTools?.[1]).toBe(String(toolCount));

    // Keep narrative counters in sync too.
    expect(readme).toContain(`${agentCount} specialist agents`);
    // Accept either "classified tools" (current, honest) or "production tools"
    // (legacy — rejected elsewhere in truth-check, kept here for historical
    // branches that haven't rebased).
    const hasToolCount =
      readme.includes(`${toolCount} classified tools`) ||
      readme.includes(`${toolCount} production tools`);
    expect(hasToolCount, `README must contain "${toolCount} classified tools"`).toBe(true);
  });

  it('does not claim API keys are unnecessary for external providers', () => {
    const readme = readRepoFile('README.md').toLowerCase();
    expect(readme).not.toContain('no api keys required');
    expect(readme).toContain('api keys are required');
  });

  it('does not overstate production readiness in FAQ', () => {
    const readme = readRepoFile('README.md');
    const faqSection = readme.substring(readme.indexOf('Is JAK Swarm production-ready?'));
    // Should acknowledge staging-ready status and caveats
    expect(faqSection).toContain('staging-ready');
    expect(faqSection).toContain('v0.1.0');
  });

  it('integration maturity map covers all major providers', () => {
    const integrationRoutes = readRepoFile('apps/api/src/routes/integrations.routes.ts');
    // Must have explicit maturity classifications for key providers
    const requiredProviders = ['SLACK', 'GITHUB', 'NOTION', 'HUBSPOT', 'STRIPE', 'SALESFORCE', 'LINEAR', 'SUPABASE'];
    for (const provider of requiredProviders) {
      expect(integrationRoutes, `${provider} must have maturity classification`).toContain(`${provider}: {`);
    }
    // Community providers should be labeled partial, not production-ready
    expect(integrationRoutes).toContain("maturity: 'partial'");
    expect(integrationRoutes).toContain('Community-maintained');
  });

  it('architecture docs do not overstate production-grade claims', () => {
    const arch = readRepoFile('docs/architecture.md');
    expect(arch).not.toContain('production-grade');
    expect(arch).toContain('staging-ready');
  });

  // ─── Landing page numeric assertions (added 2026-04-20 truth audit) ─────
  // The landing page surfaces 4 counts: agents, tools, connectors, providers.
  // All four must match the code. These tests pin each count so any future
  // refactor that adds/removes agents/tools/integrations can't silently
  // drift the marketing copy — CI catches it.

  it('landing page stat card count: 38 agents matches AgentRole enum', () => {
    const agentRoleSrc = readRepoFile('packages/shared/src/types/agent.ts');
    const landing = readRepoFile('apps/web/src/app/page.tsx');

    // Count enum entries inside the AgentRole enum (not AgentStatus etc.)
    // AgentRole enum block starts with `export enum AgentRole {` and ends at
    // the first `}` on its own line.
    const roleBlock = agentRoleSrc.match(/export enum AgentRole \{([\s\S]*?)\n\}/);
    expect(roleBlock, 'AgentRole enum must exist in agent.ts').toBeTruthy();
    const entries = (roleBlock![1].match(/^\s+[A-Z_]+\s*=\s*'/gm) ?? []).length;

    // Landing page stat card declares `{ value: 38, label: 'Specialist Agents' }`.
    // Extract the numeric claim and assert it matches.
    const agentsClaim = landing.match(/\{\s*value:\s*(\d+),\s*label:\s*'(?:AI\s*|Specialist\s*)?Agents'/);
    expect(agentsClaim, 'landing page must declare an Agents stat card').toBeTruthy();
    expect(Number(agentsClaim![1])).toBe(entries);
  });

  it('landing page stat card count: 119 tools matches toolRegistry.register() calls', () => {
    const toolBuiltin = readRepoFile('packages/tools/src/builtin/index.ts');
    const landing = readRepoFile('apps/web/src/app/page.tsx');
    const premiumCta = readRepoFile('apps/web/src/components/landing/PremiumCTA.tsx');
    const layout = readRepoFile('apps/web/src/app/layout.tsx');

    const toolCount = (toolBuiltin.match(/toolRegistry\.register\(/g) ?? []).length;

    // Main landing stat card
    const toolsClaim = landing.match(/\{\s*value:\s*(\d+),\s*label:\s*'Classified Tools'/);
    expect(toolsClaim, 'landing page must declare a Classified Tools stat card').toBeTruthy();
    expect(Number(toolsClaim![1])).toBe(toolCount);

    // PremiumCTA footer — used to drift to stale "113"
    const ctaToolsClaim = premiumCta.match(/\{\s*value:\s*'(\d+)',\s*label:\s*'Tools'/);
    expect(ctaToolsClaim, 'PremiumCTA must declare a Tools counter').toBeTruthy();
    expect(Number(ctaToolsClaim![1])).toBe(toolCount);

    // layout.tsx site metadata narrative
    expect(layout).toContain(`${toolCount} classified tools`);
  });

  it('landing page INTEGRATIONS tile count matches the Connectors stat card', () => {
    const landing = readRepoFile('apps/web/src/app/page.tsx');

    // Count entries in INTEGRATIONS_CORE and INTEGRATIONS_INFRA arrays
    const coreBlock = landing.match(/const INTEGRATIONS_CORE = \[([\s\S]*?)\n\];/);
    const infraBlock = landing.match(/const INTEGRATIONS_INFRA = \[([\s\S]*?)\n\];/);
    expect(coreBlock, 'INTEGRATIONS_CORE array must exist').toBeTruthy();
    expect(infraBlock, 'INTEGRATIONS_INFRA array must exist').toBeTruthy();
    const coreCount = (coreBlock![1].match(/name:\s*'/g) ?? []).length;
    const infraCount = (infraBlock![1].match(/name:\s*'/g) ?? []).length;
    const totalTiles = coreCount + infraCount;

    // Connectors stat card must match the sum
    const connectorsClaim = landing.match(/\{\s*value:\s*(\d+),\s*label:\s*'Connectors'/);
    expect(connectorsClaim, 'landing page must declare a Connectors stat card').toBeTruthy();
    expect(Number(connectorsClaim![1])).toBe(totalTiles);

    // PremiumCTA footer integration count must match too
    const premiumCta = readRepoFile('apps/web/src/components/landing/PremiumCTA.tsx');
    const ctaIntegClaim = premiumCta.match(/\{\s*value:\s*'(\d+)',\s*label:\s*'Integrations'/);
    expect(ctaIntegClaim, 'PremiumCTA must declare an Integrations counter').toBeTruthy();
    expect(Number(ctaIntegClaim![1])).toBe(totalTiles);
  });

  it('WhatsApp is listed on landing (implementation at whatsapp.routes.ts exists)', () => {
    const landing = readRepoFile('apps/web/src/app/page.tsx');
    const whatsappRoute = readRepoFile('apps/api/src/routes/whatsapp.routes.ts');

    // WhatsApp route is real — more than a stub
    expect(whatsappRoute.length).toBeGreaterThan(1000);
    // And it must appear in the landing page integrations list
    expect(landing).toContain("name: 'WhatsApp'");
  });

  it('Sentry tile is labeled MCP (not implying SDK-level observability)', () => {
    const landing = readRepoFile('apps/web/src/app/page.tsx');
    const apiIndex = readRepoFile('apps/api/src/index.ts');

    // We do NOT import @sentry/node — we haven't wired the SDK
    expect(apiIndex).not.toContain('@sentry/node');
    // So the tile MUST say "Sentry MCP", not "Sentry" (the MCP-only reality)
    expect(landing).toContain("name: 'Sentry MCP'");
  });

  it('voice route does not leak a mock token in production', () => {
    const voiceRoute = readRepoFile('apps/api/src/routes/voice.routes.ts');
    // Pre-audit: returned `mock_token_${Date.now()}` + `isMock: true` when unconfigured.
    // Post-audit: throws 503 — no mock path in the codebase.
    expect(voiceRoute).not.toContain('mock_token_');
    expect(voiceRoute).not.toContain('isMock: true');
    // And the error code is discoverable by callers
    expect(voiceRoute).toContain('VOICE_NOT_CONFIGURED');
  });

  it('Paddle does not silently match placeholder price IDs', () => {
    const paddleRoute = readRepoFile('apps/api/src/routes/paddle.routes.ts');
    // Pre-audit: `?? 'pri_pro_placeholder'` defaults. A Paddle webhook with
    // a real price would never match and subscriptions would silently not link.
    expect(paddleRoute).not.toContain('pri_pro_placeholder');
    expect(paddleRoute).not.toContain('pri_team_placeholder');
    expect(paddleRoute).not.toContain('pri_enterprise_placeholder');
  });
});
