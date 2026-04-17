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
    const badgeTools = readme.match(/Production_Tools-(\d+)/);

    expect(badgeAgent?.[1]).toBe(String(agentCount));
    expect(badgeTools?.[1]).toBe(String(toolCount));

    // Keep narrative counters in sync too.
    expect(readme).toContain(`${agentCount} AI agents`);
    expect(readme).toContain(`${toolCount} production tools`);
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
});
