import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../../packages/tools/src/registry/tool-registry.js';
import { ToolCategory, ToolRiskClass } from '../../../packages/shared/src/types/tool.js';

function sampleMetadata(name: string) {
  return {
    name,
    description: `Test tool ${name}`,
    category: ToolCategory.CRM,
    riskClass: ToolRiskClass.READ_ONLY,
    requiresApproval: false,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object' },
    version: '1.0.0',
  };
}

describe('ToolRegistry duplicate registration', () => {
  // Use singleton, but deregister our test tools between runs to avoid
  // clashing with registerBuiltinTools in other tests.
  const registry = ToolRegistry.getInstance();
  const testName = '__test_duplicate_tool__';

  beforeEach(() => {
    registry.deregister(testName);
  });

  it('throws when the same tool name is registered twice without override', () => {
    registry.register(sampleMetadata(testName), async () => ({ ok: true }));

    expect(() =>
      registry.register(sampleMetadata(testName), async () => ({ ok: false })),
    ).toThrow(/Duplicate tool registration/);

    registry.deregister(testName);
  });

  it('allows explicit override with { allowOverride: true }', () => {
    registry.register(sampleMetadata(testName), async () => ({ version: 'first' }));

    expect(() =>
      registry.register(sampleMetadata(testName), async () => ({ version: 'second' }), {
        allowOverride: true,
      }),
    ).not.toThrow();

    registry.deregister(testName);
  });

  it('does not throw on the first registration', () => {
    expect(() =>
      registry.register(sampleMetadata(testName), async () => ({ ok: true })),
    ).not.toThrow();

    registry.deregister(testName);
  });
});

describe('verify_email rename (split into two tools)', () => {
  const registry = ToolRegistry.getInstance();

  it('no longer exposes the ambiguous "verify_email" name', async () => {
    // registerBuiltinTools may have been auto-invoked via index.ts side-effects.
    // Touch the registry to ensure the builtins are present.
    if (registry.list().length === 0) {
      const mod = await import('../../../packages/tools/src/builtin/index.js');
      mod.registerBuiltinTools();
    }

    expect(registry.has('verify_email')).toBe(false);
  });

  it('exposes verify_email_deliverability (CRM) and analyze_email_risk (RESEARCH)', async () => {
    if (registry.list().length === 0) {
      const mod = await import('../../../packages/tools/src/builtin/index.js');
      mod.registerBuiltinTools();
    }

    const deliverability = registry.get('verify_email_deliverability');
    const risk = registry.get('analyze_email_risk');

    expect(deliverability?.metadata.category).toBe(ToolCategory.CRM);
    expect(risk?.metadata.category).toBe(ToolCategory.RESEARCH);
  });
});
