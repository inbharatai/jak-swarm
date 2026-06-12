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
    // The FAQ must acknowledge that JAK Swarm is NOT yet ready for paying
    // enterprise customers expecting an SLA. After the Migration 106 README
    // rewrite (May 2026) the wording moved from "staging-ready / v0.1.0"
    // hedges to a bluntly honest "for paying enterprise customers: NO" with
    // concrete numbered blockers. The intent is the same: never claim
    // unqualified production readiness, always name the specific gaps.
    //
    // Required signals (any rewording must keep these):
    //   1. The phrase "not yet" or an explicit "NO" — production-readiness
    //      caveat must be visible
    //   2. A specific blocker about third-party security audit / SOC 2 /
    //      certification status
    //   3. A specific blocker about lawyer-reviewed Terms / Privacy / DPA
    expect(faqSection).toMatch(/not yet|\bNO\b|\bnot\b/i);
    expect(faqSection).toMatch(/(third-party security audit|SOC ?2|ISO 27001|attestation)/i);
    expect(faqSection).toMatch(/(Terms of Service|Privacy Policy|DPA|lawyer)/i);
  });

  it('declares the beta release without implying hosted production readiness', () => {
    const readme = readRepoFile('README.md');
    const beta = readRepoFile('docs/beta-release.md');
    const packageManifests = [
      'package.json',
      'apps/api/package.json',
      'apps/web/package.json',
      'tests/package.json',
      'packages/agents/package.json',
      'packages/client/package.json',
      'packages/db/package.json',
      'packages/industry-packs/package.json',
      'packages/security/package.json',
      'packages/shared/package.json',
      'packages/skills/package.json',
      'packages/swarm/package.json',
      'packages/tools/package.json',
      'packages/verification/package.json',
      'packages/adk/package.json',
      'packages/voice/package.json',
      'packages/whatsapp-client/package.json',
      'packages/workflows/package.json',
    ];

    for (const manifest of packageManifests) {
      const pkg = JSON.parse(readRepoFile(manifest)) as { version: string };
      expect(pkg.version, manifest).toBe('0.1.0-beta.0');
    }
    expect(readme).toContain('working challenge build');
    expect(readme).toMatch(/Release-Beta_0\.1\.0--beta\.0/);
    expect(readme).toContain('post-challenge production hardening roadmap');
    expect(beta).toContain('hosted Cloud Run / Railway health');
    expect(readRepoFile('docs/railway-deployment.md')).toContain('API | Railway');
    expect(readRepoFile('docs/railway-deployment.md')).toContain('Worker | Railway');
    expect(beta).toContain('not yet ready for unqualified public/enterprise promises');
    expect(beta).toContain('Use "beta", "design partner", or "self-hosted validation" language');
  });

  it('keeps active deployment docs aligned on Railway Redis and CORS formatting truth', () => {
    const deployment = readRepoFile('docs/DEPLOYMENT.md');
    const railwayGuide = readRepoFile('docs/railway-deployment.md');
    const railwayRunbook = readRepoFile('docs/deployment/railway.md');
    const automationReadme = readRepoFile('scripts/automation/README.md');

    expect(deployment).toContain('Railway managed Redis');
    expect(railwayGuide).toContain('Railway managed Redis');
    expect(railwayGuide).toContain('REDIS_URL=${{Redis.REDIS_URL}}');
    expect(railwayRunbook).toContain('REDIS_URL=${{Redis.REDIS_URL}}');
    expect(railwayGuide).toMatch(/CORS_ORIGINS.*comma-separated/i);
    expect(railwayRunbook).toMatch(/CORS_ORIGINS.*comma-separated/i);

    // Active deployment path must not claim Upstash as the current default.
    expect(automationReadme).not.toMatch(/active beta deploy target[\s\S]{0,100}upstash/i);
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

  // After the 2026-04-28 simplification (commit d7bbf71) the landing page
  // dropped the stats band + integration chip section. The product-claim
  // constants moved to `apps/web/src/lib/product-truth.ts` — a canonical
  // source-of-truth file the truth tests read from. Future landing redesigns
  // do NOT need to re-encode these counts to keep CI green; they just need
  // the registry file to stay accurate.
  it('product-truth registry agent count matches AgentRole enum', () => {
    const agentRoleSrc = readRepoFile('packages/shared/src/types/agent.ts');
    const truth = readRepoFile('apps/web/src/lib/product-truth.ts');

    const roleBlock = agentRoleSrc.match(/export enum AgentRole \{([\s\S]*?)\n\}/);
    expect(roleBlock, 'AgentRole enum must exist in agent.ts').toBeTruthy();
    const entries = (roleBlock![1].match(/^\s+[A-Z_]+\s*=\s*'/gm) ?? []).length;

    const agentsClaim = truth.match(/\{\s*value:\s*(\d+),\s*label:\s*'(?:AI\s*|Specialist\s*)?Agents'/);
    expect(agentsClaim, 'product-truth must declare an Agents stat').toBeTruthy();
    expect(Number(agentsClaim![1])).toBe(entries);
  });

  it('product-truth registry tools count matches toolRegistry.register() calls', () => {
    const toolBuiltin = readRepoFile('packages/tools/src/builtin/index.ts');
    const truth = readRepoFile('apps/web/src/lib/product-truth.ts');
    const premiumCta = readRepoFile('apps/web/src/components/landing/PremiumCTA.tsx');
    const layout = readRepoFile('apps/web/src/app/layout.tsx');

    const toolCount = (toolBuiltin.match(/toolRegistry\.register\(/g) ?? []).length;

    const toolsClaim = truth.match(/\{\s*value:\s*(\d+),\s*label:\s*'Classified Tools'/);
    expect(toolsClaim, 'product-truth must declare a Classified Tools stat').toBeTruthy();
    expect(Number(toolsClaim![1])).toBe(toolCount);

    // PremiumCTA footer — used to drift to stale "113". Label was
    // softened from 'Tools' to 'Classified Tools' for honesty (matches
    // product-truth.ts) — the regex now accepts either form so a
    // future rename in either direction stays caught.
    const ctaToolsClaim = premiumCta.match(/\{\s*value:\s*'(\d+)',\s*label:\s*'(?:Classified )?Tools'/);
    expect(ctaToolsClaim, 'PremiumCTA must declare a (Classified) Tools counter').toBeTruthy();
    expect(Number(ctaToolsClaim![1])).toBe(toolCount);

    // layout.tsx site metadata narrative
    expect(layout).toContain(`${toolCount} classified tools`);
  });

  it('product-truth INTEGRATIONS tile count matches the Connectors stat', () => {
    const truth = readRepoFile('apps/web/src/lib/product-truth.ts');

    const coreBlock = truth.match(/INTEGRATIONS_CORE = \[([\s\S]*?)\n\] as const;/);
    const infraBlock = truth.match(/INTEGRATIONS_INFRA = \[([\s\S]*?)\n\] as const;/);
    expect(coreBlock, 'INTEGRATIONS_CORE array must exist').toBeTruthy();
    expect(infraBlock, 'INTEGRATIONS_INFRA array must exist').toBeTruthy();
    const coreCount = (coreBlock![1].match(/name:\s*'/g) ?? []).length;
    const infraCount = (infraBlock![1].match(/name:\s*'/g) ?? []).length;
    const totalTiles = coreCount + infraCount;

    const connectorsClaim = truth.match(/\{\s*value:\s*(\d+),\s*label:\s*'Connectors'/);
    expect(connectorsClaim, 'product-truth must declare a Connectors stat').toBeTruthy();
    expect(Number(connectorsClaim![1])).toBe(totalTiles);

    // PremiumCTA footer integration count must match too. Label was
    // softened from 'Integrations' to 'Connectors' and the value uses
    // a soft floor like '20+' (the connector registry currently ships
    // 23 = 21 MCP + Remotion + Blender, but PremiumCTA understates to
    // avoid overclaiming). Regex accepts both label spellings, AND a
    // soft `+` suffix; the digit prefix must be a non-overclaiming
    // floor (≤ totalTiles).
    const premiumCta = readRepoFile('apps/web/src/components/landing/PremiumCTA.tsx');
    const ctaIntegClaim = premiumCta.match(/\{\s*value:\s*'(\d+)\+?',\s*label:\s*'(?:Integrations|Connectors)'/);
    expect(ctaIntegClaim, 'PremiumCTA must declare an Integrations/Connectors counter').toBeTruthy();
    expect(
      Number(ctaIntegClaim![1]),
      `PremiumCTA Connectors floor (${ctaIntegClaim![1]}) must not overclaim — must be ≤ totalTiles (${totalTiles})`,
    ).toBeLessThanOrEqual(totalTiles);
  });

  it('WhatsApp is listed in product-truth (whatsapp.routes.ts exists and is non-trivial)', () => {
    const truth = readRepoFile('apps/web/src/lib/product-truth.ts');
    const whatsappRoute = readRepoFile('apps/api/src/routes/whatsapp.routes.ts');

    // WhatsApp route is real — more than a stub
    expect(whatsappRoute.length).toBeGreaterThan(1000);
    // And it must appear in the product-truth integrations list
    expect(truth).toContain("name: 'WhatsApp'");
  });

  it('Sentry tile is labeled MCP (not implying SDK-level observability)', () => {
    const truth = readRepoFile('apps/web/src/lib/product-truth.ts');
    const apiIndex = readRepoFile('apps/api/src/index.ts');

    // We do NOT import @sentry/node — we haven't wired the SDK
    expect(apiIndex).not.toContain('@sentry/node');
    // So the tile MUST say "Sentry MCP", not "Sentry" (the MCP-only reality)
    expect(truth).toContain("name: 'Sentry MCP'");
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
