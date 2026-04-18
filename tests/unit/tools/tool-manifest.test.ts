import { describe, it, expect, beforeAll } from 'vitest';
import { toolRegistry } from '../../../packages/tools/src/registry/tool-registry.js';
import { registerBuiltinTools } from '../../../packages/tools/src/builtin/index.js';

beforeAll(() => {
  if (toolRegistry.list().length === 0) registerBuiltinTools();
});

describe('ToolRegistry.getManifest()', () => {
  it('returns a non-zero total matching the registered tools count', () => {
    const m = toolRegistry.getManifest();
    expect(m.total).toBe(toolRegistry.list().length);
    expect(m.total).toBeGreaterThan(100);
  });

  it('buckets every tool by maturity (sum of buckets equals total)', () => {
    const m = toolRegistry.getManifest();
    const sum = Object.values(m.byMaturity).reduce((a, b) => a + b, 0);
    expect(sum).toBe(m.total);
  });

  it('classifies the known LLM-passthrough stubs explicitly', () => {
    const passthroughExemplars = ['classify_text', 'find_availability', 'search_deals', 'classify_ticket', 'lookup_customer'];
    for (const name of passthroughExemplars) {
      const tool = toolRegistry.get(name);
      expect(tool, `${name} should be registered`).toBeDefined();
      expect(tool?.metadata.maturity, `${name} should be llm_passthrough`).toBe('llm_passthrough');
    }
  });

  it('classifies the known real / config-dependent integrations explicitly', () => {
    const expectations: Array<[name: string, maturity: string]> = [
      ['read_email', 'config_dependent'],
      ['draft_email', 'config_dependent'],
      ['send_email', 'config_dependent'],
      ['github_create_repo', 'config_dependent'],
      ['analyze_email_risk', 'config_dependent'],
      ['verify_email_deliverability', 'real'],
      ['browser_navigate', 'real'],
      ['code_execute', 'real'],
      ['web_search', 'real'],
      ['score_lead', 'heuristic'],
    ];
    for (const [name, expected] of expectations) {
      const tool = toolRegistry.get(name);
      expect(tool, `${name} should be registered`).toBeDefined();
      expect(tool?.metadata.maturity, `${name} expected maturity '${expected}'`).toBe(expected);
    }
  });

  it('exposes Gmail env-var requirements on email tools', () => {
    const send = toolRegistry.get('send_email');
    expect(send?.metadata.requiredEnvVars).toEqual(
      expect.arrayContaining(['GMAIL_EMAIL', 'GMAIL_APP_PASSWORD']),
    );
  });

  it('reports unclassified tools so the truth-check can surface coverage gaps', () => {
    const m = toolRegistry.getManifest();
    // We've explicitly classified ~13 tools; the rest are unclassified by design.
    expect(m.byMaturity.unclassified).toBeGreaterThan(0);
    expect(m.unclassifiedNames.length).toBe(m.byMaturity.unclassified);
  });

  it('counts requiresApproval tools (sanity)', () => {
    const m = toolRegistry.getManifest();
    expect(m.requiresApproval).toBeGreaterThan(0);
    expect(m.requiresApproval).toBeLessThan(m.total);
  });
});
